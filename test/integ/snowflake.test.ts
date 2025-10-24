/**
 * Integration tests for Snowflake adapter
 * 
 * These tests require a Snowflake account and proper credentials.
 * Set SNOWFLAKE_TEST=true to run these tests.
 */

import { expect } from 'chai';
import cds from '@sap/cds';

const RUN_INTEGRATION_TESTS = process.env.SNOWFLAKE_TEST === 'true';

(RUN_INTEGRATION_TESTS ? describe : describe.skip)('Snowflake Integration Tests', function() {
  this.timeout(30000); // Snowflake queries can be slow

  let db: any;

  before(async () => {
    // Load the adapter
    await import('../../src/index.js');

    // Configure for Snowflake
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

  describe('Basic Operations', () => {
    const testTable = 'TEST_BOOKS';

    before(async () => {
      // Create test table
      await db.run(`
        CREATE TABLE IF NOT EXISTS ${testTable} (
          ID VARCHAR(36) PRIMARY KEY,
          TITLE VARCHAR(100),
          PRICE NUMBER(10,2),
          STOCK NUMBER(38,0)
        )
      `);

      // Clean up any existing test data
      await db.run(`DELETE FROM ${testTable}`);
    });

    after(async () => {
      // Clean up test table
      await db.run(`DROP TABLE IF EXISTS ${testTable}`);
    });

    it('should INSERT records', async () => {
      const result = await db.run(
        `INSERT INTO ${testTable} (ID, TITLE, PRICE, STOCK) VALUES (?, ?, ?, ?)`,
        ['test-1', 'Test Book', 19.99, 10]
      );

      expect(result).to.exist;
    });

    it('should SELECT records', async () => {
      const rows = await db.run(`SELECT * FROM ${testTable} WHERE ID = ?`, ['test-1']);
      
      expect(rows).to.be.an('array');
      expect(rows.length).to.equal(1);
      expect(rows[0].TITLE).to.equal('Test Book');
      expect(rows[0].PRICE).to.equal(19.99);
    });

    it('should UPDATE records', async () => {
      await db.run(
        `UPDATE ${testTable} SET PRICE = ? WHERE ID = ?`,
        [24.99, 'test-1']
      );

      const rows = await db.run(`SELECT PRICE FROM ${testTable} WHERE ID = ?`, ['test-1']);
      expect(rows[0].PRICE).to.equal(24.99);
    });

    it('should DELETE records', async () => {
      await db.run(`DELETE FROM ${testTable} WHERE ID = ?`, ['test-1']);
      
      const rows = await db.run(`SELECT * FROM ${testTable} WHERE ID = ?`, ['test-1']);
      expect(rows.length).to.equal(0);
    });
  });

  describe('OData Query Features', () => {
    const testTable = 'TEST_BOOKS_ODATA';

    before(async () => {
      // Create and populate test table
      await db.run(`
        CREATE TABLE IF NOT EXISTS ${testTable} (
          ID VARCHAR(36),
          TITLE VARCHAR(100),
          PRICE NUMBER(10,2),
          STOCK NUMBER(38,0)
        )
      `);

      await db.run(`DELETE FROM ${testTable}`);

      // Insert test data
      for (let i = 1; i <= 20; i++) {
        await db.run(
          `INSERT INTO ${testTable} VALUES (?, ?, ?, ?)`,
          [`book-${i}`, `Book ${i}`, 10 + i, i * 5]
        );
      }
    });

    after(async () => {
      await db.run(`DROP TABLE IF EXISTS ${testTable}`);
    });

    it('should support $filter', async () => {
      const rows = await db.run(
        `SELECT * FROM ${testTable} WHERE PRICE < ?`,
        [20]
      );

      expect(rows.length).to.be.lessThan(20);
      rows.forEach((row: any) => {
        expect(row.PRICE).to.be.lessThan(20);
      });
    });

    it('should support $orderby', async () => {
      const rows = await db.run(
        `SELECT * FROM ${testTable} ORDER BY TITLE ASC LIMIT 5`
      );

      expect(rows).to.have.lengthOf(5);
      for (let i = 1; i < rows.length; i++) {
        expect(rows[i].TITLE >= rows[i - 1].TITLE).to.be.true;
      }
    });

    it('should support $top and $skip', async () => {
      const rows = await db.run(
        `SELECT * FROM ${testTable} ORDER BY ID LIMIT 5 OFFSET 10`
      );

      expect(rows).to.have.lengthOf(5);
    });

    it('should support LIKE queries', async () => {
      const rows = await db.run(
        `SELECT * FROM ${testTable} WHERE TITLE LIKE ?`,
        ['%Book 1%']
      );

      expect(rows.length).to.be.greaterThan(0);
      rows.forEach((row: any) => {
        expect(row.TITLE).to.include('Book 1');
      });
    });
  });

  describe('Transaction Support', () => {
    it('should support transactions with SDK', async () => {
      if (!db.sdkClient) {
        console.log('Skipping transaction test (not using SDK)');
        return;
      }

      await db.begin();

      try {
        await db.run('CREATE TEMPORARY TABLE TEMP_TEST (ID INT, NAME VARCHAR(50))');
        await db.run('INSERT INTO TEMP_TEST VALUES (1, ?)' , ['Test']);
        await db.commit();
      } catch (error) {
        await db.rollback();
        throw error;
      }
    });
  });
});

