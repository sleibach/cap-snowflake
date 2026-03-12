/**
 * Unit tests for CQN filter translation
 *
 * Snowflake uses unquoted UPPERCASE identifiers by default. The adapter
 * normalises plain identifiers to UPPERCASE, so all column references in
 * WHERE / HAVING clauses appear as e.g. TITLE, PRICE, STOCK.
 */

import { expect } from 'chai';
import { translateFilter, translateSearch } from '../../src/cqn/filters.js';

describe('CQN Filter Translation', () => {
  it('should translate simple equality', () => {
    const params: any[] = [];
    const xpr = [{ ref: ['title'] }, '=', { val: 'Test Book' }];
    const result = translateFilter(xpr, params);

    expect(result).to.equal('TITLE = ?');
    expect(params).to.deep.equal(['Test Book']);
  });

  it('should translate comparison operators', () => {
    let params: any[] = [];
    let xpr = [{ ref: ['price'] }, '<', { val: 20 }];
    let result = translateFilter(xpr, params);
    expect(result).to.equal('PRICE < ?');
    expect(params).to.deep.equal([20]);

    params = [];
    xpr = [{ ref: ['price'] }, '>=', { val: 10 }];
    result = translateFilter(xpr, params);
    expect(result).to.equal('PRICE >= ?');
    expect(params).to.deep.equal([10]);

    params = [];
    xpr = [{ ref: ['price'] }, '!=', { val: 0 }];
    result = translateFilter(xpr, params);
    expect(result).to.equal('PRICE != ?');
    expect(params).to.deep.equal([0]);

    params = [];
    xpr = [{ ref: ['price'] }, '<>', { val: 0 }];
    result = translateFilter(xpr, params);
    expect(result).to.equal('PRICE <> ?');
    expect(params).to.deep.equal([0]);
  });

  it('should translate AND/OR logic', () => {
    const params: any[] = [];
    const xpr = [
      { ref: ['price'] }, '>', { val: 10 },
      'and',
      { ref: ['stock'] }, '>', { val: 0 }
    ];
    const result = translateFilter(xpr, params);

    expect(result).to.equal('PRICE > ? AND STOCK > ?');
    expect(params).to.deep.equal([10, 0]);
  });

  it('should translate OR logic', () => {
    const params: any[] = [];
    const xpr = [
      { ref: ['status'] }, '=', { val: 'active' },
      'or',
      { ref: ['status'] }, '=', { val: 'pending' }
    ];
    const result = translateFilter(xpr, params);

    expect(result).to.equal('STATUS = ? OR STATUS = ?');
    expect(params).to.deep.equal(['active', 'pending']);
  });

  it('should translate NOT logic', () => {
    const params: any[] = [];
    const xpr = [
      'not',
      { xpr: [{ ref: ['archived'] }, '=', { val: true }] }
    ];
    const result = translateFilter(xpr, params);

    expect(result).to.equal('NOT (ARCHIVED = ?)');
    expect(params).to.deep.equal([true]);
  });

  it('should translate IN operator', () => {
    const params: any[] = [];
    const xpr = [
      { ref: ['status'] },
      'in',
      { list: [{ val: 'active' }, { val: 'pending' }] }
    ];
    const result = translateFilter(xpr, params);

    expect(result).to.equal('STATUS IN (?, ?)');
    expect(params).to.deep.equal(['active', 'pending']);
  });

  it('should translate IN with numeric values', () => {
    const params: any[] = [];
    const xpr = [
      { ref: ['priority'] },
      'in',
      { list: [{ val: 1 }, { val: 2 }, { val: 3 }] }
    ];
    const result = translateFilter(xpr, params);

    expect(result).to.include('PRIORITY IN');
    expect(params).to.deep.equal([1, 2, 3]);
  });

  it('should translate BETWEEN operator', () => {
    const params: any[] = [];
    const xpr = [
      { ref: ['price'] },
      'between',
      { val: 10 },
      'and',
      { val: 50 }
    ];
    const result = translateFilter(xpr, params);

    expect(result).to.include('BETWEEN');
    expect(params).to.deep.equal([10, 50]);
  });

  it('should translate LIKE operator', () => {
    const params: any[] = [];
    const xpr = [{ ref: ['title'] }, 'like', { val: '%test%' }];
    const result = translateFilter(xpr, params);

    expect(result).to.equal('TITLE LIKE ?');
    expect(params).to.deep.equal(['%test%']);
  });

  it('should translate IS NULL', () => {
    const params: any[] = [];
    const xpr = [{ ref: ['author'] }, 'is', { val: null }];
    const result = translateFilter(xpr, params);

    expect(result).to.equal('AUTHOR IS NULL');
  });

  it('should translate IS NOT NULL', () => {
    const params: any[] = [];
    const xpr = [{ ref: ['description'] }, 'is not', { val: null }];
    const result = translateFilter(xpr, params);

    expect(result).to.include('DESCRIPTION');
    expect(result).to.include('NULL');
  });

  it('should translate nested expressions', () => {
    const params: any[] = [];
    const xpr = [
      { xpr: [{ ref: ['price'] }, '>', { val: 10 }] },
      'or',
      { xpr: [{ ref: ['featured'] }, '=', { val: true }] }
    ];
    const result = translateFilter(xpr, params);

    expect(result).to.equal('(PRICE > ?) OR (FEATURED = ?)');
    expect(params).to.deep.equal([10, true]);
  });

  it('should translate deeply nested expressions', () => {
    const params: any[] = [];
    const xpr = [
      { xpr: [
        { xpr: [{ ref: ['price'] }, '>', { val: 10 }] },
        'and',
        { xpr: [{ ref: ['stock'] }, '>', { val: 0 }] }
      ]}
    ];
    const result = translateFilter(xpr, params);

    expect(result).to.include('PRICE > ?');
    expect(result).to.include('STOCK > ?');
    expect(result).to.include('AND');
  });

  it('should translate functions', () => {
    const params: any[] = [];
    const xpr = [
      { func: 'lower', args: [{ ref: ['title'] }] },
      '=',
      { val: 'test' }
    ];
    const result = translateFilter(xpr, params);

    expect(result).to.equal('LOWER(TITLE) = ?');
    expect(params).to.deep.equal(['test']);
  });

  it('should translate UPPER function', () => {
    const params: any[] = [];
    const xpr = [
      { func: 'upper', args: [{ ref: ['country'] }] },
      '=',
      { val: 'DE' }
    ];
    const result = translateFilter(xpr, params);

    expect(result).to.equal('UPPER(COUNTRY) = ?');
  });

  it('should translate LENGTH function', () => {
    const params: any[] = [];
    const xpr = [
      { func: 'length', args: [{ ref: ['description'] }] },
      '>',
      { val: 100 }
    ];
    const result = translateFilter(xpr, params);

    expect(result).to.equal('LENGTH(DESCRIPTION) > ?');
  });

  it('should translate CONTAINS as LIKE', () => {
    const params: any[] = [];
    const xpr = [
      { func: 'contains', args: [{ ref: ['title'] }, { val: 'CAP' }] }
    ];
    const result = translateFilter(xpr, params);

    expect(result).to.equal('TITLE LIKE ?');
    expect(params).to.deep.equal(['%CAP%']);
  });

  it('should translate STARTSWITH as LIKE', () => {
    const params: any[] = [];
    const xpr = [
      { func: 'startswith', args: [{ ref: ['title'] }, { val: 'The' }] }
    ];
    const result = translateFilter(xpr, params);

    expect(result).to.equal('TITLE LIKE ?');
    expect(params).to.deep.equal(['The%']);
  });

  it('should translate ENDSWITH as LIKE', () => {
    const params: any[] = [];
    const xpr = [
      { func: 'endswith', args: [{ ref: ['title'] }, { val: 'Guide' }] }
    ];
    const result = translateFilter(xpr, params);

    expect(result).to.equal('TITLE LIKE ?');
    expect(params).to.deep.equal(['%Guide']);
  });

  it('should translate SUBSTRING function', () => {
    const params: any[] = [];
    const xpr = [
      { func: 'substring', args: [{ ref: ['title'] }, { val: 1 }, { val: 5 }] },
      '=',
      { val: 'Hello' }
    ];
    const result = translateFilter(xpr, params);

    expect(result).to.include('SUBSTRING(TITLE');
    expect(result).to.include('= ?');
  });

  it('should translate YEAR/MONTH/DAY functions', () => {
    let params: any[] = [];
    let xpr = [{ func: 'year', args: [{ ref: ['createdAt'] }] }, '=', { val: 2024 }];
    let result = translateFilter(xpr, params);
    expect(result).to.equal('YEAR(CREATEDAT) = ?');
    expect(params).to.deep.equal([2024]);

    params = [];
    xpr = [{ func: 'month', args: [{ ref: ['createdAt'] }] }, '=', { val: 1 }];
    result = translateFilter(xpr, params);
    expect(result).to.equal('MONTH(CREATEDAT) = ?');

    params = [];
    xpr = [{ func: 'day', args: [{ ref: ['createdAt'] }] }, '=', { val: 15 }];
    result = translateFilter(xpr, params);
    expect(result).to.equal('DAY(CREATEDAT) = ?');
  });

  it('should handle boolean literal values', () => {
    const params: any[] = [];
    const xpr = [{ ref: ['active'] }, '=', { val: true }];
    const result = translateFilter(xpr, params);

    expect(result).to.equal('ACTIVE = ?');
    expect(params).to.deep.equal([true]);
  });

  it('should handle null literal values', () => {
    const params: any[] = [];
    const xpr = [{ ref: ['deletedAt'] }, '=', { val: null }];
    const result = translateFilter(xpr, params);

    expect(result).to.equal('DELETEDAT = NULL');
    expect(params).to.deep.equal([]);
  });

  it('should handle multi-part path references', () => {
    const params: any[] = [];
    const xpr = [{ ref: ['author', 'name'] }, '=', { val: 'John' }];
    const result = translateFilter(xpr, params);

    expect(result).to.equal('AUTHOR.NAME = ?');
    expect(params).to.deep.equal(['John']);
  });

  it('should return empty string for empty filter', () => {
    const params: any[] = [];
    const result = translateFilter([], params);
    expect(result).to.equal('');
  });

  it('replaces IsActiveEntity with TRUE constant in WHERE clause', () => {
    const params: any[] = [];
    // Fiori draft filter: (IsActiveEntity eq false or SiblingEntity/IsActiveEntity eq null)
    const filter = [
      { ref: ['IsActiveEntity'] }, '=', { val: false },
      'or',
      { ref: ['SiblingEntity', 'IsActiveEntity'] }, 'is', 'null',
    ];
    const result = translateFilter(filter, params);
    // IsActiveEntity → TRUE constant, SiblingEntity navigation → NULL constant
    expect(result).to.include('TRUE');
    expect(result).to.include('NULL');
    // Must not reference non-existent columns
    expect(result).not.to.include('ISACTIVEENTITY');
    expect(result).not.to.include('SIBLINGENTITY');
  });
});

