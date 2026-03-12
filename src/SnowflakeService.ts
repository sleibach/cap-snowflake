/**
 * Main Snowflake Database Service
 */

import cds from '@sap/cds';
import { getSnowflakeConfig, SnowflakeCredentials } from './config.js';
import { SnowflakeSQLAPIClient } from './client/sqlapi.js';
import { SnowflakeSDKClient } from './client/sdk.js';
import { cqnToSQL, generateMerge } from './cqn/toSQL.js';
import { wrapWithCount } from './cqn/pagination.js';
import { logInfo, logError, logWarning } from './utils/logger.js';
import { normalizeError } from './utils/errors.js';
import { buildDeployStatements } from './ddl/deploy.js';

export class SnowflakeService extends cds.DatabaseService {
  private credentials!: SnowflakeCredentials;
  private sqlApiClient?: SnowflakeSQLAPIClient;
  private sdkClient?: SnowflakeSDKClient;
  private transactionStates = new Map<string, boolean>();

  private get inTransaction(): boolean {
    return this.transactionStates.get(cds.context?.id ?? 'default') ?? false;
  }

  private set inTransaction(value: boolean) {
    const key = cds.context?.id ?? 'default';
    if (value) {
      this.transactionStates.set(key, true);
    } else {
      this.transactionStates.delete(key);
    }
  }

  /**
   * CAP v9 DatabaseService compatibility:
   * base class initializes pool metadata with `this.factory`.
   * For this adapter we manage connectivity ourselves (SQL API / SDK),
   * so this lightweight no-op factory is sufficient.
   */
  get factory() {
    return {
      create: async () => ({}),
      destroy: async () => {},
    };
  }

  /**
   * CAP v9 hook used by base tx handling.
   * Our adapter manages context at query level, so this is intentionally a no-op.
   */
  set(_variables: any) {
    return;
  }

  /**
   * Initialize the service
   */
  async init() {
    // Load configuration
    const config = getSnowflakeConfig(this.name);
    this.credentials = config.credentials;

    logInfo('Initializing Snowflake adapter', {
      account: this.credentials.account,
      database: this.credentials.database,
      schema: this.credentials.schema,
      auth: this.credentials.auth,
    });

    // Initialize appropriate client
    if (this.credentials.auth === 'jwt') {
      this.sqlApiClient = new SnowflakeSQLAPIClient(this.credentials);
      logInfo('Using Snowflake SQL API with JWT authentication');
    } else {
      this.sdkClient = new SnowflakeSDKClient(this.credentials);
      await this.sdkClient.connect();
      logInfo('Using Snowflake SDK with password authentication');
    }

    // Register query handlers
    this.on('READ', '*', this.onRead.bind(this));
    this.on('INSERT', '*', this.onInsert.bind(this));
    this.on('UPDATE', '*', this.onUpdate.bind(this));
    this.on('DELETE', '*', this.onDelete.bind(this));
    this.on('UPSERT', '*', this.onUpsert.bind(this));

    // Wildcard handler for raw SQL strings (e.g. db.run('SELECT ...'))
    this.on('*', this.onPlainSQL.bind(this));

    // Call parent init
    return super.init();
  }

  /**
   * Handle READ operations
   * Supports expand (LEFT JOIN), temporal queries, and localized data
   */
  private async onRead(req: any): Promise<any> {
    const query = req.query;
    try {
      const select = query.SELECT;
      
      if (!select) {
        throw new Error('Invalid SELECT query');
      }

      // Check if $count is requested
      const needsCount = select.count;

      // Translate to SQL (now with JOIN-based expand support)
      const { sql, params } = cqnToSQL(query, this.credentials, { target: req.target });

      if (this.shouldStreamRead(req, select)) {
        return this.executeStream(sql, params, req?.data?.batchSize);
      }

      // Execute query
      let rows = await this.execute(sql, params);
      rows = this.mapRowKeysToElements(rows, req.target);

      // Restructure expanded results if needed
      rows = this.restructureExpands(rows, select);

      // Handle $count if requested
      if (needsCount) {
        const countSQL = wrapWithCount(sql);
        const countResult = await this.execute(countSQL, params);
        const count = Number(countResult[0]?.count ?? countResult[0]?.COUNT ?? 0);

        // Attach $count to result set
        (rows as any).$count = count;

        // Add @odata.nextLink when more pages exist
        const top = select.limit?.rows?.val;
        const skip = select.limit?.offset?.val ?? 0;
        if (top && skip + rows.length < count) {
          const nextOffset = skip + top;
          const nextToken = Buffer.from(String(nextOffset)).toString('base64');
          (rows as any)['@odata.nextLink'] = `?$skiptoken=${nextToken}`;
        }
      } else {
        // Without $count, emit nextLink heuristically when result fills page exactly
        const top = select.limit?.rows?.val;
        if (top && rows.length === top) {
          const skip = select.limit?.offset?.val ?? 0;
          const nextToken = Buffer.from(String(skip + top)).toString('base64');
          (rows as any)['@odata.nextLink'] = `?$skiptoken=${nextToken}`;
        }
      }

      // Return one or many
      if (select.one) {
        return rows.length > 0 ? rows[0] : null;
      }

      return rows;
    } catch (error) {
      logError('READ operation failed', error);
      throw normalizeError(error);
    }
  }

