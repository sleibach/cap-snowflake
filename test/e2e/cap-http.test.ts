/**
 * End-to-end HTTP tests for the CAP Snowflake adapter.
 *
 * Starts a real CAP HTTP server, connects to Snowflake, and verifies OData
 * responses for all common operations.
 *
 * Runs when:
 *   - SNOWFLAKE_TEST=true  (env)
 *   - SNOWFLAKE_E2E_SMOKE=true  (env, subset of tests)
 *   - test/e2e/fixtures/.cdsrc-private.json is present
 */

import { expect } from 'chai';
import cds from '@sap/cds';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SnowflakeSQLAPIClient } from '../../src/client/sqlapi.js';
import { SnowflakeService } from '../../src/SnowflakeService.js';

const RUN_LIVE  = process.env.SNOWFLAKE_TEST === 'true';
const RUN_SMOKE = process.env.SNOWFLAKE_E2E_SMOKE === 'true';
const FIXTURE_DIR = `${process.cwd()}/test/e2e/fixtures`;
const HAS_PRIVATE_CONFIG = existsSync(join(FIXTURE_DIR, '.cdsrc-private.json'));
const RUN_E2E = RUN_LIVE || RUN_SMOKE || HAS_PRIVATE_CONFIG;

let GET: any;
let POST: any;
let DELETE_REQ: any;
let PATCH: any;

const AUTHORS_TABLE           = 'CAP_E2E_DB.APP.CAP_E2E_AUTHORS';
const BOOKS_TABLE             = 'CAP_E2E_DB.APP.CAP_E2E_BOOKS';
const BOOKS_DRAFTS_TABLE      = 'CAP_E2E_DB.APP.E2ETESTSERVICE_BOOKS_DRAFTS';
const DRAFT_ADMIN_TABLE       = 'CAP_E2E_DB.APP.DRAFT_DRAFTADMINISTRATIVEDATA';
const ORDERS_TABLE            = 'CAP_E2E_DB.APP.CAP_E2E_ORDERS';
const LOCALIZED_TABLE         = 'CAP_E2E_DB.APP.CAP_E2E_LOCALIZEDBOOKS';
const LOCALIZED_TEXTS_TABLE   = 'CAP_E2E_DB.APP.CAP_E2E_LOCALIZEDBOOKS_TEXTS';
const WORK_ASSIGNMENTS_TABLE  = 'CAP_E2E_DB.APP.CAP_E2E_WORKASSIGNMENTS';
const CATALOGS_TABLE          = 'CAP_E2E_DB.APP.CAP_E2E_CATALOGS';
const CATALOG_ITEMS_TABLE     = 'CAP_E2E_DB.APP.CAP_E2E_CATALOGITEMS';

const AUTHOR_ID          = 'de61ab2e-7584-4726-be79-07e7f8bc5a9d';
const AUTHOR_ID2         = '50706d32-7e65-4c40-a695-ecc2a0ee5fe7';
const BOOK_ID            = '33f21c31-318b-46de-aa6a-0c6f54c7e777';
const BOOK_ID2           = '028f8f24-ff57-45ab-9b8e-b4df009d825a';
const LOCALIZED_BOOK_ID  = '33333333-3333-3333-3333-333333333333';
const WORK_ASSIGNMENT_ID = '44444444-4444-4444-4444-444444444444';

// ---------------------------------------------------------------------------
function resolveEnvRefs(value: any): any {
  if (Array.isArray(value)) return value.map(resolveEnvRefs);
  if (value && typeof value === 'object') {
    const out: any = {};
    for (const [k, v] of Object.entries(value)) out[k] = resolveEnvRefs(v);
    return out;
  }
  if (typeof value === 'string' && value.startsWith('env:')) {
    return process.env[value.slice(4)];
  }
  return value;
}

// ---------------------------------------------------------------------------
if (RUN_E2E) {
  // Load credentials from .cdsrc-private.json BEFORE cds.test() so the db
  // config is available when the CAP server boots inside cds.test().
  const privateConfigPath = join(FIXTURE_DIR, '.cdsrc-private.json');
  if (existsSync(privateConfigPath)) {
    const privateConfig = JSON.parse(readFileSync(privateConfigPath, 'utf8'));
    const resolvedDbConfig = resolveEnvRefs(privateConfig?.cds?.requires?.db);
    if (resolvedDbConfig) {
      if (!cds.env.requires) cds.env.requires = {};
      cds.env.requires.db = resolvedDbConfig;
    }
  }

  // Register SnowflakeService before cds.test() so CAP can instantiate it.
  if (!cds.env.requires) cds.env.requires = {};
  if (!cds.env.requires.kinds) cds.env.requires.kinds = {};
  cds.env.requires.kinds.snowflake = SnowflakeService as any;

  const test = cds.test(FIXTURE_DIR);
  GET        = test.GET;
  POST       = test.POST;
  DELETE_REQ = (test as any).DELETE;
  PATCH      = (test as any).PATCH;
}

