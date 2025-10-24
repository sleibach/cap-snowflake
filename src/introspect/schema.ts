/**
 * Schema introspection - Import existing Snowflake tables as CDS entities
 */

import { SnowflakeCredentials } from '../config.js';
import { SnowflakeSQLAPIClient } from '../client/sqlapi.js';
import { SnowflakeSDKClient } from '../client/sdk.js';
import { mapSnowflakeTypeToCDS } from '../ddl/types.js';
import { logInfo, logWarning } from '../utils/logger.js';

export interface TableInfo {
  tableName: string;
  tableSchema: string;
  tableType: 'BASE TABLE' | 'VIEW';
  comment?: string;
}

export interface ColumnInfo {
  columnName: string;
  dataType: string;
  isNullable: boolean;
  defaultValue?: string;
  isPrimaryKey: boolean;
  comment?: string;
  characterMaximumLength?: number;
  numericPrecision?: number;
  numericScale?: number;
}

export interface ForeignKeyInfo {
  constraintName: string;
  columnName: string;
  referencedTable: string;
  referencedColumn: string;
}

export interface SchemaDefinition {
  tables: Map<string, TableMetadata>;
}

export interface TableMetadata {
  info: TableInfo;
  columns: ColumnInfo[];
  primaryKeys: string[];
  foreignKeys: ForeignKeyInfo[];
}

/**
 * Schema introspection class
 */
export class SnowflakeSchemaIntrospector {
  private credentials: SnowflakeCredentials;
  private sqlApiClient?: SnowflakeSQLAPIClient;
  private sdkClient?: SnowflakeSDKClient;

  constructor(credentials: SnowflakeCredentials) {
    this.credentials = credentials;

    if (credentials.auth === 'jwt') {
      this.sqlApiClient = new SnowflakeSQLAPIClient(credentials);
    } else {
      this.sdkClient = new SnowflakeSDKClient(credentials);
    }
  }

  /**
   * Connect if using SDK
   */
  async connect(): Promise<void> {
    if (this.sdkClient) {
      await this.sdkClient.connect();
    }
  }

  /**
   * Introspect schema and get all tables
   */
  async introspectSchema(schemaName?: string): Promise<SchemaDefinition> {
    const schema = schemaName || this.credentials.schema;
    if (!schema) {
      throw new Error('Schema name is required for introspection');
    }

    logInfo(`Introspecting schema: ${schema}`);

    const tables = await this.getTables(schema);
    const schemaDefinition: SchemaDefinition = {
      tables: new Map(),
    };

    for (const table of tables) {
      logInfo(`Introspecting table: ${table.tableName}`);
      
      const columns = await this.getColumns(schema, table.tableName);
      const primaryKeys = await this.getPrimaryKeys(schema, table.tableName);
      const foreignKeys = await this.getForeignKeys(schema, table.tableName);

      schemaDefinition.tables.set(table.tableName, {
        info: table,
        columns,
        primaryKeys,
        foreignKeys,
      });
    }

    logInfo(`Introspected ${schemaDefinition.tables.size} tables`);
    return schemaDefinition;
  }

  /**
   * Get all tables in schema
   */
  private async getTables(schemaName: string): Promise<TableInfo[]> {
    const sql = `
      SELECT 
        TABLE_NAME,
        TABLE_SCHEMA,
        TABLE_TYPE,
        COMMENT
      FROM ${this.credentials.database}.INFORMATION_SCHEMA.TABLES
      WHERE TABLE_SCHEMA = ?
        AND TABLE_TYPE IN ('BASE TABLE', 'VIEW')
      ORDER BY TABLE_NAME
    `;

    const rows = await this.execute(sql, [schemaName]);

    return rows.map(row => ({
      tableName: row.TABLE_NAME,
      tableSchema: row.TABLE_SCHEMA,
      tableType: row.TABLE_TYPE,
      comment: row.COMMENT,
    }));
  }

