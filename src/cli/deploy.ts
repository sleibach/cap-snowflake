#!/usr/bin/env node
/**
 * CLI tool to deploy CDS model to Snowflake
 *
 * Usage (from your CAP project root):
 *   npx cap-snowflake-deploy
 *   npx cap-snowflake-deploy --dry
 */

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import cds from '@sap/cds';
import { buildDeployStatements, generateMigrationStatements } from '../ddl/deploy.js';
import { SnowflakeSQLAPIClient } from '../client/sqlapi.js';
import { SnowflakeSDKClient } from '../client/sdk.js';
import { logInfo, logError } from '../utils/logger.js';
import { SnowflakeCredentials } from '../config.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function loadCredentials(projectRoot: string): SnowflakeCredentials | null {
  const paths = [
    join(projectRoot, '.cdsrc-private.json'),
    join(projectRoot, 'default-env.json'),
  ];

  for (const p of paths) {
    if (existsSync(p)) {
      const raw = JSON.parse(readFileSync(p, 'utf8'));
      const creds = raw?.cds?.requires?.db?.credentials
        ?? raw?.VCAP_SERVICES?.snowflake?.[0]?.credentials;
      if (creds) {
        logInfo(`Loaded credentials from ${p}`);
        return creds as SnowflakeCredentials;
      }
    }
  }

  // Fall back to cds.env
  const creds = (cds.env as any).requires?.db?.credentials;
  if (creds) return creds as SnowflakeCredentials;

  return null;
}

function resolveEnvRefs(obj: any): any {
  if (Array.isArray(obj)) return obj.map(resolveEnvRefs);
  if (obj && typeof obj === 'object') {
    const out: any = {};
    for (const [k, v] of Object.entries(obj)) out[k] = resolveEnvRefs(v);
    return out;
  }
  if (typeof obj === 'string' && obj.startsWith('env:')) {
    return process.env[obj.slice(4)] ?? obj;
  }
  return obj;
}