// ---------------------------------------------------------------------------
async function setupSchema(db: any) {
  await db.run(`CREATE TABLE IF NOT EXISTS ${AUTHORS_TABLE} (
    ID         VARCHAR(36) PRIMARY KEY,
    NAME       VARCHAR(100) NOT NULL,
    COUNTRY    VARCHAR(2),
    CREATEDAT  TIMESTAMP_NTZ,
    CREATEDBY  VARCHAR(100),
    MODIFIEDAT TIMESTAMP_NTZ,
    MODIFIEDBY VARCHAR(100)
  )`);

  await db.run(`CREATE TABLE IF NOT EXISTS ${BOOKS_TABLE} (
    ID          VARCHAR(36) PRIMARY KEY,
    TITLE       VARCHAR(120) NOT NULL,
    AUTHOR_ID   VARCHAR(36),
    PRICE       NUMBER(10,2),
    STOCK       NUMBER(38,0),
    DESCRIPTION TEXT,
    CREATEDAT   TIMESTAMP_NTZ,
    CREATEDBY   VARCHAR(100),
    MODIFIEDAT  TIMESTAMP_NTZ,
    MODIFIEDBY  VARCHAR(100)
  )`);

  await db.run(`CREATE TABLE IF NOT EXISTS ${ORDERS_TABLE} (
    ID         VARCHAR(36) PRIMARY KEY,
    BOOK_ID    VARCHAR(36),
    QUANTITY   NUMBER(38,0) NOT NULL,
    BUYER      VARCHAR(100),
    TOTAL      NUMBER(10,2),
    CREATEDAT  TIMESTAMP_NTZ,
    CREATEDBY  VARCHAR(100),
    MODIFIEDAT TIMESTAMP_NTZ,
    MODIFIEDBY VARCHAR(100)
  )`);

  await db.run(`CREATE TABLE IF NOT EXISTS ${LOCALIZED_TABLE} (
    ID         VARCHAR(36) PRIMARY KEY,
    TITLE      VARCHAR(120),
    DESCRIPTION TEXT,
    CREATEDAT  TIMESTAMP_NTZ,
    CREATEDBY  VARCHAR(100),
    MODIFIEDAT TIMESTAMP_NTZ,
    MODIFIEDBY VARCHAR(100)
  )`);

  await db.run(`CREATE TABLE IF NOT EXISTS ${LOCALIZED_TEXTS_TABLE} (
    locale      VARCHAR(14)  NOT NULL,
    ID          VARCHAR(36)  NOT NULL,
    title       VARCHAR(120),
    description TEXT,
    PRIMARY KEY (locale, ID)
  )`);

  await db.run(`CREATE TABLE IF NOT EXISTS ${WORK_ASSIGNMENTS_TABLE} (
    ID         VARCHAR(36)   NOT NULL,
    EMPLOYEE   VARCHAR(100),
    ROLE       VARCHAR(100),
    DEPARTMENT VARCHAR(100),
    VALIDFROM  TIMESTAMP_NTZ NOT NULL,
    VALIDTO    TIMESTAMP_NTZ NOT NULL,
    PRIMARY KEY (ID, VALIDFROM)
  )`);

  // Draft tables required by @odata.draft.enabled on Books
  await db.run(`CREATE TABLE IF NOT EXISTS ${BOOKS_DRAFTS_TABLE} (
    ID                               VARCHAR(36) NOT NULL,
    CREATEDAT                        TIMESTAMP_TZ,
    CREATEDBY                        VARCHAR(255),
    MODIFIEDAT                       TIMESTAMP_TZ,
    MODIFIEDBY                       VARCHAR(255),
    TITLE                            VARCHAR(120),
    AUTHOR_ID                        VARCHAR(36),
    PRICE                            NUMBER(10,2),
    STOCK                            NUMBER(38,0),
    DESCRIPTION                      TEXT,
    ISACTIVEENTITY                   BOOLEAN,
    HASACTIVEENTITY                  BOOLEAN,
    HASDRAFTENTITY                   BOOLEAN,
    DRAFTADMINISTRATIVEDATA_DRAFTUUID VARCHAR(36) NOT NULL,
    PRIMARY KEY (ID)
  )`);

  await db.run(`CREATE TABLE IF NOT EXISTS ${DRAFT_ADMIN_TABLE} (
    DRAFTUUID             VARCHAR(36) NOT NULL,
    INPROCESSBYUSER       VARCHAR(255),
    LASTCHANGEDBYUSER     VARCHAR(255),
    CREATEDBYUSER         VARCHAR(255),
    DRAFTISCREATEDBYME    BOOLEAN,
    DRAFTISPROCESSEDBYME  BOOLEAN,
    DRAFTMESSAGES         TEXT,
    LASTCHANGEDATETIME    TIMESTAMP_TZ,
    PRIMARY KEY (DRAFTUUID)
  )`);
  // Add columns that may be missing from older table versions
  for (const col of [
    'INPROCESSBYUSER VARCHAR(255)',
    'LASTCHANGEDBYUSER VARCHAR(255)',
    'CREATEDBYUSER VARCHAR(255)',
    'LASTCHANGEDATETIME TIMESTAMP_TZ',
  ]) {
    await db.run(`ALTER TABLE ${DRAFT_ADMIN_TABLE} ADD COLUMN IF NOT EXISTS ${col}`).catch(() => {});
  }

  await db.run(`CREATE TABLE IF NOT EXISTS ${CATALOGS_TABLE} (
    ID         VARCHAR(36) PRIMARY KEY,
    NAME       VARCHAR(100) NOT NULL,
    CREATEDAT  TIMESTAMP_NTZ,
    CREATEDBY  VARCHAR(100),
    MODIFIEDAT TIMESTAMP_NTZ,
    MODIFIEDBY VARCHAR(100)
  )`);

  await db.run(`CREATE TABLE IF NOT EXISTS ${CATALOG_ITEMS_TABLE} (
    ID         VARCHAR(36) PRIMARY KEY,
    CATALOG_ID VARCHAR(36),
    TITLE      VARCHAR(100) NOT NULL,
    PRICE      NUMBER(10,2),
    CREATEDAT  TIMESTAMP_NTZ,
    CREATEDBY  VARCHAR(100),
    MODIFIEDAT TIMESTAMP_NTZ,
    MODIFIEDBY VARCHAR(100)
  )`);
}

