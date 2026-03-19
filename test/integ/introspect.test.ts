/**
 * Integration tests for SnowflakeSchemaIntrospector.
 *
 * Runs against a real Snowflake instance when .cdsrc-private.json is present
 * or when SNOWFLAKE_TEST=true.
 *
 * These tests validate the SQL queries against INFORMATION_SCHEMA — the parts
 * of the introspection layer that cannot be verified with unit tests alone.
 */

import { expect } from 'chai';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SnowflakeSchemaIntrospector, generateCDSModel } from '../../src/introspect/schema.js';
import { mapSnowflakeTypeToCDS } from '../../src/ddl/types.js';

// ---------------------------------------------------------------------------
// Credential loading (identical pattern to other integ tests)
// ---------------------------------------------------------------------------
const ROOT = process.cwd();
const PRIVATE_CONFIG_PATHS = [
  join(ROOT, '.cdsrc-private.json'),
  join(ROOT, 'test/e2e/fixtures/.cdsrc-private.json'),
];

const privateConfigPath = PRIVATE_CONFIG_PATHS.find(p => existsSync(p));
const RUN = process.env.SNOWFLAKE_TEST === 'true' || Boolean(privateConfigPath);

function loadCredentials(): any {
  if (process.env.SNOWFLAKE_ACCOUNT) {
    return {
      account: process.env.SNOWFLAKE_ACCOUNT,
      user: process.env.SNOWFLAKE_USER,
      database: process.env.SNOWFLAKE_DATABASE,
      schema: process.env.SNOWFLAKE_SCHEMA,
      warehouse: process.env.SNOWFLAKE_WAREHOUSE,
      role: process.env.SNOWFLAKE_ROLE,
      auth: process.env.SNOWFLAKE_AUTH || 'jwt',
      jwt: { privateKey: process.env.SNOWFLAKE_PRIVATE_KEY },
    };
  }
  if (privateConfigPath) {
    const raw = JSON.parse(readFileSync(privateConfigPath, 'utf8'));
    return raw?.cds?.requires?.db?.credentials;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------
const INTEG_SCHEMA = 'APP';
// Temp tables created by this test (cleaned up in after())
const VECTOR_TABLE = 'INTEG_INTROSPECT_VECTOR_TEST';
const NUMBER_TABLE = 'INTEG_INTROSPECT_NUMBER_TEST';

(RUN ? describe : describe.skip)('SnowflakeSchemaIntrospector Integration', function () {
  this.timeout(120_000);

  let introspector: SnowflakeSchemaIntrospector;
  let credentials: any;

  // Helper: run raw SQL via the SDK-path introspector's private execute.
  // We create a second introspector purely for table setup/teardown so the
  // primary introspector under test is not touched.
  let setupIntrospector: SnowflakeSchemaIntrospector;

  async function runSQL(sql: string): Promise<void> {
    // We piggyback on the existing integ test tables via a separate introspector.
    // Since SnowflakeSchemaIntrospector.execute is private, we use introspectSchema
    // on a known schema — but for DDL we need a direct path.
    // Use the SDK client directly via the introspector's connect/execute cycle.
    // Workaround: instantiate a fresh introspector and introspect a dummy schema
    // to trigger the connection, then piggyback — instead we expose setup via
    // the existing integration test helper pattern by using cds.test or the
    // SnowflakeSDKClient directly.
    //
    // For simplicity, reuse the setupIntrospector by accessing its private execute
    // through a cast (test-only code — acceptable).
    await (setupIntrospector as any).execute(sql);
  }

  before(async () => {
    credentials = loadCredentials();
    if (!credentials) throw new Error('No Snowflake credentials found');

    introspector = new SnowflakeSchemaIntrospector(credentials);
    await introspector.connect();

    setupIntrospector = new SnowflakeSchemaIntrospector(credentials);
    await setupIntrospector.connect();

    // Create a table with a VECTOR column for round-trip testing
    await runSQL(`
      CREATE OR REPLACE TABLE ${credentials.database}.${INTEG_SCHEMA}.${VECTOR_TABLE} (
        ID        VARCHAR(36)         NOT NULL,
        LABEL     VARCHAR(200),
        EMBEDDING VECTOR(FLOAT, 1536),
        PRIMARY KEY (ID)
      )
    `);

    // Create a table with various NUMBER variants for type-mapping testing
    await runSQL(`
      CREATE OR REPLACE TABLE ${credentials.database}.${INTEG_SCHEMA}.${NUMBER_TABLE} (
        ID            VARCHAR(36)  NOT NULL,
        BARE_NUM      NUMBER,
        INT_PRECISION NUMBER(10),
        LARGE_INT     NUMBER(38),
        DECIMAL_COL   NUMBER(15,2),
        PRIMARY KEY (ID)
      )
    `);
  });

  after(async () => {
    try {
      await runSQL(`DROP TABLE IF EXISTS ${credentials.database}.${INTEG_SCHEMA}.${VECTOR_TABLE}`);
      await runSQL(`DROP TABLE IF EXISTS ${credentials.database}.${INTEG_SCHEMA}.${NUMBER_TABLE}`);
    } finally {
      await introspector.disconnect();
      await setupIntrospector.disconnect();
    }
  });

  // -------------------------------------------------------------------------
  // 1. Schema uppercase normalisation
  // -------------------------------------------------------------------------
  it('accepts lowercase schema name and returns results', async () => {
    const result = await introspector.introspectSchema(INTEG_SCHEMA.toLowerCase());
    expect(result.tables.size).to.be.greaterThan(0,
      'Lowercase schema name must be normalised to UPPERCASE before querying INFORMATION_SCHEMA');
  });

  it('accepts UPPERCASE schema name', async () => {
    const result = await introspector.introspectSchema(INTEG_SCHEMA);
    expect(result.tables.size).to.be.greaterThan(0);
  });

  // -------------------------------------------------------------------------
  // 2. Batch query efficiency — single introspectSchema() call
  // -------------------------------------------------------------------------
  it('returns consistent results between two calls to introspectSchema()', async () => {
    const first = await introspector.introspectSchema(INTEG_SCHEMA);
    const second = await introspector.introspectSchema(INTEG_SCHEMA);
    expect(first.tables.size).to.equal(second.tables.size);
  });

  // -------------------------------------------------------------------------
  // 3. Primary key detection
  // -------------------------------------------------------------------------
  it('detects primary keys on test tables', async () => {
    const result = await introspector.introspectSchema(INTEG_SCHEMA);
    const vectorTable = result.tables.get(VECTOR_TABLE);
    expect(vectorTable, `${VECTOR_TABLE} not found in schema`).to.exist;
    expect(vectorTable!.primaryKeys).to.include('ID');
    const idCol = vectorTable!.columns.find(c => c.columnName === 'ID');
    expect(idCol?.isPrimaryKey).to.equal(true);
  });

  it('marks non-key columns as not primary key', async () => {
    const result = await introspector.introspectSchema(INTEG_SCHEMA);
    const vectorTable = result.tables.get(VECTOR_TABLE);
    const labelCol = vectorTable!.columns.find(c => c.columnName === 'LABEL');
    expect(labelCol?.isPrimaryKey).to.equal(false);
  });

  // -------------------------------------------------------------------------
  // 4. NUMBER type variants
  // -------------------------------------------------------------------------
  it('maps NUMBER variants to correct CDS types', async () => {
    const result = await introspector.introspectSchema(INTEG_SCHEMA);
    const numTable = result.tables.get(NUMBER_TABLE);
    expect(numTable, `${NUMBER_TABLE} not found`).to.exist;

    const colMap = new Map(numTable!.columns.map(c => [c.columnName, c]));

    // NUMBER bare — INTEGER semantics
    const bareNum = colMap.get('BARE_NUM');
    expect(bareNum, 'BARE_NUM column not found').to.exist;
    expect(mapSnowflakeTypeToCDS(bareNum!.dataType)).to.equal('cds.Integer');

    // NUMBER(15,2) — DECIMAL
    const decimalCol = colMap.get('DECIMAL_COL');
    expect(decimalCol, 'DECIMAL_COL not found').to.exist;
    expect(mapSnowflakeTypeToCDS(decimalCol!.dataType)).to.equal('cds.Decimal');
  });

  // -------------------------------------------------------------------------
  // 5. VECTOR column round-trip
  // -------------------------------------------------------------------------
  it('detects VECTOR columns and maps to cds.Vector(N)', async () => {
    const result = await introspector.introspectSchema(INTEG_SCHEMA);
    const vectorTable = result.tables.get(VECTOR_TABLE);
    const embeddingCol = vectorTable!.columns.find(c => c.columnName === 'EMBEDDING');
    expect(embeddingCol, 'EMBEDDING column not found').to.exist;
    const cdsType = mapSnowflakeTypeToCDS(embeddingCol!.dataType);
    expect(cdsType).to.equal('cds.Vector(1536)');
  });

  // -------------------------------------------------------------------------
  // 6. generateCDSModel produces valid output with @cds.persistence.name
  // -------------------------------------------------------------------------
  it('generateCDSModel emits @cds.persistence.name for each entity', async () => {
    const result = await introspector.introspectSchema(INTEG_SCHEMA);
    const cdsModel = generateCDSModel(result, 'imported');

    expect(cdsModel).to.include('namespace imported;');
    expect(cdsModel).to.include(`@cds.persistence.name: '${VECTOR_TABLE}'`);
    expect(cdsModel).to.include(`@cds.persistence.name: '${NUMBER_TABLE}'`);
    // Entity names should be PascalCase
    expect(cdsModel).to.include(`entity ${toPascalCase(VECTOR_TABLE)} {`);
  });

  // -------------------------------------------------------------------------
  // 7. VECTOR column appears in generated CDS with dimension
  // -------------------------------------------------------------------------
  it('generateCDSModel outputs Vector(1536) for VECTOR columns', async () => {
    const result = await introspector.introspectSchema(INTEG_SCHEMA);
    const cdsModel = generateCDSModel(result, 'imported');
    expect(cdsModel).to.include('embedding : Vector(1536)');
  });

  // -------------------------------------------------------------------------
  // 8. View handling — @readonly annotation
  // -------------------------------------------------------------------------
  it('annotates VIEW type entities with @readonly', async () => {
    const result = await introspector.introspectSchema(INTEG_SCHEMA);
    const viewEntry = [...result.tables.entries()].find(([, meta]) => meta.info.tableType === 'VIEW');
    if (!viewEntry) {
      // No views in schema — skip this assertion gracefully
      return;
    }
    const cdsModel = generateCDSModel(result, 'imported');
    expect(cdsModel).to.include('@readonly');
  });

  // -------------------------------------------------------------------------
  // 9. Non-existent schema returns empty result gracefully
  // -------------------------------------------------------------------------
  it('returns empty table map for a non-existent schema', async () => {
    const result = await introspector.introspectSchema('NONEXISTENT_SCHEMA_XYZ_99');
    expect(result.tables.size).to.equal(0);
  });

  // -------------------------------------------------------------------------
  // 10. Column ordering preserved
  // -------------------------------------------------------------------------
  it('preserves ORDINAL_POSITION column order', async () => {
    const result = await introspector.introspectSchema(INTEG_SCHEMA);
    const vectorTable = result.tables.get(VECTOR_TABLE);
    const cols = vectorTable!.columns.map(c => c.columnName);
    // ID is defined first in the CREATE TABLE
    expect(cols[0]).to.equal('ID');
  });
});

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------
function toPascalCase(str: string): string {
  return str
    .toLowerCase()
    .split('_')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join('');
}
