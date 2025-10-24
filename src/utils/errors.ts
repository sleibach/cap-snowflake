/**
 * Error normalization for Snowflake errors
 */

export class SnowflakeError extends Error {
  code: string;
  sqlState?: string;
  statusCode?: number;

  constructor(message: string, code: string, sqlState?: string, statusCode?: number) {
    super(message);
    this.name = 'SnowflakeError';
    this.code = code;
    this.sqlState = sqlState;
    this.statusCode = statusCode;
  }
}

/**
 * Normalize Snowflake errors to CAP error format
 */
export function normalizeError(error: any): Error {
  if (error instanceof SnowflakeError) {
    return error;
  }

  // Snowflake SDK error
  if (error.code && error.sqlState) {
    const statusCode = mapSQLStateToHTTP(error.sqlState);
    return new SnowflakeError(
      error.message || 'Unknown Snowflake error',
      error.code,
      error.sqlState,
      statusCode
    );
  }

  // HTTP error from SQL API
  if (error.response) {
    const data = error.response.data;
    return new SnowflakeError(
      data?.message || error.message || 'Snowflake SQL API error',
      data?.code || 'SNOWFLAKE_API_ERROR',
      data?.sqlState,
      error.response.status
    );
  }

  // Generic error
  return error;
}

/**
 * Map SQL state codes to HTTP status codes
 */
function mapSQLStateToHTTP(sqlState: string): number {
  // SQL state classes
  const stateClass = sqlState.substring(0, 2);

  switch (stateClass) {
    case '02': // No data
      return 404;
    case '23': // Integrity constraint violation
      return 409;
    case '28': // Invalid authorization
      return 401;
    case '42': // Syntax error or access rule violation
      return 400;
    case '53': // Insufficient resources
      return 503;
    case '08': // Connection exception
      return 503;
    default:
      return 500;
  }
}

/**
 * Check if error is retryable
 */
export function isRetryableError(error: any): boolean {
  if (error instanceof SnowflakeError) {
    // Retry on 429 (rate limit) or 5xx errors
    if (error.statusCode === 429 || (error.statusCode && error.statusCode >= 500)) {
      return true;
    }
  }

  // Connection errors
  if (error.code === 'ECONNREFUSED' || error.code === 'ETIMEDOUT') {
    return true;
  }

  return false;
}

