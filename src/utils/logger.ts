/**
 * Logging utility for the Snowflake adapter
 */

import cds from '@sap/cds';

export const LOG = cds.log('snowflake-adapter');

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
  LOG.warn(message, details);
}

export function logError(message: string, error: any) {
  LOG.error(message, error);
}

export function logInfo(message: string, details?: any) {
  LOG.info(message, details);
}

