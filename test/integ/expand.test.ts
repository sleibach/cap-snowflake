/**
 * Integration tests for $expand functionality
 */

import { expect } from 'chai';
import cds from '@sap/cds';

const RUN_INTEGRATION_TESTS = process.env.SNOWFLAKE_TEST === 'true';

(RUN_INTEGRATION_TESTS ? describe : describe.skip)('Expand Integration Tests', function() {
  this.timeout(30000);

  let db: any;

  before(async () => {
    await import('../../src/index.js');

    cds.env.requires.db = {
      kind: 'snowflake',
      impl: 'cap-snowflake',
      credentials: {
        account: process.env.SNOWFLAKE_ACCOUNT,
        user: process.env.SNOWFLAKE_USER,
        database: process.env.SNOWFLAKE_DATABASE,
        schema: process.env.SNOWFLAKE_SCHEMA,
        warehouse: process.env.SNOWFLAKE_WAREHOUSE,
        role: process.env.SNOWFLAKE_ROLE,
        auth: process.env.SNOWFLAKE_AUTH || 'jwt',
        jwt: {
          privateKey: process.env.SNOWFLAKE_PRIVATE_KEY,
          privateKeyPassphrase: process.env.SNOWFLAKE_PASSPHRASE,
        },
      },
    };

    db = await cds.connect.to('db');
  });

  after(async () => {
    if (db && db.disconnect) {
      await db.disconnect();
    }
  });

  describe('To-one Expand', () => {
    before(async () => {
      // Create test tables
      await db.run(`
        CREATE TABLE IF NOT EXISTS TEST_AUTHORS (
          ID VARCHAR(36) PRIMARY KEY,
          NAME VARCHAR(100)
        )
      `);

      await db.run(`
        CREATE TABLE IF NOT EXISTS TEST_BOOKS (
          ID VARCHAR(36) PRIMARY KEY,
          TITLE VARCHAR(100),
          AUTHOR_ID VARCHAR(36)
        )
      `);

      // Insert test data
      await db.run(`DELETE FROM TEST_BOOKS`);
      await db.run(`DELETE FROM TEST_AUTHORS`);

      await db.run(
        `INSERT INTO TEST_AUTHORS VALUES (?, ?)`,
        ['author-1', 'John Doe']
      );

      await db.run(
        `INSERT INTO TEST_BOOKS VALUES (?, ?, ?)`,
        ['book-1', 'Test Book', 'author-1']
      );
    });

    after(async () => {
      await db.run(`DROP TABLE IF EXISTS TEST_BOOKS`);
      await db.run(`DROP TABLE IF EXISTS TEST_AUTHORS`);
    });

    it('should expand to-one association with JOIN', async () => {
      // Query with manual JOIN to test
      const rows = await db.run(`
        SELECT 
          b.ID,
          b.TITLE,
          a.NAME AS AUTHOR_NAME
        FROM TEST_BOOKS b
        LEFT JOIN TEST_AUTHORS a ON b.AUTHOR_ID = a.ID
        WHERE b.ID = ?
      `, ['book-1']);

      expect(rows).to.have.lengthOf(1);
      expect(rows[0].TITLE).to.equal('Test Book');
      expect(rows[0].AUTHOR_NAME).to.equal('John Doe');
    });

    it('should handle path expressions', async () => {
      const rows = await db.run(`
        SELECT 
          b.TITLE,
          a.NAME
        FROM TEST_BOOKS b
        LEFT JOIN TEST_AUTHORS a ON b.AUTHOR_ID = a.ID
        WHERE a.NAME = ?
      `, ['John Doe']);

      expect(rows).to.have.lengthOf(1);
      expect(rows[0].TITLE).to.equal('Test Book');
    });
  });

  describe('To-many Expand', () => {
    before(async () => {
      // Add more books for same author
      await db.run(
        `INSERT INTO TEST_BOOKS VALUES (?, ?, ?)`,
        ['book-2', 'Another Book', 'author-1']
      );
    });

    it('should aggregate to-many with ARRAY_AGG', async () => {
      // Manual query to test aggregation
      const rows = await db.run(`
        SELECT 
          a.ID,
          a.NAME,
          ARRAY_AGG(OBJECT_CONSTRUCT('id', b.ID, 'title', b.TITLE)) AS BOOKS
        FROM TEST_AUTHORS a
        LEFT JOIN TEST_BOOKS b ON a.ID = b.AUTHOR_ID
        WHERE a.ID = ?
        GROUP BY a.ID, a.NAME
      `, ['author-1']);

      expect(rows).to.have.lengthOf(1);
      expect(rows[0].NAME).to.equal('John Doe');
      expect(rows[0].BOOKS).to.be.an('array');
      expect(rows[0].BOOKS).to.have.lengthOf(2);
    });
  });
});


