/**
 * Unit tests for $expand support
 */

import { expect } from 'chai';
import { cqnToSQL } from '../../src/cqn/toSQL.js';
import { SnowflakeCredentials } from '../../src/config.js';

describe('Expand Support', () => {
  const credentials: SnowflakeCredentials = {
    account: 'TEST',
    user: 'TEST_USER',
    database: 'TEST_DB',
    schema: 'TEST_SCHEMA',
    auth: 'jwt',
    jwt: { privateKey: 'dummy' },
  };

  describe('To-one expansion', () => {
    it('should generate LEFT JOIN for to-one association', () => {
      const cqn = {
        SELECT: {
          from: { ref: ['Books'], as: 'base' },
          columns: [
            { ref: ['ID'] },
            { ref: ['title'] },
            { 
              ref: ['author'], 
              expand: [
                { ref: ['name'] },
                { ref: ['country'] }
              ]
            }
          ],
        },
      };

      const result = cqnToSQL(cqn, credentials);

      expect(result.sql).to.include('LEFT JOIN');
      expect(result.sql).to.include('author_ID');
      expect(result.sql).to.include('AS author_name');
      expect(result.sql).to.include('AS author_country');
    });

    it('should handle multiple to-one expansions', () => {
      const cqn = {
        SELECT: {
          from: { ref: ['Books'], as: 'base' },
          columns: [
            { ref: ['title'] },
            { 
              ref: ['author'], 
              expand: [{ ref: ['name'] }]
            },
            {
              ref: ['publisher'],
              expand: [{ ref: ['name'] }]
            }
          ],
        },
      };

      const result = cqnToSQL(cqn, credentials);

      expect(result.sql).to.match(/LEFT JOIN.*LEFT JOIN/s);
    });

    it('should handle expand with all columns', () => {
      const cqn = {
        SELECT: {
          from: { ref: ['Books'] },
          columns: [
            { ref: ['title'] },
            { 
              ref: ['author'], 
              expand: [{ ref: ['*'] }] 
            }
          ],
        },
      };

      const result = cqnToSQL(cqn, credentials);

      expect(result.sql).to.include('LEFT JOIN');
    });
  });

  describe('Inline expansion', () => {
    it('should generate LEFT JOIN for inline association', () => {
      const cqn = {
        SELECT: {
          from: { ref: ['Books'], as: 'base' },
          columns: [
            { ref: ['title'] },
            {
              ref: ['author'],
              inline: [
                { ref: ['name'], as: 'authorName' }
              ]
            }
          ],
        },
      };

      const result = cqnToSQL(cqn, credentials);

      expect(result.sql).to.include('LEFT JOIN');
      expect(result.sql).to.include('AS authorName');
    });
  });

  describe('Nested expansions', () => {
    it('should handle deeply nested expansions', () => {
      const cqn = {
        SELECT: {
          from: { ref: ['Orders'] },
          columns: [
            { ref: ['ID'] },
            {
              ref: ['items'],
              expand: [
                { ref: ['product'] },
                {
                  ref: ['book'],
                  expand: [
                    { ref: ['title'] },
                    {
                      ref: ['author'],
                      expand: [
                        { ref: ['name'] }
                      ]
                    }
                  ]
                }
              ]
            }
          ],
        },
      };

      const result = cqnToSQL(cqn, credentials);

      // Should have multiple LEFT JOINs for nested structure
      expect(result.sql).to.include('LEFT JOIN');
    });
  });

  describe('Path expressions', () => {
    it('should handle path navigation in WHERE', () => {
      const cqn = {
        SELECT: {
          from: { ref: ['Books'] },
          where: [
            { ref: ['author', 'name'] },
            '=',
            { val: 'John Doe' }
          ],
        },
      };

      const result = cqnToSQL(cqn, credentials);

      // Path expressions become qualified column references
      expect(result.sql).to.include('author.name');
    });

    it('should handle path expressions in SELECT', () => {
      const cqn = {
        SELECT: {
          from: { ref: ['Books'] },
          columns: [
            { ref: ['title'] },
            { ref: ['author', 'name'], as: 'authorName' }
          ],
        },
      };

      const result = cqnToSQL(cqn, credentials);

      expect(result.sql).to.include('author.name');
      expect(result.sql).to.include('AS authorName');
    });
  });
});