  private shouldStreamRead(req: any, select: any): boolean {
    return req?.data?.$stream === true || select?.stream === true;
  }

  /**
   * Restructure expanded results from flat JOIN to nested objects
   */
  private restructureExpands(rows: any[], select: any): any[] {
    if (!select.columns) return rows;

    // Check for expand columns
    const hasExpands = select.columns.some((col: any) => col.expand || col.inline);
    if (!hasExpands) return rows;

    return rows.map(row => {
      const result: any = {};
      const expanded: Map<string, any> = new Map();

      // Separate base and expanded fields
      for (const [key, value] of Object.entries(row)) {
        // To-many expansions are returned as aggregated JSON arrays under association name.
        const toManyCol = select.columns.find((col: any) => col.expand && col.ref?.[0] === key);
        if (toManyCol) {
          // ARRAY_AGG returns null when no rows match; normalize to empty array
          result[key] = value == null ? [] : value;
          continue;
        }

        // Check if this is an expanded field (contains association name prefix)
        let isExpandField = false;

        for (const col of select.columns) {
          if (col.expand && col.ref) {
            const assocName = col.ref[0];
            // Expand columns use "__" (double underscore) as separator to avoid
            // aliasing collisions with base FK columns (e.g. author_ID).
            if (key.startsWith(`${assocName}__`)) {
              const fieldSuffix = key.substring(assocName.length + 2);

              if (!expanded.has(assocName)) expanded.set(assocName, {});
              const nestedPath = fieldSuffix.split('__');
              this.assignNested(expanded.get(assocName), nestedPath, value);
              isExpandField = true;
              break;
            }
          }
        }

        if (!isExpandField) {
          result[key] = value;
        }
      }

      // Attach expanded objects
      for (const [assocName, data] of expanded.entries()) {
        // Check if all values are null (no related record)
        const hasData = Object.values(data).some(v => v !== null);
        result[assocName] = hasData ? data : null;
      }

      return result;
    });
  }

  private assignNested(target: any, path: string[], value: any) {
    if (path.length === 0) return;
    if (path.length === 1) {
      target[path[0]] = value;
      return;
    }
    const [head, ...tail] = path;
    if (!target[head] || typeof target[head] !== 'object') {
      target[head] = {};
    }
    this.assignNested(target[head], tail, value);
  }

  private mapRowKeysToElements(rows: any[], target: any): any[] {
    const elements = target?.elements;
    if (!Array.isArray(rows)) return rows;
    const elementNames = elements ? Object.keys(elements) : [];
    if (!elementNames.length && !elements) {
      return rows.map((row) => this.mapUppercaseFallback(row));
    }

    return rows.map((row) => {
      const mapped: any = {};
      for (const [key, value] of Object.entries(row)) {
        const exact = elementNames.find((n) => n === key);
        if (exact) {
          mapped[exact] = value;
          continue;
        }
        const caseInsensitive = elementNames.find((n) => n.toUpperCase() === key.toUpperCase());
        if (caseInsensitive) {
          mapped[caseInsensitive] = value;
          continue;
        }
        mapped[key] = value;
      }
      return mapped;
    });
  }

  private mapUppercaseFallback(row: any): any {
    const out: any = {};
    for (const [key, value] of Object.entries(row)) {
      if (/^[A-Z0-9_]+$/.test(key)) {
        out[key.toLowerCase()] = value;
      } else {
        out[key] = value;
      }
    }
    return out;
  }

  /**
   * Check if entity has annotation
   */
  private hasAnnotation(entity: any, annotation: string): boolean {
    if (!entity) return false;
    // Check entity definition for annotation
    return entity[`@${annotation}`] !== undefined;
  }

