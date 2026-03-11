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
  resultSetMetaData?: SQLAPIResult['resultSetMetaData'] & { numRows?: number };
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
        const result = this.normalizeResult(response);
        const timing = Date.now() - startTime;
        logSQL(sql, binds, timing);

        if (!result) {
          throw new Error('No data in SQL API response');
        }

        return result;
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
      const rows = SnowflakeSQLAPIClient.parseRows(result);

      if (!rows.length) {
        return;
      }

      for (const row of rows) {
        yield row;
      }

      if (rows.length < batchSize) {
        return;
      }

      offset += batchSize;
    }
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

  private normalizeResult(response: SQLAPIResponse): SQLAPIResult | undefined {
    // Shape A (expected by earlier code): { data: { resultSetMetaData, data, total, returned } }
    if ((response.data as any)?.resultSetMetaData && Array.isArray((response.data as any)?.data)) {
      return response.data as SQLAPIResult;
    }

    // Shape B (actual SQL API): { resultSetMetaData, data, ... }
    if ((response as any).resultSetMetaData && Array.isArray((response as any).data)) {
      const top = response as any;
      return {
        resultSetMetaData: top.resultSetMetaData,
        data: top.data,
        total: top.resultSetMetaData?.numRows ?? top.data.length,
        returned: top.returned ?? top.data.length,
      };
    }

    return undefined;
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
      this.credentials.user,
      this.credentials.host
    );
  }

  /**
   * Format bindings for SQL API
   */
  private formatBindings(binds: any[]): any {
    // Snowflake SQL API expects an object map: { "1": { type, value }, ... }
    const out: Record<string, { type: string; value: any }> = {};
    binds.forEach((value, index) => {
      out[String(index + 1)] = {
        type: this.inferBindingType(value),
        value: this.formatValue(value),
      };
    });
    return out;
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

    if (typeof value === 'number' || typeof value === 'boolean') {
      return String(value);
    }

    if (typeof value === 'object') {
      return JSON.stringify(value);
    }

    return value;
  }

  private inferBindingType(value: any): string {
    if (value === null || value === undefined) return 'TEXT';
    if (value instanceof Date) return 'TIMESTAMP_NTZ';
    if (typeof value === 'boolean') return 'BOOLEAN';
    if (typeof value === 'number') return Number.isInteger(value) ? 'FIXED' : 'REAL';
    return 'TEXT';
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

