/**
 * Logging utility for the Snowflake adapter
 *
 * Activation (follows standard CDS log conventions):
 *   DEBUG=snowflake-adapter   – all adapter debug output
 *   DEBUG=sql                 – SQL statements + timings only
 *   DEBUG=snowflake-adapter,sql – both
 */
/** Primary adapter logger — activated by DEBUG=snowflake-adapter */
export declare const LOG: {
    trace: (message?: any, ...optionalParams: any[]) => void;
    debug: (message?: any, ...optionalParams: any[]) => void;
    info: (message?: any, ...optionalParams: any[]) => void;
    warn: (message?: any, ...optionalParams: any[]) => void;
    error: (message?: any, ...optionalParams: any[]) => void;
    log: (message?: any, ...optionalParams: any[]) => void;
    _trace: boolean;
    _debug: boolean;
    _info: boolean;
    _warn: boolean;
    _error: boolean;
    setFormat(formatter: (module: string, level: number, args: any[]) => any[]): any;
};
/**
 * Dedicated SQL logger — activated by DEBUG=sql.
 * Follows the same component name used by @cap-js/db-service so that
 * the familiar `DEBUG=sql` env var shows SQL from all CAP DB adapters.
 */
export declare const LOG_SQL: {
    trace: (message?: any, ...optionalParams: any[]) => void;
    debug: (message?: any, ...optionalParams: any[]) => void;
    info: (message?: any, ...optionalParams: any[]) => void;
    warn: (message?: any, ...optionalParams: any[]) => void;
    error: (message?: any, ...optionalParams: any[]) => void;
    log: (message?: any, ...optionalParams: any[]) => void;
    _trace: boolean;
    _debug: boolean;
    _info: boolean;
    _warn: boolean;
    _error: boolean;
    setFormat(formatter: (module: string, level: number, args: any[]) => any[]): any;
};
/**
 * Log SQL statement and optional timing.
 * Uses LOG_SQL (DEBUG=sql) for the statement and LOG (DEBUG=snowflake-adapter)
 * as fallback, consistent with other CAP adapters.
 *
 * Params are shown as their count only — never their values — to avoid
 * leaking PII in logs.
 */
export declare function logSQL(sql: string, params?: any[], timing?: number): void;
/**
 * Log a debug message guarded by LOG._debug (DEBUG=snowflake-adapter).
 * Use for adapter internals: CQN input, row counts, branching decisions.
 * Pass a thunk as `details` to defer expensive serialisation until needed.
 */
export declare function logDebug(message: string, details?: any | (() => any)): void;
export declare function logWarning(message: string, details?: any): void;
export declare function logError(message: string, error: any): void;
export declare function logInfo(message: string, details?: any): void;
//# sourceMappingURL=logger.d.ts.map