  /**
   * Get columns for a table
   */
  private async getColumns(schemaName: string, tableName: string): Promise<ColumnInfo[]> {
    const sql = `
      SELECT 
        COLUMN_NAME,
        DATA_TYPE,
        IS_NULLABLE,
        COLUMN_DEFAULT,
        COMMENT,
        CHARACTER_MAXIMUM_LENGTH,
        NUMERIC_PRECISION,
        NUMERIC_SCALE
      FROM ${this.credentials.database}.INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = ?
        AND TABLE_NAME = ?
      ORDER BY ORDINAL_POSITION
    `;

    const rows = await this.execute(sql, [schemaName, tableName]);
    const primaryKeys = await this.getPrimaryKeys(schemaName, tableName);

    return rows.map(row => ({
      columnName: row.COLUMN_NAME,
      dataType: row.DATA_TYPE,
      isNullable: row.IS_NULLABLE === 'YES',
      defaultValue: row.COLUMN_DEFAULT,
      isPrimaryKey: primaryKeys.includes(row.COLUMN_NAME),
      comment: row.COMMENT,
      characterMaximumLength: row.CHARACTER_MAXIMUM_LENGTH,
      numericPrecision: row.NUMERIC_PRECISION,
      numericScale: row.NUMERIC_SCALE,
    }));
  }

  /**
   * Get primary key columns
   */
  private async getPrimaryKeys(schemaName: string, tableName: string): Promise<string[]> {
    const sql = `
      SELECT COLUMN_NAME
      FROM ${this.credentials.database}.INFORMATION_SCHEMA.TABLE_CONSTRAINTS tc
      JOIN ${this.credentials.database}.INFORMATION_SCHEMA.KEY_COLUMN_USAGE kcu
        ON tc.CONSTRAINT_NAME = kcu.CONSTRAINT_NAME
        AND tc.TABLE_SCHEMA = kcu.TABLE_SCHEMA
        AND tc.TABLE_NAME = kcu.TABLE_NAME
      WHERE tc.TABLE_SCHEMA = ?
        AND tc.TABLE_NAME = ?
        AND tc.CONSTRAINT_TYPE = 'PRIMARY KEY'
      ORDER BY kcu.ORDINAL_POSITION
    `;

    try {
      const rows = await this.execute(sql, [schemaName, tableName]);
      return rows.map(row => row.COLUMN_NAME);
    } catch (error) {
      // Primary key info might not be available
      logWarning(`Could not retrieve primary keys for ${tableName}`);
      return [];
    }
  }

  /**
   * Get foreign keys
   */
  private async getForeignKeys(schemaName: string, tableName: string): Promise<ForeignKeyInfo[]> {
    // Note: Snowflake doesn't enforce foreign keys, but they can be defined for metadata
    const sql = `
      SELECT 
        rc.CONSTRAINT_NAME,
        kcu.COLUMN_NAME,
        kcu2.TABLE_NAME as REFERENCED_TABLE,
        kcu2.COLUMN_NAME as REFERENCED_COLUMN
      FROM ${this.credentials.database}.INFORMATION_SCHEMA.REFERENTIAL_CONSTRAINTS rc
      JOIN ${this.credentials.database}.INFORMATION_SCHEMA.KEY_COLUMN_USAGE kcu
        ON rc.CONSTRAINT_NAME = kcu.CONSTRAINT_NAME
        AND rc.CONSTRAINT_SCHEMA = kcu.TABLE_SCHEMA
      JOIN ${this.credentials.database}.INFORMATION_SCHEMA.KEY_COLUMN_USAGE kcu2
        ON rc.UNIQUE_CONSTRAINT_NAME = kcu2.CONSTRAINT_NAME
        AND rc.UNIQUE_CONSTRAINT_SCHEMA = kcu2.TABLE_SCHEMA
      WHERE kcu.TABLE_SCHEMA = ?
        AND kcu.TABLE_NAME = ?
    `;

    try {
      const rows = await this.execute(sql, [schemaName, tableName]);
      return rows.map(row => ({
        constraintName: row.CONSTRAINT_NAME,
        columnName: row.COLUMN_NAME,
        referencedTable: row.REFERENCED_TABLE,
        referencedColumn: row.REFERENCED_COLUMN,
      }));
    } catch (error) {
      // Foreign key info might not be available
      logWarning(`Could not retrieve foreign keys for ${tableName}`);
      return [];
    }
  }

