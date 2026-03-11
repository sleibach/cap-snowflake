/**
 * Snowflake SDK client wrapper
 */

import snowflake from 'snowflake-sdk';
import { SnowflakeCredentials } from '../config.js';
import { normalizeError } from '../utils/errors.js';
import { logSQL, logError } from '../utils/logger.js';

export interface SDKResult {
  rows: any[];
  rowCount: number;
}

/**
 * Snowflake SDK Client
 */
export class SnowflakeSDKClient {
  private credentials: SnowflakeCredentials;
  private connection?: snowflake.Connection;
  private connecting?: Promise<void>;

  constructor(credentials: SnowflakeCredentials) {
    this.credentials = credentials;
  }

  /**
   * Connect to Snowflake
   */
  async connect(): Promise<void> {
    if (this.connection) {
      return;
    }

    if (this.connecting) {
      return this.connecting;
    }

    this.connecting = new Promise((resolve, reject) => {
      const options: snowflake.ConnectionOptions = {
        account: this.credentials.account,
        username: this.credentials.user,
        password: this.credentials.password,
        warehouse: this.credentials.warehouse,
        database: this.credentials.database,
        schema: this.credentials.schema,
        role: this.credentials.role,
        clientSessionKeepAlive: true,
      };

      this.connection = snowflake.createConnection(options);

      this.connection.connect((err, _conn) => {
        if (err) {
          logError('Failed to connect to Snowflake', err);
          this.connection = undefined;
          this.connecting = undefined;
          reject(normalizeError(err));
        } else {
          resolve();
        }
      });
    });

    return this.connecting;
  }

  /**
   * Execute a SQL statement
   */
  async execute(sql: string, binds?: any[]): Promise<SDKResult> {
    await this.connect();

    if (!this.connection) {
      throw new Error('Not connected to Snowflake');
    }

    const startTime = Date.now();
    logSQL(sql, binds, 0);

    return new Promise((resolve, reject) => {
      this.connection!.execute({
        sqlText: sql,
        binds: binds || [],
        complete: (err, stmt, rows) => {
          const timing = Date.now() - startTime;
          
          if (err) {
            logError('SQL execution failed', err);
            reject(normalizeError(err));
          } else {
            logSQL(sql, binds, timing);
            resolve({
              rows: rows || [],
              rowCount: rows?.length || 0,
            });
          }
        },
      });
    });
  }

  /**
   * Execute multiple statements in sequence
   */
  async executeMany(statements: Array<{ sql: string; binds?: any[] }>): Promise<SDKResult[]> {
    const results: SDKResult[] = [];

    for (const stmt of statements) {
      const result = await this.execute(stmt.sql, stmt.binds);
      results.push(result);
    }

    return results;
  }

  /**
   * Stream query results in chunks using LIMIT/OFFSET paging.
   */
  async *queryStream(
    sql: string,
    binds?: any[],
    options?: { batchSize?: number }
  ): AsyncGenerator<any, void, unknown> {
    const batchSize = Math.max(1, options?.batchSize || 1000);
    let offset = 0;

    while (true) {
      const pagedSQL = `SELECT * FROM (${sql}) AS stream_src LIMIT ${batchSize} OFFSET ${offset}`;
      const result = await this.execute(pagedSQL, binds);

      if (!result.rows.length) {
        return;
      }

      for (const row of result.rows) {
        yield row;
      }

      if (result.rows.length < batchSize) {
        return;
      }

      offset += batchSize;
    }
  }

  /**
   * Begin transaction
   */
  async beginTransaction(): Promise<void> {
    await this.execute('BEGIN TRANSACTION');
  }

  /**
   * Commit transaction
   */
  async commit(): Promise<void> {
    await this.execute('COMMIT');
  }

  /**
   * Rollback transaction
   */
  async rollback(): Promise<void> {
    await this.execute('ROLLBACK');
  }

  /**
   * Disconnect from Snowflake
   */
  async disconnect(): Promise<void> {
    if (!this.connection) {
      return;
    }

    return new Promise((resolve, reject) => {
      this.connection!.destroy((err) => {
        if (err) {
          logError('Failed to disconnect from Snowflake', err);
          reject(normalizeError(err));
        } else {
          this.connection = undefined;
          this.connecting = undefined;
          resolve();
        }
      });
    });
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return !!this.connection;
  }
}

