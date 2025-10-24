/**
 * Main Snowflake Database Service
 */

import cds from '@sap/cds';
import { getSnowflakeConfig, SnowflakeCredentials } from './config.js';
import { SnowflakeSQLAPIClient, SQLAPIResult } from './client/sqlapi.js';
import { SnowflakeSDKClient, SDKResult } from './client/sdk.js';
import { cqnToSQL, generateMerge, CQN } from './cqn/toSQL.js';
import { wrapWithCount } from './cqn/pagination.js';
import { logInfo, logError, logWarning } from './utils/logger.js';
import { normalizeError } from './utils/errors.js';
import { isTemporal, getTemporalFields, addTemporalConditions } from './features/temporal.js';
import { hasLocalizedElements, extractLocalizedElements, getEntityKeys } from './features/localized.js';

export class SnowflakeService extends cds.DatabaseService {
  private credentials!: SnowflakeCredentials;
  private sqlApiClient?: SnowflakeSQLAPIClient;
  private sdkClient?: SnowflakeSDKClient;
  private inTransaction = false;

  /**
   * Initialize the service
   */
  async init() {
    // Load configuration
    const config = getSnowflakeConfig();
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

    // Call parent init
    return super.init();
  }

  /**
   * Handle READ operations
   * Supports expand (LEFT JOIN), temporal queries, and localized data
   */
  async read(query: CQN): Promise<any[]> {
    try {
      const select = query.SELECT;
      
      if (!select) {
        throw new Error('Invalid SELECT query');
      }

      // Check if $count is requested
      const needsCount = select.count;

      // Translate to SQL (now with JOIN-based expand support)
      let { sql, params } = cqnToSQL(query, this.credentials);
      
      // Execute query
      let rows = await this.execute(sql, params);

      // Restructure expanded results if needed
      rows = this.restructureExpands(rows, select);

      // Handle $count if requested
      if (needsCount) {
        const countSQL = wrapWithCount(sql);
        const countResult = await this.execute(countSQL, params);
        const count = countResult[0]?.count || 0;
        
        // Attach $count to result set
        (rows as any).$count = count;
      }

      // Return one or many
      if (select.one && rows.length > 0) {
        return rows[0];
      }

      return rows;
    } catch (error) {
      logError('READ operation failed', error);
      throw normalizeError(error);
    }
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
        // Check if this is an expanded field (contains association name prefix)
        let isExpandField = false;

        for (const col of select.columns) {
          if (col.expand && col.ref) {
            const assocName = col.ref[0];
            if (key.startsWith(`${assocName}_`) && key !== `${assocName}_ID`) {
              const fieldName = key.substring(assocName.length + 1);
              if (!expanded.has(assocName)) {
                expanded.set(assocName, {});
              }
              expanded.get(assocName)[fieldName] = value;
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
  async insert(query: CQN): Promise<any> {
    try {
      const insert = query.INSERT;
      
      if (!insert) {
        throw new Error('Invalid INSERT query');
      }

      // Note: CAP runtime handles @readonly checks before reaching adapter
      // Note: CAP runtime fills in cuid, managed fields automatically

      const { sql, params } = cqnToSQL(query, this.credentials);
      
      await this.execute(sql, params);

      // Return inserted entries
      if (insert.entries) {
        return insert.entries;
      }

      return { affectedRows: 1 };
    } catch (error) {
      logError('INSERT operation failed', error);
      throw normalizeError(error);
    }
  }

  /**
   * Handle UPDATE operations
   */
  async update(query: CQN): Promise<number> {
    try {
      const update = query.UPDATE;
      
      if (!update) {
        throw new Error('Invalid UPDATE query');
      }

      // Note: CAP runtime handles @readonly/@insertonly checks before reaching adapter
      // Note: CAP runtime updates managed fields (modifiedAt, modifiedBy) automatically

      const { sql, params } = cqnToSQL(query, this.credentials);
      
      const result = await this.execute(sql, params);

      // Return affected rows count
      return result.length || 0;
    } catch (error) {
      logError('UPDATE operation failed', error);
      throw normalizeError(error);
    }
  }

  /**
   * Handle DELETE operations
   */
  async delete(query: CQN): Promise<number> {
    try {
      const del = query.DELETE;
      
      if (!del) {
        throw new Error('Invalid DELETE query');
      }

      // Note: CAP runtime handles @readonly/@insertonly checks before reaching adapter
      // Note: Compositions trigger cascading deletes automatically via CAP

      const { sql, params } = cqnToSQL(query, this.credentials);
      
      await this.execute(sql, params);

      // Snowflake doesn't return affected rows in same way
      // Return 0 as we can't easily determine
      return 0;
    } catch (error) {
      logError('DELETE operation failed', error);
      throw normalizeError(error);
    }
  }

  /**
   * Handle UPSERT operations (using MERGE)
   */
  async upsert(entity: string, data: any, keys?: string[]): Promise<any> {
    try {
      if (!keys || keys.length === 0) {
        throw new Error('UPSERT requires key fields');
      }

      const { sql, params } = generateMerge(entity, keys, data, this.credentials);
      
      await this.execute(sql, params);

      return data;
    } catch (error) {
      logError('UPSERT operation failed', error);
      throw normalizeError(error);
    }
  }

  /**
   * Run arbitrary SQL
   */
  async run(sql: string, params?: any[]): Promise<any[]> {
    try {
      return await this.execute(sql, params);
    } catch (error) {
      logError('RUN operation failed', error);
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
  async deploy(model: any, options?: any): Promise<void> {
    logInfo('Deploy operation called', options);
    
    // Basic deploy support - could be extended with full DDL generation
    logWarning('Full DDL deployment not yet implemented. Please create Snowflake tables manually.');
    
    // In production implementation, would:
    // 1. Parse model (CSN)
    // 2. Generate CREATE TABLE statements using ddl/deploy.ts
    // 3. Execute DDL statements
  }
}

// Export as default
export default SnowflakeService;

