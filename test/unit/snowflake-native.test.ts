/**
 * Unit tests for @Snowflake.* annotation accessors, VECTOR type, applySnowflakeAnnotations,
 * Time Travel, and VARIANT colon-path filter syntax.
 */

import { strict as assert } from 'assert';

// ─── 1. Annotation Accessors ──────────────────────────────────────────────────
import {
  getVectorConfig,
  getClusteringKeys,
  getDataRetentionDays,
  isSearchOptimized,
  getMaskingPolicy,
  getRowAccessPolicy,
  getTags,
  isVariantColumn,
  getExternalTableConfig,
} from '../../src/features/snowflake-native.js';

describe('snowflake-native: annotation accessors', () => {

  describe('getVectorConfig', () => {
    it('returns dimensions and similarity when annotation present', () => {
      const el = { '@Snowflake.vector': { dimensions: 768, similarity: 'DOT_PRODUCT' } };
      const cfg = getVectorConfig(el);
      assert.deepEqual(cfg, { dimensions: 768, similarity: 'DOT_PRODUCT' });
    });

    it('defaults dimensions to 1536 and similarity to COSINE when not set', () => {
      const el = { '@Snowflake.vector': {} };
      const cfg = getVectorConfig(el);
      assert.deepEqual(cfg, { dimensions: 1536, similarity: 'COSINE' });
    });

    it('returns undefined when annotation absent', () => {
      assert.strictEqual(getVectorConfig({}), undefined);
      assert.strictEqual(getVectorConfig(null), undefined);
      assert.strictEqual(getVectorConfig(undefined), undefined);
    });
  });

  describe('getClusteringKeys', () => {
    it('returns array of key names', () => {
      const entity = { '@Snowflake.clustering': ['createdAt', 'region'] };
      assert.deepEqual(getClusteringKeys(entity), ['createdAt', 'region']);
    });

    it('returns undefined when empty array', () => {
      assert.strictEqual(getClusteringKeys({ '@Snowflake.clustering': [] }), undefined);
    });

    it('returns undefined when annotation absent', () => {
      assert.strictEqual(getClusteringKeys({}), undefined);
    });
  });

  describe('getDataRetentionDays', () => {
    it('returns the numeric value', () => {
      assert.strictEqual(getDataRetentionDays({ '@Snowflake.dataRetentionDays': 7 }), 7);
    });

    it('returns 0 for explicit 0', () => {
      assert.strictEqual(getDataRetentionDays({ '@Snowflake.dataRetentionDays': 0 }), 0);
    });

    it('returns undefined when absent or non-number', () => {
      assert.strictEqual(getDataRetentionDays({}), undefined);
      assert.strictEqual(getDataRetentionDays({ '@Snowflake.dataRetentionDays': 'seven' }), undefined);
    });
  });

  describe('isSearchOptimized', () => {
    it('returns true when annotation is true', () => {
      assert.strictEqual(isSearchOptimized({ '@Snowflake.searchOptimized': true }), true);
    });

    it('returns false when false or absent', () => {
      assert.strictEqual(isSearchOptimized({ '@Snowflake.searchOptimized': false }), false);
      assert.strictEqual(isSearchOptimized({}), false);
    });
  });

  describe('getMaskingPolicy', () => {
    it('returns policy name string', () => {
      assert.strictEqual(getMaskingPolicy({ '@Snowflake.maskingPolicy': 'MY_SCHEMA.PII_MASK' }), 'MY_SCHEMA.PII_MASK');
    });

    it('returns undefined for empty string or absent', () => {
      assert.strictEqual(getMaskingPolicy({ '@Snowflake.maskingPolicy': '' }), undefined);
      assert.strictEqual(getMaskingPolicy({}), undefined);
    });
  });

  describe('getRowAccessPolicy', () => {
    it('returns policy and on array', () => {
      const entity = { '@Snowflake.rowAccessPolicy': { policy: 'MY_SCHEMA.ROW_POLICY', on: ['TENANT_ID'] } };
      assert.deepEqual(getRowAccessPolicy(entity), { policy: 'MY_SCHEMA.ROW_POLICY', on: ['TENANT_ID'] });
    });

    it('defaults on to empty array when not set', () => {
      const entity = { '@Snowflake.rowAccessPolicy': { policy: 'MY_SCHEMA.ROW_POLICY' } };
      const cfg = getRowAccessPolicy(entity);
      assert.deepEqual(cfg, { policy: 'MY_SCHEMA.ROW_POLICY', on: [] });
    });

    it('returns undefined when policy is absent', () => {
      assert.strictEqual(getRowAccessPolicy({ '@Snowflake.rowAccessPolicy': {} }), undefined);
      assert.strictEqual(getRowAccessPolicy({}), undefined);
    });
  });

  describe('getTags', () => {
    it('returns array of tag entries', () => {
      const obj = { '@Snowflake.tags': [{ key: 'team', value: 'data-eng' }] };
      assert.deepEqual(getTags(obj), [{ key: 'team', value: 'data-eng' }]);
    });

    it('filters entries without key', () => {
      const obj = { '@Snowflake.tags': [{ value: 'no-key' }, { key: 'good', value: 'yes' }] };
      const tags = getTags(obj);
      assert.strictEqual(tags?.length, 1);
      assert.strictEqual(tags?.[0].key, 'good');
    });

    it('returns undefined for empty or absent', () => {
      assert.strictEqual(getTags({ '@Snowflake.tags': [] }), undefined);
      assert.strictEqual(getTags({}), undefined);
    });
  });

  describe('isVariantColumn', () => {
    it('returns true when annotation is true', () => {
      assert.strictEqual(isVariantColumn({ '@Snowflake.variant': true }), true);
    });

    it('returns false otherwise', () => {
      assert.strictEqual(isVariantColumn({ '@Snowflake.variant': false }), false);
      assert.strictEqual(isVariantColumn({}), false);
    });
  });

  describe('getExternalTableConfig', () => {
    it('returns stage, fileFormat, and optional pattern', () => {
      const entity = {
        '@Snowflake.external': { stage: 'MY_STAGE', fileFormat: 'MY_FORMAT', pattern: '.*\\.csv' }
      };
      assert.deepEqual(getExternalTableConfig(entity), {
        stage: 'MY_STAGE',
        fileFormat: 'MY_FORMAT',
        pattern: '.*\\.csv',
      });
    });

    it('returns undefined pattern when not set', () => {
      const entity = { '@Snowflake.external': { stage: 'S', fileFormat: 'F' } };
      const cfg = getExternalTableConfig(entity);
      assert.strictEqual(cfg?.pattern, undefined);
    });

    it('returns undefined when stage or fileFormat missing', () => {
      assert.strictEqual(getExternalTableConfig({ '@Snowflake.external': { stage: 'S' } }), undefined);
      assert.strictEqual(getExternalTableConfig({}), undefined);
    });
  });
});

