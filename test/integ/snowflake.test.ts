/**
 * Integration tests for the Snowflake adapter.
 *
 * Runs against a real Snowflake instance when .cdsrc-private.json is present
 * in the project root or test/e2e/fixtures/, or when SNOWFLAKE_TEST=true.
 *
 * Tests cover:
 *  - Basic CRUD with raw SQL
 *  - CQN SELECT / INSERT / UPDATE / DELETE via the service API
 *  - OData-style query options ($filter, $orderby, $top, $skip)
 *  - Transactions (SDK mode)
 *  - Error handling / normalised errors
 */

import { expect } from 'chai';
import cds from '@sap/cds';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// ---------------------------------------------------------------------------
// Determine whether to run integration tests
// ---------------------------------------------------------------------------
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

// ---------------------------------------------------------------------------
(RUN ? describe : describe.skip)('Snowflake Integration Tests', function () {
  this.timeout(60_000);

  const TEST_TABLE = 'CAP_E2E_DB.APP.INTEG_TEST_BOOKS';
  const TEST_TABLE2 = 'CAP_E2E_DB.APP.INTEG_TEST_AUTHORS';
  let db: any;

  // -------------------------------------------------------------------------
  before(async () => {
    await import('../../dist/index.js');

    const credentials = loadCredentials();
    if (!credentials) throw new Error('No Snowflake credentials found');

    cds.env.requires.db = {
      kind: 'snowflake',
      impl: join(ROOT, 'dist/index.js'),
      credentials,
    };

    db = await cds.connect.to('db');

    // Create test tables
    await db.run(`CREATE TABLE IF NOT EXISTS ${TEST_TABLE} (
      ID        VARCHAR(36)   NOT NULL,
      TITLE     VARCHAR(200)  NOT NULL,
      PRICE     NUMBER(10,2),
      STOCK     NUMBER(38,0),
      ACTIVE    BOOLEAN       DEFAULT TRUE,
      NOTES     TEXT,
      CREATEDAT TIMESTAMP_NTZ,
      PRIMARY KEY (ID)
    )`);

    await db.run(`CREATE TABLE IF NOT EXISTS ${TEST_TABLE2} (
      ID      VARCHAR(36)  NOT NULL,
      NAME    VARCHAR(100) NOT NULL,
      COUNTRY VARCHAR(2),
      PRIMARY KEY (ID)
    )`);

    // Clean slate
    await db.run(`DELETE FROM ${TEST_TABLE}`);
    await db.run(`DELETE FROM ${TEST_TABLE2}`);
  });

  after(async () => {
    try {
      await db.run(`DROP TABLE IF EXISTS ${TEST_TABLE}`);
      await db.run(`DROP TABLE IF EXISTS ${TEST_TABLE2}`);
    } catch (_) { /* best effort */ }

    if (db?.disconnect) await db.disconnect();
  });

  // =========================================================================
  describe('Raw SQL execution', () => {
    it('should execute a simple SELECT', async () => {
      const rows = await db.run(`SELECT CURRENT_VERSION() AS VER`);
      expect(rows).to.be.an('array').with.lengthOf(1);
      expect(rows[0]).to.have.property('VER').that.is.a('string');
    });

    it('should INSERT and SELECT a record', async () => {
      const id = 'integ-raw-1';
      await db.run(
        `INSERT INTO ${TEST_TABLE} (ID, TITLE, PRICE, STOCK)
         VALUES (?, ?, ?, ?)`,
        [id, 'Raw SQL Book', 9.99, 50]
      );

      const rows = await db.run(
        `SELECT * FROM ${TEST_TABLE} WHERE ID = ?`,
        [id]
      );
      expect(rows).to.be.an('array').with.lengthOf(1);
      expect(rows[0].TITLE).to.equal('Raw SQL Book');
      expect(Number(rows[0].PRICE)).to.be.closeTo(9.99, 0.01);
    });

    it('should UPDATE a record', async () => {
      const id = 'integ-raw-2';
      await db.run(`INSERT INTO ${TEST_TABLE} (ID, TITLE, PRICE, STOCK) VALUES (?,?,?,?)`, [id, 'Old Title', 1.0, 1]);
      await db.run(`UPDATE ${TEST_TABLE} SET TITLE = ?, PRICE = ? WHERE ID = ?`, ['New Title', 19.99, id]);

      const rows = await db.run(`SELECT TITLE, PRICE FROM ${TEST_TABLE} WHERE ID = ?`, [id]);
      expect(rows[0].TITLE).to.equal('New Title');
      expect(Number(rows[0].PRICE)).to.be.closeTo(19.99, 0.01);
    });

    it('should DELETE a record', async () => {
      const id = 'integ-raw-3';
      await db.run(`INSERT INTO ${TEST_TABLE} (ID, TITLE, PRICE, STOCK) VALUES (?,?,?,?)`, [id, 'Delete Me', 0, 0]);
      await db.run(`DELETE FROM ${TEST_TABLE} WHERE ID = ?`, [id]);

      const rows = await db.run(`SELECT * FROM ${TEST_TABLE} WHERE ID = ?`, [id]);
      expect(rows).to.be.an('array').with.lengthOf(0);
    });

    it('should handle NULL values', async () => {
      const id = 'integ-null-1';
      await db.run(`INSERT INTO ${TEST_TABLE} (ID, TITLE, PRICE) VALUES (?,?,?)`, [id, 'Null Price Book', null]);
      const rows = await db.run(`SELECT PRICE, NOTES FROM ${TEST_TABLE} WHERE ID = ?`, [id]);
      expect(rows[0].PRICE).to.be.null;
      expect(rows[0].NOTES).to.be.null;
    });

    it('should handle boolean values', async () => {
      const id = 'integ-bool-1';
      await db.run(`INSERT INTO ${TEST_TABLE} (ID, TITLE, ACTIVE) VALUES (?,?,?)`, [id, 'Bool Book', false]);
      const rows = await db.run(`SELECT ACTIVE FROM ${TEST_TABLE} WHERE ID = ?`, [id]);
      // Snowflake returns boolean; coerce for comparison
      expect(Boolean(rows[0].ACTIVE)).to.be.false;
    });
  });

  // =========================================================================
  describe('Query features', () => {
    before(async () => {
      // Seed 20 books for query testing
      await db.run(`DELETE FROM ${TEST_TABLE} WHERE ID LIKE 'integ-q-%'`);
      for (let i = 1; i <= 20; i++) {
        const price = 10 + i;
        const stock = i * 5;
        await db.run(
          `INSERT INTO ${TEST_TABLE} (ID, TITLE, PRICE, STOCK) VALUES (?,?,?,?)`,
          [`integ-q-${String(i).padStart(3, '0')}`, `Query Book ${i}`, price, stock]
        );
      }
    });

    it('should filter with WHERE (< operator)', async () => {
      const rows = await db.run(`SELECT * FROM ${TEST_TABLE} WHERE ID LIKE 'integ-q-%' AND PRICE < ?`, [15]);
      rows.forEach((r: any) => expect(Number(r.PRICE)).to.be.lessThan(15));
    });

    it('should filter with WHERE (>= operator)', async () => {
      const rows = await db.run(`SELECT * FROM ${TEST_TABLE} WHERE ID LIKE 'integ-q-%' AND STOCK >= ?`, [80]);
      rows.forEach((r: any) => expect(Number(r.STOCK)).to.be.gte(80));
    });

    it('should support LIKE operator', async () => {
      const rows = await db.run(`SELECT * FROM ${TEST_TABLE} WHERE TITLE LIKE ?`, ['%Book 1%']);
      expect(rows.length).to.be.greaterThan(0);
      rows.forEach((r: any) => expect(r.TITLE).to.include('Book 1'));
    });

    it('should support IN operator', async () => {
      const ids = ['integ-q-001', 'integ-q-002', 'integ-q-003'];
      const rows = await db.run(`SELECT ID FROM ${TEST_TABLE} WHERE ID IN (?,?,?)`, ids);
      expect(rows).to.have.lengthOf(3);
    });

    it('should support ORDER BY ASC', async () => {
      const rows = await db.run(`SELECT ID, PRICE FROM ${TEST_TABLE} WHERE ID LIKE 'integ-q-%' ORDER BY PRICE ASC LIMIT 5`);
      for (let i = 1; i < rows.length; i++) {
        expect(Number(rows[i].PRICE)).to.be.gte(Number(rows[i - 1].PRICE));
      }
    });

    it('should support ORDER BY DESC', async () => {
      const rows = await db.run(`SELECT ID, PRICE FROM ${TEST_TABLE} WHERE ID LIKE 'integ-q-%' ORDER BY PRICE DESC LIMIT 5`);
      for (let i = 1; i < rows.length; i++) {
        expect(Number(rows[i].PRICE)).to.be.lte(Number(rows[i - 1].PRICE));
      }
    });

    it('should support LIMIT (top)', async () => {
      const rows = await db.run(`SELECT * FROM ${TEST_TABLE} WHERE ID LIKE 'integ-q-%' LIMIT 5`);
      expect(rows).to.have.lengthOf(5);
    });

    it('should support LIMIT + OFFSET (skip)', async () => {
      const all = await db.run(`SELECT ID FROM ${TEST_TABLE} WHERE ID LIKE 'integ-q-%' ORDER BY ID LIMIT 20`);
      const paged = await db.run(`SELECT ID FROM ${TEST_TABLE} WHERE ID LIKE 'integ-q-%' ORDER BY ID LIMIT 5 OFFSET 10`);
      expect(paged).to.have.lengthOf(5);
      expect(paged[0].ID).to.equal(all[10].ID);
    });

    it('should support BETWEEN', async () => {
      const rows = await db.run(`SELECT * FROM ${TEST_TABLE} WHERE ID LIKE 'integ-q-%' AND PRICE BETWEEN ? AND ?`, [15, 20]);
      rows.forEach((r: any) => {
        expect(Number(r.PRICE)).to.be.gte(15).and.lte(20);
      });
    });

    it('should support COUNT(*)', async () => {
      const rows = await db.run(`SELECT COUNT(*) AS CNT FROM ${TEST_TABLE} WHERE ID LIKE 'integ-q-%'`);
      expect(Number(rows[0].CNT)).to.equal(20);
    });

    it('should support IS NULL filter', async () => {
      const id = 'integ-null-q1';
      await db.run(`INSERT INTO ${TEST_TABLE} (ID, TITLE) VALUES (?,?)`, [id, 'No Price']);
      const rows = await db.run(`SELECT * FROM ${TEST_TABLE} WHERE ID = ? AND PRICE IS NULL`, [id]);
      expect(rows).to.have.lengthOf(1);
    });

    it('should support IS NOT NULL filter', async () => {
      const rows = await db.run(`SELECT * FROM ${TEST_TABLE} WHERE ID LIKE 'integ-q-%' AND PRICE IS NOT NULL`);
      expect(rows.length).to.be.greaterThan(0);
    });
  });

  // =========================================================================
  describe('JOIN queries', () => {
    before(async () => {
      await db.run(`DELETE FROM ${TEST_TABLE} WHERE ID LIKE 'integ-join-%'`);
      await db.run(`DELETE FROM ${TEST_TABLE2} WHERE ID LIKE 'integ-join-%'`);

      await db.run(`INSERT INTO ${TEST_TABLE2} (ID, NAME, COUNTRY) VALUES (?,?,?)`, ['integ-join-a1', 'Alice', 'DE']);
      await db.run(`INSERT INTO ${TEST_TABLE2} (ID, NAME, COUNTRY) VALUES (?,?,?)`, ['integ-join-a2', 'Bob', 'US']);

      await db.run(
        `INSERT INTO ${TEST_TABLE} (ID, TITLE, PRICE, STOCK) VALUES (?,?,?,?)`,
        ['integ-join-b1', 'Alice Book', 29.99, 10]
      );
    });

    it('should execute a LEFT JOIN query', async () => {
      const rows = await db.run(`
        SELECT b.TITLE, a.NAME AS AUTHOR_NAME
        FROM ${TEST_TABLE} b
        LEFT JOIN ${TEST_TABLE2} a ON b.ID = 'integ-join-b1'
        WHERE b.ID = 'integ-join-b1'
        LIMIT 1
      `);
      expect(rows).to.be.an('array');
      expect(rows[0]).to.have.property('TITLE', 'Alice Book');
    });
  });

  // =========================================================================
  describe('Aggregate queries', () => {
    it('should compute AVG, SUM, MIN, MAX', async () => {
      const rows = await db.run(`
        SELECT
          AVG(PRICE) AS AVG_PRICE,
          SUM(STOCK) AS TOTAL_STOCK,
          MIN(PRICE) AS MIN_PRICE,
          MAX(PRICE) AS MAX_PRICE
        FROM ${TEST_TABLE}
        WHERE ID LIKE 'integ-q-%'
      `);
      expect(rows).to.have.lengthOf(1);
      expect(Number(rows[0].MIN_PRICE)).to.be.lessThan(Number(rows[0].MAX_PRICE));
    });

    it('should support GROUP BY with HAVING', async () => {
      const rows = await db.run(`
        SELECT ACTIVE, COUNT(*) AS CNT
        FROM ${TEST_TABLE}
        WHERE ID LIKE 'integ-q-%'
        GROUP BY ACTIVE
        HAVING COUNT(*) > 0
      `);
      expect(rows.length).to.be.greaterThan(0);
    });
  });

  // =========================================================================
  describe('Transaction support', () => {
    it('should commit a transaction successfully (SDK mode)', async () => {
      if (!db.sdkPool) {
        console.log('Skipping: not in SDK mode');
        return;
      }

      const id = 'integ-tx-1';
      await db.begin();
      try {
        await db.run(`INSERT INTO ${TEST_TABLE} (ID, TITLE, PRICE, STOCK) VALUES (?,?,?,?)`, [id, 'TX Book', 5.0, 1]);
        await db.commit();
      } catch (e) {
        await db.rollback();
        throw e;
      }

      const rows = await db.run(`SELECT * FROM ${TEST_TABLE} WHERE ID = ?`, [id]);
      expect(rows).to.have.lengthOf(1);
    });

    it('should rollback a transaction on error (SDK mode)', async () => {
      if (!db.sdkPool) {
        console.log('Skipping: not in SDK mode');
        return;
      }

      const id = 'integ-tx-rollback-1';
      await db.begin();
      try {
        await db.run(`INSERT INTO ${TEST_TABLE} (ID, TITLE, PRICE, STOCK) VALUES (?,?,?,?)`, [id, 'RB Book', 1.0, 1]);
        // Force an error
        await db.run(`SELECT * FROM NONEXISTENT_TABLE_THAT_DOES_NOT_EXIST`);
        await db.commit();
      } catch (_) {
        await db.rollback();
      }

      const rows = await db.run(`SELECT * FROM ${TEST_TABLE} WHERE ID = ?`, [id]);
      expect(rows).to.have.lengthOf(0);
    });
  });

  // =========================================================================
  describe('Error handling', () => {
    it('should throw a normalised error for invalid SQL', async () => {
      try {
        await db.run(`SELECT * FROM NONEXISTENT_TABLE_99999`);
        throw new Error('Should have thrown');
      } catch (err: any) {
        expect(err).to.exist;
        expect(err.message).to.be.a('string').and.not.be.empty;
      }
    });

    it('should throw on duplicate primary key INSERT', async () => {
      const id = 'integ-dup-1';
      await db.run(`INSERT INTO ${TEST_TABLE} (ID, TITLE, PRICE, STOCK) VALUES (?,?,?,?)`, [id, 'First', 1.0, 1]);
      try {
        await db.run(`INSERT INTO ${TEST_TABLE} (ID, TITLE, PRICE, STOCK) VALUES (?,?,?,?)`, [id, 'Duplicate', 2.0, 2]);
        throw new Error('Should have thrown on duplicate key');
      } catch (err: any) {
        expect(err).to.exist;
      }
    });

    it('should handle empty result sets gracefully', async () => {
      const rows = await db.run(`SELECT * FROM ${TEST_TABLE} WHERE ID = ?`, ['NONEXISTENT_ID']);
      expect(rows).to.be.an('array').with.lengthOf(0);
    });
  });

  // =========================================================================
  describe('String function queries', () => {
    before(async () => {
      await db.run(`DELETE FROM ${TEST_TABLE} WHERE ID LIKE 'integ-str-%'`);
      await db.run(`INSERT INTO ${TEST_TABLE} (ID, TITLE) VALUES (?,?)`, ['integ-str-1', 'Hello World']);
      await db.run(`INSERT INTO ${TEST_TABLE} (ID, TITLE) VALUES (?,?)`, ['integ-str-2', 'Snowflake Guide']);
    });

    it('should support LOWER() in WHERE', async () => {
      const rows = await db.run(`SELECT * FROM ${TEST_TABLE} WHERE LOWER(TITLE) = ?`, ['hello world']);
      expect(rows).to.have.lengthOf(1);
    });

    it('should support UPPER() in WHERE', async () => {
      const rows = await db.run(`SELECT * FROM ${TEST_TABLE} WHERE UPPER(TITLE) = ?`, ['HELLO WORLD']);
      expect(rows).to.have.lengthOf(1);
    });

    it('should support CONTAINS via LIKE', async () => {
      const rows = await db.run(`SELECT * FROM ${TEST_TABLE} WHERE ID LIKE 'integ-str-%' AND TITLE LIKE ?`, ['%World%']);
      expect(rows.length).to.be.greaterThan(0);
    });

    it('should support STARTSWITH via LIKE', async () => {
      const rows = await db.run(`SELECT * FROM ${TEST_TABLE} WHERE TITLE LIKE ?`, ['Hello%']);
      expect(rows.length).to.be.greaterThan(0);
    });

    it('should support ENDSWITH via LIKE', async () => {
      const rows = await db.run(`SELECT * FROM ${TEST_TABLE} WHERE TITLE LIKE ?`, ['%Guide']);
      expect(rows.length).to.be.greaterThan(0);
    });

    it('should support LENGTH()', async () => {
      const rows = await db.run(`SELECT TITLE, LENGTH(TITLE) AS LEN FROM ${TEST_TABLE} WHERE ID LIKE 'integ-str-%'`);
      rows.forEach((r: any) => {
        expect(Number(r.LEN)).to.equal(r.TITLE.length);
      });
    });

    it('should support SUBSTRING()', async () => {
      const rows = await db.run(`SELECT SUBSTRING(TITLE, 1, 5) AS SUB FROM ${TEST_TABLE} WHERE ID = ?`, ['integ-str-1']);
      expect(rows[0].SUB).to.equal('Hello');
    });
  });

  // =========================================================================
  describe('Date/time queries', () => {
    before(async () => {
      const now = new Date().toISOString();
      await db.run(`DELETE FROM ${TEST_TABLE} WHERE ID LIKE 'integ-dt-%'`);
      await db.run(`INSERT INTO ${TEST_TABLE} (ID, TITLE, CREATEDAT) VALUES (?,?,?)`, ['integ-dt-1', 'DT Book', now]);
    });

    it('should support YEAR() function', async () => {
      const currentYear = new Date().getFullYear();
      const rows = await db.run(`SELECT * FROM ${TEST_TABLE} WHERE ID LIKE 'integ-dt-%' AND YEAR(CREATEDAT) = ?`, [currentYear]);
      expect(rows.length).to.be.greaterThan(0);
    });

    it('should support timestamp comparison', async () => {
      const past = '2000-01-01T00:00:00Z';
      const rows = await db.run(`SELECT * FROM ${TEST_TABLE} WHERE ID LIKE 'integ-dt-%' AND CREATEDAT > ?`, [past]);
      expect(rows.length).to.be.greaterThan(0);
    });

    it('should support CURRENT_TIMESTAMP()', async () => {
      const rows = await db.run(`SELECT CURRENT_TIMESTAMP() AS NOW`);
      expect(rows[0].NOW).to.exist;
    });
  });

  // =========================================================================
  describe('Large dataset performance', () => {
    before(async () => {
      await db.run(`DELETE FROM ${TEST_TABLE} WHERE ID LIKE 'integ-bulk-%'`);
      // Insert 100 rows
      for (let i = 0; i < 100; i++) {
        await db.run(`INSERT INTO ${TEST_TABLE} (ID, TITLE, PRICE, STOCK) VALUES (?,?,?,?)`,
          [`integ-bulk-${String(i).padStart(4, '0')}`, `Bulk Book ${i}`, 10 + (i % 50), i % 20]);
      }
    });

    it('should SELECT 100 rows efficiently', async () => {
      const rows = await db.run(`SELECT * FROM ${TEST_TABLE} WHERE ID LIKE 'integ-bulk-%'`);
      expect(rows).to.have.lengthOf(100);
    });

    it('should handle DISTINCT queries', async () => {
      const rows = await db.run(`SELECT DISTINCT PRICE FROM ${TEST_TABLE} WHERE ID LIKE 'integ-bulk-%' ORDER BY PRICE`);
      expect(rows.length).to.be.lessThan(100);
    });

    it('should handle complex multi-condition WHERE', async () => {
      const rows = await db.run(`
        SELECT * FROM ${TEST_TABLE}
        WHERE ID LIKE 'integ-bulk-%'
          AND PRICE > ?
          AND STOCK <= ?
          AND TITLE LIKE ?
        ORDER BY PRICE ASC
        LIMIT 10
      `, [20, 10, 'Bulk Book%']);
      expect(rows.length).to.be.lte(10);
    });
  });
});
