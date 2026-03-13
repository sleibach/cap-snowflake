/**
 * Unit tests for CQN to SQL translation
 *
 * Table names and column names are normalised to UPPERCASE for Snowflake.
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
    it('should translate simple SELECT *', () => {
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
      expect(result.sql).to.include('SELECT TITLE, PRICE FROM TEST_DB.TEST_SCHEMA.BOOKS');
    });

    it('should translate SELECT with column alias', () => {
      const cqn = {
        SELECT: {
          from: { ref: ['Books'] },
          columns: [
            { ref: ['title'], as: 'bookTitle' },
          ],
        },
      };

      const result = cqnToSQL(cqn, credentials);
      expect(result.sql).to.include('TITLE AS "bookTitle"');
    });

    it('should translate SELECT with WHERE', () => {
      const cqn = {
        SELECT: {
          from: { ref: ['Books'] },
          where: [{ ref: ['price'] }, '<', { val: 20 }],
        },
      };

      const result = cqnToSQL(cqn, credentials);
      expect(result.sql).to.include('WHERE PRICE < ?');
      expect(result.params).to.deep.equal([20]);
    });

    it('should translate SELECT with complex WHERE', () => {
      const cqn = {
        SELECT: {
          from: { ref: ['Books'] },
          where: [
            { ref: ['price'] }, '>', { val: 10 },
            'and',
            { ref: ['stock'] }, '>', { val: 0 }
          ],
        },
      };

      const result = cqnToSQL(cqn, credentials);
      expect(result.sql).to.include('WHERE PRICE > ? AND STOCK > ?');
      expect(result.params).to.deep.equal([10, 0]);
    });

    it('should translate SELECT with ORDER BY ASC', () => {
      const cqn = {
        SELECT: {
          from: { ref: ['Books'] },
          orderBy: [{ ref: ['title'], sort: 'asc' }],
        },
      };

      const result = cqnToSQL(cqn, credentials);
      expect(result.sql).to.include('ORDER BY TITLE ASC');
    });

    it('should translate SELECT with ORDER BY DESC', () => {
      const cqn = {
        SELECT: {
          from: { ref: ['Books'] },
          orderBy: [{ ref: ['price'], sort: 'desc' }],
        },
      };

      const result = cqnToSQL(cqn, credentials);
      expect(result.sql).to.include('ORDER BY PRICE DESC');
    });

    it('should translate SELECT with multiple ORDER BY', () => {
      const cqn = {
        SELECT: {
          from: { ref: ['Books'] },
          orderBy: [
            { ref: ['author'], sort: 'asc' },
            { ref: ['price'], sort: 'desc' }
          ],
        },
      };

      const result = cqnToSQL(cqn, credentials);
      expect(result.sql).to.include('ORDER BY AUTHOR ASC, PRICE DESC');
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

    it('should translate SELECT with LIMIT only', () => {
      const cqn = {
        SELECT: {
          from: { ref: ['Books'] },
          limit: { rows: { val: 5 } },
        },
      };

      const result = cqnToSQL(cqn, credentials);
      expect(result.sql).to.include('LIMIT 5');
      expect(result.sql).not.to.include('OFFSET');
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
      expect(result.sql).to.include('SELECT DISTINCT AUTHOR');
    });

    it('should handle table alias in FROM', () => {
      const cqn = {
        SELECT: {
          from: { ref: ['Books'], as: 'b' },
          columns: [{ ref: ['title'] }],
        },
      };

      const result = cqnToSQL(cqn, credentials);
      expect(result.sql).to.include('AS "b"');
    });

    it('should translate SELECT with GROUP BY', () => {
      const cqn = {
        SELECT: {
          from: { ref: ['Orders'] },
          columns: [
            { ref: ['status'] },
            { func: 'count', as: 'total' },
          ],
          groupBy: [{ ref: ['status'] }],
        },
      };

      const result = cqnToSQL(cqn, credentials);
      expect(result.sql).to.include('GROUP BY');
      expect(result.sql).to.include('STATUS');
    });

    it('should translate SELECT with HAVING', () => {
      const cqn = {
        SELECT: {
          from: { ref: ['Orders'] },
          columns: [
            { ref: ['status'] },
          ],
          groupBy: [{ ref: ['status'] }],
          having: [{ func: 'count', args: [] }, '>', { val: 5 }],
        },
      };

      const result = cqnToSQL(cqn, credentials);
      expect(result.sql).to.include('HAVING');
    });

    it('should translate fully qualified entity name', () => {
      const cqn = {
        SELECT: {
          from: { ref: ['myns.Books'] },
        },
      };

      const result = cqnToSQL(cqn, credentials);
      // Entity names with dots: last segment is used as table name
      expect(result.sql).to.include('TEST_DB.TEST_SCHEMA.');
    });

    it('should handle value columns (literals)', () => {
      const cqn = {
        SELECT: {
          from: { ref: ['Books'] },
          columns: [
            { ref: ['title'] },
            { val: 42, as: 'constant' },
          ],
        },
      };

      const result = cqnToSQL(cqn, credentials);
      expect(result.sql).to.include('42');
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
      expect(result.sql).to.match(/\(TITLE, PRICE\)|VALUES/);
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
      expect(result.sql).to.include('VALUES (?, ?)');
      expect(result.params).to.deep.equal(['Test Book', 15.99]);
    });

    it('should translate INSERT with rows', () => {
      const cqn = {
        INSERT: {
          into: 'Books',
          columns: ['ID', 'TITLE'],
          rows: [
            ['id-1', 'First Book'],
            ['id-2', 'Second Book'],
          ],
        },
      };

      const result = cqnToSQL(cqn, credentials);
      expect(result.sql).to.include('INSERT INTO TEST_DB.TEST_SCHEMA.BOOKS');
      expect(result.sql).to.include('VALUES (?, ?), (?, ?)');
      expect(result.params).to.deep.equal(['id-1', 'First Book', 'id-2', 'Second Book']);
    });

    it('should handle null values in INSERT', () => {
      const cqn = {
        INSERT: {
          into: 'Books',
          entries: [{ title: 'Book', price: null }],
        },
      };

      const result = cqnToSQL(cqn, credentials);
      expect(result.params).to.include(null);
    });

    it('should handle boolean values in INSERT', () => {
      const cqn = {
        INSERT: {
          into: 'Books',
          entries: [{ title: 'Book', active: true }],
        },
      };

      const result = cqnToSQL(cqn, credentials);
      expect(result.params).to.include(true);
    });

    it('should throw for invalid INSERT', () => {
      const cqn = {
        INSERT: {
          into: 'Books',
          // no entries, columns, or rows
        },
      };

      expect(() => cqnToSQL(cqn, credentials)).to.throw();
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
      expect(result.sql).to.include('SET PRICE = ?, STOCK = ?');
      expect(result.sql).to.include('WHERE ID = ?');
      expect(result.params).to.deep.equal([25.99, 100, '123']);
    });

    it('should translate UPDATE without WHERE', () => {
      const cqn = {
        UPDATE: {
          entity: 'Config',
          data: { value: 'new' },
        },
      };

      const result = cqnToSQL(cqn, credentials);
      expect(result.sql).to.include('UPDATE TEST_DB.TEST_SCHEMA.CONFIG');
      expect(result.sql).to.include('SET VALUE = ?');
      expect(result.sql).not.to.include('WHERE');
    });

    it('should throw for UPDATE without data', () => {
      const cqn = {
        UPDATE: {
          entity: 'Books',
        },
      };

      expect(() => cqnToSQL(cqn, credentials)).to.throw('UPDATE requires data');
    });

    it('should handle null values in UPDATE', () => {
      const cqn = {
        UPDATE: {
          entity: 'Books',
          data: { description: null },
          where: [{ ref: ['ID'] }, '=', { val: '1' }],
        },
      };

      const result = cqnToSQL(cqn, credentials);
      expect(result.params).to.include(null);
    });
  });

  describe('DELETE translation', () => {
    it('should translate DELETE with WHERE', () => {
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

    it('should translate DELETE without WHERE', () => {
      const cqn = {
        DELETE: {
          from: 'TempTable',
        },
      };

      const result = cqnToSQL(cqn, credentials);
      expect(result.sql).to.include('DELETE FROM TEST_DB.TEST_SCHEMA.TEMPTABLE');
      expect(result.sql).not.to.include('WHERE');
    });

    it('should translate DELETE with complex WHERE', () => {
      const cqn = {
        DELETE: {
          from: 'Books',
          where: [
            { ref: ['stock'] }, '=', { val: 0 },
            'and',
            { ref: ['price'] }, '<', { val: 5 }
          ],
        },
      };

      const result = cqnToSQL(cqn, credentials);
      expect(result.sql).to.include('WHERE STOCK = ? AND PRICE < ?');
      expect(result.params).to.deep.equal([0, 5]);
    });
  });

  describe('MERGE (UPSERT) translation', () => {
    it('should generate MERGE statement', () => {
      const data = { ID: '123', title: 'Book', price: 19.99 };
      const keys = ['ID'];

      const result = generateMerge('Books', keys, data, credentials);

      expect(result.sql).to.include('MERGE INTO TEST_DB.TEST_SCHEMA.BOOKS');
      expect(result.sql).to.include('USING');
      // UPPERCASE key 'ID' needs no quoting; lowercase columns are quoted to preserve case
      expect(result.sql).to.include('ON target.ID = source.ID');
      expect(result.sql).to.include('WHEN MATCHED THEN UPDATE');
      expect(result.sql).to.include('WHEN NOT MATCHED THEN INSERT');
      expect(result.params).to.deep.equal(['123', 'Book', 19.99]);
    });

    it('should generate MERGE with composite key', () => {
      const data = { country: 'DE', code: 'B1', name: 'Book' };
      const keys = ['country', 'code'];

      const result = generateMerge('Products', keys, data, credentials);

      // lowercase keys are quoted to preserve case in MERGE ON condition
      expect(result.sql).to.include('ON target."country" = source."country" AND target."code" = source."code"');
      expect(result.sql).to.include('WHEN MATCHED THEN UPDATE');
    });

    it('should generate MERGE with only keys (no update columns)', () => {
      const data = { ID: '123' };
      const keys = ['ID'];

      const result = generateMerge('Entities', keys, data, credentials);

      expect(result.sql).to.include('MERGE INTO');
      expect(result.sql).not.to.include('WHEN MATCHED THEN UPDATE SET');
      expect(result.sql).to.include('WHEN NOT MATCHED THEN INSERT');
    });
  });

  describe('Error handling', () => {
    it('should throw for unsupported operation', () => {
      const cqn = {} as any;
      expect(() => cqnToSQL(cqn, credentials)).to.throw('Unsupported CQN operation');
    });
  });

  describe('CAP draft columns', () => {
    const draftTarget = {
      elements: {
        ID: { type: 'cds.UUID', key: true },
        title: { type: 'cds.String' },
        // Draft indicator elements added by CAP — no virtual flag but also no physical column
        IsActiveEntity: { type: 'cds.Boolean' },
        HasActiveEntity: { type: 'cds.Boolean' },
        HasDraftEntity: { type: 'cds.Boolean' },
        DraftAdministrativeData: { target: 'DRAFT.DraftAdministrativeData', isAssociation: true },
      }
    };

    it('emits TRUE/FALSE constants for draft indicator columns in expand context', () => {
      const cqn = {
        SELECT: {
          from: { ref: ['Books'] },
          columns: [
            { ref: ['ID'] },
            { ref: ['IsActiveEntity'] },
            { ref: ['HasActiveEntity'] },
            { ref: ['HasDraftEntity'] },
            { ref: ['DraftAdministrativeData'], expand: [{ ref: ['DraftUUID'] }] },
          ],
        },
      };

      const result = cqnToSQL(cqn, credentials, { target: draftTarget });
      expect(result.sql).to.include('TRUE AS "IsActiveEntity"');
      expect(result.sql).to.include('FALSE AS "HasActiveEntity"');
      expect(result.sql).to.include('FALSE AS "HasDraftEntity"');
      // DraftAdministrativeData has no physical FK → NULLs for expanded columns
      expect(result.sql).to.include('NULL AS "DraftAdministrativeData__DraftUUID"');
      // No physical join on DraftAdministrativeData
      expect(result.sql).not.to.include('DRAFTADMINISTRATIVEDATA_ID');
    });

    it('UPDATE with inline WHERE in entity ref (CAP single-entity PATCH)', () => {
      const cqn = {
        UPDATE: {
          entity: { ref: [{ id: 'Books', where: [{ ref: ['ID'] }, '=', { val: 'abc-123' }] }] },
          data: { title: 'Updated' },
        },
      };
      const result = cqnToSQL(cqn, credentials);
      expect(result.sql).to.include('UPDATE');
      expect(result.sql).to.include('SET TITLE = ?');
      expect(result.sql).to.include('WHERE ID = ?');
      expect(result.params).to.deep.equal(['Updated', 'abc-123']);
    });

    it('DELETE with inline WHERE in from ref (CAP single-entity DELETE)', () => {
      const cqn = {
        DELETE: {
          from: { ref: [{ id: 'Books', where: [{ ref: ['ID'] }, '=', { val: 'abc-123' }] }] },
        },
      };
      const result = cqnToSQL(cqn, credentials);
      expect(result.sql).to.include('DELETE FROM');
      expect(result.sql).to.include('WHERE ID = ?');
      expect(result.params).to.deep.equal(['abc-123']);
    });

    it('emits physical column for FK (author_ID) absent from CDS runtime elements', () => {
      // In CAP v9, generated FK columns like author_ID are NOT in the CDS runtime
      // model elements (only in cds.compile.for.sql). They must still be emitted as
      // physical column references, not NULL. This is the Fiori Elements value-help fix.
      const target = {
        name: 'E2ETestService.Books',
        elements: {
          ID: { type: 'cds.UUID', key: true },
          title: { type: 'cds.String' },
          author: { target: 'cap_e2e.Authors', isAssociation: true },
          // author_ID is intentionally absent — like real CAP runtime model
        }
      };
      const cqn = {
        SELECT: {
          from: { ref: ['E2ETestService.Books'] },
          columns: [
            { ref: ['ID'] },
            { ref: ['title'] },
            { ref: ['author_ID'] },  // FK not in elements — must be physical
            { ref: ['author'], expand: [{ ref: ['ID'] }, { ref: ['name'] }] },
          ],
        },
      };
      const result = cqnToSQL(cqn, credentials, { target });
      // author_ID must be a physical column reference, not NULL
      expect(result.sql).to.include('AUTHOR_ID');
      expect(result.sql).not.to.include('NULL AS "author_ID"');
      // Expand columns use __ separator to avoid alias collision
      expect(result.sql).to.include('"author__ID"');
      expect(result.sql).to.include('"author__name"');
    });

    it('still joins physical associations when FK exists on base entity', () => {
      const target = {
        elements: {
          ID: { type: 'cds.UUID', key: true },
          author_ID: { type: 'cds.UUID' },
          author: { target: 'Authors', isAssociation: true },
        }
      };
      const cqn = {
        SELECT: {
          from: { ref: ['Books'] },
          columns: [
            { ref: ['ID'] },
            { ref: ['author'], expand: [{ ref: ['ID'] }, { ref: ['name'] }] },
          ],
        },
      };
      const result = cqnToSQL(cqn, credentials, { target });
      expect(result.sql).to.include('LEFT JOIN');
      expect(result.sql).to.include('AUTHOR_ID');
    });
  });

  // ---------------------------------------------------------------------------

  describe('Subquery in WHERE (#6)', () => {
    it('translates { SELECT } subquery in WHERE — ID IN (SELECT ...)', () => {
      const cqn = {
        SELECT: {
          from: { ref: ['cap_e2e.Authors'] },
          where: [
            { ref: ['ID'] },
            'in',
            {
              SELECT: {
                from: { ref: ['cap_e2e.Books'] },
                columns: [{ ref: ['author_ID'] }],
                where: [{ ref: ['price'] }, '>', { val: 30 }],
              },
            },
          ],
        },
      };

      const { sql, params } = cqnToSQL(cqn, credentials);

      expect(sql).to.match(/WHERE ID IN \(/i);
      expect(sql).to.include('SELECT');
      expect(sql).to.include('PRICE > ?');
      expect(params).to.include(30);
    });

    it('subquery params appended to outer params in correct order', () => {
      const cqn = {
        SELECT: {
          from: { ref: ['cap_e2e.Authors'] },
          where: [
            { ref: ['country'] }, '=', { val: 'US' },
            'and',
            { ref: ['ID'] },
            'in',
            {
              SELECT: {
                from: { ref: ['cap_e2e.Books'] },
                columns: [{ ref: ['author_ID'] }],
                where: [{ ref: ['price'] }, '>', { val: 50 }],
              },
            },
          ],
        },
      };

      const { sql, params } = cqnToSQL(cqn, credentials);

      expect(sql).to.include('COUNTRY = ?');
      expect(sql).to.include('IN (');
      expect(sql).to.include('PRICE > ?');
      expect(params[0]).to.equal('US');
      expect(params[1]).to.equal(50);
    });

    it('handles NOT followed by IN subquery', () => {
      const cqn = {
        SELECT: {
          from: { ref: ['cap_e2e.Authors'] },
          where: [
            'NOT',
            { ref: ['ID'] },
            'in',
            {
              SELECT: {
                from: { ref: ['cap_e2e.Orders'] },
                columns: [{ ref: ['book_ID'] }],
              },
            },
          ],
        },
      };

      const { sql } = cqnToSQL(cqn, credentials);
      expect(sql).to.include('NOT');
      expect(sql).to.include('IN (');
    });
  });
});

// ---------------------------------------------------------------------------
describe('Star schema — dimension navigation in groupBy', () => {
  const credentials: import('../../src/config.js').SnowflakeCredentials = {
    account: 'TEST', user: 'TEST_USER', database: 'TEST_DB', schema: 'TEST_SCHEMA',
    auth: 'jwt', jwt: { privateKey: 'dummy' },
  };

  it('groupBy with plain ref generates standard GROUP BY column', () => {
    const cqn = {
      SELECT: {
        from: { ref: ['cap_e2e.SalesFacts'] },
        columns: [{ func: 'sum', args: [{ ref: ['units'] }], as: 'totalUnits' }],
        groupBy: [{ ref: ['channel'] }],
      },
    };
    const { sql } = cqnToSQL(cqn, credentials);
    expect(sql).to.include('GROUP BY CHANNEL');
  });

  it('groupBy with navigation path ref uses dimension join alias when context has target', () => {
    // Simulate a CQN where groupBy has a nav ref (book/title) AND context.target.elements has the 'book' association
    const mockTarget = {
      name: 'cap_e2e.SalesFacts',
      elements: {
        book: { isAssociation: true, target: 'cap_e2e.Books', type: 'cds.Association' },
      },
    };
    const cqn = {
      SELECT: {
        from: { ref: ['cap_e2e.SalesFacts'] },
        columns: [{ ref: ['book', 'title'], as: 'book_title' }],
        groupBy: [{ ref: ['book', 'title'] }],
      },
    };
    const { sql } = cqnToSQL(cqn, credentials, { target: mockTarget });
    // Dimension JOIN should be injected
    expect(sql).to.include('LEFT JOIN');
    expect(sql).to.include('_grp_book');
    expect(sql).to.include('GROUP BY');
    expect(sql).to.include('_grp_book.');
  });

  it('groupBy + having with aggregation generates correct SQL', () => {
    const cqn = {
      SELECT: {
        from: { ref: ['cap_e2e.SalesFacts'] },
        columns: [{ func: 'sum', args: [{ ref: ['units'] }], as: 'totalUnits' }],
        groupBy: [{ ref: ['channel'] }],
        having: [{ func: 'sum', args: [{ ref: ['units'] }] }, '>', { val: 0 }],
      },
    };
    const { sql } = cqnToSQL(cqn, credentials);
    expect(sql).to.include('GROUP BY CHANNEL');
    expect(sql).to.include('HAVING');
  });
});

// ---------------------------------------------------------------------------
// OData $apply aggregate translation
// CAP compiles $apply=groupby((...),aggregate(...)) into CQN with func names
// like "countdistinct", "sum", "avg", etc. — these must map to valid Snowflake SQL.
// ---------------------------------------------------------------------------
describe('$apply aggregate translation', () => {
  const credentials: import('../../src/config.js').SnowflakeCredentials = {
    account: 'TEST', user: 'TEST_USER', database: 'TEST_DB', schema: 'TEST_SCHEMA',
    auth: 'jwt', jwt: { privateKey: 'dummy' },
  };

  // -- countdistinct ----------------------------------------------------------

  it('countdistinct → COUNT(DISTINCT col)', () => {
    const cqn = {
      SELECT: {
        from: { ref: ['MaterialValuation'] },
        columns: [
          { func: 'countdistinct', args: [{ ref: ['material_id'] }], as: 'material_id_countdistinct' },
        ],
      },
    };
    const { sql } = cqnToSQL(cqn, credentials);
    expect(sql).to.include('COUNT(DISTINCT MATERIAL_ID)');
    expect(sql).to.include('"material_id_countdistinct"');
    expect(sql).not.to.include('COUNTDISTINCT');
  });

  it('countdistinct with groupBy — real-world $apply scenario from bug report', () => {
    // Reproduces: $apply=groupby((kategorie),aggregate(material_id with countdistinct as material_id_countdistinct))
    const cqn = {
      SELECT: {
        from: { ref: ['PHARMA_MATERIAL_VALUATION'] },
        columns: [
          { ref: ['kategorie'] },
          { func: 'countdistinct', args: [{ ref: ['material_id'] }], as: 'material_id_countdistinct' },
        ],
        groupBy: [{ ref: ['kategorie'] }],
      },
    };
    const { sql, params } = cqnToSQL(cqn, credentials);
    expect(sql).to.include('COUNT(DISTINCT MATERIAL_ID)');
    expect(sql).to.include('"material_id_countdistinct"');
    expect(sql).to.include('GROUP BY KATEGORIE');
    expect(sql).not.to.include('COUNTDISTINCT');
    expect(params).to.deep.equal([]);
  });

  it('countdistinct is case-insensitive (CAP may lowercase or camelCase)', () => {
    // CAP emits lowercase "countdistinct" — ensure our toUpperCase() + special-case handles it
    const cqn = {
      SELECT: {
        from: { ref: ['Orders'] },
        columns: [
          { func: 'countdistinct', args: [{ ref: ['customer_id'] }], as: 'unique_customers' },
        ],
      },
    };
    const { sql } = cqnToSQL(cqn, credentials);
    expect(sql).to.match(/COUNT\(DISTINCT CUSTOMER_ID\)/);
    expect(sql).not.to.include('COUNTDISTINCT');
  });

  // -- standard aggregates (must still work correctly) -----------------------

  it('count with no args → COUNT(*)', () => {
    const cqn = {
      SELECT: {
        from: { ref: ['Orders'] },
        columns: [{ func: 'count', as: 'total' }],
      },
    };
    const { sql } = cqnToSQL(cqn, credentials);
    expect(sql).to.include('COUNT(*)');
    expect(sql).to.include('"total"');
  });

  it('count with explicit * arg → COUNT(*)', () => {
    const cqn = {
      SELECT: {
        from: { ref: ['Orders'] },
        columns: [{ func: 'count', args: [{ val: '*' }], as: 'total' }],
      },
    };
    const { sql } = cqnToSQL(cqn, credentials);
    expect(sql).to.include('COUNT(');
    expect(sql).to.include('"total"');
  });

  it('sum → SUM(col)', () => {
    const cqn = {
      SELECT: {
        from: { ref: ['Sales'] },
        columns: [{ func: 'sum', args: [{ ref: ['amount'] }], as: 'total_amount' }],
        groupBy: [{ ref: ['region'] }],
      },
    };
    const { sql } = cqnToSQL(cqn, credentials);
    expect(sql).to.include('SUM(AMOUNT)');
    expect(sql).to.include('"total_amount"');
    expect(sql).to.include('GROUP BY REGION');
  });

  it('avg → AVG(col)', () => {
    const cqn = {
      SELECT: {
        from: { ref: ['Sales'] },
        columns: [{ func: 'avg', args: [{ ref: ['price'] }], as: 'avg_price' }],
        groupBy: [{ ref: ['category'] }],
      },
    };
    const { sql } = cqnToSQL(cqn, credentials);
    expect(sql).to.include('AVG(PRICE)');
    expect(sql).to.include('"avg_price"');
  });

  it('min → MIN(col)', () => {
    const cqn = {
      SELECT: {
        from: { ref: ['Sales'] },
        columns: [{ func: 'min', args: [{ ref: ['price'] }], as: 'min_price' }],
      },
    };
    const { sql } = cqnToSQL(cqn, credentials);
    expect(sql).to.include('MIN(PRICE)');
    expect(sql).to.include('"min_price"');
  });

  it('max → MAX(col)', () => {
    const cqn = {
      SELECT: {
        from: { ref: ['Sales'] },
        columns: [{ func: 'max', args: [{ ref: ['price'] }], as: 'max_price' }],
      },
    };
    const { sql } = cqnToSQL(cqn, credentials);
    expect(sql).to.include('MAX(PRICE)');
    expect(sql).to.include('"max_price"');
  });

  // -- multi-aggregate $apply ------------------------------------------------

  it('multiple aggregates with groupBy in one query', () => {
    // $apply=groupby((category),aggregate(price with sum as total_price, id with countdistinct as unique_count))
    const cqn = {
      SELECT: {
        from: { ref: ['Products'] },
        columns: [
          { ref: ['category'] },
          { func: 'sum', args: [{ ref: ['price'] }], as: 'total_price' },
          { func: 'countdistinct', args: [{ ref: ['id'] }], as: 'unique_count' },
          { func: 'avg', args: [{ ref: ['price'] }], as: 'avg_price' },
        ],
        groupBy: [{ ref: ['category'] }],
      },
    };
    const { sql } = cqnToSQL(cqn, credentials);
    expect(sql).to.include('SUM(PRICE)');
    expect(sql).to.include('COUNT(DISTINCT ID)');
    expect(sql).to.include('AVG(PRICE)');
    expect(sql).to.include('GROUP BY CATEGORY');
    expect(sql).not.to.include('COUNTDISTINCT');
  });

  it('$apply with groupBy on multiple dimensions', () => {
    const cqn = {
      SELECT: {
        from: { ref: ['Sales'] },
        columns: [
          { ref: ['region'] },
          { ref: ['year'] },
          { func: 'countdistinct', args: [{ ref: ['customer_id'] }], as: 'unique_customers' },
          { func: 'sum', args: [{ ref: ['revenue'] }], as: 'total_revenue' },
        ],
        groupBy: [{ ref: ['region'] }, { ref: ['year'] }],
      },
    };
    const { sql } = cqnToSQL(cqn, credentials);
    expect(sql).to.include('COUNT(DISTINCT CUSTOMER_ID)');
    expect(sql).to.include('SUM(REVENUE)');
    expect(sql).to.include('GROUP BY REGION, YEAR');
    expect(sql).not.to.include('COUNTDISTINCT');
  });
});

// ---------------------------------------------------------------------------
describe('Large IN list — 1000+ parameters', () => {
  const credentials: import('../../src/config.js').SnowflakeCredentials = {
    account: 'TEST', user: 'TEST_USER', database: 'TEST_DB', schema: 'TEST_SCHEMA',
    auth: 'jwt', jwt: { privateKey: 'dummy' },
  };

  it('WHERE ID IN (...1000 values...) generates correct param count', () => {
    const ids = Array.from({ length: 1000 }, (_, i) =>
      `00000000-0000-0000-0000-${String(i).padStart(12, '0')}`
    );
    const cqn = {
      SELECT: {
        from: { ref: ['cap_e2e.Books'] },
        columns: [{ ref: ['ID'] }],
        where: [
          { ref: ['ID'] },
          'in',
          { list: ids.map(id => ({ val: id })) },
        ],
      },
    };
    const { sql, params } = cqnToSQL(cqn, credentials);
    expect(sql).to.include('WHERE');
    expect(sql).to.include('IN');
    expect(params).to.have.lengthOf(1000);
  });
});
