/**
 * Connection pool for Snowflake SDK clients.
 *
 * Maintains up to `maxSize` persistent connections and multiplexes them across
 * concurrent requests, solving both the concurrency and per-request transaction
 * isolation problems.
 */
import { SnowflakeSDKClient } from './sdk.js';
export class SnowflakeSDKPool {
    pool = [];
    available = [];
    waitQueue = [];
    maxSize;
    credentials;
    constructor(credentials, maxSize = 10) {
        this.credentials = credentials;
        this.maxSize = maxSize;
    }
    /**
     * Acquire a client from the pool. Creates a new one if the pool is not full;
     * otherwise waits until one is released.
     */
    async acquire() {
        if (this.available.length > 0) {
            return this.available.pop();
        }
        if (this.pool.length < this.maxSize) {
            const client = new SnowflakeSDKClient(this.credentials);
            await client.connect();
            this.pool.push(client);
            return client;
        }
        // Pool exhausted — queue the caller
        return new Promise(resolve => {
            this.waitQueue.push(resolve);
        });
    }
    /**
     * Release a client back to the pool.
     */
    release(client) {
        if (this.waitQueue.length > 0) {
            const next = this.waitQueue.shift();
            next(client);
        }
        else {
            this.available.push(client);
        }
    }
    /** Pool size (connected clients) */
    get size() {
        return this.pool.length;
    }
    /** Available (idle) clients */
    get idleCount() {
        return this.available.length;
    }
    /**
     * Disconnect all clients and clear the pool.
     */
    async destroyAll() {
        for (const client of this.pool) {
            await client.disconnect().catch(() => { });
        }
        this.pool = [];
        this.available = [];
    }
}
//# sourceMappingURL=sdk-pool.js.map