  /**
   * Get custom table/column name from @cds.persistence.name
   */
  private getCustomName(definition: any): string | undefined {
    return definition?.['@cds.persistence.name'];
  }

  /**
   * Handle INSERT operations
   */
  private async onInsert(req: any): Promise<any> {
    const query = req.query;
    try {
      const insert = query.INSERT;
      
      if (!insert) {
        throw new Error('Invalid INSERT query');
      }

      // For draft entities, ensure IsActiveEntity=false is included in the data
      // BEFORE generating SQL — otherwise Snowflake stores it as NULL and draft
      // filter queries (IsActiveEntity eq false) return no results.
      const insertIntoName = typeof insert.into === 'string' ? insert.into 
        : (insert.into?.ref?.[0]?.id ?? insert.into?.ref?.[0] ?? '');
      const isDraft = req.target?.name?.endsWith('.drafts') || 
        (typeof insertIntoName === 'string' && insertIntoName.endsWith('.drafts'));
      if (isDraft && insert.entries) {
        for (const entry of insert.entries) {
          if (entry.IsActiveEntity === undefined) entry.IsActiveEntity = false;
          if (entry.HasActiveEntity === undefined) entry.HasActiveEntity = false;
          if (entry.HasDraftEntity === undefined) entry.HasDraftEntity = false;
        }
      }

      const { sql, params } = cqnToSQL(query, this.credentials, { target: req.target });
      await this.execute(sql, params);

      // Return inserted entries for CAP
      if (insert.entries) {
        return insert.entries.length === 1 ? insert.entries[0] : insert.entries;
      }

      return req.data;
    } catch (error) {
      logError('INSERT operation failed', error);
      throw normalizeError(error);
    }
  }

  /**
   * Handle UPDATE operations
   */
  private async onUpdate(req: any): Promise<number> {
    const query = req.query;
    try {
      const update = query.UPDATE;
      
      if (!update) {
        throw new Error('Invalid UPDATE query');
      }

      // Note: CAP runtime handles @readonly/@insertonly checks before reaching adapter
      // Note: CAP runtime updates managed fields (modifiedAt, modifiedBy) automatically

      const { sql, params } = cqnToSQL(query, this.credentials, { target: req.target });
      const result = await this.execute(sql, params);
      return result.length || 0;
    } catch (error) {
      logError('UPDATE operation failed', error);
      throw normalizeError(error);
    }
  }

  /**
   * Handle DELETE operations
   */
  private async onDelete(req: any): Promise<number> {
    const query = req.query;
    try {
      const del = query.DELETE;
      
      if (!del) {
        throw new Error('Invalid DELETE query');
      }

      // Note: CAP runtime handles @readonly/@insertonly checks before reaching adapter
      // Note: Compositions trigger cascading deletes automatically via CAP

      const { sql, params } = cqnToSQL(query, this.credentials, { target: req.target });

      const result = await this.execute(sql, params);

      // Snowflake DML returns a metadata row; result.length > 0 means the statement ran.
      // Return 1 so CAP emits 204 No Content instead of 404 Not Found.
      return result?.length > 0 ? result.length : 1;
    } catch (error) {
      logError('DELETE operation failed', error);
      throw normalizeError(error);
    }
  }

  /**
   * Handle UPSERT operations (using MERGE)
   */
  private async onUpsert(req: any): Promise<any> {
    const query = req.query;
    try {
      const upsert = query.UPSERT;
      if (!upsert) throw new Error('Invalid UPSERT query');

      const entity = upsert.into?.ref?.[0] ?? upsert.into;
      const target = req.target;
      const keys = target?.keys ? Object.keys(target.keys) : ['ID'];
      const entries = upsert.entries ?? (upsert.entry ? [upsert.entry] : [req.data]);

      for (const entry of entries) {
        const { sql, params } = generateMerge(entity, keys, entry, this.credentials);
        await this.execute(sql, params);
      }

      return entries;
    } catch (error) {
      logError('UPSERT operation failed', error);
      throw normalizeError(error);
    }
  }

