/**
 * Unit tests for configuration validation.
 */

import { expect } from 'chai';
import cds from '@sap/cds';

// Helper to call getSnowflakeConfig with a given db config
async function withConfig(db: any, fn: () => void) {
  const original = cds.env.requires?.db;
  try {
    if (!cds.env.requires) cds.env.requires = {};
    cds.env.requires.db = db;
    fn();
  } finally {
    cds.env.requires.db = original;
  }
}

describe('getSnowflakeConfig', () => {
  let getSnowflakeConfig: any;

  before(async () => {
    ({ getSnowflakeConfig } = await import('../../src/config.js'));
  });

  it('throws when account is missing', async () => {
    await withConfig(
      { kind: 'snowflake', credentials: { user: 'u', auth: 'sdk', password: 'p' } },
      () => expect(() => getSnowflakeConfig()).to.throw(/account/i)
    );
  });

  it('throws when user is missing', async () => {
    await withConfig(
      { kind: 'snowflake', credentials: { account: 'a', auth: 'sdk', password: 'p' } },
      () => expect(() => getSnowflakeConfig()).to.throw(/user/i)
    );
  });

  it('throws for invalid auth value', async () => {
    await withConfig(
      { kind: 'snowflake', credentials: { account: 'a', user: 'u', auth: 'magic' } },
      () => expect(() => getSnowflakeConfig()).to.throw(/auth/i)
    );
  });

  it('throws for jwt without privateKey', async () => {
    await withConfig(
      { kind: 'snowflake', credentials: { account: 'a', user: 'u', auth: 'jwt', jwt: {} } },
      () => expect(() => getSnowflakeConfig()).to.throw(/privateKey/i)
    );
  });

  it('throws for sdk without password', async () => {
    await withConfig(
      { kind: 'snowflake', credentials: { account: 'a', user: 'u', auth: 'sdk' } },
      () => expect(() => getSnowflakeConfig()).to.throw(/password/i)
    );
  });

  it('resolves env: references in privateKey', async () => {
    process.env.TEST_PRIVATE_KEY = 'my-key-value';
    await withConfig(
      {
        kind: 'snowflake',
        credentials: {
          account: 'a', user: 'u', auth: 'jwt',
          jwt: { privateKey: 'env:TEST_PRIVATE_KEY' }
        }
      },
      () => {
        const cfg = getSnowflakeConfig();
        expect(cfg.credentials.jwt.privateKey).to.equal('my-key-value');
      }
    );
    delete process.env.TEST_PRIVATE_KEY;
  });

  it('applies default host when absent', async () => {
    await withConfig(
      {
        kind: 'snowflake',
        credentials: { account: 'myaccount', user: 'u', auth: 'sdk', password: 'p' }
      },
      () => {
        const cfg = getSnowflakeConfig();
        expect(cfg.credentials.host).to.equal('myaccount.snowflakecomputing.com');
      }
    );
  });

  it('applies default timeout of 60 when absent', async () => {
    await withConfig(
      {
        kind: 'snowflake',
        credentials: { account: 'a', user: 'u', auth: 'sdk', password: 'p' }
      },
      () => {
        const cfg = getSnowflakeConfig();
        expect(cfg.credentials.timeout).to.equal(60);
      }
    );
  });
});
