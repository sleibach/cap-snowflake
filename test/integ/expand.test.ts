/**
 * Integration tests for $expand / JOIN behaviour using raw SQL on Snowflake.
 *
 * Runs against a real Snowflake instance when credentials are available.
 */

import { expect } from 'chai';
import cds from '@sap/cds';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const PRIVATE_CONFIG_PATHS = [
  join(ROOT, '.cdsrc-private.json'),
  join(ROOT, 'test/e2e/fixtures/.cdsrc-private.json'),
];
const privateConfigPath = PRIVATE_CONFIG_PATHS.find(p => existsSync(p));
const RUN = process.env.SNOWFLAKE_TEST === 'true' || Boolean(privateConfigPath);

function loadCredentials(): any {
  if (process.env.SNOWFLAKE_ACCOUNT) {
    return {
      account: process.env.SNOWFLAKE_ACCOUNT,
      user: process.env.SNOWFLAKE_USER,
      database: process.env.SNOWFLAKE_DATABASE,
      schema: process.env.SNOWFLAKE_SCHEMA,
      warehouse: process.env.SNOWFLAKE_WAREHOUSE,
      role: process.env.SNOWFLAKE_ROLE,
      auth: process.env.SNOWFLAKE_AUTH || 'jwt',
      jwt: { privateKey: process.env.SNOWFLAKE_PRIVATE_KEY },
    };
  }
  if (privateConfigPath) {
    const raw = JSON.parse(readFileSync(privateConfigPath, 'utf8'));
    return raw?.cds?.requires?.db?.credentials;
  }
  return null;
}

