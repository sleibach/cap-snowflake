import { expect } from 'chai';
import cds from '@sap/cds';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SnowflakeSQLAPIClient } from '../../src/client/sqlapi.js';

const RUN_LIVE = process.env.SNOWFLAKE_TEST === 'true';
const RUN_SMOKE = process.env.SNOWFLAKE_E2E_SMOKE === 'true';
const FIXTURE_DIR = `${process.cwd()}/test/e2e/fixtures`;
const HAS_PRIVATE_CONFIG = existsSync(join(FIXTURE_DIR, '.cdsrc-private.json'));
const RUN_E2E = RUN_LIVE || RUN_SMOKE || HAS_PRIVATE_CONFIG;

let GET: any;
let POST: any;
const AUTHORS_TABLE = 'CAP_E2E_DB.APP.CAP_E2E_AUTHORS';
const BOOKS_TABLE = 'CAP_E2E_DB.APP.CAP_E2E_BOOKS';
const ORDERS_TABLE = 'CAP_E2E_DB.APP.CAP_E2E_ORDERS';
const LOCALIZED_TABLE = 'CAP_E2E_DB.APP.CAP_E2E_LOCALIZED_BOOKS';
const LOCALIZED_TEXTS_TABLE = 'CAP_E2E_DB.APP.CAP_E2E_LOCALIZED_BOOKS_texts';
const WORK_ASSIGNMENTS_TABLE = 'CAP_E2E_DB.APP.CAP_E2E_WORK_ASSIGNMENTS';
const AUTHOR_ID = '11111111-1111-1111-1111-111111111111';
const BOOK_ID = '22222222-2222-2222-2222-222222222222';
const LOCALIZED_BOOK_ID = '33333333-3333-3333-3333-333333333333';
const WORK_ASSIGNMENT_ID = '44444444-4444-4444-4444-444444444444';

before(function () {
  this.timeout(60000);
});

function resolveEnvRefs(value: any): any {
  if (Array.isArray(value)) {
    return value.map(resolveEnvRefs);
  }
  if (value && typeof value === 'object') {
    const out: any = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = resolveEnvRefs(v);
    }
    return out;
  }
  if (typeof value === 'string' && value.startsWith('env:')) {
    const envName = value.slice(4);
    return process.env[envName];
  }
  return value;
}

if (RUN_E2E) {
  await import('../../dist/index.js');
  const privateConfigPath = join(FIXTURE_DIR, '.cdsrc-private.json');
  const privateConfigRaw = readFileSync(privateConfigPath, 'utf8');
  const privateConfig = JSON.parse(privateConfigRaw);
  const dbConfig = resolveEnvRefs(privateConfig?.cds?.requires?.db);
  if (!dbConfig) {
    throw new Error(`Missing cds.requires.db in ${privateConfigPath}`);
  }

  cds.env.requires.db = dbConfig;

  const test = cds.test(FIXTURE_DIR);
  GET = test.GET;
  POST = test.POST;
}

