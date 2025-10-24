/**
 * Unit tests for CQN to SQL translation
 */

import { expect } from 'chai';
import { cqnToSQL, generateMerge } from '../../src/cqn/toSQL.js';
import { SnowflakeCredentials } from '../../src/config.js';

describe('CQN to SQL Translation', () => {
  const credentials: SnowflakeCredentials = {
    account: 'TEST',
    user: 'TEST_USER',
    database: 'TEST_DB',
    schema: 'TEST_SCHEMA',
    auth: 'jwt',
    jwt: { privateKey: 'dummy' },
  };

  describe('SELECT translation', () => {
    it('should translate simple SELECT', () => {
      const cqn = {
        SELECT: {
          from: { ref: ['Books'] },
        },
      };

      const result = cqnToSQL(cqn, credentials);
      expect(result.sql).to.include('SELECT * FROM TEST_DB.TEST_SCHEMA.BOOKS');
    });

    it('should translate SELECT with columns', () => {
      const cqn = {
        SELECT: {
          from: { ref: ['Books'] },
          columns: [
            { ref: ['title'] },
            { ref: ['price'] },
          ],
        },
      };

      const result = cqnToSQL(cqn, credentials);
      expect(result.sql).to.include('SELECT title, price FROM');
    });

    it('should translate SELECT with WHERE', () => {
      const cqn = {
        SELECT: {
          from: { ref: ['Books'] },
          where: [{ ref: ['price'] }, '<', { val: 20 }],
        },
      };

      const result = cqnToSQL(cqn, credentials);
      expect(result.sql).to.include('WHERE price < ?');
      expect(result.params).to.deep.equal([20]);
    });

    it('should translate SELECT with ORDER BY', () => {
      const cqn = {
        SELECT: {
          from: { ref: ['Books'] },
          orderBy: [{ ref: ['title'], sort: 'asc' }],
        },
      };

      const result = cqnToSQL(cqn, credentials);
      expect(result.sql).to.include('ORDER BY title ASC');
    });

    it('should translate SELECT with LIMIT/OFFSET', () => {
      const cqn = {
        SELECT: {
          from: { ref: ['Books'] },
          limit: {
            rows: { val: 10 },
            offset: { val: 20 },
          },
        },
      };

      const result = cqnToSQL(cqn, credentials);
      expect(result.sql).to.include('LIMIT 10');
      expect(result.sql).to.include('OFFSET 20');
    });

    it('should translate SELECT DISTINCT', () => {
      const cqn = {
        SELECT: {
          distinct: true,
          from: { ref: ['Books'] },
          columns: [{ ref: ['author'] }],
        },
      };

      const result = cqnToSQL(cqn, credentials);
      expect(result.sql).to.include('SELECT DISTINCT author');
    });
  });

  describe('INSERT translation', () => {
    it('should translate INSERT with entries', () => {
      const cqn = {
        INSERT: {
          into: 'Books',
          entries: [
            { title: 'Book 1', price: 19.99 },
            { title: 'Book 2', price: 29.99 },
          ],
        },
      };

      const result = cqnToSQL(cqn, credentials);
      expect(result.sql).to.include('INSERT INTO TEST_DB.TEST_SCHEMA.BOOKS');
      expect(result.sql).to.include('(title, price)');
      expect(result.sql).to.include('VALUES (?, ?), (?, ?)');
      expect(result.params).to.deep.equal(['Book 1', 19.99, 'Book 2', 29.99]);
    });

    it('should translate INSERT with columns and values', () => {
      const cqn = {
        INSERT: {
          into: 'Books',
          columns: ['title', 'price'],
          values: ['Test Book', 15.99],
        },
      };

      const result = cqnToSQL(cqn, credentials);
      expect(result.sql).to.include('INSERT INTO TEST_DB.TEST_SCHEMA.BOOKS');
      expect(result.sql).to.include('(title, price)');
      expect(result.sql).to.include('VALUES (?, ?)');
      expect(result.params).to.deep.equal(['Test Book', 15.99]);
    });
  });

  describe('UPDATE translation', () => {
    it('should translate UPDATE', () => {
      const cqn = {
        UPDATE: {
          entity: 'Books',
          data: { price: 25.99, stock: 100 },
          where: [{ ref: ['ID'] }, '=', { val: '123' }],
        },
      };

      const result = cqnToSQL(cqn, credentials);
      expect(result.sql).to.include('UPDATE TEST_DB.TEST_SCHEMA.BOOKS');
      expect(result.sql).to.include('SET price = ?, stock = ?');
      expect(result.sql).to.include('WHERE ID = ?');
      expect(result.params).to.deep.equal([25.99, 100, '123']);
    });
  });

  describe('DELETE translation', () => {
    it('should translate DELETE', () => {
      const cqn = {
        DELETE: {
          from: 'Books',
          where: [{ ref: ['ID'] }, '=', { val: '123' }],
        },
      };

      const result = cqnToSQL(cqn, credentials);
      expect(result.sql).to.include('DELETE FROM TEST_DB.TEST_SCHEMA.BOOKS');
      expect(result.sql).to.include('WHERE ID = ?');
      expect(result.params).to.deep.equal(['123']);
    });
  });

  describe('MERGE (UPSERT) translation', () => {
    it('should generate MERGE statement', () => {
      const data = { ID: '123', title: 'Book', price: 19.99 };
      const keys = ['ID'];

      const result = generateMerge('Books', keys, data, credentials);
      
      expect(result.sql).to.include('MERGE INTO TEST_DB.TEST_SCHEMA.BOOKS');
      expect(result.sql).to.include('USING');
      expect(result.sql).to.include('ON target.ID = source.ID');
      expect(result.sql).to.include('WHEN MATCHED THEN UPDATE');
      expect(result.sql).to.include('WHEN NOT MATCHED THEN INSERT');
      expect(result.params).to.deep.equal(['123', 'Book', 19.99]);
    });
  });
});