  /**
   * Handle raw SQL strings passed via db.run('SELECT ...') or db.exec('...')
   * Mirrors the SQLService.onPlainSQL wildcard handler from @cap-js/db-service.
   */
  private async onPlainSQL(req: any, next: any): Promise<any> {
    const { query, data } = req;
    if (typeof query !== 'string') return next();

    const isSelect = /^\s*(SELECT|WITH|SHOW|DESCRIBE)\b/i.test(query);
    try {
      if (Array.isArray(data) && Array.isArray(data[0])) {
        // Batch: array of param arrays
        const results = await Promise.all(
          data.map((row: any[]) => this.execute(query, row))
        );
        return isSelect ? results.flat() : results;
      }

      const params = Array.isArray(data) ? data : data != null ? [data] : undefined;
      return await this.execute(query, params);
    } catch (error) {
      logError('Plain SQL execution failed', error);
      throw normalizeError(error);
    }
  }

  /**
   * Execute SQL statement
   */
  private async execute(sql: string, params?: any[]): Promise<any[]> {

    if (this.sqlApiClient) {
      const result = await this.sqlApiClient.execute(sql, params);
      return SnowflakeSQLAPIClient.parseRows(result);
    } else if (this.sdkClient) {
      const result = await this.sdkClient.execute(sql, params);
      return result.rows;
    }

    throw new Error('No client available');
  }

  private async executeStream(
    sql: string,
    params?: any[],
    batchSize?: number
  ): Promise<any> {
    const effectiveBatchSize = typeof batchSize === 'number' ? batchSize : 1000;

    if (this.sqlApiClient && this.sqlApiClient.queryStream) {
      return this.sqlApiClient.queryStream(sql, params, { batchSize: effectiveBatchSize });
    } else if (this.sdkClient && this.sdkClient.queryStream) {
      return this.sdkClient.queryStream(sql, params, { batchSize: effectiveBatchSize });
    }

    return this.execute(sql, params);
  }

  /**
   * Begin transaction
   */
  async begin(): Promise<void> {
    if (this.inTransaction) {
      logWarning('Transaction already in progress');
      return;
    }

    try {
      if (this.sdkClient) {
        await this.sdkClient.beginTransaction();
        this.inTransaction = true;
        logInfo('Transaction started');
      } else {
        // SQL API doesn't support explicit transactions in same way
        logWarning('Transactions not fully supported in SQL API mode');
      }
    } catch (error) {
      logError('Failed to begin transaction', error);
      throw normalizeError(error);
    }
  }

  /**
   * Commit transaction
   */
  async commit(): Promise<void> {
    if (!this.inTransaction) {
      return;
    }

    try {
      if (this.sdkClient) {
        await this.sdkClient.commit();
        this.inTransaction = false;
        logInfo('Transaction committed');
      }
    } catch (error) {
      logError('Failed to commit transaction', error);
      throw normalizeError(error);
    }
  }

  /**
   * Rollback transaction
   */
  async rollback(): Promise<void> {
    if (!this.inTransaction) {
      return;
    }

    try {
      if (this.sdkClient) {
        await this.sdkClient.rollback();
        this.inTransaction = false;
        logInfo('Transaction rolled back');
      }
    } catch (error) {
      logError('Failed to rollback transaction', error);
      throw normalizeError(error);
    }
  }

  /**
   * Disconnect
   */
  async disconnect(): Promise<void> {
    try {
      if (this.sdkClient) {
        await this.sdkClient.disconnect();
        logInfo('Disconnected from Snowflake');
      }
    } catch (error) {
      logError('Failed to disconnect', error);
      throw normalizeError(error);
    }
  }

  /**
   * Deploy database schema (for cds deploy)
   */
  async deploy(model?: any, options?: any): Promise<any> {
    const effectiveModel = model || (this as any).model;
    await this.handleDeploy(effectiveModel, options);
    return effectiveModel;
  }

  private async handleDeploy(model: any, options?: any): Promise<void> {
    logInfo('Deploy operation called', options);

    if (!model) {
      throw new Error('Deploy requires a CDS model');
    }

    const statements = buildDeployStatements(model, this.credentials, {
      createViews: options?.createViews !== false
    });

    if (statements.length === 0) {
      logWarning('No deploy statements generated for provided model');
      return;
    }

    for (const sql of statements) {
      try {
        await this.execute(sql);
      } catch (error: any) {
        // Snowflake may return "already exists" for views/tables from previous runs.
        const message = String(error?.message || '');
        if (message.includes('already exists')) {
          logWarning('Deploy statement skipped (already exists)', { sql });
          continue;
        }
        throw error;
      }
    }

    logInfo('Deploy operation finished', { statements: statements.length });
  }
}

// Export as default
export default SnowflakeService;

