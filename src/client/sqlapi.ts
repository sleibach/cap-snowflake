/**
 * Snowflake SQL API client (HTTP-based)
 */

import { SnowflakeCredentials } from '../config.js';
import { generateJWT } from '../auth/jwt.js';
import { normalizeError, isRetryableError } from '../utils/errors.js';
import { logSQL, logError, logWarning } from '../utils/logger.js';

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
  data?: SQLAPIResult;
  message?: string;
  code?: string;
  sqlState?: string;
}

/**
 * Snowflake SQL API Client
 */
export class SnowflakeSQLAPIClient {
  private credentials: SnowflakeCredentials;
  private baseURL: string;
  private maxRetries = 3;
  private retryDelay = 1000;

  constructor(credentials: SnowflakeCredentials) {
    this.credentials = credentials;
    this.baseURL = `https://${credentials.host}/api/v2/statements`;
  }

  /**
   * Execute a SQL statement
   */
  async execute(sql: string, binds?: any[]): Promise<SQLAPIResult> {
    const startTime = Date.now();
    const token = this.getAuthToken();

    const body = {
      statement: sql,
      timeout: this.credentials.timeout || 60,
      database: this.credentials.database,
      schema: this.credentials.schema,
      warehouse: this.credentials.warehouse,
      role: this.credentials.role,
      bindings: binds ? this.formatBindings(binds) : undefined,
    };

    logSQL(sql, binds, 0);

    let lastError: any;
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        const response = await this.makeRequest(token, body);
        const timing = Date.now() - startTime;
        logSQL(sql, binds, timing);

        if (!response.data) {
          throw new Error('No data in SQL API response');
        }

        return response.data;
      } catch (error) {
        lastError = error;
        
        if (isRetryableError(error) && attempt < this.maxRetries) {
          const delay = this.retryDelay * Math.pow(2, attempt);
          logWarning(`Retrying SQL API request (attempt ${attempt + 1}/${this.maxRetries})`, { delay });
          await this.sleep(delay);
          continue;
        }

        throw normalizeError(error);
      }
    }

    throw normalizeError(lastError);
  }

  /**
   * Execute multiple statements in sequence
   */
  async executeMany(statements: Array<{ sql: string; binds?: any[] }>): Promise<SQLAPIResult[]> {
    const results: SQLAPIResult[] = [];

    for (const stmt of statements) {
      const result = await this.execute(stmt.sql, stmt.binds);
      results.push(result);
    }

    return results;
  }

  /**
   * Make HTTP request to SQL API
   */
  private async makeRequest(token: string, body: any): Promise<SQLAPIResponse> {
    const headers = {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'X-Snowflake-Authorization-Token-Type': 'KEYPAIR_JWT',
    };

    try {
      const response = await fetch(this.baseURL, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      });

      const data = await response.json() as SQLAPIResponse;

      if (!response.ok) {
        throw {
          response: {
            status: response.status,
            data,
          },
        };
      }

      return data;
    } catch (error) {
      logError('SQL API request failed', error);
      throw error;
    }
  }

  /**
   * Get authentication token
   */
  private getAuthToken(): string {
    if (!this.credentials.jwt) {
      throw new Error('JWT configuration is required for SQL API mode');
    }

    return generateJWT(
      this.credentials.jwt,
      this.credentials.account,
      this.credentials.user
    );
  }

  /**
   * Format bindings for SQL API
   */
  private formatBindings(binds: any[]): any {
    // SQL API expects bindings in a specific format
    return binds.map((value, index) => ({
      name: `${index + 1}`,
      value: this.formatValue(value),
    }));
  }

  /**
   * Format value for SQL API
   */
  private formatValue(value: any): any {
    if (value === null || value === undefined) {
      return null;
    }

    if (value instanceof Date) {
      return value.toISOString();
    }

    if (typeof value === 'object') {
      return JSON.stringify(value);
    }

    return value;
  }

  /**
   * Sleep utility
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Parse result rows into objects
   */
  static parseRows(result: SQLAPIResult): any[] {
    if (!result.data || result.data.length === 0) {
      return [];
    }

    const columns = result.resultSetMetaData.rowType.map(col => col.name);
    
    return result.data.map(row => {
      const obj: any = {};
      columns.forEach((col, idx) => {
        obj[col] = row[idx];
      });
      return obj;
    });
  }
}

