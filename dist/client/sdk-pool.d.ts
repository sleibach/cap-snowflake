/**
 * Connection pool for Snowflake SDK clients.
 *
 * Maintains up to `maxSize` persistent connections and multiplexes them across
 * concurrent requests, solving both the concurrency and per-request transaction
 * isolation problems.
 */
import { SnowflakeSDKClient } from './sdk.js';
import { SnowflakeCredentials } from '../config.js';
export declare class SnowflakeSDKPool {
    private pool;
    private available;
    private waitQueue;
    private readonly maxSize;
    private readonly credentials;
    constructor(credentials: SnowflakeCredentials, maxSize?: number);
    /**
     * Acquire a client from the pool. Creates a new one if the pool is not full;
     * otherwise waits until one is released.
     */
    acquire(): Promise<SnowflakeSDKClient>;
    /**
     * Release a client back to the pool.
     */
    release(client: SnowflakeSDKClient): void;
    /** Pool size (connected clients) */
    get size(): number;
    /** Available (idle) clients */
    get idleCount(): number;
    /**
     * Disconnect all clients and clear the pool.
     */
    destroyAll(): Promise<void>;
}
//# sourceMappingURL=sdk-pool.d.ts.map