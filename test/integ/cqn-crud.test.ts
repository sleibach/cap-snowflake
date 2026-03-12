/**
 * Integration tests for CQN-level CRUD against live Snowflake.
 *
 * Requires a .cdsrc-private.json with live credentials in the project root
 * or test/e2e/fixtures/, or SNOWFLAKE_TEST=true with env vars.
 *
 * These tests create and clean up a temporary table to avoid polluting
 * the test database.
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
(RUN ? describe : describe.skip)('CQN CRUD Integration Tests', function () {
  this.timeout(60_000);

  const CRUD_TABLE = 'CAP_E2E_DB.APP.INTEG_CQN_CRUD';
  let db: any;

  // Minimal CDS model for the test table
  const model: any = {
    definitions: {
      CrudItems: {
        kind: 'entity',
        '@cds.persistence.name': 'INTEG_CQN_CRUD',
        elements: {
          ID: { type: 'cds.UUID', key: true },
          name: { type: 'cds.String', length: 100 },
          value: { type: 'cds.Integer' }
        }
      }
    }
  };

  // ---------------------------------------------------------------------------
  before(async () => {
    await import('../../dist/index.js');

    const credentials = loadCredentials();
    if (!credentials) throw new Error('No Snowflake credentials found');

    if (!cds.env.requires) cds.env.requires = {};
    cds.env.requires.db = { kind: 'snowflake', impl: join(ROOT, 'dist/index.js'), credentials };

    db = await cds.connect.to('db');

    await db.run(`CREATE TABLE IF NOT EXISTS ${CRUD_TABLE} (
      ID    VARCHAR(36) PRIMARY KEY,
      NAME  VARCHAR(100),
      VALUE NUMBER(38,0)
    )`);
    await db.run(`DELETE FROM ${CRUD_TABLE}`);
  });

  after(async () => {
    if (db) {
      await db.run(`DROP TABLE IF EXISTS ${CRUD_TABLE}`).catch(() => {});
      if (db.disconnect) await db.disconnect();
    }
  });

  // ---------------------------------------------------------------------------
  describe('SELECT', () => {
    before(async () => {
      await db.run(`INSERT INTO ${CRUD_TABLE} (ID, NAME, VALUE) VALUES ('id-1', 'Alpha', 10)`);
      await db.run(`INSERT INTO ${CRUD_TABLE} (ID, NAME, VALUE) VALUES ('id-2', 'Beta', 20)`);
    });

    it('SELECT.from returns all rows', async () => {
      const rows = await SELECT.from(CRUD_TABLE);
      expect(rows).to.be.an('array').with.lengthOf.gte(2);
    });

    it('SELECT.from.where filters correctly', async () => {
      const rows = await SELECT.from(CRUD_TABLE).where({ ID: 'id-1' });
      expect(rows).to.have.lengthOf(1);
      expect(rows[0].NAME ?? rows[0].name).to.equal('Alpha');
    });
  });

  // ---------------------------------------------------------------------------
  describe('INSERT', () => {
    it('INSERT.into.entries inserts new row', async () => {
      await INSERT.into(CRUD_TABLE).entries({ ID: 'id-3', NAME: 'Gamma', VALUE: 30 });
      const rows = await SELECT.from(CRUD_TABLE).where({ ID: 'id-3' });
      expect(rows).to.have.lengthOf(1);
    });
  });

  // ---------------------------------------------------------------------------
  describe('UPDATE', () => {
    it('UPDATE.set.where updates row', async () => {
      await UPDATE(CRUD_TABLE).set({ VALUE: 99 }).where({ ID: 'id-1' });
      const rows = await SELECT.from(CRUD_TABLE).where({ ID: 'id-1' });
      expect(Number(rows[0].VALUE ?? rows[0].value)).to.equal(99);
    });
  });

  // ---------------------------------------------------------------------------
  describe('DELETE', () => {
    it('DELETE.from.where removes row', async () => {
      await DELETE.from(CRUD_TABLE).where({ ID: 'id-2' });
      const rows = await SELECT.from(CRUD_TABLE).where({ ID: 'id-2' });
      expect(rows).to.have.lengthOf(0);
    });
  });

  // ---------------------------------------------------------------------------
  describe('UPSERT', () => {
    it('UPSERT.into.entries is idempotent', async () => {
      const entry = { ID: 'upsert-1', NAME: 'Upserted', VALUE: 1 };
      await UPSERT.into(CRUD_TABLE).entries(entry);
      await UPSERT.into(CRUD_TABLE).entries({ ...entry, VALUE: 2 });

      const rows = await SELECT.from(CRUD_TABLE).where({ ID: 'upsert-1' });
      expect(rows).to.have.lengthOf(1);
      expect(Number(rows[0].VALUE ?? rows[0].value)).to.equal(2);
    });
  });

  // ---------------------------------------------------------------------------
  describe('Transactions', () => {
    it('cds.tx commit persists changes', async () => {
      await cds.tx(async tx => {
        await tx.run(INSERT.into(CRUD_TABLE).entries({ ID: 'tx-1', NAME: 'TxCommit', VALUE: 100 }));
      });
      const rows = await SELECT.from(CRUD_TABLE).where({ ID: 'tx-1' });
      expect(rows).to.have.lengthOf(1);
    });
  });
});
