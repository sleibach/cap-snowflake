/**
 * Unit tests for DDL generation
 *
 * All column and table names are normalised to UPPERCASE.
 */

import { expect } from 'chai';
import { buildDeployStatements, generateCreateTable, generateCreateView, generateDropTable } from '../../src/ddl/deploy.js';
import { SnowflakeCredentials } from '../../src/config.js';

describe('Deploy DDL generation', () => {
  const credentials: SnowflakeCredentials = {
    account: 'ACCT',
    user: 'USER',
    database: 'DB',
    schema: 'SCHEMA',
    auth: 'jwt',
    jwt: { privateKey: 'dummy' }
  };

  describe('buildDeployStatements', () => {
    it('generates table DDL for persisted entities with UPPERCASE column names', () => {
      const csn = {
        definitions: {
          'srv.Books': {
            kind: 'entity',
            elements: {
              ID: { type: 'cds.UUID', key: true },
              title: { type: 'cds.String', length: 111 },
              author: { target: 'srv.Authors', isAssociation: true }
            }
          }
        }
      };

      const statements = buildDeployStatements(csn, credentials);
      expect(statements.length).to.equal(1);
      expect(statements[0]).to.include('CREATE TABLE IF NOT EXISTS');
      expect(statements[0]).to.include('TITLE VARCHAR(111)');
      expect(statements[0]).not.to.include('author');
    });

    it('skips entities with @cds.persistence.skip', () => {
      const csn = {
        definitions: {
          'srv.VirtualEntity': {
            kind: 'entity',
            '@cds.persistence.skip': true,
            elements: {
              ID: { type: 'cds.UUID', key: true }
            }
          }
        }
      };

      const statements = buildDeployStatements(csn, credentials);
      expect(statements).to.deep.equal([]);
    });

    it('skips entities with @cds.persistence.exists (externally managed)', () => {
      const csn = {
        definitions: {
          'srv.ExternalTable': {
            kind: 'entity',
            '@cds.persistence.exists': true,
            elements: {
              ID: { type: 'cds.UUID', key: true }
            }
          }
        }
      };

      const statements = buildDeployStatements(csn, credentials);
      expect(statements).to.deep.equal([]);
    });

    it('skips projections/views (entities with query)', () => {
      const csn = {
        definitions: {
          'srv.BooksView': {
            kind: 'entity',
            query: { SELECT: { from: { ref: ['Books'] } } },
            elements: { ID: { type: 'cds.UUID' } }
          }
        }
      };

      const statements = buildDeployStatements(csn, credentials);
      expect(statements).to.deep.equal([]);
    });

    it('generates localized table, texts table, and view', () => {
      const csn = {
        definitions: {
          'srv.LocalizedBooks': {
            kind: 'entity',
            elements: {
              ID: { type: 'cds.UUID', key: true },
              title: { type: 'cds.String', localized: true }
            }
          }
        }
      };

      const statements = buildDeployStatements(csn, credentials);
      const output = statements.join('\n');
      // table name is SRV_LOCALIZEDBOOKS (namespace.entity → NAMESPACE_ENTITY)
      expect(output).to.include('SRV_LOCALIZEDBOOKS_TEXTS');
      expect(output).to.include('LOCALIZED_SRV_LOCALIZEDBOOKS');
    });

    it('generates temporal table and current view', () => {
      const csn = {
        definitions: {
          'srv.WorkAssignments': {
            kind: 'entity',
            elements: {
              ID: { type: 'cds.UUID', key: true },
              validFrom: { type: 'cds.Timestamp', '@cds.valid.from': true },
              validTo: { type: 'cds.Timestamp', '@cds.valid.to': true }
            }
          }
        }
      };

      const statements = buildDeployStatements(csn, credentials);
      const output = statements.join('\n');
      expect(output).to.include('CURRENT_SRV_WORKASSIGNMENTS');
    });

    it('generates both localized and temporal helpers', () => {
      const csn = {
        definitions: {
          'srv.LocalizedBooks': {
            kind: 'entity',
            elements: {
              ID: { type: 'cds.UUID', key: true },
              title: { type: 'cds.String', localized: true }
            }
          },
          'srv.WorkAssignments': {
            kind: 'entity',
            elements: {
              ID: { type: 'cds.UUID', key: true },
              validFrom: { type: 'cds.Timestamp', '@cds.valid.from': true },
              validTo: { type: 'cds.Timestamp', '@cds.valid.to': true }
            }
          }
        }
      };

      const statements = buildDeployStatements(csn, credentials);
      const output = statements.join('\n');
      expect(output).to.include('SRV_LOCALIZEDBOOKS_TEXTS');
      expect(output).to.include('LOCALIZED_SRV_LOCALIZEDBOOKS');
      expect(output).to.include('CURRENT_SRV_WORKASSIGNMENTS');
    });

    it('uses @cds.persistence.name when specified', () => {
      const csn = {
        definitions: {
          'srv.Books': {
            kind: 'entity',
            '@cds.persistence.name': 'CAP_BOOKS',
            elements: {
              ID: { type: 'cds.UUID', key: true },
              title: { type: 'cds.String', length: 100 }
            }
          }
        }
      };

      const statements = buildDeployStatements(csn, credentials);
      expect(statements[0]).to.include('CAP_BOOKS');
    });

    it('skips service and non-entity kinds', () => {
      const csn = {
        definitions: {
          'srv.CatalogService': { kind: 'service' },
          'srv.IBookProc': { kind: 'function', elements: {} },
        }
      };

      const statements = buildDeployStatements(csn, credentials);
      expect(statements).to.deep.equal([]);
    });

    it('generates PRIMARY KEY for single key', () => {
      const csn = {
        definitions: {
          'srv.Books': {
            kind: 'entity',
            elements: {
              ID: { type: 'cds.UUID', key: true },
              title: { type: 'cds.String' }
            }
          }
        }
      };

      const statements = buildDeployStatements(csn, credentials);
      expect(statements[0]).to.include('PRIMARY KEY (ID)');
    });

    it('generates composite PRIMARY KEY', () => {
      const csn = {
        definitions: {
          'srv.Translations': {
            kind: 'entity',
            elements: {
              locale: { type: 'cds.String', key: true },
              code: { type: 'cds.String', key: true },
              text: { type: 'cds.String' }
            }
          }
        }
      };

      const statements = buildDeployStatements(csn, credentials);
      expect(statements[0]).to.include('PRIMARY KEY (LOCALE, CODE)');
    });

    it('handles entities with no elements gracefully', () => {
      const csn = {
        definitions: {
          'srv.Empty': {
            kind: 'entity',
            elements: {}
          }
        }
      };

      const statements = buildDeployStatements(csn, credentials);
      expect(statements).to.deep.equal([]);
    });

    it('skips virtual elements', () => {
      const csn = {
        definitions: {
          'srv.Books': {
            kind: 'entity',
            elements: {
              ID: { type: 'cds.UUID', key: true },
              virtualField: { type: 'cds.String', virtual: true }
            }
          }
        }
      };

      const statements = buildDeployStatements(csn, credentials);
      expect(statements[0]).not.to.include('VIRTUALFIELD');
    });

    it('handles default values', () => {
      const csn = {
        definitions: {
          'srv.Config': {
            kind: 'entity',
            elements: {
              key: { type: 'cds.String', key: true },
              value: { type: 'cds.String', default: { val: 'default_val' } },
              active: { type: 'cds.Boolean', default: { val: true } },
              count: { type: 'cds.Integer', default: { val: 0 } }
            }
          }
        }
      };

      const statements = buildDeployStatements(csn, credentials);
      expect(statements[0]).to.include("DEFAULT 'default_val'");
      expect(statements[0]).to.include('DEFAULT TRUE');
      expect(statements[0]).to.include('DEFAULT 0');
    });
  });

  describe('generateCreateTable', () => {
    it('generates IF NOT EXISTS by default', () => {
      const entity = {
        name: 'BOOKS',
        kind: 'entity' as const,
        elements: {
          ID: { type: 'cds.UUID', key: true }
        }
      };
      const result = generateCreateTable(entity, credentials);
      expect(result).to.include('CREATE TABLE IF NOT EXISTS');
    });

    it('generates without IF NOT EXISTS when disabled', () => {
      const entity = {
        name: 'BOOKS',
        kind: 'entity' as const,
        elements: {
          ID: { type: 'cds.UUID', key: true }
        }
      };
      const result = generateCreateTable(entity, credentials, false);
      expect(result).not.to.include('IF NOT EXISTS');
    });
  });

  describe('generateCreateView', () => {
    it('generates OR REPLACE view by default', () => {
      const result = generateCreateView('MY_VIEW', 'SELECT * FROM MY_TABLE', credentials);
      expect(result).to.include('CREATE OR REPLACE VIEW DB.SCHEMA.MY_VIEW');
      expect(result).to.include('SELECT * FROM MY_TABLE');
    });

    it('generates view without OR REPLACE', () => {
      const result = generateCreateView('MY_VIEW', 'SELECT 1', credentials, false);
      expect(result).not.to.include('OR REPLACE');
      expect(result).to.include('CREATE VIEW');
    });
  });

  describe('generateDropTable', () => {
    it('generates DROP TABLE IF EXISTS by default', () => {
      const result = generateDropTable('BOOKS', credentials);
      expect(result).to.equal('DROP TABLE IF EXISTS DB.SCHEMA.BOOKS');
    });

    it('generates DROP TABLE without IF EXISTS', () => {
      const result = generateDropTable('BOOKS', credentials, false);
      expect(result).to.equal('DROP TABLE DB.SCHEMA.BOOKS');
    });
  });
});
