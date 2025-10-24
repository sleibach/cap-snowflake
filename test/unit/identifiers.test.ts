/**
 * Unit tests for identifier handling
 */

import { expect } from 'chai';
import { needsQuoting, quoteIdentifier, qualifyName } from '../../src/identifiers.js';
import { SnowflakeCredentials } from '../../src/config.js';

describe('Identifier Handling', () => {
  const credentials: SnowflakeCredentials = {
    account: 'TEST_ACCOUNT',
    user: 'TEST_USER',
    database: 'TEST_DB',
    schema: 'TEST_SCHEMA',
    auth: 'jwt' as const,
    jwt: {
      privateKey: 'dummy',
    },
  };

  describe('needsQuoting', () => {
    it('should not quote uppercase identifiers', () => {
      expect(needsQuoting('TABLENAME')).to.be.false;
      expect(needsQuoting('COLUMN_NAME')).to.be.false;
    });

    it('should quote lowercase identifiers', () => {
      expect(needsQuoting('tablename')).to.be.true;
      expect(needsQuoting('columnName')).to.be.true;
    });

    it('should quote reserved words', () => {
      expect(needsQuoting('SELECT')).to.be.true;
      expect(needsQuoting('FROM')).to.be.true;
      expect(needsQuoting('TABLE')).to.be.true;
    });

    it('should quote special characters', () => {
      expect(needsQuoting('column-name')).to.be.true;
      expect(needsQuoting('column.name')).to.be.true;
    });

    it('should not quote already quoted identifiers', () => {
      expect(needsQuoting('"TableName"')).to.be.false;
    });
  });

  describe('quoteIdentifier', () => {
    it('should quote when needed', () => {
      expect(quoteIdentifier('tableName')).to.equal('"tableName"');
      expect(quoteIdentifier('TABLENAME')).to.equal('TABLENAME');
    });

    it('should escape internal quotes', () => {
      expect(quoteIdentifier('table"name')).to.equal('"table""name"');
    });

    it('should preserve already quoted identifiers', () => {
      expect(quoteIdentifier('"TableName"')).to.equal('"TableName"');
    });
  });

  describe('qualifyName', () => {
    it('should fully qualify simple table name', () => {
      const result = qualifyName('BOOKS', credentials);
      expect(result).to.equal('TEST_DB.TEST_SCHEMA.BOOKS');
    });

    it('should handle schema.table format', () => {
      const result = qualifyName('MY_SCHEMA.BOOKS', credentials);
      expect(result).to.equal('TEST_DB."MY_SCHEMA".BOOKS');
    });

    it('should preserve fully qualified names', () => {
      const result = qualifyName('DB.SCHEMA.TABLE', credentials);
      expect(result).to.equal('DB.SCHEMA.TABLE');
    });

    it('should quote mixed case names', () => {
      const result = qualifyName('Books', credentials);
      expect(result).to.equal('TEST_DB.TEST_SCHEMA."Books"');
    });
  });
});

