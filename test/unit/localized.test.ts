/**
 * Unit tests for localization support
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
  });

  describe('getEntityKeys', () => {
    it('should extract entity keys', () => {
      const entity = {
        name: 'Books',
        elements: {
          ID: { type: 'cds.UUID', key: true },
          title: { type: 'cds.String' },
          author_ID: { type: 'cds.UUID', key: true },
        },
      };

      const keys = getEntityKeys(entity);

      expect(keys).to.deep.equal(['ID', 'author_ID']);
    });
  });

  describe('generateTextsTable', () => {
    it('should generate .texts table DDL', () => {
      const entity = {
        entityName: 'Books',
        localizedElements: [
          { name: 'title', type: 'cds.String', length: 100, localized: true },
          { name: 'description', type: 'cds.String', localized: true },
        ],
        keys: ['ID'],
      };

      const ddl = generateTextsTable(entity, credentials);

      expect(ddl).to.include('CREATE TABLE TEST_DB.TEST_SCHEMA.Books_texts');
      expect(ddl).to.include('locale VARCHAR(14) NOT NULL');
      expect(ddl).to.include('ID VARCHAR(36) NOT NULL');
      expect(ddl).to.include('title VARCHAR(100)');
      expect(ddl).to.include('description VARCHAR(5000)');
      expect(ddl).to.include('PRIMARY KEY (locale, ID)');
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

      expect(ddl).to.include('PRIMARY KEY (locale, country, productCode)');
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

      expect(view).to.include('CREATE VIEW TEST_DB.TEST_SCHEMA.localized_Books');
      expect(view).to.include('LEFT JOIN TEST_DB.TEST_SCHEMA.Books_texts');
      expect(view).to.include('COALESCE(texts.title, base.title) AS title');
      expect(view).to.include("SESSION_PARAMETER('LOCALE')");
      expect(view).to.include("base.ID = texts.ID");
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

      expect(view).to.include("'de'");
    });
  });
});


