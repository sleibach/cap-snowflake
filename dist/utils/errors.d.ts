/**
 * Error normalization for Snowflake errors
 */
export declare class SnowflakeError extends Error {
    code: string;
    sqlState?: string;
    statusCode?: number;
    /** CAP-compatible HTTP status (alias for statusCode) */
    status?: number;
    constructor(message: string, code: string, sqlState?: string, statusCode?: number);
}
/**
 * Normalize Snowflake errors to CAP error format
 */
export declare function normalizeError(error: any): Error;
/**
 * Check if a Snowflake error indicates that an object already exists.
 * Uses Snowflake error code 002002 as the primary signal; falls back to
 * message text for errors that bypass the SDK normalisation path.
 */
export declare function isAlreadyExistsError(error: unknown): boolean;
/**
 * Check if error is retryable
 */
export declare function isRetryableError(error: any): boolean;
//# sourceMappingURL=errors.d.ts.map