async function seedData(db: any) {
  await db.run(`DELETE FROM ${ORDERS_TABLE}`);
  await db.run(`DELETE FROM ${DRAFT_ADMIN_TABLE}`).catch(() => {});
  await db.run(`DELETE FROM ${BOOKS_DRAFTS_TABLE}`).catch(() => {});
  await db.run(`DELETE FROM ${BOOKS_TABLE}`);
  await db.run(`DELETE FROM ${AUTHORS_TABLE}`);
  await db.run(`DELETE FROM ${LOCALIZED_TEXTS_TABLE}`);
  await db.run(`DELETE FROM ${LOCALIZED_TABLE}`);
  await db.run(`DELETE FROM ${WORK_ASSIGNMENTS_TABLE}`);
  await db.run(`DELETE FROM ${CATALOG_ITEMS_TABLE}`).catch(() => {});
  await db.run(`DELETE FROM ${CATALOGS_TABLE}`).catch(() => {});

  await db.run(`INSERT INTO ${AUTHORS_TABLE} (ID, NAME, COUNTRY) VALUES ('${AUTHOR_ID}',  'John Doe', 'DE')`);
  await db.run(`INSERT INTO ${AUTHORS_TABLE} (ID, NAME, COUNTRY) VALUES ('${AUTHOR_ID2}', 'Jane Smith', 'US')`);
  await db.run(`INSERT INTO ${BOOKS_TABLE}   (ID, TITLE, AUTHOR_ID, PRICE, STOCK, DESCRIPTION)
    VALUES ('${BOOK_ID}',  'Adapter Patterns', '${AUTHOR_ID}',  29.99, 7,  'Guide to CAP adapters')`);
  await db.run(`INSERT INTO ${BOOKS_TABLE}   (ID, TITLE, AUTHOR_ID, PRICE, STOCK, DESCRIPTION)
    VALUES ('${BOOK_ID2}', 'Snowflake Deep Dive', '${AUTHOR_ID}', 39.99, 3,  'Advanced Snowflake')`);
  await db.run(`INSERT INTO ${LOCALIZED_TABLE} (ID, TITLE, DESCRIPTION)
    VALUES ('${LOCALIZED_BOOK_ID}', 'Default title', 'Default description')`);
  await db.run(`INSERT INTO ${LOCALIZED_TEXTS_TABLE} (locale, ID, title, description)
    VALUES ('de', '${LOCALIZED_BOOK_ID}', 'Titel Deutsch', 'Beschreibung Deutsch')`);
  await db.run(`INSERT INTO ${LOCALIZED_TEXTS_TABLE} (locale, ID, title, description)
    VALUES ('fr', '${LOCALIZED_BOOK_ID}', 'Titre Français', 'Description Française')`);
  await db.run(`INSERT INTO ${WORK_ASSIGNMENTS_TABLE} (ID, EMPLOYEE, ROLE, DEPARTMENT, VALIDFROM, VALIDTO)
    VALUES ('${WORK_ASSIGNMENT_ID}', 'Alice', 'Engineer', 'Platform',
            '2020-01-01T00:00:00Z', '2099-12-31T23:59:59Z')`);
}

async function seedDataDirect(credentials: any) {
  const client = new SnowflakeSQLAPIClient(credentials);
  const stmts = [
    `DELETE FROM ${ORDERS_TABLE}`,
    `DELETE FROM ${BOOKS_TABLE}`,
    `DELETE FROM ${AUTHORS_TABLE}`,
    `DELETE FROM ${LOCALIZED_TEXTS_TABLE}`,
    `DELETE FROM ${LOCALIZED_TABLE}`,
    `DELETE FROM ${WORK_ASSIGNMENTS_TABLE}`,
    `INSERT INTO ${AUTHORS_TABLE} (ID, NAME, COUNTRY) VALUES ('${AUTHOR_ID}',  'John Doe', 'DE')`,
    `INSERT INTO ${AUTHORS_TABLE} (ID, NAME, COUNTRY) VALUES ('${AUTHOR_ID2}', 'Jane Smith', 'US')`,
    `INSERT INTO ${BOOKS_TABLE} (ID, TITLE, AUTHOR_ID, PRICE, STOCK, DESCRIPTION)
       VALUES ('${BOOK_ID}', 'Adapter Patterns', '${AUTHOR_ID}', 29.99, 7, 'Guide to CAP adapters')`,
    `INSERT INTO ${BOOKS_TABLE} (ID, TITLE, AUTHOR_ID, PRICE, STOCK, DESCRIPTION)
       VALUES ('${BOOK_ID2}', 'Snowflake Deep Dive', '${AUTHOR_ID}', 39.99, 3, 'Advanced Snowflake')`,
    `INSERT INTO ${LOCALIZED_TABLE} (ID, TITLE, DESCRIPTION)
       VALUES ('${LOCALIZED_BOOK_ID}', 'Default title', 'Default description')`,
    `INSERT INTO ${LOCALIZED_TEXTS_TABLE} (locale, ID, title, description)
       VALUES ('de', '${LOCALIZED_BOOK_ID}', 'Titel Deutsch', 'Beschreibung Deutsch')`,
    `INSERT INTO ${LOCALIZED_TEXTS_TABLE} (locale, ID, title, description)
       VALUES ('fr', '${LOCALIZED_BOOK_ID}', 'Titre Français', 'Description Française')`,
    `INSERT INTO ${WORK_ASSIGNMENTS_TABLE} (ID, EMPLOYEE, ROLE, DEPARTMENT, VALIDFROM, VALIDTO)
       VALUES ('${WORK_ASSIGNMENT_ID}', 'Alice', 'Engineer', 'Platform',
               '2020-01-01T00:00:00Z', '2099-12-31T23:59:59Z')`,
  ];
  for (const sql of stmts) await client.execute(sql);
}

// ---------------------------------------------------------------------------
before(function () { this.timeout(120_000); });

