/**
 * Snowflake SQL API client (HTTP-based)
 */
import { generateJWT } from '../auth/jwt.js';
import { normalizeError, isRetryableError } from '../utils/errors.js';
import { logSQL, logError, logWarning } from '../utils/logger.js';
/**
 * Snowflake SQL API Client
 */
export class SnowflakeSQLAPIClient {
    credentials;
    baseURL;
    maxRetries = 3;
    retryDelay = 1000;
    cachedToken;
    tokenExpiry;
    constructor(credentials) {
        this.credentials = credentials;
        this.baseURL = `https://${credentials.host}/api/v2/statements`;
    }
    /**
     * Execute a SQL statement
     */
    async execute(sql, binds) {
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
        let lastError;
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
            }
            catch (error) {
                lastError = error;
                if (isRetryableError(error) && attempt < this.maxRetries) {
                    const retryAfterHeader = error?.response?.retryAfter;
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
    async executeMany(statements) {
        const results = [];
        for (const stmt of statements) {
            const result = await this.execute(stmt.sql, stmt.binds);
            results.push(result);
        }
        return results;
    }
    /**
     * Stream query results in chunks using LIMIT/OFFSET paging.
     */
    async *queryStream(sql, binds, options) {
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
    async makeRequest(token, body) {
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
            const data = await response.json();
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
        }
        catch (error) {
            logError('SQL API request failed', error);
            throw error;
        }
    }
    normalizeResult(response) {
        // Shape A (expected by earlier code): { data: { resultSetMetaData, data, total, returned } }
        if (response.data?.resultSetMetaData && Array.isArray(response.data?.data)) {
            return response.data;
        }
        // Shape B (actual SQL API): { resultSetMetaData, data, ... }
        const top = response;
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
            };
        }
        logWarning('Unexpected Snowflake SQL API response shape', { keys: Object.keys(top) });
        return undefined;
    }
    /**
     * Get authentication token — cached until 30 s before expiry.
     */
    getAuthToken() {
        const now = Date.now();
        if (this.cachedToken && this.tokenExpiry && now < this.tokenExpiry - 30_000) {
            return this.cachedToken;
        }
        if (!this.credentials.jwt) {
            throw new Error('JWT configuration is required for SQL API mode');
        }
        const expiresIn = typeof this.credentials.jwt.expiresIn === 'number'
            ? this.credentials.jwt.expiresIn
            : 3600;
        this.cachedToken = generateJWT(this.credentials.jwt, this.credentials.account, this.credentials.user, this.credentials.host);
        this.tokenExpiry = now + expiresIn * 1000;
        return this.cachedToken;
    }
    /**
     * Format bindings for SQL API
     */
    formatBindings(binds) {
        // Snowflake SQL API expects an object map: { "1": { type, value }, ... }
        const out = {};
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
    formatValue(value) {
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
    inferBindingType(value) {
        if (value === null || value === undefined)
            return 'TEXT';
        // Timestamps passed as TEXT — Snowflake auto-casts to TIMESTAMP_TZ/NTZ/LTZ.
        // Using TIMESTAMP_TZ binding type causes SQL compilation errors with formatted
        // strings; TEXT is always accepted.
        if (value instanceof Date)
            return 'TEXT';
        if (typeof value === 'boolean')
            return 'BOOLEAN';
        if (typeof value === 'number')
            return Number.isInteger(value) ? 'FIXED' : 'REAL';
        if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(value)) {
            return 'TEXT';
        }
        return 'TEXT';
    }
    /**
     * Calculate retry delay with exponential back-off, jitter, and Retry-After header support.
     */
    calculateRetryDelay(attempt, retryAfterHeader) {
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
    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
    /**
     * Parse result rows into objects, coercing types based on column metadata.
     * The Snowflake SQL API returns all values as strings.
     */
    static parseRows(result) {
        if (!result.data || result.data.length === 0) {
            return [];
        }
        const rowTypes = result.resultSetMetaData.rowType;
        const rows = result.data.map(row => {
            const obj = {};
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
    static coerceValue(raw, col) {
        if (raw === null || raw === undefined)
            return null;
        const type = (col.type ?? '').toLowerCase();
        switch (type) {
            case 'boolean':
                if (typeof raw === 'boolean')
                    return raw;
                return String(raw).toLowerCase() === 'true' || raw === '1' || raw === 1;
            case 'fixed':
                // scale === 0 → integer, otherwise decimal
                if (raw === '')
                    return null;
                if ((col.scale ?? 0) === 0)
                    return Number.parseInt(String(raw), 10);
                return Number.parseFloat(String(raw));
            case 'real':
                if (raw === '')
                    return null;
                return Number.parseFloat(String(raw));
            case 'variant':
            case 'object':
            case 'array':
                if (typeof raw === 'object')
                    return raw;
                try {
                    return JSON.parse(String(raw));
                }
                catch {
                    return raw;
                }
            default: {
                // For TEXT/VARCHAR columns, CAP sometimes stores JSON-serialised arrays or
                // objects (e.g. DraftMessages: LargeString).  Auto-parse so CAP receives the
                // JS type it wrote rather than the raw string representation.
                if (typeof raw === 'string') {
                    const trimmed = raw.trimStart();
                    if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
                        try {
                            return JSON.parse(raw);
                        }
                        catch { /* not JSON – return as-is */ }
                    }
                }
                return raw;
            }
        }
    }
}
//# sourceMappingURL=sqlapi.js.map