// ─── 2. VECTOR type mapping ───────────────────────────────────────────────────
import { mapCDSType } from '../../src/ddl/types.js';

describe('mapCDSType: VECTOR', () => {
  it('maps vector type with dimensions', () => {
    assert.strictEqual(mapCDSType('vector', undefined, undefined, undefined, { dimensions: 1536 }), 'VECTOR(FLOAT, 1536)');
  });

  it('defaults dimensions to 1536 when vectorConfig omitted', () => {
    assert.strictEqual(mapCDSType('vector'), 'VECTOR(FLOAT, 1536)');
  });

  it('uses custom dimensions', () => {
    assert.strictEqual(mapCDSType('vector', undefined, undefined, undefined, { dimensions: 768 }), 'VECTOR(FLOAT, 768)');
  });

  it('does not affect other types', () => {
    assert.strictEqual(mapCDSType('cds.String', 100), 'VARCHAR(100)');
    assert.strictEqual(mapCDSType('cds.Integer'), 'NUMBER(38,0)');
  });
});

// ─── 3. buildSnowflakeAnnotationStatements ────────────────────────────────────
import { buildSnowflakeAnnotationStatements, generateExternalTable } from '../../src/ddl/deploy.js';

const mockCreds = { account: 'acct', database: 'DB', schema: 'SCH', warehouse: 'WH', auth: 'password' as const };