async function setupSchema(db: any) {
  await db.run(`CREATE TABLE IF NOT EXISTS ${AUTHORS_TABLE} (
    ID VARCHAR(36) PRIMARY KEY,
    NAME VARCHAR(100) NOT NULL,
    COUNTRY VARCHAR(2),
    CREATEDAT TIMESTAMP_NTZ,
    CREATEDBY VARCHAR(100),
    MODIFIEDAT TIMESTAMP_NTZ,
    MODIFIEDBY VARCHAR(100)
  )`);

  await db.run(`CREATE TABLE IF NOT EXISTS ${BOOKS_TABLE} (
    ID VARCHAR(36) PRIMARY KEY,
    TITLE VARCHAR(120) NOT NULL,
    AUTHOR_ID VARCHAR(36),
    PRICE NUMBER(10,2),
    STOCK NUMBER(38,0),
    DESCRIPTION TEXT,
    CREATEDAT TIMESTAMP_NTZ,
    CREATEDBY VARCHAR(100),
    MODIFIEDAT TIMESTAMP_NTZ,
    MODIFIEDBY VARCHAR(100)
  )`);

  await db.run(`CREATE TABLE IF NOT EXISTS ${ORDERS_TABLE} (
    ID VARCHAR(36) PRIMARY KEY,
    BOOK_ID VARCHAR(36),
    QUANTITY NUMBER(38,0) NOT NULL,
    BUYER VARCHAR(100),
    TOTAL NUMBER(10,2),
    CREATEDAT TIMESTAMP_NTZ,
    CREATEDBY VARCHAR(100),
    MODIFIEDAT TIMESTAMP_NTZ,
    MODIFIEDBY VARCHAR(100)
  )`);

  await db.run(`CREATE TABLE IF NOT EXISTS ${LOCALIZED_TABLE} (
    ID VARCHAR(36) PRIMARY KEY,
    TITLE VARCHAR(120),
    DESCRIPTION TEXT,
    CREATEDAT TIMESTAMP_NTZ,
    CREATEDBY VARCHAR(100),
    MODIFIEDAT TIMESTAMP_NTZ,
    MODIFIEDBY VARCHAR(100)
  )`);

  await db.run(`CREATE TABLE IF NOT EXISTS ${LOCALIZED_TEXTS_TABLE} (
    locale VARCHAR(14) NOT NULL,
    ID VARCHAR(36) NOT NULL,
    title VARCHAR(120),
    description TEXT,
    PRIMARY KEY (locale, ID)
  )`);

  await db.run(`CREATE TABLE IF NOT EXISTS ${WORK_ASSIGNMENTS_TABLE} (
    ID VARCHAR(36) NOT NULL,
    EMPLOYEE VARCHAR(100),
    ROLE VARCHAR(100),
    DEPARTMENT VARCHAR(100),
    VALIDFROM TIMESTAMP_NTZ NOT NULL,
    VALIDTO TIMESTAMP_NTZ NOT NULL,
    PRIMARY KEY (ID, VALIDFROM)
  )`);
}

async function seedData(db: any) {
  await db.run(`DELETE FROM ${ORDERS_TABLE}`);
  await db.run(`DELETE FROM ${BOOKS_TABLE}`);
  await db.run(`DELETE FROM ${AUTHORS_TABLE}`);
  await db.run(`DELETE FROM ${LOCALIZED_TEXTS_TABLE}`);
  await db.run(`DELETE FROM ${LOCALIZED_TABLE}`);
  await db.run(`DELETE FROM ${WORK_ASSIGNMENTS_TABLE}`);

  await db.run(`INSERT INTO ${AUTHORS_TABLE} (ID, NAME, COUNTRY) VALUES ('${AUTHOR_ID}', 'John Doe', 'DE')`);
  await db.run(`INSERT INTO ${BOOKS_TABLE} (ID, TITLE, AUTHOR_ID, PRICE, STOCK, DESCRIPTION) VALUES ('${BOOK_ID}', 'Adapter Patterns', '${AUTHOR_ID}', 29.99, 7, 'Guide to CAP adapters')`);
  await db.run(`INSERT INTO ${LOCALIZED_TABLE} (ID, TITLE, DESCRIPTION) VALUES ('${LOCALIZED_BOOK_ID}', 'Default title', 'Default description')`);
  await db.run(`INSERT INTO ${LOCALIZED_TEXTS_TABLE} (locale, ID, title, description) VALUES ('de', '${LOCALIZED_BOOK_ID}', 'Titel Deutsch', 'Beschreibung Deutsch')`);
  await db.run(`INSERT INTO ${WORK_ASSIGNMENTS_TABLE} (ID, EMPLOYEE, ROLE, DEPARTMENT, VALIDFROM, VALIDTO) VALUES ('${WORK_ASSIGNMENT_ID}', 'Alice', 'Engineer', 'Platform', '2020-01-01T00:00:00Z', '2099-12-31T23:59:59Z')`);
}

