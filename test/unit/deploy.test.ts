import { expect } from 'chai';
import { buildDeployStatements } from '../../src/ddl/deploy.js';
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

  it('generates table DDL for persisted entities', () => {
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
    expect(statements[0]).to.include('"title" VARCHAR(111)');
    expect(statements[0]).to.not.include('author');
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

  it('generates localized and temporal helper objects', () => {
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
    expect(output).to.include('LocalizedBooks_texts');
    expect(output).to.include('localized_LocalizedBooks');
    expect(output).to.include('current_WorkAssignments');
  });
});
