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
  private cachedToken?: string;
  private tokenExpiry?: number;

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
          const retryAfterHeader = (error as any)?.response?.retryAfter;
          const delay = this.calculateRetryDelay(attempt, retryAfterHeader);
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

    const fetchTimeout = ((body.timeout ?? 60) + 30) * 1000;
    try {
      const response = await fetch(this.baseURL, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(fetchTimeout),
      });

      const data = await response.json() as SQLAPIResponse;

      if (!response.ok) {
        throw {
          response: {
            status: response.status,
            data,
            retryAfter: response.headers.get('retry-after'),
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
    const top = response as any;
    if (top.resultSetMetaData) {
      const dataArr = Array.isArray(top.data) ? top.data : [];
      return {
        resultSetMetaData: top.resultSetMetaData,
        data: dataArr,
        total: top.resultSetMetaData?.numRows ?? dataArr.length,
        returned: top.returned ?? dataArr.length,
      };
    }

    // Shape C: async statement handle — treat as empty result (query is still processing)
    // Snowflake returns { statementHandle, code: "333334" } for async queries
    if (top.statementHandle) {
      logWarning('Snowflake returned async statement handle; treating as empty result', { handle: top.statementHandle });
      return {
        resultSetMetaData: { rowType: [] },
        data: [],
        total: 0,
        returned: 0,
      } as any;
    }

    logWarning('Unexpected Snowflake SQL API response shape', { keys: Object.keys(top) });
    return undefined;
  }

  /**
   * Get authentication token — cached until 30 s before expiry.
   */
  private getAuthToken(): string {
    const now = Date.now();
    if (this.cachedToken && this.tokenExpiry && now < this.tokenExpiry - 30_000) {
      return this.cachedToken;
    }

    if (!this.credentials.jwt) {
      throw new Error('JWT configuration is required for SQL API mode');
    }

    const expiresIn =
      typeof this.credentials.jwt.expiresIn === 'number'
        ? this.credentials.jwt.expiresIn
        : 3600;

    this.cachedToken = generateJWT(
      this.credentials.jwt,
      this.credentials.account,
      this.credentials.user,
      this.credentials.host
    );
    this.tokenExpiry = now + expiresIn * 1000;
    return this.cachedToken;
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
      // Snowflake SQL API TIMESTAMP_TZ format: "YYYY-MM-DD HH:MI:SS.SSS +00:00"
      return value.toISOString().replace('T', ' ').replace('Z', ' +00:00');
    }

    if (typeof value === 'number' || typeof value === 'boolean') {
      return String(value);
    }

    if (typeof value === 'string') {
      // ISO 8601 timestamp strings from CAP (e.g. "2026-03-12T01:23:45.000Z").
      // Convert to Snowflake TIMESTAMP_TZ format: "YYYY-MM-DD HH:MI:SS.SSS +00:00".
      // This works for both TIMESTAMP_TZ and TIMESTAMP_NTZ columns (Snowflake strips TZ).
      const isoRe = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}:\d{2}(?:\.\d+)?)Z?$/;
      const m = isoRe.exec(value);
      if (m) {
        return `${m[1]} ${m[2]} +00:00`;
      }
    }

    if (typeof value === 'object') {
      return JSON.stringify(value);
    }

    return value;
  }

  private inferBindingType(value: any): string {
    if (value === null || value === undefined) return 'TEXT';
    // Timestamps passed as TEXT — Snowflake auto-casts to TIMESTAMP_TZ/NTZ/LTZ.
    // Using TIMESTAMP_TZ binding type causes SQL compilation errors with formatted
    // strings; TEXT is always accepted.
    if (value instanceof Date) return 'TEXT';
    if (typeof value === 'boolean') return 'BOOLEAN';
    if (typeof value === 'number') return Number.isInteger(value) ? 'FIXED' : 'REAL';
    if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(value)) {
      return 'TEXT';
    }
    return 'TEXT';
  }

  /**
   * Calculate retry delay with exponential back-off, jitter, and Retry-After header support.
   */
  private calculateRetryDelay(attempt: number, retryAfterHeader?: string | null): number {
    if (retryAfterHeader) {
      const seconds = Number(retryAfterHeader);
      if (!isNaN(seconds) && seconds > 0) {
        return Math.min(seconds * 1000, 30_000);
      }
    }
    const base = this.retryDelay * Math.pow(2, attempt);
    const jitter = Math.random() * 200;
    return Math.min(base + jitter, 30_000);
  }

  /**
   * Sleep utility
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Parse result rows into objects, coercing types based on column metadata.
   * The Snowflake SQL API returns all values as strings.
   */
  static parseRows(result: SQLAPIResult): any[] {
    if (!result.data || result.data.length === 0) {
      return [];
    }

    const rowTypes = result.resultSetMetaData.rowType;

    const rows = result.data.map(row => {
      const obj: any = {};
      rowTypes.forEach((col, idx) => {
        obj[col.name] = SnowflakeSQLAPIClient.coerceValue(row[idx], col);
      });
      return obj;
    });

    return rows;
  }

  /**
   * Coerce a raw string value from the SQL API to its proper JS type.
   */
  private static coerceValue(
    raw: any,
    col: { type: string; scale?: number; nullable: boolean }
  ): any {
    if (raw === null || raw === undefined) return null;

    const type = (col.type ?? '').toLowerCase();

    switch (type) {
      case 'boolean':
        if (typeof raw === 'boolean') return raw;
        return String(raw).toLowerCase() === 'true' || raw === '1' || raw === 1;

      case 'fixed':
        // scale === 0 → integer, otherwise decimal
        if (raw === '') return null;
        if ((col.scale ?? 0) === 0) return Number.parseInt(String(raw), 10);
        return Number.parseFloat(String(raw));

      case 'real':
        if (raw === '') return null;
        return Number.parseFloat(String(raw));

      case 'variant':
      case 'object':
      case 'array':
        if (typeof raw === 'object') return raw;
        try { return JSON.parse(String(raw)); } catch { return raw; }

      default: {
        // For TEXT/VARCHAR columns, CAP sometimes stores JSON-serialised arrays or
        // objects (e.g. DraftMessages: LargeString).  Auto-parse so CAP receives the
        // JS type it wrote rather than the raw string representation.
        if (typeof raw === 'string') {
          const trimmed = raw.trimStart();
          if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
            try { return JSON.parse(raw); } catch { /* not JSON – return as-is */ }
          }
        }
        return raw;
      }
    }
  }
}

