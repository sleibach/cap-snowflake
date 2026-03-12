/**
 * Unit tests for error normalization and HTTP status mapping.
 */

import { expect } from 'chai';
import { SnowflakeError, normalizeError, isRetryableError } from '../../src/utils/errors.js';

describe('SnowflakeError', () => {
  it('sets status as alias for statusCode', () => {
    const err = new SnowflakeError('msg', 'CODE', '23000', 409);
    expect(err.statusCode).to.equal(409);
    expect((err as any).status).to.equal(409);
  });
});

describe('normalizeError — SQL state HTTP mapping', () => {
  function fromSQLState(sqlState: string): SnowflakeError {
    const err = normalizeError({ code: 'SF_ERR', sqlState, message: 'test' });
    expect(err).to.be.instanceOf(SnowflakeError);
    return err as SnowflakeError;
  }

  it('23xxx → 409 Conflict', () => {
    expect(fromSQLState('23000').statusCode).to.equal(409);
  });

  it('42xxx → 400 Bad Request', () => {
    expect(fromSQLState('42000').statusCode).to.equal(400);
  });

  it('28xxx → 401 Unauthorized', () => {
    expect(fromSQLState('28000').statusCode).to.equal(401);
  });

  it('02xxx → 404 Not Found', () => {
    expect(fromSQLState('02000').statusCode).to.equal(404);
  });

  it('unknown state → 500', () => {
    expect(fromSQLState('99000').statusCode).to.equal(500);
  });

  it('passes through existing SnowflakeError unchanged', () => {
    const original = new SnowflakeError('original', 'CODE', '23000', 409);
    const result = normalizeError(original);
    expect(result).to.equal(original);
  });

  it('passes through generic Error unchanged', () => {
    const err = new Error('generic');
    const result = normalizeError(err);
    expect(result).to.equal(err);
  });
});

describe('isRetryableError', () => {
  it('returns true for ECONNREFUSED', () => {
    expect(isRetryableError({ code: 'ECONNREFUSED' })).to.be.true;
  });

  it('returns true for ETIMEDOUT', () => {
    expect(isRetryableError({ code: 'ETIMEDOUT' })).to.be.true;
  });

  it('returns true for HTTP 429', () => {
    const err = new SnowflakeError('rate limit', 'RATE_LIMIT', undefined, 429);
    expect(isRetryableError(err)).to.be.true;
  });

  it('returns true for 503', () => {
    const err = new SnowflakeError('service unavailable', 'SVC', undefined, 503);
    expect(isRetryableError(err)).to.be.true;
  });

  it('returns false for 404', () => {
    const err = new SnowflakeError('not found', 'NF', '02000', 404);
    expect(isRetryableError(err)).to.be.false;
  });

  it('returns false for generic error', () => {
    expect(isRetryableError(new Error('generic'))).to.be.false;
  });
});