  /**
   * Execute SQL query
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
   * Disconnect
   */
  async disconnect(): Promise<void> {
    if (this.sdkClient) {
      await this.sdkClient.disconnect();
    }
  }
}

/**
 * Generate CDS model from schema definition
 */
export function generateCDSModel(schemaDefinition: SchemaDefinition, namespace = 'imported'): string {
  const lines: string[] = [];

  lines.push(`namespace ${namespace};`);
  lines.push('');
  lines.push('// Auto-generated from Snowflake schema');
  lines.push('// Generated: ' + new Date().toISOString());
  lines.push('');

  for (const [tableName, metadata] of schemaDefinition.tables) {
    lines.push(...generateEntityDefinition(tableName, metadata));
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Generate single entity definition
 */
function generateEntityDefinition(tableName: string, metadata: TableMetadata): string[] {
  const lines: string[] = [];

  // Add comment if available
  if (metadata.info.comment) {
    lines.push(`// ${metadata.info.comment}`);
  }

  // Mark as view if applicable
  const isView = metadata.info.tableType === 'VIEW';
  if (isView) {
    lines.push('@readonly');
  }

  // Entity name (convert to PascalCase)
  const entityName = toPascalCase(tableName);
  lines.push(`entity ${entityName} {`);

  // Generate columns
  for (const column of metadata.columns) {
    lines.push(...generateColumnDefinition(column, metadata));
  }

  lines.push('}');

  return lines;
}

/**
 * Generate column definition
 */
function generateColumnDefinition(column: ColumnInfo, metadata: TableMetadata): string[] {
  const lines: string[] = [];
  const indent = '  ';

  // Add comment if available
  if (column.comment) {
    lines.push(`${indent}// ${column.comment}`);
  }

  // Key annotation
  const annotations: string[] = [];
  if (column.isPrimaryKey) {
    annotations.push('key');
  }

  // Map Snowflake type to CDS type
  let cdsType = mapSnowflakeTypeToCDS(column.dataType);

  // Add length/precision if needed
  if (column.characterMaximumLength && cdsType === 'cds.String') {
    cdsType = `String(${column.characterMaximumLength})`;
  } else if (column.numericPrecision && cdsType === 'cds.Decimal') {
    const scale = column.numericScale || 0;
    cdsType = `Decimal(${column.numericPrecision}, ${scale})`;
  }

  // Clean up cds. prefix for common types
  cdsType = cdsType.replace('cds.', '');

  // Build column definition
  const keyPrefix = annotations.length > 0 ? 'key ' : '';
  let columnDef = `${indent}${keyPrefix}${toCamelCase(column.columnName)} : ${cdsType}`;

  // Not null annotation (skip for keys, they're always not null)
  if (!column.isNullable && !column.isPrimaryKey) {
    columnDef += ' @mandatory';
  }

  // Check if this is a foreign key
  const fk = metadata.foreignKeys.find(fk => fk.columnName === column.columnName);
  if (fk) {
    // Generate association
    const referencedEntity = toPascalCase(fk.referencedTable);
    columnDef = `${indent}${toCamelCase(column.columnName)} : Association to ${referencedEntity}`;
  }

  columnDef += ';';
  lines.push(columnDef);

  return lines;
}

/**
 * Convert SNAKE_CASE to PascalCase
 */
function toPascalCase(str: string): string {
  return str
    .toLowerCase()
    .split('_')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join('');
}

/**
 * Convert SNAKE_CASE to camelCase
 */
function toCamelCase(str: string): string {
  const pascal = toPascalCase(str);
  return pascal.charAt(0).toLowerCase() + pascal.slice(1);
}

