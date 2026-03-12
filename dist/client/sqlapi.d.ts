/**
 * Snowflake SQL API client (HTTP-based)
 */
import { SnowflakeCredentials } from '../config.js';
export interface SQLAPIResult {
    resultSetMetaData: {
        rowType: Array<{
            name: string;
            type: string;
            nullable: boolean;
            scale?: number;
            precision?: number;
        }>;
    };
    data: any[][];
    total: number;
    returned: number;
}
export interface SQLAPIResponse {
    resultSetMetaData?: SQLAPIResult['resultSetMetaData'] & {
        numRows?: number;
    };
    data?: SQLAPIResult['data'] | SQLAPIResult;
    returned?: number;
    total?: number;
    statementHandle?: string;
    message?: string;
    code?: string;
    sqlState?: string;
}
/**
 * Snowflake SQL API Client
 */
export declare class SnowflakeSQLAPIClient {
    private credentials;
    private baseURL;
    private maxRetries;
    private retryDelay;
    private cachedToken?;
    private tokenExpiry?;
    constructor(credentials: SnowflakeCredentials);
    /**
     * Execute a SQL statement
     */
    execute(sql: string, binds?: any[]): Promise<SQLAPIResult>;
    /**
     * Execute multiple statements in sequence
     */
    executeMany(statements: Array<{
        sql: string;
        binds?: any[];
    }>): Promise<SQLAPIResult[]>;
    /**
     * Stream query results in chunks using LIMIT/OFFSET paging.
     */
    queryStream(sql: string, binds?: any[], options?: {
        batchSize?: number;
    }): AsyncGenerator<any, void, unknown>;
    /**
     * Make HTTP request to SQL API
     */
    private makeRequest;
    private normalizeResult;
    /**
     * Get authentication token — cached until 30 s before expiry.
     */
    private getAuthToken;
    /**
     * Format bindings for SQL API
     */
    private formatBindings;
    /**
     * Format value for SQL API
     */
    private formatValue;
    private inferBindingType;
    /**
     * Calculate retry delay with exponential back-off, jitter, and Retry-After header support.
     */
    private calculateRetryDelay;
    /**
     * Sleep utility
     */
    private sleep;
    /**
     * Parse result rows into objects, coercing types based on column metadata.
     * The Snowflake SQL API returns all values as strings.
     */
    static parseRows(result: SQLAPIResult): any[];
    /**
     * Coerce a raw string value from the SQL API to its proper JS type.
     */
    private static coerceValue;
}
//# sourceMappingURL=sqlapi.d.ts.map