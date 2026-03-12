/**
 * Connection pool for Snowflake SDK clients.
 *
 * Maintains up to `maxSize` persistent connections and multiplexes them across
 * concurrent requests, solving both the concurrency and per-request transaction
 * isolation problems.
 */

import { SnowflakeSDKClient } from './sdk.js';
import { SnowflakeCredentials } from '../config.js';

export class SnowflakeSDKPool {
  private pool: SnowflakeSDKClient[] = [];
  private available: SnowflakeSDKClient[] = [];
  private waitQueue: Array<(client: SnowflakeSDKClient) => void> = [];
  private readonly maxSize: number;
  private readonly credentials: SnowflakeCredentials;

  constructor(credentials: SnowflakeCredentials, maxSize = 10) {
    this.credentials = credentials;
    this.maxSize = maxSize;
  }

  /**
   * Acquire a client from the pool. Creates a new one if the pool is not full;
   * otherwise waits until one is released.
   */
  async acquire(): Promise<SnowflakeSDKClient> {
    if (this.available.length > 0) {
      return this.available.pop()!;
    }

    if (this.pool.length < this.maxSize) {
      const client = new SnowflakeSDKClient(this.credentials);
      await client.connect();
      this.pool.push(client);
      return client;
    }

    // Pool exhausted — queue the caller
    return new Promise<SnowflakeSDKClient>(resolve => {
      this.waitQueue.push(resolve);
    });
  }

  /**
   * Release a client back to the pool.
   */
  release(client: SnowflakeSDKClient): void {
    if (this.waitQueue.length > 0) {
      const next = this.waitQueue.shift()!;
      next(client);
    } else {
      this.available.push(client);
    }
  }

  /** Pool size (connected clients) */
  get size(): number {
    return this.pool.length;
  }

  /** Available (idle) clients */
  get idleCount(): number {
    return this.available.length;
  }

  /**
   * Disconnect all clients and clear the pool.
   */
  async destroyAll(): Promise<void> {
    for (const client of this.pool) {
      await client.disconnect().catch(() => { /* ignore disconnect errors */ });
    }
    this.pool = [];
    this.available = [];
  }
}
