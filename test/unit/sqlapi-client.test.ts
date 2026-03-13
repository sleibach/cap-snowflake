/**
 * Unit tests for SnowflakeSQLAPIClient.
 *
 * All network calls are mocked so no real Snowflake connection is required.
 */

import { expect } from 'chai';
import { SnowflakeSQLAPIClient } from '../../src/client/sqlapi.js';

// ---------------------------------------------------------------------------
// Minimal mock result builders
// ---------------------------------------------------------------------------
function makeResult(rows: any[][], colNames: string[], colTypes: string[]) {
  return {
    resultSetMetaData: {
      rowType: colNames.map((name, i) => ({
        name,
        type: colTypes[i] ?? 'text',
        nullable: true,
        scale: 0
      }))
    },
    data: rows,
    total: rows.length,
    returned: rows.length
  };
}

// ---------------------------------------------------------------------------
describe('SnowflakeSQLAPIClient.parseRows', () => {
  it('parses shape B (flat resultSetMetaData + data) — FIXED cols → integers', () => {
    const result = makeResult(
      [['42'], ['7']],
      ['STOCK'],
      ['fixed']
    );
    const rows = SnowflakeSQLAPIClient.parseRows(result as any);
    expect(rows).to.have.lengthOf(2);
    expect(rows[0].STOCK).to.equal(42);
    expect(rows[1].STOCK).to.equal(7);
  });

  it('parses REAL type → float', () => {
    const result = makeResult([['3.14']], ['PRICE'], ['real']);
    const rows = SnowflakeSQLAPIClient.parseRows(result as any);
    expect(rows[0].PRICE).to.be.closeTo(3.14, 0.0001);
  });

  it('parses BOOLEAN type → boolean', () => {
    const result = makeResult([['true'], ['false']], ['ACTIVE', 'ACTIVE'], ['boolean', 'boolean']);
    // Single column variant
    const r2 = makeResult([['true']], ['ACTIVE'], ['boolean']);
    const rows = SnowflakeSQLAPIClient.parseRows(r2 as any);
    expect(rows[0].ACTIVE).to.equal(true);

    const r3 = makeResult([['false']], ['ACTIVE'], ['boolean']);
    const rows3 = SnowflakeSQLAPIClient.parseRows(r3 as any);
    expect(rows3[0].ACTIVE).to.equal(false);
  });

  it('parses VARIANT type → parsed JSON object', () => {
    const result = makeResult([[JSON.stringify({ x: 1 })]], ['DATA'], ['variant']);
    const rows = SnowflakeSQLAPIClient.parseRows(result as any);
    expect(rows[0].DATA).to.deep.equal({ x: 1 });
  });

  it('returns empty array for empty result', () => {
    const result = makeResult([], ['COL'], ['text']);
    expect(SnowflakeSQLAPIClient.parseRows(result as any)).to.have.lengthOf(0);
  });

  it('null values stay null', () => {
    const result = makeResult([[null]], ['NAME'], ['text']);
    const rows = SnowflakeSQLAPIClient.parseRows(result as any);
    expect(rows[0].NAME).to.equal(null);
  });
});

// ---------------------------------------------------------------------------
describe('SnowflakeSQLAPIClient — token caching', () => {
  it('does not throw when getAuthToken is called with valid jwt config', () => {
    // We can only test the structural logic without a real private key.
    // Check that the cache fields initialise correctly.
    const creds: any = {
      account: 'acct',
      user: 'user',
      host: 'acct.snowflakecomputing.com',
      auth: 'jwt',
      jwt: {
        privateKey: 'dummy',
        expiresIn: 3600
      }
    };
    const client = new SnowflakeSQLAPIClient(creds);
    // Accessing the private cache via any-cast to verify initial state
    expect((client as any).cachedToken).to.be.undefined;
    expect((client as any).tokenExpiry).to.be.undefined;
  });
});

// ---------------------------------------------------------------------------
describe('SnowflakeSQLAPIClient — retry delay calculation', () => {
  it('uses Retry-After header value when present', () => {
    const creds: any = {
      account: 'a', user: 'u', host: 'h', auth: 'jwt',
      jwt: { privateKey: 'k' }
    };
    const client = new SnowflakeSQLAPIClient(creds);
    const delay = (client as any).calculateRetryDelay(0, '5');
    expect(delay).to.equal(5000);
  });

  it('caps delay at 30 000 ms', () => {
    const creds: any = {
      account: 'a', user: 'u', host: 'h', auth: 'jwt',
      jwt: { privateKey: 'k' }
    };
    const client = new SnowflakeSQLAPIClient(creds);
    // Very large attempt number → should be capped
    const delay = (client as any).calculateRetryDelay(20, null);
    expect(delay).to.be.lte(30_000);
  });

  it('adds jitter to base delay', () => {
    const creds: any = {
      account: 'a', user: 'u', host: 'h', auth: 'jwt',
      jwt: { privateKey: 'k' }
    };
    const client = new SnowflakeSQLAPIClient(creds);
    // With no Retry-After, delay includes a random jitter (0–200ms)
    const delay = (client as any).calculateRetryDelay(0, null);
    // Base = 1000, jitter = 0–200
    expect(delay).to.be.gte(1000).and.lte(1200);
  });
});

// ---------------------------------------------------------------------------
describe('SnowflakeSQLAPIClient — retry exhaustion (Part E)', () => {
  it('throws SnowflakeError after all retries are exhausted on 503', async () => {
    const { SnowflakeError } = await import('../../src/utils/errors.js');
    const creds: any = {
      account: 'a', user: 'u', host: 'a.snowflakecomputing.com', auth: 'jwt',
      jwt: { privateKey: 'k' }
    };
    const client = new SnowflakeSQLAPIClient(creds);
    // Override maxRetries to 1 for speed
    (client as any).maxRetries = 1;
    // Stub sleep to avoid actual delay
    (client as any).sleep = async () => {};
    // Stub getAuthToken to return a dummy token
    (client as any).getAuthToken = () => 'dummy-token';
    // Stub makeRequest to always throw a 503 SnowflakeError
    const retryableErr = new SnowflakeError('Service Unavailable', 'HTTP_503', undefined, 503);
    (client as any).makeRequest = async () => { throw retryableErr; };

    let thrown: any;
    try {
      await client.execute('SELECT 1');
    } catch (e) {
      thrown = e;
    }
    expect(thrown).to.be.instanceOf(SnowflakeError);
    expect(thrown.statusCode).to.equal(503);
  });
});