(RUN ? describe : describe.skip)('Snowflake Expand Integration Tests', function () {
  this.timeout(60_000);

  const AUTHORS_TABLE = 'CAP_E2E_DB.APP.INTEG_EXP_AUTHORS';
  const BOOKS_TABLE   = 'CAP_E2E_DB.APP.INTEG_EXP_BOOKS';

  const AUTHOR_ID1 = 'expa0001-0001-0001-0001-000000000001';
  const AUTHOR_ID2 = 'expa0002-0002-0002-0002-000000000002';
  const BOOK_ID1   = 'expb0001-0001-0001-0001-000000000001';
  const BOOK_ID2   = 'expb0002-0002-0002-0002-000000000002';
  const BOOK_ID3   = 'expb0003-0003-0003-0003-000000000003';

  let db: any;

  before(async () => {
    await import('../../dist/index.js');
    const credentials = loadCredentials();
    if (!credentials) throw new Error('No Snowflake credentials found');

    cds.env.requires.db = { kind: 'snowflake', impl: join(ROOT, 'dist/index.js'), credentials };
    db = await cds.connect.to('db');

    await db.run(`CREATE TABLE IF NOT EXISTS ${AUTHORS_TABLE} (
      ID      VARCHAR(36)  NOT NULL,
      NAME    VARCHAR(100) NOT NULL,
      COUNTRY VARCHAR(2),
      PRIMARY KEY (ID)
    )`);

    await db.run(`CREATE TABLE IF NOT EXISTS ${BOOKS_TABLE} (
      ID        VARCHAR(36)  NOT NULL,
      TITLE     VARCHAR(200) NOT NULL,
      PRICE     NUMBER(10,2),
      STOCK     NUMBER(38,0),
      AUTHOR_ID VARCHAR(36),
      PRIMARY KEY (ID)
    )`);

    await db.run(`DELETE FROM ${BOOKS_TABLE}`);
    await db.run(`DELETE FROM ${AUTHORS_TABLE}`);

    await db.run(`INSERT INTO ${AUTHORS_TABLE} (ID, NAME, COUNTRY) VALUES (?,?,?)`, [AUTHOR_ID1, 'Alice', 'DE']);
    await db.run(`INSERT INTO ${AUTHORS_TABLE} (ID, NAME, COUNTRY) VALUES (?,?,?)`, [AUTHOR_ID2, 'Bob', 'US']);

    await db.run(`INSERT INTO ${BOOKS_TABLE} (ID, TITLE, PRICE, STOCK, AUTHOR_ID) VALUES (?,?,?,?,?)`,
      [BOOK_ID1, 'Alice Book A', 12.00, 10, AUTHOR_ID1]);
    await db.run(`INSERT INTO ${BOOKS_TABLE} (ID, TITLE, PRICE, STOCK, AUTHOR_ID) VALUES (?,?,?,?,?)`,
      [BOOK_ID2, 'Alice Book B', 18.50, 5, AUTHOR_ID1]);
    await db.run(`INSERT INTO ${BOOKS_TABLE} (ID, TITLE, PRICE, STOCK, AUTHOR_ID) VALUES (?,?,?,?,?)`,
      [BOOK_ID3, 'Bob Book', 9.99, 20, AUTHOR_ID2]);
  });

  after(async () => {
    try {
      await db.run(`DROP TABLE IF EXISTS ${BOOKS_TABLE}`);
      await db.run(`DROP TABLE IF EXISTS ${AUTHORS_TABLE}`);
    } catch (_) { /* best effort */ }
    if (db?.disconnect) await db.disconnect();
  });

  // =========================================================================
  describe('Raw JOIN queries (verify data layer)', () => {
    it('should LEFT JOIN books to authors', async () => {
      const rows = await db.run(`
        SELECT b.TITLE, a.NAME AS AUTHOR_NAME
        FROM ${BOOKS_TABLE} b
        LEFT JOIN ${AUTHORS_TABLE} a ON b.AUTHOR_ID = a.ID
        ORDER BY b.TITLE
      `);

      expect(rows).to.have.lengthOf(3);
      const alice = rows.find((r: any) => r.TITLE === 'Alice Book A');
      expect(alice).to.exist;
      expect(alice.AUTHOR_NAME).to.equal('Alice');
    });

    it('should return NULL author for books without an author', async () => {
      const orphanId = 'exp-b-orphan';
      await db.run(`INSERT INTO ${BOOKS_TABLE} (ID, TITLE) VALUES (?,?)`, [orphanId, 'Orphan Book']);

      const rows = await db.run(`
        SELECT b.TITLE, a.NAME AS AUTHOR_NAME
        FROM ${BOOKS_TABLE} b
        LEFT JOIN ${AUTHORS_TABLE} a ON b.AUTHOR_ID = a.ID
        WHERE b.ID = ?
      `, [orphanId]);

      expect(rows[0].AUTHOR_NAME).to.be.null;
      await db.run(`DELETE FROM ${BOOKS_TABLE} WHERE ID = ?`, [orphanId]);
    });

    it('should return books per author with ARRAY_AGG', async () => {
      const rows = await db.run(`
        SELECT a.NAME,
          ARRAY_AGG(OBJECT_CONSTRUCT('title', b.TITLE, 'price', b.PRICE)) AS BOOKS
        FROM ${AUTHORS_TABLE} a
        JOIN ${BOOKS_TABLE} b ON b.AUTHOR_ID = a.ID
        WHERE a.ID = ?
        GROUP BY a.ID, a.NAME
      `, [AUTHOR_ID1]);

      expect(rows).to.have.lengthOf(1);
      expect(rows[0].NAME).to.equal('Alice');
      const books = typeof rows[0].BOOKS === 'string'
        ? JSON.parse(rows[0].BOOKS)
        : rows[0].BOOKS;
      expect(books).to.be.an('array').with.lengthOf(2);
    });

    it('should handle INNER JOIN filtering by country', async () => {
      const rows = await db.run(`
        SELECT b.TITLE
        FROM ${BOOKS_TABLE} b
        JOIN ${AUTHORS_TABLE} a ON b.AUTHOR_ID = a.ID
        WHERE a.COUNTRY = ?
      `, ['DE']);

      expect(rows).to.have.lengthOf(2);
    });

    it('should handle aggregate COUNT per author', async () => {
      const rows = await db.run(`
        SELECT a.NAME, COUNT(b.ID) AS BOOK_COUNT
        FROM ${AUTHORS_TABLE} a
        LEFT JOIN ${BOOKS_TABLE} b ON b.AUTHOR_ID = a.ID
        GROUP BY a.ID, a.NAME
        ORDER BY a.NAME
      `);

      expect(rows).to.have.lengthOf(2);
      const alice = rows.find((r: any) => r.NAME === 'Alice');
      const bob   = rows.find((r: any) => r.NAME === 'Bob');
      expect(Number(alice?.BOOK_COUNT)).to.equal(2);
      expect(Number(bob?.BOOK_COUNT)).to.equal(1);
    });
  });

  // =========================================================================
  describe('Pagination on joined queries', () => {
    it('should paginate books by author with LIMIT/OFFSET', async () => {
      const page1 = await db.run(`
        SELECT b.TITLE
        FROM ${BOOKS_TABLE} b
        JOIN ${AUTHORS_TABLE} a ON b.AUTHOR_ID = a.ID
        WHERE a.ID = ?
        ORDER BY b.TITLE
        LIMIT 1 OFFSET 0
      `, [AUTHOR_ID1]);

      const page2 = await db.run(`
        SELECT b.TITLE
        FROM ${BOOKS_TABLE} b
        JOIN ${AUTHORS_TABLE} a ON b.AUTHOR_ID = a.ID
        WHERE a.ID = ?
        ORDER BY b.TITLE
        LIMIT 1 OFFSET 1
      `, [AUTHOR_ID1]);

      expect(page1).to.have.lengthOf(1);
      expect(page2).to.have.lengthOf(1);
      expect(page1[0].TITLE).to.not.equal(page2[0].TITLE);
    });
  });
});