// ---------------------------------------------------------------------------
describe('translateSearch', () => {
  const stringElements = {
    title: { type: 'cds.String' },
    description: { type: 'cds.LargeString' },
    stock: { type: 'cds.Integer' },
    price: { type: 'cds.Decimal' }
  };

  it('single term → ILIKE on string columns only', () => {
    const params: any[] = [];
    const result = translateSearch([{ val: 'hello' }], stringElements, params);
    expect(result).to.include('TITLE ILIKE ?');
    expect(result).to.include('DESCRIPTION ILIKE ?');
    expect(result).to.not.include('STOCK');
    expect(result).to.not.include('PRICE');
    expect(params).to.deep.equal(['%hello%', '%hello%']);
  });

  it('AND compound → both OR-blocks ANDed', () => {
    const params: any[] = [];
    const result = translateSearch([{ val: 'hello' }, 'and', { val: 'world' }], stringElements, params);
    expect(result).to.include('AND');
    expect(params).to.deep.equal(['%hello%', '%hello%', '%world%', '%world%']);
  });

  it('OR compound → both OR-blocks ORed', () => {
    const params: any[] = [];
    const result = translateSearch([{ val: 'foo' }, 'or', { val: 'bar' }], stringElements, params);
    expect(result).to.include('OR');
  });

  it('elements with @cds.search: false are excluded', () => {
    const params: any[] = [];
    const elements = {
      title: { type: 'cds.String' },
      internal: { type: 'cds.String', '@cds.search': false }
    };
    const result = translateSearch([{ val: 'test' }], elements, params);
    expect(result).to.include('TITLE');
    expect(result).to.not.include('INTERNAL');
  });

  it('non-string elements (Integer, Decimal) are excluded', () => {
    const params: any[] = [];
    const onlyNonString = {
      stock: { type: 'cds.Integer' },
      price: { type: 'cds.Decimal' }
    };
    const result = translateSearch([{ val: 'test' }], onlyNonString, params);
    expect(result).to.equal('');
    expect(params).to.have.lengthOf(0);
  });

  it('empty element list returns empty string', () => {
    const params: any[] = [];
    const result = translateSearch([{ val: 'test' }], {}, params);
    expect(result).to.equal('');
  });

  it('baseAlias qualifies columns to avoid ambiguous name with JOINs', () => {
    const params: any[] = [];
    const result = translateSearch([{ val: 'hello' }], stringElements, params, 'base');
    expect(result).to.include('base.TITLE ILIKE ?');
    expect(result).to.include('base.DESCRIPTION ILIKE ?');
    expect(result).to.not.include('STOCK');
  });
});
