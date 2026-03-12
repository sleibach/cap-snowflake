/**
 * Snowflake SDK client wrapper
 */
import { SnowflakeCredentials } from '../config.js';
export interface SDKResult {
    rows: any[];
    rowCount: number;
}
/**
 * Snowflake SDK Client
 */
export declare class SnowflakeSDKClient {
    private credentials;
    private connection?;
    private connecting?;
    constructor(credentials: SnowflakeCredentials);
    /**
     * Connect to Snowflake
     */
    connect(): Promise<void>;
    /**
     * Execute a SQL statement
     */
    execute(sql: string, binds?: any[]): Promise<SDKResult>;
    /**
     * Execute multiple statements in sequence
     */
    executeMany(statements: Array<{
        sql: string;
        binds?: any[];
    }>): Promise<SDKResult[]>;
    /**
     * Stream query results in chunks using LIMIT/OFFSET paging.
     */
    queryStream(sql: string, binds?: any[], options?: {
        batchSize?: number;
    }): AsyncGenerator<any, void, unknown>;
    /**
     * Begin transaction
     */
    beginTransaction(): Promise<void>;
    /**
     * Commit transaction
     */
    commit(): Promise<void>;
    /**
     * Rollback transaction
     */
    rollback(): Promise<void>;
    /**
     * Disconnect from Snowflake
     */
    disconnect(): Promise<void>;
    /**
     * Check if connected
     */
    isConnected(): boolean;
}
//# sourceMappingURL=sdk.d.ts.map