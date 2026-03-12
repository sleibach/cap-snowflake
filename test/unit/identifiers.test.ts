/**
 * Unit tests for identifier handling
 *
 * Snowflake normalises unquoted identifiers to UPPERCASE. The adapter uses
 * toPhysicalIdentifier to uppercase plain identifiers and quotes identifiers
 * containing special characters.
 */

import { expect } from 'chai';
import { needsQuoting, quoteIdentifier, qualifyName, toPhysicalIdentifier } from '../../src/identifiers.js';
import { SnowflakeCredentials } from '../../src/config.js';

describe('Identifier Handling', () => {
  const credentials: SnowflakeCredentials = {
    account: 'TEST_ACCOUNT',
    user: 'TEST_USER',
    database: 'TEST_DB',
    schema: 'TEST_SCHEMA',
    auth: 'jwt' as const,
    jwt: { privateKey: 'dummy' },
  };

  describe('needsQuoting', () => {
    it('should not need quoting for UPPERCASE identifiers', () => {
      expect(needsQuoting('TABLENAME')).to.be.false;
      expect(needsQuoting('COLUMN_NAME')).to.be.false;
    });

    it('should require quoting for lowercase identifiers (Snowflake would uppercase them)', () => {
      expect(needsQuoting('tablename')).to.be.true;
      expect(needsQuoting('columnName')).to.be.true;
      expect(needsQuoting('Books')).to.be.true;
    });

    it('should require quoting for reserved words', () => {
      expect(needsQuoting('SELECT')).to.be.true;
      expect(needsQuoting('FROM')).to.be.true;
      expect(needsQuoting('TABLE')).to.be.true;
      expect(needsQuoting('ORDER')).to.be.true;
    });

    it('should require quoting for identifiers with special characters', () => {
      expect(needsQuoting('column-name')).to.be.true;
      expect(needsQuoting('column.name')).to.be.true;
    });

    it('should not need quoting for already-quoted identifiers', () => {
      expect(needsQuoting('"TableName"')).to.be.false;
      expect(needsQuoting('"special-col"')).to.be.false;
    });

    it('should handle edge cases', () => {
      expect(needsQuoting('')).to.be.false;
      expect(needsQuoting('_UNDERSCORE')).to.be.false;
      expect(needsQuoting('A1B2C3')).to.be.false;
    });
  });

  describe('toPhysicalIdentifier', () => {
    it('should uppercase simple identifiers', () => {
      expect(toPhysicalIdentifier('title')).to.equal('TITLE');
      expect(toPhysicalIdentifier('price')).to.equal('PRICE');
      expect(toPhysicalIdentifier('authorId')).to.equal('AUTHORID');
      expect(toPhysicalIdentifier('ALREADY_UPPER')).to.equal('ALREADY_UPPER');
      expect(toPhysicalIdentifier('Books')).to.equal('BOOKS');
      expect(toPhysicalIdentifier('validFrom')).to.equal('VALIDFROM');
    });

    it('should quote identifiers with special characters', () => {
      expect(toPhysicalIdentifier('col-name')).to.equal('"col-name"');
      expect(toPhysicalIdentifier('col.name')).to.equal('"col.name"');
    });

    it('should pass through already-quoted identifiers', () => {
      expect(toPhysicalIdentifier('"MyTable"')).to.equal('"MyTable"');
    });

    it('should handle star and empty', () => {
      expect(toPhysicalIdentifier('*')).to.equal('*');
      expect(toPhysicalIdentifier('')).to.equal('');
    });
  });

  describe('quoteIdentifier', () => {
    it('should quote when needed (reserved word)', () => {
      expect(quoteIdentifier('SELECT')).to.equal('"SELECT"');
      expect(quoteIdentifier('FROM')).to.equal('"FROM"');
    });

    it('should not quote UPPERCASE identifiers', () => {
      expect(quoteIdentifier('TABLENAME')).to.equal('TABLENAME');
    });

    it('should quote mixed-case identifiers to preserve case', () => {
      expect(quoteIdentifier('tableName')).to.equal('"tableName"');
      expect(quoteIdentifier('Books')).to.equal('"Books"');
    });

    it('should escape internal quotes', () => {
      expect(quoteIdentifier('table"name')).to.equal('"table""name"');
    });

    it('should preserve already-quoted identifiers', () => {
      expect(quoteIdentifier('"TableName"')).to.equal('"TableName"');
    });
  });

  describe('qualifyName', () => {
    it('should fully qualify simple table name (UPPERCASE)', () => {
      const result = qualifyName('BOOKS', credentials);
      expect(result).to.equal('TEST_DB.TEST_SCHEMA.BOOKS');
    });

    it('should uppercase mixed-case table names', () => {
      const result = qualifyName('Books', credentials);
      expect(result).to.equal('TEST_DB.TEST_SCHEMA.BOOKS');
    });

    it('should uppercase camelCase names', () => {
      const result = qualifyName('myBooks', credentials);
      expect(result).to.equal('TEST_DB.TEST_SCHEMA.MYBOOKS');
    });

    it('should preserve underscore-separated parts', () => {
      const result = qualifyName('CAP_E2E_AUTHORS', credentials);
      expect(result).to.equal('TEST_DB.TEST_SCHEMA.CAP_E2E_AUTHORS');
    });

    it('should handle schema.table format', () => {
      const result = qualifyName('MY_SCHEMA.BOOKS', credentials);
      expect(result).to.equal('TEST_DB.MY_SCHEMA.BOOKS');
    });

    it('should preserve fully qualified names', () => {
      const result = qualifyName('PROD_DB.PROD_SCHEMA.TABLE', credentials);
      expect(result).to.equal('PROD_DB.PROD_SCHEMA.TABLE');
    });

    it('should quote special-char name parts', () => {
      const result = qualifyName('my-table', credentials);
      expect(result).to.equal('TEST_DB.TEST_SCHEMA."my-table"');
    });

    it('should work without schema in credentials', () => {
      const minCreds = { ...credentials, schema: undefined as any, database: undefined as any };
      const result = qualifyName('BOOKS', minCreds);
      expect(result).to.equal('BOOKS');
    });

    it('should work with schema but no database', () => {
      const creds = { ...credentials, database: undefined as any };
      const result = qualifyName('BOOKS', creds);
      expect(result).to.equal('TEST_SCHEMA.BOOKS');
    });
  });
});
