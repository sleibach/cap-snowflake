/**
 * Logging utility for the Snowflake adapter
 */

import cds from '@sap/cds';

export const LOG = cds.log('snowflake-adapter');

const SENSITIVE_KEYS = new Set(['privateKey', 'password', 'privateKeyPassphrase']);

function scrubCredentials(details: any): any {
  if (!details || typeof details !== 'object') return details;
  if (Array.isArray(details)) return details.map(scrubCredentials);
  const out: any = {};
  for (const [k, v] of Object.entries(details)) {
    out[k] = SENSITIVE_KEYS.has(k) ? '[REDACTED]' : scrubCredentials(v);
  }
  return out;
}

export function logSQL(sql: string, params?: any[], timing?: number) {
  if (LOG.debug) {
    const redacted = params?.map(() => '?').join(', ') || '';
    LOG.debug(`SQL: ${sql}`, redacted ? `[${redacted}]` : '');
    if (timing) {
      LOG.debug(`Query executed in ${timing}ms`);
    }
  }
}

export function logWarning(message: string, details?: any) {
  const scrubbed = scrubCredentials(details);
  if (scrubbed !== undefined) {
    LOG.warn(message, scrubbed);
  } else {
    LOG.warn(message);
  }
}

export function logError(message: string, error: any) {
  LOG.error(message, scrubCredentials(error));
}

export function logInfo(message: string, details?: any) {
  const scrubbed = scrubCredentials(details);
  if (scrubbed !== undefined) {
    LOG.info(message, scrubbed);
  } else {
    LOG.info(message);
  }
}

