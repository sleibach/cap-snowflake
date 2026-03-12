import { expect } from 'chai';
import { cqnToSQL } from '../../src/cqn/toSQL.js';
import { SnowflakeCredentials } from '../../src/config.js';

describe('Deep expand regression', () => {
  const credentials: SnowflakeCredentials = {
    account: 'TEST',
    user: 'TEST_USER',
    database: 'TEST_DB',
    schema: 'TEST_SCHEMA',
    auth: 'jwt',
    jwt: { privateKey: 'dummy' }
  };

  it('creates nested aliases for multi-level to-one expands', () => {
    const cqn = {
      SELECT: {
        from: { ref: ['Books'], as: 'base' },
        columns: [
          { ref: ['ID'] },
          {
            ref: ['author'],
            expand: [
              { ref: ['name'] },
              {
                ref: ['country'],
                expand: [{ ref: ['code'] }]
              }
            ]
          }
        ]
      }
    };

    const { sql } = cqnToSQL(cqn, credentials);
    expect(sql).to.include('"author__name"');
    expect(sql).to.include('"author__country__code"');
  });

  it('uses ARRAY_AGG optimization for likely to-many associations', () => {
    const cqn = {
      SELECT: {
        from: { ref: ['Author'], as: 'base' },
        columns: [
          { ref: ['ID'] },
          { ref: ['books'], expand: [{ ref: ['ID'] }, { ref: ['title'] }] }
        ]
      }
    };

    const { sql } = cqnToSQL(cqn, credentials);
    expect(sql).to.include('ARRAY_AGG');
    expect(sql).to.include('AS "books"');
  });
});
