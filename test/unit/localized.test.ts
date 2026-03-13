/**
 * Unit tests for localization support
 *
 * All identifiers are UPPERCASE in Snowflake (unquoted).
 */

import { expect } from 'chai';
import {
  hasLocalizedElements,
  extractLocalizedElements,
  getEntityKeys,
  generateTextsTable,
  generateLocalizedView,
} from '../../src/features/localized.js';
import { SnowflakeCredentials } from '../../src/config.js';

describe('Localization Support', () => {
  const credentials: SnowflakeCredentials = {
    account: 'TEST',
    user: 'TEST_USER',
    database: 'TEST_DB',
    schema: 'TEST_SCHEMA',
    auth: 'jwt',
    jwt: { privateKey: 'dummy' },
  };

  describe('hasLocalizedElements', () => {
    it('should detect localized elements', () => {
      const entity = {
        name: 'Books',
        elements: {
          ID: { type: 'cds.UUID', key: true },
          title: { type: 'cds.String', localized: true },
          description: { type: 'cds.String', localized: true },
        },
      };

      expect(hasLocalizedElements(entity)).to.be.true;
    });

    it('should return false for non-localized entities', () => {
      const entity = {
        name: 'Books',
        elements: {
          ID: { type: 'cds.UUID', key: true },
          title: { type: 'cds.String' },
        },
      };

      expect(hasLocalizedElements(entity)).to.be.false;
    });

    it('should return false for null/undefined entity', () => {
      expect(hasLocalizedElements(null)).to.be.false;
      expect(hasLocalizedElements(undefined)).to.be.false;
      expect(hasLocalizedElements({})).to.be.false;
    });
  });

  describe('extractLocalizedElements', () => {
    it('should extract localized elements', () => {
      const entity = {
        name: 'Books',
        elements: {
          ID: { type: 'cds.UUID', key: true },
          title: { type: 'cds.String', length: 100, localized: true },
          price: { type: 'cds.Decimal' },
          description: { type: 'cds.String', localized: true },
        },
      };

      const localized = extractLocalizedElements(entity);

      expect(localized).to.have.lengthOf(2);
      expect(localized[0].name).to.equal('title');
      expect(localized[0].length).to.equal(100);
      expect(localized[1].name).to.equal('description');
    });

    it('should return empty array for entity with no localized elements', () => {
      const entity = {
        elements: {
          ID: { type: 'cds.UUID' },
          price: { type: 'cds.Decimal' },
        },
      };

      const localized = extractLocalizedElements(entity);
      expect(localized).to.deep.equal([]);
    });

    it('should return empty array for null entity', () => {
      expect(extractLocalizedElements(null)).to.deep.equal([]);
    });
  });

  describe('getEntityKeys', () => {
    it('should extract single key', () => {
      const entity = {
        elements: {
          ID: { type: 'cds.UUID', key: true },
          title: { type: 'cds.String' },
        },
      };

      const keys = getEntityKeys(entity);
      expect(keys).to.deep.equal(['ID']);
    });

    it('should extract composite keys', () => {
      const entity = {
        elements: {
          country: { type: 'cds.String', key: true },
          code: { type: 'cds.String', key: true },
          name: { type: 'cds.String' },
        },
      };

      const keys = getEntityKeys(entity);
      expect(keys).to.include('country');
      expect(keys).to.include('code');
      expect(keys).to.have.lengthOf(2);
    });

    it('should return empty for entity with no keys', () => {
      const entity = {
        elements: { title: { type: 'cds.String' } },
      };
      expect(getEntityKeys(entity)).to.deep.equal([]);
    });
  });

  describe('generateTextsTable', () => {
    it('should generate .texts table DDL with UPPERCASE identifiers', () => {
      const entity = {
        entityName: 'Books',
        localizedElements: [
          { name: 'title', type: 'cds.String', length: 100, localized: true },
          { name: 'description', type: 'cds.String', localized: true },
        ],
        keys: ['ID'],
      };

      const ddl = generateTextsTable(entity, credentials);

      expect(ddl).to.include('CREATE TABLE IF NOT EXISTS TEST_DB.TEST_SCHEMA.BOOKS_TEXTS');
      expect(ddl).to.include('LOCALE VARCHAR(14) NOT NULL');
      expect(ddl).to.include('ID VARCHAR(36) NOT NULL');
      expect(ddl).to.include('TITLE VARCHAR(100)');
      expect(ddl).to.include('DESCRIPTION VARCHAR(5000)');
      expect(ddl).to.include('PRIMARY KEY (LOCALE, ID)');
    });

    it('should handle composite keys', () => {
      const entity = {
        entityName: 'Products',
        localizedElements: [
          { name: 'name', type: 'cds.String', localized: true },
        ],
        keys: ['country', 'productCode'],
      };

      const ddl = generateTextsTable(entity, credentials);

      expect(ddl).to.include('PRIMARY KEY (LOCALE, COUNTRY, PRODUCTCODE)');
    });

    it('should qualify table name with database and schema', () => {
      const entity = {
        entityName: 'CAP_BOOKS',
        localizedElements: [{ name: 'title', type: 'cds.String', localized: true }],
        keys: ['ID'],
      };

      const ddl = generateTextsTable(entity, credentials);
      expect(ddl).to.include('IF NOT EXISTS TEST_DB.TEST_SCHEMA.CAP_BOOKS_TEXTS');
    });
  });

  describe('generateLocalizedView', () => {
    it('should generate localized view with COALESCE', () => {
      const entity = {
        entityName: 'Books',
        localizedElements: [
          { name: 'title', type: 'cds.String', localized: true },
        ],
        keys: ['ID'],
      };

      const view = generateLocalizedView(entity, credentials);

      expect(view).to.include('CREATE OR REPLACE VIEW TEST_DB.TEST_SCHEMA.LOCALIZED_BOOKS');
      expect(view).to.include('LEFT JOIN TEST_DB.TEST_SCHEMA.BOOKS_TEXTS');
      expect(view).to.include('COALESCE(texts.TITLE, base.TITLE) AS TITLE');
      expect(view).to.include("texts.LOCALE = 'en'");
      expect(view).to.include('base.ID = texts.ID');
    });

    it('should exclude localized columns from base.* to avoid duplicates', () => {
      const entity = {
        entityName: 'Books',
        localizedElements: [{ name: 'title', type: 'cds.String', localized: true }],
        keys: ['ID'],
      };

      const view = generateLocalizedView(entity, credentials);
      expect(view).to.include('base.* EXCLUDE (TITLE)');
    });

    it('should use custom default locale', () => {
      const entity = {
        entityName: 'Books',
        localizedElements: [
          { name: 'title', type: 'cds.String', localized: true },
        ],
        keys: ['ID'],
      };

      const view = generateLocalizedView(entity, credentials, 'de');
      expect(view).to.include("texts.LOCALE = 'de'");
    });

    it('should handle composite join keys', () => {
      const entity = {
        entityName: 'Products',
        localizedElements: [{ name: 'name', type: 'cds.String', localized: true }],
        keys: ['country', 'code'],
      };

      const view = generateLocalizedView(entity, credentials);
      expect(view).to.include('base.COUNTRY = texts.COUNTRY');
      expect(view).to.include('base.CODE = texts.CODE');
    });
  });

  describe('generateTextsTable — composite key edge cases (Part E)', () => {
    it('composite key with 3 parts generates PRIMARY KEY (LOCALE, K1, K2, K3)', () => {
      const entity = {
        entityName: 'Prices',
        localizedElements: [{ name: 'label', type: 'cds.String', localized: true }],
        keys: ['salesOrg', 'material', 'currency'],
      };
      const ddl = generateTextsTable(entity, credentials);
      expect(ddl).to.include('PRIMARY KEY (LOCALE, SALESORG, MATERIAL, CURRENCY)');
    });

    it('single key without ID name generates PRIMARY KEY (LOCALE, <KEY>)', () => {
      const entity = {
        entityName: 'Regions',
        localizedElements: [{ name: 'name', type: 'cds.String', localized: true }],
        keys: ['code'],
      };
      const ddl = generateTextsTable(entity, credentials);
      expect(ddl).to.include('PRIMARY KEY (LOCALE, CODE)');
    });
  });
});
