/**
 * Integration tests for multitenancy support.
 *
 * Verifies that:
 *  - Queries with a tenant context are routed to the correct tenant schema
 *  - Data inserted by one tenant is not visible to another (schema isolation)
 *  - deploy() creates the tenant schema when called with a tenant context
 *  - disconnect(tenant) cleans up only that tenant's resources
 *  - A custom tenantSchemaPrefix is respected
 *
 * Runs against a real Snowflake instance when .cdsrc-private.json is present
 * or SNOWFLAKE_TEST=true.
 *
 * Tenant → Schema mapping under test:
 *   'mt-integ-t1' → TENANT_MT_INTEG_T1
 *   'mt-integ-t2' → TENANT_MT_INTEG_T2
 *   'mt-deploy-test' → TENANT_MT_DEPLOY_TEST
 */

import { expect } from 'chai';
import cds from '@sap/cds';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

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
      auth: process.env.SNOWFLAKE_AUTH ?? 'jwt',
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
(RUN ? describe : describe.skip)('Multitenancy Integration Tests', function () {
  this.timeout(90_000);

  // -------------------------------------------------------------------------
  // Constants
  // -------------------------------------------------------------------------
  const DB = 'CAP_E2E_DB';
  const TENANT_1 = 'mt-integ-t1';
  const TENANT_2 = 'mt-integ-t2';
  const SCHEMA_T1 = 'TENANT_MT_INTEG_T1';
  const SCHEMA_T2 = 'TENANT_MT_INTEG_T2';
  const SHARED_TABLE = 'MT_INTEG_BOOKS'; // unqualified — tests that routing works
  const T1_FQTABLE = `${DB}.${SCHEMA_T1}.${SHARED_TABLE}`;
  const T2_FQTABLE = `${DB}.${SCHEMA_T2}.${SHARED_TABLE}`;

  let db: any;

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  /** Sets cds.context.tenant so the adapter routes to the right schema. */
  function withTenant(tenant: string): void {
    (cds as any).context = { tenant, id: `mt-ctx-${Date.now()}` };
  }

  /** Clears tenant context (back to provider/default schema). */
  function clearTenant(): void {
    (cds as any).context = undefined;
  }

  // -------------------------------------------------------------------------
  // Suite setup — runs once before all tests
  // -------------------------------------------------------------------------
  before(async () => {
    await import('../../dist/index.js');

    const credentials = loadCredentials();
    if (!credentials) throw new Error('No Snowflake credentials found');

    // Use a dedicated service name so this suite does not interfere with the
    // 'db' service used by other integration tests running in the same process.
    (cds.env as any).requires['mt_test_db'] = {
      kind: 'snowflake',
      impl: join(ROOT, 'dist/index.js'),
      multiTenant: true,   // enables isMultitenant for this service instance
      credentials,
    };
    db = await cds.connect.to('mt_test_db');

    // Pre-create the two tenant schemas and the shared table within each.
    // The deploy() test below creates its own schema independently.
    for (const [schema, fqtable] of [
      [SCHEMA_T1, T1_FQTABLE],
      [SCHEMA_T2, T2_FQTABLE],
    ]) {
      await db.run(`CREATE SCHEMA IF NOT EXISTS ${DB}."${schema}"`);
      await db.run(`
        CREATE TABLE IF NOT EXISTS ${fqtable} (
          ID    VARCHAR(36) NOT NULL PRIMARY KEY,
          TITLE VARCHAR(200)
        )
      `);
      await db.run(`DELETE FROM ${fqtable}`);
    }
  });

  after(async () => {
    clearTenant();
    // Drop the tenant schemas created by these tests
    for (const schema of [SCHEMA_T1, SCHEMA_T2]) {
      await db.run(`DROP SCHEMA IF EXISTS ${DB}."${schema}" CASCADE`).catch(() => {});
    }
    if (db?.disconnect) await db.disconnect();
  });

  afterEach(() => clearTenant());

  // =========================================================================
  describe('Schema routing — SELECT', () => {
    before(async () => {
      // Seed one row per tenant using raw fully-qualified SQL so the routing
      // logic isn't needed here — the real test is the CQN SELECT below.
      await db.run(`INSERT INTO ${T1_FQTABLE} (ID, TITLE) VALUES ('t1-seed', 'T1 Book')`);
      await db.run(`INSERT INTO ${T2_FQTABLE} (ID, TITLE) VALUES ('t2-seed', 'T2 Book')`);
    });

    after(async () => {
      await db.run(`DELETE FROM ${T1_FQTABLE}`).catch(() => {});
      await db.run(`DELETE FROM ${T2_FQTABLE}`).catch(() => {});
    });

    it('CQN SELECT with T1 context returns only T1 rows', async () => {
      withTenant(TENANT_1);
      // SHARED_TABLE is unqualified — cqnToSQL qualifies it with SCHEMA_T1
      const rows = await db.run({ SELECT: { from: { ref: [SHARED_TABLE] } } });
      const ids = rows.map((r: any) => r.ID ?? r.id);
      expect(ids).to.include('t1-seed', 'expected t1 row to be present');
      expect(ids).not.to.include('t2-seed', 'expected t2 row to be absent');
    });

    it('CQN SELECT with T2 context returns only T2 rows', async () => {
      withTenant(TENANT_2);
      const rows = await db.run({ SELECT: { from: { ref: [SHARED_TABLE] } } });
      const ids = rows.map((r: any) => r.ID ?? r.id);
      expect(ids).to.include('t2-seed', 'expected t2 row to be present');
      expect(ids).not.to.include('t1-seed', 'expected t1 row to be absent');
    });

    it('no tenant context → query targets default provider schema (APP), not tenant schemas', async () => {
      clearTenant();
      // SHARED_TABLE does not exist in APP, so we expect an error or empty result
      // (not data from T1/T2). We treat an error as also proving isolation.
      let rows: any[];
      try {
        rows = await db.run({ SELECT: { from: { ref: [SHARED_TABLE] } } });
        // If the table happens not to exist in APP, Snowflake throws — that's fine.
        const ids = rows.map((r: any) => r.ID ?? r.id);
        expect(ids).not.to.include('t1-seed');
        expect(ids).not.to.include('t2-seed');
      } catch (err: any) {
        // "object does not exist" or similar confirms the table is not in APP
        expect(err.message ?? err).to.satisfy(
          (m: string) => /does not exist|not found|002003/i.test(String(m)),
          `unexpected error: ${err}`
        );
      }
    });
  });

  // =========================================================================
  describe('Schema routing — INSERT/UPDATE/DELETE', () => {
    after(async () => {
      await db.run(`DELETE FROM ${T1_FQTABLE}`).catch(() => {});
      await db.run(`DELETE FROM ${T2_FQTABLE}`).catch(() => {});
    });

    it('CQN INSERT with T1 context lands in T1 schema', async () => {
      withTenant(TENANT_1);
      await db.run({
        INSERT: {
          into: { ref: [SHARED_TABLE] },
          entries: [{ ID: 't1-insert', TITLE: 'T1 Insert' }],
        },
      });

      // Verify via raw fully-qualified SELECT
      const rows = await db.run(`SELECT * FROM ${T1_FQTABLE} WHERE ID = 't1-insert'`);
      expect(rows).to.have.lengthOf(1);

      // Must NOT appear in T2
      const t2rows = await db.run(`SELECT * FROM ${T2_FQTABLE} WHERE ID = 't1-insert'`);
      expect(t2rows).to.have.lengthOf(0);
    });

    it('CQN INSERT with T2 context lands in T2 schema', async () => {
      withTenant(TENANT_2);
      await db.run({
        INSERT: {
          into: { ref: [SHARED_TABLE] },
          entries: [{ ID: 't2-insert', TITLE: 'T2 Insert' }],
        },
      });

      const rows = await db.run(`SELECT * FROM ${T2_FQTABLE} WHERE ID = 't2-insert'`);
      expect(rows).to.have.lengthOf(1);

      const t1rows = await db.run(`SELECT * FROM ${T1_FQTABLE} WHERE ID = 't2-insert'`);
      expect(t1rows).to.have.lengthOf(0);
    });

    it('CQN UPDATE with T1 context updates only T1 row', async () => {
      // Seed: same ID in both schemas
      await db.run(`INSERT INTO ${T1_FQTABLE} (ID, TITLE) VALUES ('upd-shared', 'T1 Original')`);
      await db.run(`INSERT INTO ${T2_FQTABLE} (ID, TITLE) VALUES ('upd-shared', 'T2 Original')`);

      withTenant(TENANT_1);
      await db.run({
        UPDATE: {
          entity: { ref: [SHARED_TABLE] },
          data: { TITLE: 'T1 Updated' },
          where: [{ ref: ['ID'] }, '=', { val: 'upd-shared' }],
        },
      });

      const t1rows = await db.run(`SELECT TITLE FROM ${T1_FQTABLE} WHERE ID = 'upd-shared'`);
      expect(t1rows[0]?.TITLE ?? t1rows[0]?.title).to.equal('T1 Updated');

      // T2 row must be untouched
      const t2rows = await db.run(`SELECT TITLE FROM ${T2_FQTABLE} WHERE ID = 'upd-shared'`);
      expect(t2rows[0]?.TITLE ?? t2rows[0]?.title).to.equal('T2 Original');
    });

    it('CQN DELETE with T1 context removes only T1 row', async () => {
      await db.run(`INSERT INTO ${T1_FQTABLE} (ID, TITLE) VALUES ('del-shared', 'To Delete')`);
      await db.run(`INSERT INTO ${T2_FQTABLE} (ID, TITLE) VALUES ('del-shared', 'Should Stay')`);

      withTenant(TENANT_1);
      await db.run({
        DELETE: {
          from: { ref: [SHARED_TABLE] },
          where: [{ ref: ['ID'] }, '=', { val: 'del-shared' }],
        },
      });

      const t1rows = await db.run(`SELECT * FROM ${T1_FQTABLE} WHERE ID = 'del-shared'`);
      expect(t1rows).to.have.lengthOf(0);

      // T2 row must still exist
      const t2rows = await db.run(`SELECT * FROM ${T2_FQTABLE} WHERE ID = 'del-shared'`);
      expect(t2rows).to.have.lengthOf(1);
    });
  });

  // =========================================================================
  describe('deploy() with tenant context', () => {
    const DEPLOY_TENANT = 'mt-deploy-test';
    const DEPLOY_SCHEMA = 'TENANT_MT_DEPLOY_TEST';
    const DEPLOY_FQTABLE = `${DB}.${DEPLOY_SCHEMA}.MT_DEPLOY_BOOKS`;

    // Minimal CDS model to deploy
    const deployModel: any = {
      definitions: {
        MtDeployBooks: {
          kind: 'entity',
          '@cds.persistence.name': 'MT_DEPLOY_BOOKS',
          elements: {
            ID: { type: 'cds.UUID', key: true, '@Core.Computed': true },
            title: { type: 'cds.String', length: 200 },
          },
        },
      },
    };

    after(async () => {
      clearTenant();
      await db.run(`DROP SCHEMA IF EXISTS ${DB}."${DEPLOY_SCHEMA}" CASCADE`).catch(() => {});
    });

    it('deploy() creates the tenant schema if it does not exist', async () => {
      // Ensure schema does NOT exist before the test
      await db.run(`DROP SCHEMA IF EXISTS ${DB}."${DEPLOY_SCHEMA}" CASCADE`).catch(() => {});

      withTenant(DEPLOY_TENANT);
      await db.deploy(deployModel);
      clearTenant();

      // The schema and table should now exist; a SELECT is the simplest proof
      const rows = await db.run(`SELECT * FROM ${DEPLOY_FQTABLE}`);
      expect(rows).to.be.an('array');
    });

    it('deploy() is idempotent — calling it twice does not fail', async () => {
      withTenant(DEPLOY_TENANT);
      await db.deploy(deployModel); // second call — must not throw
      clearTenant();

      const rows = await db.run(`SELECT * FROM ${DEPLOY_FQTABLE}`);
      expect(rows).to.be.an('array');
    });

    it('data inserted after deploy is readable with correct tenant context', async () => {
      await db.run(`INSERT INTO ${DEPLOY_FQTABLE} (ID, TITLE) VALUES ('deploy-row-1', 'Deployed Book')`);

      withTenant(DEPLOY_TENANT);
      const rows = await db.run({ SELECT: { from: { ref: ['MT_DEPLOY_BOOKS'] } } });
      const ids = rows.map((r: any) => r.ID ?? r.id);
      expect(ids).to.include('deploy-row-1');
    });
  });

  // =========================================================================
  describe('disconnect(tenant)', () => {
    // Use an isolated service + dedicated schemas so dropping them does not
    // interfere with the SELECT/INSERT/UPDATE/DELETE tests above.
    const DROP_TENANT = 'mt-drop-t1';
    const DROP_SCHEMA = 'TENANT_MT_DROP_T1';
    const DROP_FQTABLE = `${DB}.${DROP_SCHEMA}.MT_DROP_BOOKS`;

    let dbDrop: any;

    before(async () => {
      const credentials = loadCredentials();
      (cds.env as any).requires['mt_drop_test'] = {
        kind: 'snowflake',
        impl: join(ROOT, 'dist/index.js'),
        multiTenant: true,
        credentials,
      };
      dbDrop = await cds.connect.to('mt_drop_test');

      // Create the tenant schema + table so disconnect has something to drop.
      await dbDrop.run(`CREATE SCHEMA IF NOT EXISTS ${DB}."${DROP_SCHEMA}"`);
      await dbDrop.run(`
        CREATE TABLE IF NOT EXISTS ${DROP_FQTABLE} (
          ID    VARCHAR(36) NOT NULL PRIMARY KEY,
          TITLE VARCHAR(200)
        )
      `);
      await dbDrop.run(`INSERT INTO ${DROP_FQTABLE} (ID, TITLE) VALUES ('drop-row', 'Will Be Dropped')`);
    });

    after(async () => {
      clearTenant();
      // Safety net — drop schema if the test failed before disconnect
      await dbDrop?.run(`DROP SCHEMA IF EXISTS ${DB}."${DROP_SCHEMA}" CASCADE`).catch(() => {});
      if (dbDrop?.disconnect) await dbDrop.disconnect();
    });

    it('schema exists before disconnect', async () => {
      const rows = await dbDrop.run(`SELECT * FROM ${DROP_FQTABLE} WHERE ID = 'drop-row'`);
      expect(rows).to.have.lengthOf(1);
    });

    it('disconnect(tenant) drops the tenant schema (HANA HDI container equivalent)', async () => {
      await dbDrop.disconnect(DROP_TENANT);

      // Schema must no longer exist — any query against it should fail
      let threw = false;
      try {
        await dbDrop.run(`SELECT * FROM ${DROP_FQTABLE}`);
      } catch (err: any) {
        threw = true;
        const msg = String(err?.message ?? err);
        expect(msg).to.satisfy(
          (m: string) => /does not exist|not found|002003/i.test(m),
          `unexpected error after schema drop: ${msg}`
        );
      }
      expect(threw).to.equal(true, 'query against dropped schema must throw');
    });

    it('disconnect(tenant) leaves other tenant schemas intact', async () => {
      // TENANT_2 (SCHEMA_T2) must still be reachable
      withTenant(TENANT_2);
      const rows = await db.run({ SELECT: { from: { ref: [SHARED_TABLE] } } });
      expect(rows).to.be.an('array');
    });

    it('disconnect() (full) cleanly shuts down the service without throwing', async () => {
      // Use a separate service instance so we don't poison the shared `db`.
      const credentials = loadCredentials();
      (cds.env as any).requires['mt_shutdown_test'] = {
        kind: 'snowflake',
        impl: join(ROOT, 'dist/index.js'),
        multiTenant: true,
        credentials,
      };
      const tempDb = await cds.connect.to('mt_shutdown_test');
      let threw = false;
      try { await tempDb.disconnect(); } catch { threw = true; }
      expect(threw).to.equal(false, 'disconnect() must not throw');
    });
  });

  // =========================================================================
  describe('custom tenantSchemaPrefix', () => {
    const CUSTOM_TENANT = 'pfx-t1';          // → ACME_PFX_T1
    const CUSTOM_SCHEMA = 'ACME_PFX_T1';
    const CUSTOM_TABLE = 'MT_CUSTOM_PREFIX';
    const CUSTOM_FQTABLE = `${DB}.${CUSTOM_SCHEMA}.${CUSTOM_TABLE}`;

    let dbCustom: any;

    before(async () => {
      const baseCredentials = loadCredentials();
      (cds.env as any).requires['mt_custom_prefix'] = {
        kind: 'snowflake',
        impl: join(ROOT, 'dist/index.js'),
        multiTenant: true,
        credentials: { ...baseCredentials, tenantSchemaPrefix: 'ACME_' },
      };
      dbCustom = await cds.connect.to('mt_custom_prefix');

      await dbCustom.run(`CREATE SCHEMA IF NOT EXISTS ${DB}."${CUSTOM_SCHEMA}"`);
      await dbCustom.run(`
        CREATE TABLE IF NOT EXISTS ${CUSTOM_FQTABLE} (
          ID    VARCHAR(36) NOT NULL PRIMARY KEY,
          TITLE VARCHAR(100)
        )
      `);
      await dbCustom.run(`INSERT INTO ${CUSTOM_FQTABLE} (ID, TITLE) VALUES ('prefix-row', 'Custom Prefix Row')`);
    });

    after(async () => {
      clearTenant();
      await dbCustom?.run(`DROP SCHEMA IF EXISTS ${DB}."${CUSTOM_SCHEMA}" CASCADE`).catch(() => {});
      if (dbCustom?.disconnect) await dbCustom.disconnect();
    });

    it('uses ACME_ prefix instead of default TENANT_ prefix', async () => {
      withTenant(CUSTOM_TENANT);
      // 'pfx-t1' → ACME_ + PFX_T1 = ACME_PFX_T1 ✓
      const rows = await dbCustom.run({ SELECT: { from: { ref: [CUSTOM_TABLE] } } });
      expect(rows).to.have.lengthOf(1);
      expect(rows[0].ID ?? rows[0].id).to.equal('prefix-row');
    });

    it('resolveTenantSchema sanitises hyphens to underscores', async () => {
      // tenant 'pfx-t1' has a hyphen which must be sanitised → ACME_PFX_T1
      // The SELECT above already proves this works; this test makes it explicit.
      withTenant(CUSTOM_TENANT);
      const rows = await dbCustom.run({ SELECT: { from: { ref: [CUSTOM_TABLE] } } });
      expect(rows.length).to.be.gte(1);
    });
  });
});