async function seedDataDirect(credentials: any) {
  const client = new SnowflakeSQLAPIClient(credentials);
  const statements = [
    `DELETE FROM ${ORDERS_TABLE}`,
    `DELETE FROM ${BOOKS_TABLE}`,
    `DELETE FROM ${AUTHORS_TABLE}`,
    `DELETE FROM ${LOCALIZED_TEXTS_TABLE}`,
    `DELETE FROM ${LOCALIZED_TABLE}`,
    `DELETE FROM ${WORK_ASSIGNMENTS_TABLE}`,
    `INSERT INTO ${AUTHORS_TABLE} (ID, NAME, COUNTRY) VALUES ('${AUTHOR_ID}', 'John Doe', 'DE')`,
    `INSERT INTO ${BOOKS_TABLE} (ID, TITLE, AUTHOR_ID, PRICE, STOCK, DESCRIPTION) VALUES ('${BOOK_ID}', 'Adapter Patterns', '${AUTHOR_ID}', 29.99, 7, 'Guide to CAP adapters')`,
    `INSERT INTO ${LOCALIZED_TABLE} (ID, TITLE, DESCRIPTION) VALUES ('${LOCALIZED_BOOK_ID}', 'Default title', 'Default description')`,
    `INSERT INTO ${LOCALIZED_TEXTS_TABLE} (locale, ID, title, description) VALUES ('de', '${LOCALIZED_BOOK_ID}', 'Titel Deutsch', 'Beschreibung Deutsch')`,
    `INSERT INTO ${WORK_ASSIGNMENTS_TABLE} (ID, EMPLOYEE, ROLE, DEPARTMENT, VALIDFROM, VALIDTO) VALUES ('${WORK_ASSIGNMENT_ID}', 'Alice', 'Engineer', 'Platform', '2020-01-01T00:00:00Z', '2099-12-31T23:59:59Z')`
  ];
  for (const sql of statements) {
    await client.execute(sql);
  }
}

(RUN_E2E ? describe : describe.skip)('CAP HTTP E2E (Snowflake)', function () {
  this.timeout(60000);
  const BASE_PATH = '/odata/v4/e2-etest';

  let db: any;

  before(async () => {
    db = await cds.connect.to('db');
    await setupSchema(db);
    await seedData(db);
    const creds = cds.env.requires.db?.credentials;
    await seedDataDirect(creds);
  });

  after(async () => {
    if (db?.disconnect) {
      await db.disconnect();
    }
  });

  it('reads books with query options', async () => {
    const res = await GET(`${BASE_PATH}/Books?$select=ID,title,price&$filter=price gt 10&$orderby=title asc&$top=5&$skip=0&$count=true`);
    expect(res.status).to.equal(200);
    expect(res.data.value).to.be.an('array');
    expect(res.data.value.length).to.be.greaterThan(0);
  });

  it('expands to-one association', async () => {
    const res = await GET(`${BASE_PATH}/Books?$select=ID,title&$expand=author($select=ID,name)`);
    expect(res.status).to.equal(200);
    expect(res.data.value[0]).to.have.property('author');
  });

  it('executes submitOrder action end-to-end', async () => {
    const actionRes = await POST(`${BASE_PATH}/submitOrder`, { book: BOOK_ID, quantity: 2 });
    expect(actionRes.status).to.equal(200);

    const booksRes = await GET(`${BASE_PATH}/Books?$select=ID,stock&$filter=ID eq '${BOOK_ID}'`);
    expect(booksRes.status).to.equal(200);
    expect(Number(booksRes.data.value[0].stock)).to.be.greaterThan(0);
  });

  it('reads localized entity with locale header', async () => {
    const res = await GET(`${BASE_PATH}/LocalizedBooks`, {
      headers: { 'Accept-Language': 'de' }
    });
    expect(res.status).to.equal(200);
    expect(res.data.value[0]).to.have.property('title');
  });

  it('reads temporal entity with explicit validity filter', async () => {
    const res = await GET(`${BASE_PATH}/WorkAssignments?$filter=validFrom le 2099-01-01T00:00:00Z and validTo gt 2021-01-01T00:00:00Z`);
    expect(res.status).to.equal(200);
    expect(res.data.value.length).to.be.greaterThan(0);
  });
});