describe('buildSnowflakeAnnotationStatements', () => {
  it('generates CLUSTER BY statement', () => {
    const entity = { '@Snowflake.clustering': ['createdAt', 'region'], elements: {} };
    const stmts = buildSnowflakeAnnotationStatements('MY_TABLE', entity, mockCreds);
    assert.ok(stmts.some(s => s.includes('CLUSTER BY')), 'Expected CLUSTER BY');
    assert.ok(stmts.some(s => s.includes('CREATEDAT')), 'Expected CREATEDAT column');
  });

  it('generates DATA_RETENTION_TIME_IN_DAYS statement', () => {
    const entity = { '@Snowflake.dataRetentionDays': 30, elements: {} };
    const stmts = buildSnowflakeAnnotationStatements('MY_TABLE', entity, mockCreds);
    assert.ok(stmts.some(s => s.includes('DATA_RETENTION_TIME_IN_DAYS = 30')));
  });

  it('generates ADD SEARCH OPTIMIZATION statement', () => {
    const entity = { '@Snowflake.searchOptimized': true, elements: {} };
    const stmts = buildSnowflakeAnnotationStatements('MY_TABLE', entity, mockCreds);
    assert.ok(stmts.some(s => s.includes('ADD SEARCH OPTIMIZATION')));
  });

  it('generates SET TAG statements', () => {
    const entity = { '@Snowflake.tags': [{ key: 'team', value: 'data-eng' }], elements: {} };
    const stmts = buildSnowflakeAnnotationStatements('MY_TABLE', entity, mockCreds);
    assert.ok(stmts.some(s => s.includes("SET TAG team = 'data-eng'")));
  });

  it('generates ADD ROW ACCESS POLICY statement', () => {
    const entity = {
      '@Snowflake.rowAccessPolicy': { policy: 'MY_SCHEMA.ROW_POLICY', on: ['TENANT_ID'] },
      elements: {}
    };
    const stmts = buildSnowflakeAnnotationStatements('MY_TABLE', entity, mockCreds);
    assert.ok(stmts.some(s => s.includes('ADD ROW ACCESS POLICY MY_SCHEMA.ROW_POLICY')));
  });

  it('generates per-column MASKING POLICY statement', () => {
    const entity = {
      elements: {
        email: { '@Snowflake.maskingPolicy': 'MY_SCHEMA.EMAIL_MASK' }
      }
    };
    const stmts = buildSnowflakeAnnotationStatements('MY_TABLE', entity, mockCreds);
    assert.ok(stmts.some(s => s.includes('SET MASKING POLICY MY_SCHEMA.EMAIL_MASK')));
  });

  it('generates per-column TAG statement', () => {
    const entity = {
      elements: {
        ssn: { '@Snowflake.tags': [{ key: 'pii', value: 'true' }] }
      }
    };
    const stmts = buildSnowflakeAnnotationStatements('MY_TABLE', entity, mockCreds);
    assert.ok(stmts.some(s => s.includes("SET TAG pii = 'true'")));
  });

  it('returns empty array for entity with no @Snowflake annotations', () => {
    const entity = { elements: { name: { type: 'cds.String' } } };
    const stmts = buildSnowflakeAnnotationStatements('MY_TABLE', entity, mockCreds);
    assert.strictEqual(stmts.length, 0);
  });
});

describe('generateExternalTable', () => {
  it('generates CREATE EXTERNAL TABLE with stage, format, and pattern', () => {
    const sql = generateExternalTable('EXT_TABLE', 'MY_STAGE', 'MY_FORMAT', '.*\\.csv', mockCreds);
    assert.ok(sql.includes('CREATE EXTERNAL TABLE IF NOT EXISTS'));
    assert.ok(sql.includes('@MY_STAGE'));
    assert.ok(sql.includes("FORMAT_NAME = 'MY_FORMAT'"));
    assert.ok(sql.includes("PATTERN = '.*\\.csv'"));
  });

  it('generates CREATE EXTERNAL TABLE without pattern', () => {
    const sql = generateExternalTable('EXT_TABLE', 'MY_STAGE', 'MY_FORMAT', undefined, mockCreds);
    assert.ok(!sql.includes('PATTERN'));
  });
});

// ─── 4. Time Travel ───────────────────────────────────────────────────────────
import { parseTimeTravelHeader, injectTimeTravelClause } from '../../src/features/time-travel.js';

describe('parseTimeTravelHeader', () => {
  it('parses sap-snowflake-at header (lowercase)', () => {
    const result = parseTimeTravelHeader({ 'sap-snowflake-at': '2024-01-15T10:30:00Z' });
    assert.strictEqual(result, '2024-01-15T10:30:00Z');
  });

  it('is case-insensitive for header name', () => {
    const result = parseTimeTravelHeader({ 'SAP-SNOWFLAKE-AT': '2024-01-15T10:30:00Z' });
    assert.strictEqual(result, '2024-01-15T10:30:00Z');
  });

  it('trims whitespace from header value', () => {
    const result = parseTimeTravelHeader({ 'sap-snowflake-at': '  2024-01-15T10:30:00Z  ' });
    assert.strictEqual(result, '2024-01-15T10:30:00Z');
  });

  it('returns undefined when header absent', () => {
    assert.strictEqual(parseTimeTravelHeader({}), undefined);
  });

  it('returns undefined for empty header value', () => {
    assert.strictEqual(parseTimeTravelHeader({ 'sap-snowflake-at': '' }), undefined);
    assert.strictEqual(parseTimeTravelHeader({ 'sap-snowflake-at': '   ' }), undefined);
  });
});

