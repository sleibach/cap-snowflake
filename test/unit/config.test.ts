/**
 * Unit tests for configuration validation.
 */

import { expect } from 'chai';
import cds from '@sap/cds';

const validCreds = { account: 'a', user: 'u', auth: 'sdk', password: 'p' };

// Helper: temporarily set cds.env.requires.db and call fn
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

// Helper: temporarily set an arbitrary requires key and call fn
async function withRequires(key: string, cfg: any, fn: () => void) {
  const originalRequires = cds.env.requires;
  try {
    cds.env.requires = { ...originalRequires, [key]: cfg };
    fn();
  } finally {
    cds.env.requires = originalRequires;
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

  it('resolves named service by serviceName (custom key)', async () => {
    await withRequires('mydb', { kind: 'snowflake', credentials: { ...validCreds } }, () => {
      const cfg = getSnowflakeConfig('mydb');
      expect(cfg.credentials.account).to.equal('a');
    });
  });

  it('named service takes precedence over db fallback', async () => {
    const originalDb = cds.env.requires?.db;
    try {
      if (!cds.env.requires) cds.env.requires = {};
      cds.env.requires.db = { kind: 'snowflake', credentials: { ...validCreds, account: 'fallback' } };
      await withRequires('primary', { kind: 'snowflake', credentials: { ...validCreds, account: 'named' } }, () => {
        const cfg = getSnowflakeConfig('primary');
        expect(cfg.credentials.account).to.equal('named');
      });
    } finally {
      if (cds.env.requires) cds.env.requires.db = originalDb;
    }
  });

  it('dynamic discovery finds arbitrary-named snowflake service', async () => {
    await withRequires('customDataStore', { kind: 'snowflake', credentials: { ...validCreds } }, () => {
      // No serviceName passed — should discover via kind scan
      const cfg = getSnowflakeConfig();
      expect(cfg.credentials.account).to.equal('a');
    });
  });

  it('throws when no snowflake service is configured', async () => {
    const original = cds.env.requires;
    try {
      cds.env.requires = { someOtherService: { kind: 'hana' } } as any;
      expect(() => getSnowflakeConfig()).to.throw(/not found/i);
    } finally {
      cds.env.requires = original;
    }
  });
});
