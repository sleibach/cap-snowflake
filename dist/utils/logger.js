/**
 * Logging utility for the Snowflake adapter
 *
 * Activation (follows standard CDS log conventions):
 *   DEBUG=snowflake-adapter   – all adapter debug output
 *   DEBUG=sql                 – SQL statements + timings only
 *   DEBUG=snowflake-adapter,sql – both
 */
import cds from '@sap/cds';
/** Primary adapter logger — activated by DEBUG=snowflake-adapter */
export const LOG = cds.log('snowflake-adapter');
/**
 * Dedicated SQL logger — activated by DEBUG=sql.
 * Follows the same component name used by @cap-js/db-service so that
 * the familiar `DEBUG=sql` env var shows SQL from all CAP DB adapters.
 */
export const LOG_SQL = cds.log('sql');
const SENSITIVE_KEYS = new Set(['privateKey', 'password', 'privateKeyPassphrase']);
function scrubCredentials(details) {
    if (!details || typeof details !== 'object')
        return details;
    if (Array.isArray(details))
        return details.map(scrubCredentials);
    const out = {};
    for (const [k, v] of Object.entries(details)) {
        out[k] = SENSITIVE_KEYS.has(k) ? '[REDACTED]' : scrubCredentials(v);
    }
    return out;
}
/**
 * Log SQL statement and optional timing.
 * Uses LOG_SQL (DEBUG=sql) for the statement and LOG (DEBUG=snowflake-adapter)
 * as fallback, consistent with other CAP adapters.
 *
 * Params are shown as their count only — never their values — to avoid
 * leaking PII in logs.
 */
export function logSQL(sql, params, timing) {
    if (LOG_SQL._debug || LOG._debug) {
        const logger = LOG_SQL._debug ? LOG_SQL : LOG;
        const paramInfo = params?.length ? ` [${params.length} param${params.length !== 1 ? 's' : ''}]` : '';
        logger.debug(`> ${sql}${paramInfo}`);
        if (timing !== undefined && timing > 0) {
            logger.debug(`  ${timing}ms`);
        }
    }
}
/**
 * Log a debug message guarded by LOG._debug (DEBUG=snowflake-adapter).
 * Use for adapter internals: CQN input, row counts, branching decisions.
 * Pass a thunk as `details` to defer expensive serialisation until needed.
 */
export function logDebug(message, details) {
    if (LOG._debug) {
        const resolved = typeof details === 'function' ? details() : details;
        const scrubbed = scrubCredentials(resolved);
        if (scrubbed !== undefined) {
            LOG.debug(message, scrubbed);
        }
        else {
            LOG.debug(message);
        }
    }
}
export function logWarning(message, details) {
    const scrubbed = scrubCredentials(details);
    if (scrubbed !== undefined) {
        LOG.warn(message, scrubbed);
    }
    else {
        LOG.warn(message);
    }
}
export function logError(message, error) {
    LOG.error(message, scrubCredentials(error));
}
export function logInfo(message, details) {
    const scrubbed = scrubCredentials(details);
    if (scrubbed !== undefined) {
        LOG.info(message, scrubbed);
    }
    else {
        LOG.info(message);
    }
}
//# sourceMappingURL=logger.js.map