describe('injectTimeTravelClause', () => {
  it('injects AT clause after first table ref in FROM', () => {
    const sql = 'SELECT * FROM "DB"."SCH"."BOOKS" WHERE ID = ?';
    const result = injectTimeTravelClause(sql, '2024-01-15T10:30:00Z');
    assert.ok(result.includes(`AT (TIMESTAMP => '2024-01-15T10:30:00Z'::TIMESTAMP_TZ)`));
    assert.ok(result.indexOf('AT') > result.indexOf('FROM'));
  });

  it('injects AT clause before WHERE', () => {
    const sql = 'SELECT * FROM BOOKS WHERE ID = ?';
    const result = injectTimeTravelClause(sql, '2024-01-15T10:30:00Z');
    assert.ok(result.indexOf('AT') < result.indexOf('WHERE'));
  });

  it('returns original SQL unchanged when no FROM clause found', () => {
    const sql = 'SHOW TABLES';
    const result = injectTimeTravelClause(sql, '2024-01-15T10:30:00Z');
    assert.strictEqual(result, sql);
  });

  it('escapes single quotes in the timestamp', () => {
    const sql = 'SELECT * FROM BOOKS';
    const result = injectTimeTravelClause(sql, "2024-01-15T10:30:00'Z");
    assert.ok(result.includes("''Z"));
  });

  it('round-trips: parse header and inject clause', () => {
    const headers = { 'sap-snowflake-at': '2024-06-01T00:00:00Z' };
    const at = parseTimeTravelHeader(headers)!;
    const sql = 'SELECT * FROM MY_TABLE';
    const result = injectTimeTravelClause(sql, at);
    assert.ok(result.includes("AT (TIMESTAMP => '2024-06-01T00:00:00Z'::TIMESTAMP_TZ)"));
  });
});

// ─── 5. VARIANT colon-path filter syntax ─────────────────────────────────────
import { translateFilter } from '../../src/cqn/filters.js';

describe('translateFilter: VARIANT colon-path syntax', () => {
  const context = {
    target: {
      elements: {
        payload: { '@Snowflake.variant': true },
        name: { type: 'cds.String' },
      }
    }
  };

  it('translates payload/nested/key ref to PAYLOAD:nested:key::VARCHAR', () => {
    const xpr = [
      { ref: ['payload', 'nested', 'key'] },
      '=',
      { val: 'test-value' }
    ];
    const params: any[] = [];
    const sql = translateFilter(xpr, params, undefined, false, context);
    assert.ok(sql.includes('PAYLOAD:nested:key::VARCHAR'), `Expected VARIANT path, got: ${sql}`);
  });

  it('translates two-level VARIANT path', () => {
    const xpr = [
      { ref: ['payload', 'status'] },
      '=',
      { val: 'active' }
    ];
    const params: any[] = [];
    const sql = translateFilter(xpr, params, undefined, false, context);
    assert.ok(sql.includes('PAYLOAD:status::VARCHAR'), `Expected VARIANT path, got: ${sql}`);
  });

  it('does NOT apply VARIANT path to non-variant columns', () => {
    const xpr = [
      { ref: ['name'] },
      '=',
      { val: 'test' }
    ];
    const params: any[] = [];
    const sql = translateFilter(xpr, params, undefined, false, context);
    assert.ok(!sql.includes('::VARCHAR'), `Should not inject VARIANT syntax, got: ${sql}`);
    assert.ok(sql.includes('NAME'), `Expected NAME column, got: ${sql}`);
  });

  it('does NOT apply VARIANT path when context has no target', () => {
    const xpr = [
      { ref: ['payload', 'key'] },
      '=',
      { val: 'x' }
    ];
    const params: any[] = [];
    // No sqlContext with target — falls back to table.column format
    const sql = translateFilter(xpr, params);
    assert.ok(!sql.includes('::VARCHAR'), `Should not inject VARIANT syntax without context, got: ${sql}`);
  });
});