async function executeStatements(
  credentials: SnowflakeCredentials,
  statements: string[],
  opts: { dry: boolean; continueOnError: boolean }
) {
  if (opts.dry) {
    console.log('\n--- DDL Statements (dry run) ---\n');
    statements.forEach(s => console.log(s + ';\n'));
    return { ok: 0, skipped: 0, failed: 0 };
  }

  let ok = 0, skipped = 0, failed = 0;

  const isSQLAPI = credentials.auth === 'jwt';
  const sqlapi = isSQLAPI ? new SnowflakeSQLAPIClient(credentials) : null;
  const sdk    = !isSQLAPI ? new SnowflakeSDKClient(credentials) : null;
  if (sdk) await sdk.connect();

  for (const stmt of statements) {
    const label = stmt.split('\n')[0].slice(0, 80);
    try {
      if (sqlapi) {
        await sqlapi.execute(stmt);
      } else {
        await sdk!.execute(stmt);
      }
      console.log(`  ✓  ${label}`);
      ok++;
    } catch (err: any) {
      const sqlState: string = err?.response?.data?.sqlState ?? err?.sqlState ?? '';
      const msg: string = err?.response?.data?.message ?? err?.message ?? '';
      // '42S01' = object already exists; treat as skip
      if (sqlState === '42S01' || msg.toLowerCase().includes('already exists')) {
        console.log(`  –  ${label} (already exists, skipped)`);
        skipped++;
      } else if (opts.continueOnError) {
        console.error(`  ✗  ${label}\n     ${msg}`);
        failed++;
      } else {
        throw err;
      }
    }
  }

  return { ok, skipped, failed };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2);
  const dry           = args.includes('--dry') || args.includes('--dry-run');
  const migrate       = args.includes('--migrate');
  const continueOnErr = args.includes('--continue-on-error');
  const projectRoot   = args.find(a => a.startsWith('--project='))?.slice(10) ?? process.cwd();

  if (args.includes('--help') || args.includes('-h')) {
    printHelp();
    process.exit(0);
  }

  console.log('cap-snowflake deploy\n====================\n');

  // -- Credentials --
  const rawCreds = loadCredentials(projectRoot);
  if (!rawCreds) {
    console.error('No Snowflake credentials found.\n');
    console.error('Create .cdsrc-private.json in the project root with:');
    console.error('  { "cds": { "requires": { "db": { "credentials": { ... } } } } }');
    process.exit(1);
  }
  const credentials = resolveEnvRefs(rawCreds) as SnowflakeCredentials;
  if (!credentials.host) {
    credentials.host = `${credentials.account}.snowflakecomputing.com`;
  }

  // -- Model --
  logInfo('Loading CDS model from ' + projectRoot);
  cds.root = projectRoot;
  const model = await cds.load('*', { root: projectRoot } as any).catch(async () => {
    // Try srv/ and db/ explicitly
    return cds.load([
      join(projectRoot, 'srv'),
      join(projectRoot, 'db'),
    ]);
  });

  // -- DDL --
  logInfo('Generating CREATE TABLE / VIEW statements…');
  const statements = buildDeployStatements(model, credentials, { createViews: true });

  if (statements.length === 0) {
    console.log('No entities to deploy (model is empty or all skipped).');
    process.exit(0);
  }

  console.log(`\nFound ${statements.length} DDL statement(s):`);
  statements.forEach((s, i) => {
    console.log(`  ${i + 1}. ${s.split('\n')[0].slice(0, 80)}`);
  });
  console.log('');

  // -- Execute / dry-run --
  const { ok, skipped, failed } = await executeStatements(credentials, statements, {
    dry,
    continueOnError: continueOnErr,
  });

  if (!dry) {
    console.log(`\nResult: ${ok} created, ${skipped} already existed, ${failed} failed.\n`);

    // -- Migration (optional) --
    if (migrate && failed === 0) {
      logInfo('Running migration scan (ALTER TABLE ADD COLUMN IF NOT EXISTS)…');
      // Query existing columns from INFORMATION_SCHEMA
      const isSQLAPI = credentials.auth === 'jwt';
      const client = isSQLAPI ? new SnowflakeSQLAPIClient(credentials) : new SnowflakeSDKClient(credentials);
      if (client instanceof SnowflakeSDKClient) await client.connect();

      const db = credentials.database ?? '';
      const schema = credentials.schema ?? '';
      const rows = await client.execute(
        `SELECT TABLE_NAME, COLUMN_NAME
         FROM ${db}.INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_SCHEMA = '${schema.toUpperCase()}'`
      );
      const existingCols = new Map<string, Set<string>>();
      for (const row of (rows as unknown) as any[]) {
        const tbl = (row.TABLE_NAME ?? row.table_name ?? '').toUpperCase();
        const col = (row.COLUMN_NAME ?? row.column_name ?? '').toUpperCase();
        if (!existingCols.has(tbl)) existingCols.set(tbl, new Set());
        existingCols.get(tbl)!.add(col);
      }

      const migStmts = generateMigrationStatements(model, existingCols, credentials);
      if (migStmts.length === 0) {
        console.log('No new columns to add.');
      } else {
        console.log(`\nFound ${migStmts.length} migration statement(s):`);
        const mResult = await executeStatements(credentials, migStmts, { dry, continueOnError: true });
        console.log(`Migration: ${mResult.ok} added, ${mResult.skipped} skipped, ${mResult.failed} failed.`);
      }
    }
  }

  if (failed > 0) process.exit(1);
}

function printHelp() {
  console.log(`
cap-snowflake deploy – Deploy CDS model to Snowflake

Usage (run from your CAP project root):
  npx cap-snowflake-deploy [options]

Options:
  --dry, --dry-run      Print DDL without executing
  --migrate             After create, also add new columns (ALTER TABLE ADD COLUMN)
  --continue-on-error   Log errors but continue with remaining statements
  --project=PATH        Path to CAP project root (default: cwd)
  -h, --help            Show this help

Credentials are read from (in order):
  1. <project>/.cdsrc-private.json → cds.requires.db.credentials
  2. <project>/default-env.json    → VCAP_SERVICES.snowflake[0].credentials
  3. cds.env.requires.db.credentials (package.json / env vars)

Draft tables (@odata.draft.enabled) are included automatically.
`);
}

main().catch(err => {
  logError('Deployment failed', err);
  process.exit(1);
});
