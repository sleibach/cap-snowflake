/**
 * Integration test: CSV initial data loading (#57)
 *
 * Verifies that loadCsvData() correctly seeds and upserts rows from CSV files
 * found in db/data/ next to the fixture model sources.
 *
 * Requires live Snowflake credentials. Skipped in CI without them.
 */

import { expect } from 'chai';
import cds from '@sap/cds';
import { existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadCsvData } from '../../src/ddl/csv.js';
import { SnowflakeSQLAPIClient } from '../../src/client/sqlapi.js';
import { SnowflakeSDKClient } from '../../src/client/sdk.js';

const ROOT = process.cwd();
const FIXTURE_DIR = join(ROOT, 'test/e2e/fixtures');
const PRIVATE_CONFIG_PATHS = [
  join(ROOT, '.cdsrc-private.json'),
  join(FIXTURE_DIR, '.cdsrc-private.json'),
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
    return raw?.cds?.requires?.db?.credentials
        ?? raw?.requires?.db?.credentials;
  }
  return null;
}

// Known UUIDs from test/e2e/fixtures/db/data/cap_e2e-Authors.csv
const CSV_AUTHOR_1 = 'aaaaaaaa-0001-0000-0000-000000000000';
const CSV_AUTHOR_2 = 'aaaaaaaa-0002-0000-0000-000000000000';

(RUN ? describe : describe.skip)('CSV data loading integration (#57)', function () {
  this.timeout(60_000);

  let credentials: any;
  let client: SnowflakeSQLAPIClient | SnowflakeSDKClient;
  let model: any;
  /** Fully qualified AUTHORS table name */
  let authorsTable: string;

  before(async () => {
    credentials = loadCredentials();
    if (!credentials) throw new Error('No Snowflake credentials found');
    if (!credentials.host) credentials.host = `${credentials.account}.snowflakecomputing.com`;

    // Connect client
    const isSQLAPI = credentials.auth === 'jwt';
    client = isSQLAPI
      ? new SnowflakeSQLAPIClient(credentials)
      : new SnowflakeSDKClient(credentials);
    if (client instanceof SnowflakeSDKClient) await client.connect();

    // Load fixture model — $sources will point to test/e2e/fixtures so
    // cds.deploy.resources() finds db/data/*.csv there.
    model = await cds.load(join(FIXTURE_DIR, 'db/schema.cds'));

    // Build fully qualified table name from credentials
    const db = credentials.database?.toUpperCase() ?? '';
    const schema = credentials.schema?.toUpperCase() ?? '';
    authorsTable = [db, schema, 'CAP_E2E_AUTHORS'].filter(Boolean).join('.');

    // Ensure the AUTHORS table exists (it should from the main e2e suite deploy)
    // If not, create a minimal version for this test.
    await (client as any).execute(
      `CREATE TABLE IF NOT EXISTS ${authorsTable} (
        ID       VARCHAR(36),
        NAME     VARCHAR(100),
        COUNTRY  VARCHAR(2),
        CREATEDAT TIMESTAMP_TZ,
        CREATEDBY VARCHAR(255),
        MODIFIEDAT TIMESTAMP_TZ,
        MODIFIEDBY VARCHAR(255),
        PRIMARY KEY (ID)
      )`
    ).catch(() => {}); // may already exist

    // Cleanup CSV seed rows from any previous test run
    await (client as any).execute(
      `DELETE FROM ${authorsTable} WHERE ID IN (?, ?)`,
      [CSV_AUTHOR_1, CSV_AUTHOR_2]
    );
  });

  after(async () => {
    // Clean up CSV-seeded rows
    if (client && authorsTable) {
      await (client as any).execute(
        `DELETE FROM ${authorsTable} WHERE ID IN (?, ?)`,
        [CSV_AUTHOR_1, CSV_AUTHOR_2]
      ).catch(() => {});
    }
    if (client instanceof SnowflakeSDKClient) {
      await (client as any).disconnect?.().catch(() => {});
    }
  });

  // ---------------------------------------------------------------------------

  it('loads CSV rows from db/data/ on first deploy', async () => {
    const result = await loadCsvData(model, credentials, client);

    expect(result.loaded).to.be.gte(2); // at least our 2 CSV authors

    // Verify both rows exist in Snowflake
    const rows1 = await (client as any).execute(
      `SELECT ID, NAME, COUNTRY FROM ${authorsTable} WHERE ID = ?`,
      [CSV_AUTHOR_1]
    );
    const data1 = rows1?.data ?? rows1;
    expect(data1).to.have.length.gte(1);
    const row1: any = Array.isArray(data1[0]) ? { ID: data1[0][0], NAME: data1[0][1] } : data1[0];
    const name1 = row1.NAME ?? row1.name ?? row1[1];
    expect(name1).to.include('CSV Seed Author One');

    const rows2 = await (client as any).execute(
      `SELECT ID FROM ${authorsTable} WHERE ID = ?`,
      [CSV_AUTHOR_2]
    );
    const data2 = rows2?.data ?? rows2;
    expect(data2).to.have.length.gte(1);
  });

  it('is idempotent — re-running loadCsvData does not duplicate rows', async () => {
    // Run CSV load a second time
    await loadCsvData(model, credentials, client);

    // Count of CSV-seeded rows must remain exactly 2
    const result = await (client as any).execute(
      `SELECT COUNT(*) AS CNT FROM ${authorsTable} WHERE ID IN (?, ?)`,
      [CSV_AUTHOR_1, CSV_AUTHOR_2]
    );
    const raw = result?.data ?? result;
    const cnt = Array.isArray(raw[0])
      ? Number(raw[0][0])
      : Number(raw[0]?.CNT ?? raw[0]?.cnt ?? raw[0]?.['COUNT(*)'] ?? 0);
    expect(cnt).to.equal(2);
  });

  it('updates changed values on re-deploy (MERGE WHEN MATCHED)', async () => {
    // Manually change a row then re-run — CSV should restore original value
    await (client as any).execute(
      `UPDATE ${authorsTable} SET NAME = 'Manually Changed' WHERE ID = ?`,
      [CSV_AUTHOR_1]
    );

    await loadCsvData(model, credentials, client);

    const rows = await (client as any).execute(
      `SELECT NAME FROM ${authorsTable} WHERE ID = ?`,
      [CSV_AUTHOR_1]
    );
    const raw = rows?.data ?? rows;
    const name = Array.isArray(raw[0]) ? raw[0][0] : (raw[0]?.NAME ?? raw[0]?.name);
    expect(name).to.include('CSV Seed Author One');
  });
});
