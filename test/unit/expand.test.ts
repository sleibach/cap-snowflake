/**
 * Unit tests for $expand support
 *
 * Column aliases in expanded results are quoted to preserve case (e.g. "author_name").
 * Physical column references are UPPERCASE.
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
      expect(result.sql).to.include('AUTHOR_ID');
      expect(result.sql).to.include('author__name');
      expect(result.sql).to.include('author__country');
    });

    it('should alias expanded columns with association prefix', () => {
      const cqn = {
        SELECT: {
          from: { ref: ['Books'], as: 'base' },
          columns: [
            { ref: ['title'] },
            {
              ref: ['author'],
              expand: [
                { ref: ['name'] },
                { ref: ['email'] }
              ]
            }
          ],
        },
      };

      const result = cqnToSQL(cqn, credentials);

      expect(result.sql).to.include('author__name');
      expect(result.sql).to.include('author__email');
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

    it('should handle expand with all columns (wildcard)', () => {
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
      expect(result.sql).to.include('AS "authorName"');
    });

    it('should flatten inlined columns without nesting', () => {
      const cqn = {
        SELECT: {
          from: { ref: ['Books'], as: 'base' },
          columns: [
            { ref: ['title'] },
            {
              ref: ['author'],
              inline: [
                { ref: ['name'] }
              ]
            }
          ],
        },
      };

      const result = cqnToSQL(cqn, credentials);

      expect(result.sql).to.include('LEFT JOIN');
      // inline uses author_name as default alias
      expect(result.sql).to.include('author_name');
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
              // 'items' ends in 's' → treated as to-many → ARRAY_AGG
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

      // 'items' is detected as to-many (ends in 's') → ARRAY_AGG
      expect(result.sql).to.include('ARRAY_AGG');
    });

    it('should generate nested aliases for multi-level to-one expansions', () => {
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

      const result = cqnToSQL(cqn, credentials);
      expect(result.sql).to.include('author__name');
      expect(result.sql).to.include('author__country__code');
    });
  });

  describe('To-many optimization', () => {
    it('should generate ARRAY_AGG subquery for to-many expansion (names ending in s)', () => {
      const cqn = {
        SELECT: {
          from: { ref: ['Author'], as: 'base' },
          columns: [
            { ref: ['ID'] },
            {
              ref: ['books'],
              expand: [{ ref: ['ID'] }, { ref: ['title'] }]
            }
          ]
        }
      };

      const result = cqnToSQL(cqn, credentials);
      expect(result.sql).to.include('ARRAY_AGG');
      expect(result.sql).to.include('books');
    });

    it('uses short entity name for parentFK when from.ref has fully-qualified name', () => {
      // Regression: from.ref[0] = 'E2ETestService.Authors' must NOT produce
      // TM."E2ETestService.Author_ID" — only the simple name part after the last dot matters.
      const cqn = {
        SELECT: {
          from: { ref: ['E2ETestService.Authors'], as: 'base' },
          columns: [
            { ref: ['ID'] },
            { ref: ['books'], expand: [{ ref: ['ID'] }, { ref: ['title'] }] }
          ]
        }
      };
      const result = cqnToSQL(cqn, credentials);
      expect(result.sql).to.include('ARRAY_AGG');
      // FK must be the simple 'Author_ID', not 'E2ETestService.Author_ID'
      expect(result.sql).to.include('AUTHOR_ID');
      expect(result.sql).not.to.include('"E2ETestService.Author_ID"');
    });

    it('should use LEFT JOIN for to-one expansion (name not ending in s)', () => {
      const cqn = {
        SELECT: {
          from: { ref: ['Books'], as: 'base' },
          columns: [
            { ref: ['ID'] },
            {
              ref: ['author'],
              expand: [{ ref: ['name'] }]
            }
          ]
        }
      };

      const result = cqnToSQL(cqn, credentials);
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

      // Path expressions: first part is quoted alias, second is uppercase column name
      expect(result.sql).to.include('"author".NAME');
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

      expect(result.sql).to.include('AUTHOR.NAME');
      expect(result.sql).to.include('AS "authorName"');
    });
  });
});