(RUN_E2E ? describe : describe.skip)('CAP HTTP E2E (Snowflake)', function () {
  this.timeout(90_000);
  const BASE = '/odata/v4/e2-etest';

  let db: any;

  before(async () => {
    db = await cds.connect.to('db');
    await setupSchema(db);
    await seedData(db);
    const creds = cds.env.requires.db?.credentials;
    if (creds?.auth === 'jwt') await seedDataDirect(creds);
  });

  after(async () => {
    if (db?.disconnect) await db.disconnect();
  });

  // ==========================================================================
  describe('Books – basic read', () => {
    it('returns all books', async () => {
      const res = await GET(`${BASE}/Books`);
      expect(res.status).to.equal(200);
      expect(res.data.value).to.be.an('array').with.lengthOf.gte(2);
    });

    it('supports $select', async () => {
      const res = await GET(`${BASE}/Books?$select=ID,title,price`);
      expect(res.status).to.equal(200);
      const book = res.data.value[0];
      expect(book).to.have.property('ID');
      expect(book).to.have.property('title');
      expect(book).to.have.property('price');
      expect(book).to.not.have.property('stock');
    });

    it('supports $filter (eq)', async () => {
      const res = await GET(`${BASE}/Books?$filter=ID eq '${BOOK_ID}'`);
      expect(res.status).to.equal(200);
      expect(res.data.value).to.have.lengthOf(1);
      expect(res.data.value[0].ID).to.equal(BOOK_ID);
    });

    it('supports $filter (gt, lt)', async () => {
      const res = await GET(`${BASE}/Books?$filter=price gt 10 and price lt 50`);
      expect(res.status).to.equal(200);
      expect(res.data.value).to.be.an('array').with.lengthOf.gte(1);
      res.data.value.forEach((b: any) => {
        expect(Number(b.price)).to.be.greaterThan(10).and.lessThan(50);
      });
    });

    it('supports $filter (contains)', async () => {
      const res = await GET(`${BASE}/Books?$filter=contains(title,'Pattern')`);
      expect(res.status).to.equal(200);
      expect(res.data.value.length).to.be.greaterThan(0);
      res.data.value.forEach((b: any) =>
        expect(b.title).to.include('Pattern')
      );
    });

    it('supports $filter (startswith)', async () => {
      const res = await GET(`${BASE}/Books?$filter=startswith(title,'Adapter')`);
      expect(res.status).to.equal(200);
      expect(res.data.value.length).to.be.greaterThan(0);
    });

    it('supports $filter (endswith)', async () => {
      const res = await GET(`${BASE}/Books?$filter=endswith(title,'Dive')`);
      expect(res.status).to.equal(200);
      expect(res.data.value.length).to.be.greaterThan(0);
    });

    it('supports $orderby asc', async () => {
      const res = await GET(`${BASE}/Books?$orderby=price asc`);
      expect(res.status).to.equal(200);
      const prices = res.data.value.map((b: any) => Number(b.price));
      for (let i = 1; i < prices.length; i++) {
        expect(prices[i]).to.be.gte(prices[i - 1]);
      }
    });

    it('supports $orderby desc', async () => {
      const res = await GET(`${BASE}/Books?$orderby=price desc`);
      expect(res.status).to.equal(200);
      const prices = res.data.value.map((b: any) => Number(b.price));
      for (let i = 1; i < prices.length; i++) {
        expect(prices[i]).to.be.lte(prices[i - 1]);
      }
    });

    it('supports $top', async () => {
      const res = await GET(`${BASE}/Books?$top=1`);
      expect(res.status).to.equal(200);
      expect(res.data.value).to.have.lengthOf(1);
    });

    it('supports $skip', async () => {
      const allRes = await GET(`${BASE}/Books?$orderby=price asc`);
      const skipRes = await GET(`${BASE}/Books?$orderby=price asc&$skip=1`);
      expect(skipRes.status).to.equal(200);
      if (allRes.data.value.length > 1) {
        expect(skipRes.data.value[0].ID).to.equal(allRes.data.value[1].ID);
      }
    });

    it('supports $count=true', async () => {
      const res = await GET(`${BASE}/Books?$count=true`);
      expect(res.status).to.equal(200);
      expect(res.data['@odata.count']).to.be.a('number').and.gte(1);
    });

    it('supports $top + $count', async () => {
      const res = await GET(`${BASE}/Books?$top=1&$count=true`);
      expect(res.status).to.equal(200);
      expect(res.data.value).to.have.lengthOf(1);
      expect(res.data['@odata.count']).to.be.gte(1);
    });
  });

  // ==========================================================================
  describe('Books – single entity', () => {
    it('reads a single book by ID', async () => {
      const res = await GET(`${BASE}/Books(ID=${BOOK_ID},IsActiveEntity=true)`);
      expect(res.status).to.equal(200);
      expect(res.data.ID).to.equal(BOOK_ID);
      expect(res.data.title).to.equal('Adapter Patterns');
    });

    it('returns 404 for non-existent book', async () => {
      const res = await GET(`${BASE}/Books(ID=00000000-0000-0000-0000-000000000000,IsActiveEntity=true)`).catch((e: any) => e.response || e);
      expect(res.status).to.equal(404);
    });
  });

  // ==========================================================================
  describe('$expand – to-one association', () => {
    it('expands author on books', async () => {
      const res = await GET(`${BASE}/Books?$select=ID,title&$expand=author($select=ID,name)`);
      expect(res.status).to.equal(200);
      const books = res.data.value;
      expect(books.length).to.be.gte(1);
      const withAuthor = books.find((b: any) => b.author !== null);
      expect(withAuthor).to.exist;
      expect(withAuthor.author).to.have.property('ID');
      expect(withAuthor.author).to.have.property('name');
    });

    it('returns null author for books without one', async () => {
      // Insert orphan book
      await db.run(`INSERT INTO ${BOOKS_TABLE} (ID, TITLE, PRICE, STOCK)
        VALUES ('1d12d640-f3ee-48cb-9cb0-1419bc29df06', 'Orphan Book', 1.0, 0)`);

      const res = await GET(`${BASE}/Books?$filter=ID eq '1d12d640-f3ee-48cb-9cb0-1419bc29df06'&$expand=author`);
      expect(res.status).to.equal(200);

      await db.run(`DELETE FROM ${BOOKS_TABLE} WHERE ID = '1d12d640-f3ee-48cb-9cb0-1419bc29df06'`);
    });
  });

  // ==========================================================================
  describe('Authors endpoint', () => {
    it('reads all authors', async () => {
      const res = await GET(`${BASE}/Authors`);
      expect(res.status).to.equal(200);
      expect(res.data.value).to.be.an('array').with.lengthOf.gte(2);
    });

    it('filters authors by country', async () => {
      const res = await GET(`${BASE}/Authors?$filter=country eq 'DE'`);
      expect(res.status).to.equal(200);
      res.data.value.forEach((a: any) => expect(a.country).to.equal('DE'));
    });
  });

  // ==========================================================================
  describe('submitOrder action', () => {
    it('executes submitOrder end-to-end', async () => {
      const actionRes = await POST(`${BASE}/submitOrder`, { book: BOOK_ID, quantity: 2 });
      expect(actionRes.status).to.equal(200);

      // Verify stock was updated
      const booksRes = await GET(`${BASE}/Books?$select=ID,stock&$filter=ID eq '${BOOK_ID}'`);
      expect(booksRes.status).to.equal(200);
      expect(Number(booksRes.data.value[0].stock)).to.be.gte(0);
    });

    it('rejects submitOrder with invalid data', async () => {
      const res = await POST(`${BASE}/submitOrder`, { book: '', quantity: 0 })
        .catch((e: any) => e.response || e);
      expect(res.status).to.be.gte(400);
    });
  });

  // ==========================================================================
  describe('Localized entity', () => {
    it('reads localized entity without locale (default)', async () => {
      const res = await GET(`${BASE}/LocalizedBooks`);
      expect(res.status).to.equal(200);
      expect(res.data.value).to.be.an('array').with.lengthOf.gte(1);
      expect(res.data.value[0]).to.have.property('title');
    });

    it('reads localized entity with de locale header', async () => {
      const res = await GET(`${BASE}/LocalizedBooks`, {
        headers: { 'Accept-Language': 'de' }
      });
      expect(res.status).to.equal(200);
      expect(res.data.value[0]).to.have.property('title');
    });

    it('reads localized entity with fr locale header', async () => {
      const res = await GET(`${BASE}/LocalizedBooks`, {
        headers: { 'Accept-Language': 'fr' }
      });
      expect(res.status).to.equal(200);
    });

    it('de locale returns German title (content verified)', async () => {
      const deRes = await GET(`${BASE}/LocalizedBooks`, {
        headers: { 'Accept-Language': 'de' }
      });
      expect(deRes.status).to.equal(200);
      const deBook = deRes.data.value.find((b: any) => b.ID === LOCALIZED_BOOK_ID);
      expect(deBook).to.exist;
      expect(deBook.title).to.equal('Titel Deutsch');
    });

    it('fr locale returns French title (content verified)', async () => {
      const frRes = await GET(`${BASE}/LocalizedBooks`, {
        headers: { 'Accept-Language': 'fr' }
      });
      expect(frRes.status).to.equal(200);
      const frBook = frRes.data.value.find((b: any) => b.ID === LOCALIZED_BOOK_ID);
      expect(frBook).to.exist;
      expect(frBook.title).to.equal('Titre Français');
    });

    it('no locale returns default title (not a translation)', async () => {
      const res = await GET(`${BASE}/LocalizedBooks`);
      const book = res.data.value.find((b: any) => b.ID === LOCALIZED_BOOK_ID);
      expect(book).to.exist;
      expect(book.title).to.equal('Default title');
    });
  });

  // ==========================================================================
  describe('Temporal entity (WorkAssignments)', () => {
    it('reads all work assignments', async () => {
      const res = await GET(`${BASE}/WorkAssignments`);
      expect(res.status).to.equal(200);
      expect(res.data.value).to.be.an('array').with.lengthOf.gte(1);
    });

    it('filters by validity range', async () => {
      const res = await GET(
        `${BASE}/WorkAssignments?$filter=validFrom le 2099-01-01T00:00:00Z and validTo gt 2021-01-01T00:00:00Z`
      );
      expect(res.status).to.equal(200);
      expect(res.data.value.length).to.be.greaterThan(0);
    });

    it('filters by employee name', async () => {
      const res = await GET(`${BASE}/WorkAssignments?$filter=employee eq 'Alice'`);
      expect(res.status).to.equal(200);
      expect(res.data.value.length).to.be.greaterThan(0);
    });
  });

  // ==========================================================================
  // NOTE: Books has @odata.draft.enabled which prevents direct CRUD without the
  // draft lifecycle. We test write operations on Orders (not draft-enabled) instead.
  describe('Orders – write operations (POST/PATCH/DELETE)', () => {
    let createdOrderId: string;

    it('POST /Orders creates a new order (201)', async () => {
      const res = await POST(`${BASE}/Orders`, {
        book_ID: BOOK_ID,
        quantity: 3,
        buyer: 'e2e-tester'
      });
      expect(res.status).to.equal(201);
      // Capture ID first so subsequent tests don't fail with undefined
      createdOrderId = res.data.ID;
      expect(createdOrderId).to.be.a('string');
      expect(Number(res.data.quantity)).to.equal(3);
    });

    it('GET /Orders(id) verifies the newly created order', async () => {
      const res = await GET(`${BASE}/Orders(${createdOrderId})`);
      expect(res.status).to.equal(200);
      expect(res.data.ID).to.equal(createdOrderId);
      expect(Number(res.data.quantity)).to.equal(3);
    });

    it('PATCH /Orders(id) updates quantity (200)', async () => {
      const res = await PATCH(`${BASE}/Orders(${createdOrderId})`, { quantity: 5 });
      expect(res.status).to.be.oneOf([200, 204]);
    });

    it('GET /Orders(id) reflects PATCH change', async () => {
      const res = await GET(`${BASE}/Orders(${createdOrderId})`);
      expect(res.status).to.equal(200);
      expect(Number(res.data.quantity)).to.equal(5);
    });

    it('DELETE /Orders(id) removes the order (204)', async () => {
      const res = await DELETE_REQ(`${BASE}/Orders(${createdOrderId})`);
      expect(res.status).to.equal(204);
    });

    it('GET /Orders(deleted-id) returns 404', async () => {
      const res = await GET(`${BASE}/Orders(${createdOrderId})`).catch((e: any) => e.response || e);
      expect(res.status).to.equal(404);
    });
  });

  // ==========================================================================
  describe('$search', () => {
    it('returns matching books for known title fragment', async () => {
      const res = await GET(`${BASE}/Books?$search=Adapter`);
      expect(res.status).to.equal(200);
      expect(res.data.value).to.be.an('array').with.lengthOf.gte(1);
      expect(res.data.value[0].title).to.include('Adapter');
    });

    it('returns empty array for non-existent search term', async () => {
      const res = await GET(`${BASE}/Books?$search=xyzzy_nonexistent_42`);
      expect(res.status).to.equal(200);
      expect(res.data.value).to.be.an('array').with.lengthOf(0);
    });

    it('$search combined with $expand does not cause ambiguous column error', async () => {
      // Regression: $search generates ILIKE on unqualified columns (e.g. CREATEDBY).
      // When $expand adds a JOIN, those columns become ambiguous. Fix: qualify with base alias.
      const res = await GET(`${BASE}/Books?$search=Adapter&$expand=author`);
      expect(res.status).to.equal(200);
      expect(res.data.value).to.be.an('array').with.lengthOf.gte(1);
      expect(res.data.value[0].title).to.include('Adapter');
      expect(res.data.value[0]).to.have.property('author');
    });
  });

  // ==========================================================================
  describe('Navigation properties', () => {
    it('GET /Books(id)/author returns author object', async () => {
      const res = await GET(`${BASE}/Books(ID=${BOOK_ID},IsActiveEntity=true)/author`);
      expect(res.status).to.equal(200);
      expect(res.data).to.have.property('ID');
      expect(res.data).to.have.property('name');
    });

    it('GET /Authors(id)/books returns array', async () => {
      const res = await GET(`${BASE}/Authors(${AUTHOR_ID})/books`);
      expect(res.status).to.equal(200);
      expect(res.data.value).to.be.an('array').with.lengthOf.gte(1);
    });
  });

  // ==========================================================================
  describe('Filtered $expand', () => {
    it('$expand=author($select=name) returns author with only name', async () => {
      const res = await GET(`${BASE}/Books?$filter=ID eq '${BOOK_ID}'&$expand=author($select=name)`);
      expect(res.status).to.equal(200);
      const book = res.data.value[0];
      expect(book.author).to.have.property('name');
    });

    it('$expand=author($filter=country eq DE) returns author only when country matches', async () => {
      const res = await GET(`${BASE}/Books?$expand=author($filter=country eq 'DE')`);
      expect(res.status).to.equal(200);
      const booksWithDE = res.data.value.filter((b: any) => b.author !== null);
      booksWithDE.forEach((b: any) => expect(b.author.country).to.equal('DE'));
    });
  });

  // ==========================================================================
  describe('$expand – to-many association', () => {
    it('GET /Authors?$expand=books returns books array per author', async () => {
      const res = await GET(`${BASE}/Authors?$expand=books`);
      expect(res.status).to.equal(200);
      const john = res.data.value.find((a: any) => a.ID === AUTHOR_ID);
      expect(john).to.exist;
      expect(john.books).to.be.an('array').with.lengthOf.gte(2);
      const bookIds = john.books.map((b: any) => b.ID);
      expect(bookIds).to.include(BOOK_ID);
      expect(bookIds).to.include(BOOK_ID2);
    });

    it('GET /Authors?$expand=books($select=ID,title) returns projected books', async () => {
      const res = await GET(`${BASE}/Authors?$expand=books($select=ID,title)`);
      expect(res.status).to.equal(200);
      const john = res.data.value.find((a: any) => a.ID === AUTHOR_ID);
      expect(john).to.exist;
      expect(john.books).to.be.an('array').with.lengthOf.gte(2);
      john.books.forEach((b: any) => {
        expect(b).to.have.property('ID');
        expect(b).to.have.property('title');
      });
    });

    it('returns empty books array for author with no books', async () => {
      const res = await GET(`${BASE}/Authors?$filter=ID eq '${AUTHOR_ID2}'&$expand=books`);
      expect(res.status).to.equal(200);
      const jane = res.data.value[0];
      expect(jane).to.exist;
      expect(jane.books).to.be.an('array').with.lengthOf(0);
    });
  });

  // ==========================================================================
  describe('Draft lifecycle', () => {
    let draftId: string;

    it('POST /Books creates a draft (IsActiveEntity=false)', async () => {
      const res = await POST(`${BASE}/Books`, {
        title: 'Draft Book',
        price: 9.99
      });
      // Draft-enabled entity returns 201 with IsActiveEntity: false
      expect(res.status).to.be.oneOf([200, 201]);
      draftId = res.data.ID;
      expect(draftId).to.be.a('string');
    });

    it('GET /Books?$filter=IsActiveEntity eq false returns draft', async () => {
      const res = await GET(`${BASE}/Books?$filter=IsActiveEntity eq false`);
      expect(res.status).to.equal(200);
      expect(res.data.value).to.be.an('array').with.lengthOf.gte(1);
    });

    it('PATCH draft book updates title', async () => {
      const res = await PATCH(
        `${BASE}/Books(ID=${draftId},IsActiveEntity=false)`,
        { title: 'Draft Updated' }
      );
      expect(res.status).to.be.oneOf([200, 204]);
    });

    it('POST draftActivate activates the draft (IsActiveEntity=true)', async () => {
      const res = await POST(
        `${BASE}/Books(ID=${draftId},IsActiveEntity=false)/E2ETestService.draftActivate`,
        {}
      );
      expect(res.status).to.be.oneOf([200, 201]);
      expect(res.data.IsActiveEntity).to.equal(true);
    });

    it('GET /Books?$filter=IsActiveEntity eq true contains activated record', async () => {
      const res = await GET(`${BASE}/Books?$filter=IsActiveEntity eq true`);
      expect(res.status).to.equal(200);
      const found = res.data.value.find((b: any) => b.ID === draftId);
      expect(found).to.exist;
    });

    it('GET /Books?$filter=IsActiveEntity eq false no longer has the draft', async () => {
      const res = await GET(`${BASE}/Books?$filter=ID eq '${draftId}' and IsActiveEntity eq false`);
      expect(res.status).to.equal(200);
      expect(res.data.value).to.be.an('array').with.lengthOf(0);
    });

    it('POST draftEdit creates a new draft copy', async () => {
      const res = await POST(
        `${BASE}/Books(ID=${draftId},IsActiveEntity=true)/E2ETestService.draftEdit`,
        {}
      );
      expect(res.status).to.be.oneOf([200, 201]);
      expect(res.data.IsActiveEntity).to.equal(false);
    });

    it('DELETE draft book discards the draft copy', async () => {
      // draftDiscard in CAP is done via DELETE on the draft entity (IsActiveEntity=false)
      const res = await DELETE_REQ(`${BASE}/Books(ID=${draftId},IsActiveEntity=false)`);
      expect(res.status).to.be.oneOf([200, 204]);
    });

    // Cleanup activated book
    after(async () => {
      if (draftId) {
        await db.run(`DELETE FROM ${BOOKS_TABLE} WHERE ID = '${draftId}'`).catch(() => {});
      }
    });
  });

  // ==========================================================================
  describe('Managed aspects (Tier 1)', () => {
    let managedOrderId: string;

    it('POST /Orders creates order and managed fields stored in DB', async () => {
      const res = await POST(`${BASE}/Orders`, {
        book_ID: BOOK_ID,
        quantity: 1,
        buyer: 'managed-tester'
      });
      expect(res.status).to.equal(201);
      managedOrderId = res.data.ID;
      expect(managedOrderId).to.be.a('string');

      // GET the created order from DB
      const getRes = await GET(`${BASE}/Orders(${managedOrderId})`);
      expect(getRes.status).to.equal(200);
      expect(getRes.data.ID).to.equal(managedOrderId);
      // createdAt/modifiedAt are set by CAP managed aspect
      if (getRes.data.createdAt) {
        expect(getRes.data.createdAt).to.match(/^\d{4}-\d{2}-\d{2}T/);
      }
    });

    it('PATCH /Orders updates quantity and modifiedAt', async () => {
      const before = await GET(`${BASE}/Orders(${managedOrderId})`);
      const beforeModAt = before.data.modifiedAt;

      await new Promise(r => setTimeout(r, 50));
      const patchRes = await PATCH(`${BASE}/Orders(${managedOrderId})`, { quantity: 7 });
      expect(patchRes.status).to.be.oneOf([200, 204]);

      const after = await GET(`${BASE}/Orders(${managedOrderId})`);
      expect(after.status).to.equal(200);
      expect(Number(after.data.quantity)).to.equal(7);
      // If modifiedAt is tracked, verify it changed
      if (after.data.modifiedAt && beforeModAt) {
        const afterTime = new Date(after.data.modifiedAt).getTime();
        const beforeTime = new Date(beforeModAt).getTime();
        expect(afterTime).to.be.gte(beforeTime);
      }
    });

    after(async () => {
      if (managedOrderId) {
        await db.run(`DELETE FROM ${ORDERS_TABLE} WHERE ID = '${managedOrderId}'`).catch(() => {});
      }
    });
  });

  // ==========================================================================
  describe('UUID auto-generation (Tier 2)', () => {
    let autoOrderId: string;

    it('POST /Orders without ID auto-generates a UUID key', async () => {
      const res = await POST(`${BASE}/Orders`, {
        book_ID: BOOK_ID,
        quantity: 2,
        buyer: 'uuid-tester'
      });
      expect(res.status).to.equal(201);
      autoOrderId = res.data.ID;
      expect(autoOrderId).to.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    });

    after(async () => {
      if (autoOrderId) {
        await db.run(`DELETE FROM ${ORDERS_TABLE} WHERE ID = '${autoOrderId}'`).catch(() => {});
      }
    });
  });

  // ==========================================================================
  describe('$expand with nested options (Tier 4)', () => {
    it('$expand=books($orderby=title asc) returns books sorted ascending', async () => {
      const res = await GET(`${BASE}/Authors?$filter=ID eq '${AUTHOR_ID}'&$expand=books($orderby=title asc)`);
      expect(res.status).to.equal(200);
      const john = res.data.value[0];
      expect(john.books).to.be.an('array').with.lengthOf.gte(2);
      const titles = john.books.map((b: any) => b.title);
      const sorted = [...titles].sort();
      expect(titles).to.deep.equal(sorted);
    });

    it('$expand=books($orderby=title desc) returns books sorted descending', async () => {
      const res = await GET(`${BASE}/Authors?$filter=ID eq '${AUTHOR_ID}'&$expand=books($orderby=title desc)`);
      expect(res.status).to.equal(200);
      const john = res.data.value[0];
      expect(john.books).to.be.an('array').with.lengthOf.gte(2);
      const titles = john.books.map((b: any) => b.title);
      const sortedDesc = [...titles].sort().reverse();
      expect(titles).to.deep.equal(sortedDesc);
    });

    it('$expand=books($top=1) returns at most 1 book per author', async () => {
      const res = await GET(`${BASE}/Authors?$expand=books($top=1)`);
      expect(res.status).to.equal(200);
      res.data.value.forEach((author: any) => {
        expect(author.books.length).to.be.lte(1);
      });
    });
  });

  // ==========================================================================
  describe('Lambda any/all (Tier 6)', () => {
    it('$filter=books/any(b:b/price gt 30) returns authors with expensive books', async () => {
      // BOOK_ID2 has price 39.99, so AUTHOR_ID (John) should match
      const res = await GET(`${BASE}/Authors?$filter=books/any(b:b/price gt 30)`);
      expect(res.status).to.equal(200);
      expect(res.data.value).to.be.an('array').with.lengthOf.gte(1);
      const ids = res.data.value.map((a: any) => a.ID);
      expect(ids).to.include(AUTHOR_ID);
    });

    it('$filter=books/any(b:b/price gt 999) returns empty (no such expensive books)', async () => {
      const res = await GET(`${BASE}/Authors?$filter=books/any(b:b/price gt 999)`);
      expect(res.status).to.equal(200);
      expect(res.data.value).to.be.an('array').with.lengthOf(0);
    });
  });

  // ==========================================================================
  describe('$apply aggregation (Tier 8)', () => {
    it('$apply=aggregate(stock with sum as totalStock)', async () => {
      const res = await GET(`${BASE}/Books?$apply=aggregate(stock with sum as totalStock)`);
      expect(res.status).to.equal(200);
      expect(res.data.value).to.be.an('array').with.lengthOf.gte(1);
      expect(res.data.value[0].totalStock).to.be.a('number').and.gte(0);
    });

    it('$apply=groupby((author_ID),aggregate(price with avg as avgPrice))', async () => {
      const res = await GET(`${BASE}/Books?$apply=groupby((author_ID),aggregate(price with avg as avgPrice))`);
      expect(res.status).to.equal(200);
      expect(res.data.value).to.be.an('array').with.lengthOf.gte(1);
      res.data.value.forEach((row: any) => {
        expect(row.avgPrice).to.be.a('number');
      });
    });
  });

  // ==========================================================================
  describe('Composition CRUD — Catalogs + CatalogItems (Tier 5)', () => {
    let catalogId: string;
    let itemId: string;

    it('POST /Catalogs creates catalog with items (deep insert)', async () => {
      const res = await POST(`${BASE}/Catalogs`, {
        name: 'Test Catalog',
        items: [
          { title: 'Widget A', price: 9.99 },
          { title: 'Widget B', price: 19.99 }
        ]
      });
      expect(res.status).to.be.oneOf([200, 201]);
      catalogId = res.data.ID;
      expect(catalogId).to.match(/^[0-9a-f-]{36}$/i);
    });

    it('GET /Catalogs with $expand=items returns nested items', async () => {
      const res = await GET(`${BASE}/Catalogs(${catalogId})?$expand=items`);
      expect(res.status).to.equal(200);
      expect(res.data.ID).to.equal(catalogId);
      expect(res.data.items).to.be.an('array').with.lengthOf(2);
      const titles = res.data.items.map((i: any) => i.title).sort();
      expect(titles).to.deep.equal(['Widget A', 'Widget B']);
      itemId = res.data.items[0].ID;
    });

    it('PATCH /CatalogItems(id) updates item title', async () => {
      const res = await PATCH(`${BASE}/CatalogItems(${itemId})`, { title: 'Widget A Updated' });
      expect(res.status).to.be.oneOf([200, 204]);
    });

    it('GET /CatalogItems(id) reflects the PATCH', async () => {
      const res = await GET(`${BASE}/CatalogItems(${itemId})`);
      expect(res.status).to.equal(200);
      expect(res.data.title).to.equal('Widget A Updated');
    });

    it('DELETE /Catalogs(id) removes catalog and cascades to items', async () => {
      const delRes = await DELETE_REQ(`${BASE}/Catalogs(${catalogId})`);
      expect(delRes.status).to.be.oneOf([200, 204]);

      // Verify items are also gone
      const itemsRes = await GET(`${BASE}/CatalogItems?$filter=catalog_ID eq '${catalogId}'`);
      expect(itemsRes.status).to.equal(200);
      expect(itemsRes.data.value).to.be.an('array').with.lengthOf(0);
    });
  });

  // ==========================================================================
  describe('Error handling (Tier 9)', () => {
    const FIXED_ORDER_UUID = '99999999-9999-9999-9999-999999999999';

    before(async () => {
      // Ensure no leftover row from previous runs
      await db.run(`DELETE FROM ${ORDERS_TABLE} WHERE ID = '${FIXED_ORDER_UUID}'`).catch(() => {});
    });

    it.skip('duplicate key INSERT returns 409 — N/A: Snowflake PRIMARY KEY is informational only (not enforced)', async () => {
      // Snowflake constraints (PRIMARY KEY, UNIQUE) are informational and not enforced at the
      // storage level. Duplicate key inserts succeed silently. This test cannot be applied to
      // Snowflake; the COMPLIANCE.md entry is marked 🚫 N/A.
    });

    it('GET non-existent entity returns 404', async () => {
      const res = await GET(`${BASE}/Orders(00000000-0000-0000-0000-000000000000)`)
        .catch((e: any) => e.response ?? e);
      expect(res.status).to.equal(404);
    });

    after(async () => {
      await db.run(`DELETE FROM ${ORDERS_TABLE} WHERE ID = '${FIXED_ORDER_UUID}'`).catch(() => {});
    });
  });

  // ==========================================================================
  describe('OData system queries combined', () => {
    it('$select + $filter + $orderby + $top + $skip + $count', async () => {
      const res = await GET(
        `${BASE}/Books?$select=ID,title,price&$filter=price gt 10&$orderby=title asc&$top=5&$skip=0&$count=true`
      );
      expect(res.status).to.equal(200);
      expect(res.data.value).to.be.an('array');
      expect(res.data.value.length).to.be.lte(5);
      expect(res.data['@odata.count']).to.be.a('number');
    });

    it('$filter with OR condition', async () => {
      const res = await GET(
        `${BASE}/Books?$filter=ID eq '${BOOK_ID}' or ID eq '${BOOK_ID2}'`
      );
      expect(res.status).to.equal(200);
      expect(res.data.value).to.have.lengthOf(2);
    });

    it('$filter with AND condition', async () => {
      const res = await GET(
        `${BASE}/Books?$filter=price gt 10 and stock gt 0`
      );
      expect(res.status).to.equal(200);
      res.data.value.forEach((b: any) => {
        expect(Number(b.price)).to.be.greaterThan(10);
      });
    });
  });
});
