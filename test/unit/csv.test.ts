/**
 * Unit tests for CSV MERGE statement generation.
 * No Snowflake connection required.
 */

import { expect } from 'chai';
import { buildMergeSql, getKeyColumns } from '../../src/ddl/csv.js';

describe('CSV MERGE generation (buildMergeSql)', () => {
  it('generates correct MERGE SQL structure for a single row', () => {
    const { sql, params } = buildMergeSql(
      'DB.SCHEMA.AUTHORS',
      ['ID', 'NAME', 'COUNTRY'],
      ['ID'],
      [['uuid-1', 'Alice', 'US']]
    );

    expect(sql).to.include('MERGE INTO DB.SCHEMA.AUTHORS AS target');
    expect(sql).to.include('USING (SELECT ? AS ID, ? AS NAME, ? AS COUNTRY) AS src');
    expect(sql).to.include('ON (target.ID = src.ID)');
    expect(sql).to.include('WHEN MATCHED THEN UPDATE SET target.NAME = src.NAME, target.COUNTRY = src.COUNTRY');
    expect(sql).to.include('WHEN NOT MATCHED THEN INSERT (ID, NAME, COUNTRY) VALUES (src.ID, src.NAME, src.COUNTRY)');
    expect(params).to.deep.equal(['uuid-1', 'Alice', 'US']);
  });

  it('generates UNION ALL for multiple rows', () => {
    const { sql, params } = buildMergeSql(
      'T',
      ['ID', 'NAME'],
      ['ID'],
      [
        ['uuid-1', 'Alice'],
        ['uuid-2', 'Bob'],
        ['uuid-3', 'Carol'],
      ]
    );

    expect(sql.match(/SELECT \? AS ID, \? AS NAME/g)).to.have.lengthOf(3);
    expect(sql).to.include('UNION ALL');
    expect(params).to.deep.equal(['uuid-1', 'Alice', 'uuid-2', 'Bob', 'uuid-3', 'Carol']);
  });

  it('uses all columns as match condition when no keys provided', () => {
    const { sql } = buildMergeSql('T', ['A', 'B'], [], [['x', 'y']]);
    expect(sql).to.include('ON (target.A = src.A AND target.B = src.B)');
    // When all cols are keys, update set uses all cols
    expect(sql).to.include('WHEN MATCHED THEN UPDATE SET target.A = src.A, target.B = src.B');
  });

  it('updates only non-key columns', () => {
    const { sql } = buildMergeSql(
      'T',
      ['ID', 'NAME', 'SCORE'],
      ['ID'],
      [['id1', 'Alice', 42]]
    );
    // NAME and SCORE should be in the UPDATE
    expect(sql).to.include('target.NAME = src.NAME');
    expect(sql).to.include('target.SCORE = src.SCORE');
    // ID should NOT appear in UPDATE SET (it is the key)
    const updateLine = sql.split('\n').find(l => l.startsWith('WHEN MATCHED'));
    expect(updateLine).to.not.include('target.ID = src.ID');
  });

  it('substitutes null for missing values', () => {
    const { params } = buildMergeSql(
      'T',
      ['ID', 'NAME'],
      ['ID'],
      [['id1', undefined as any]]
    );
    expect(params[1]).to.equal(null);
  });

  it('throws on empty rows', () => {
    expect(() => buildMergeSql('T', ['A'], ['A'], [])).to.throw(/empty/i);
  });

  it('handles composite keys correctly', () => {
    const { sql } = buildMergeSql(
      'T',
      ['ENTITY_ID', 'LOCALE', 'TITLE'],
      ['ENTITY_ID', 'LOCALE'],
      [['id1', 'en', 'Hello']]
    );
    expect(sql).to.include('ON (target.ENTITY_ID = src.ENTITY_ID AND target.LOCALE = src.LOCALE)');
    expect(sql).to.include('target.TITLE = src.TITLE');
    // ENTITY_ID and LOCALE are keys — should not appear in UPDATE SET
    const updateLine = sql.split('\n').find(l => l.startsWith('WHEN MATCHED'));
    expect(updateLine).to.not.include('target.ENTITY_ID');
    expect(updateLine).to.not.include('target.LOCALE');
  });
});

// ---------------------------------------------------------------------------

describe('getKeyColumns', () => {
  it('extracts key columns from entity.keys', () => {
    const entityDef = {
      keys: { ID: { type: 'cds.UUID' }, locale: { type: 'cds.String' } },
      elements: {
        ID: { type: 'cds.UUID', key: true },
        locale: { type: 'cds.String', key: true },
        name: { type: 'cds.String' },
      },
    };
    const keys = getKeyColumns(entityDef);
    expect(keys).to.deep.equal(['ID', 'LOCALE']);
  });

  it('falls back to elements with key:true when .keys is absent', () => {
    const entityDef = {
      elements: {
        ID: { type: 'cds.UUID', key: true },
        name: { type: 'cds.String' },
      },
    };
    const keys = getKeyColumns(entityDef);
    expect(keys).to.deep.equal(['ID']);
  });

  it('returns empty array for undefined entity', () => {
    expect(getKeyColumns(undefined)).to.deep.equal([]);
    expect(getKeyColumns(null)).to.deep.equal([]);
    expect(getKeyColumns({})).to.deep.equal([]);
  });
});
