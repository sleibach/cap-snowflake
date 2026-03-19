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
 * Schema introspection class.
 *
 * Uses three batch queries against INFORMATION_SCHEMA (one per schema, not one
 * per table) so that a schema with N tables requires exactly 3 round-trips
 * regardless of N.
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
   * Introspect schema and get all tables.
   *
   * Performs exactly 4 SQL queries total (tables + 3 batch metadata queries),
   * regardless of the number of tables in the schema.
   */
  async introspectSchema(schemaName?: string): Promise<SchemaDefinition> {
    const schema = schemaName || this.credentials.schema;
    if (!schema) {
      throw new Error('Schema name is required for introspection');
    }

    // Snowflake INFORMATION_SCHEMA stores schema names in UPPERCASE.
    // Normalise here so that callers can pass either casing.
    const normalizedSchema = schema.toUpperCase();

    logInfo(`Introspecting schema: ${schema}`);

    const tables = await this.getTables(normalizedSchema);
    if (tables.length === 0) {
      logInfo(`No tables found in schema: ${schema}`);
      return { tables: new Map() };
    }

    // Batch-fetch all metadata — one query per resource type, not per table
    const allColumns = await this.getAllColumns(normalizedSchema);
    const allPrimaryKeys = await this.getAllPrimaryKeys(normalizedSchema);
    const allForeignKeys = await this.getAllForeignKeys(normalizedSchema);

    const schemaDefinition: SchemaDefinition = { tables: new Map() };

    for (const table of tables) {
      const tableName = table.tableName;
      schemaDefinition.tables.set(tableName, {
        info: table,
        columns: buildColumns(
          allColumns.get(tableName) ?? [],
          allPrimaryKeys.get(tableName) ?? []
        ),
        primaryKeys: allPrimaryKeys.get(tableName) ?? [],
        foreignKeys: allForeignKeys.get(tableName) ?? [],
      });
    }

    logInfo(`Introspected ${schemaDefinition.tables.size} tables`);
    return schemaDefinition;
  }

  /**
   * Get all tables and views in the schema.
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
      tableType: row.TABLE_TYPE as 'BASE TABLE' | 'VIEW',
      comment: row.COMMENT || undefined,
    }));
  }

  /**
   * Fetch all columns for the entire schema in one query.
   * Returns a map from table name to ordered column rows.
   */
  private async getAllColumns(schemaName: string): Promise<Map<string, any[]>> {
    const sql = `
      SELECT
        TABLE_NAME,
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
      ORDER BY TABLE_NAME, ORDINAL_POSITION
    `;

    const rows = await this.execute(sql, [schemaName]);
    return groupBy(rows, row => row.TABLE_NAME);
  }

  /**
   * Fetch all primary key columns for the entire schema in one query.
   * Returns a map from table name to ordered PK column names.
   */
  private async getAllPrimaryKeys(schemaName: string): Promise<Map<string, string[]>> {
    const sql = `
      SELECT kcu.TABLE_NAME, kcu.COLUMN_NAME
      FROM ${this.credentials.database}.INFORMATION_SCHEMA.TABLE_CONSTRAINTS tc
      JOIN ${this.credentials.database}.INFORMATION_SCHEMA.KEY_COLUMN_USAGE kcu
        ON tc.CONSTRAINT_NAME = kcu.CONSTRAINT_NAME
        AND tc.TABLE_SCHEMA = kcu.TABLE_SCHEMA
        AND tc.TABLE_NAME = kcu.TABLE_NAME
      WHERE tc.TABLE_SCHEMA = ?
        AND tc.CONSTRAINT_TYPE = 'PRIMARY KEY'
      ORDER BY kcu.TABLE_NAME, kcu.ORDINAL_POSITION
    `;

    try {
      const rows = await this.execute(sql, [schemaName]);
      const grouped = groupBy(rows, row => row.TABLE_NAME);
      const result = new Map<string, string[]>();
      for (const [tbl, pkRows] of grouped) {
        result.set(tbl, pkRows.map(r => r.COLUMN_NAME));
      }
      return result;
    } catch (error) {
      logWarning(`Could not retrieve primary key metadata for schema ${schemaName}`, {
        error: (error as any)?.message,
      });
      return new Map();
    }
  }

  /**
   * Fetch all foreign keys for the entire schema in one query.
   * Returns a map from table name to FK info records.
   *
   * Note: Snowflake does not enforce FKs, but they can be defined for metadata.
   */
  private async getAllForeignKeys(schemaName: string): Promise<Map<string, ForeignKeyInfo[]>> {
    const sql = `
      SELECT
        kcu.TABLE_NAME,
        rc.CONSTRAINT_NAME,
        kcu.COLUMN_NAME,
        kcu2.TABLE_NAME AS REFERENCED_TABLE,
        kcu2.COLUMN_NAME AS REFERENCED_COLUMN
      FROM ${this.credentials.database}.INFORMATION_SCHEMA.REFERENTIAL_CONSTRAINTS rc
      JOIN ${this.credentials.database}.INFORMATION_SCHEMA.KEY_COLUMN_USAGE kcu
        ON rc.CONSTRAINT_NAME = kcu.CONSTRAINT_NAME
        AND rc.CONSTRAINT_SCHEMA = kcu.TABLE_SCHEMA
      JOIN ${this.credentials.database}.INFORMATION_SCHEMA.KEY_COLUMN_USAGE kcu2
        ON rc.UNIQUE_CONSTRAINT_NAME = kcu2.CONSTRAINT_NAME
        AND rc.UNIQUE_CONSTRAINT_SCHEMA = kcu2.TABLE_SCHEMA
      WHERE kcu.TABLE_SCHEMA = ?
      ORDER BY kcu.TABLE_NAME
    `;

    try {
      const rows = await this.execute(sql, [schemaName]);
      const grouped = groupBy(rows, row => row.TABLE_NAME);
      const result = new Map<string, ForeignKeyInfo[]>();
      for (const [tbl, fkRows] of grouped) {
        result.set(tbl, fkRows.map(r => ({
          constraintName: r.CONSTRAINT_NAME,
          columnName: r.COLUMN_NAME,
          referencedTable: r.REFERENCED_TABLE,
          referencedColumn: r.REFERENCED_COLUMN,
        })));
      }
      return result;
    } catch (error) {
      logWarning(`Could not retrieve foreign key metadata for schema ${schemaName}`, {
        error: (error as any)?.message,
      });
      return new Map();
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

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

/**
 * Group an array of rows by a key-extracting function into a Map.
 */
function groupBy<T>(rows: T[], keyFn: (row: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const row of rows) {
    const key = keyFn(row);
    const existing = map.get(key);
    if (existing) {
      existing.push(row);
    } else {
      map.set(key, [row]);
    }
  }
  return map;
}

/**
 * Build ColumnInfo records from raw column rows and the pre-fetched PK set.
 */
function buildColumns(columnRows: any[], primaryKeys: string[]): ColumnInfo[] {
  const pkSet = new Set(primaryKeys);
  return columnRows.map(row => ({
    columnName: row.COLUMN_NAME,
    dataType: row.DATA_TYPE,
    isNullable: row.IS_NULLABLE === 'YES',
    defaultValue: row.COLUMN_DEFAULT ?? undefined,
    isPrimaryKey: pkSet.has(row.COLUMN_NAME),
    comment: row.COMMENT || undefined,
    characterMaximumLength: row.CHARACTER_MAXIMUM_LENGTH ?? undefined,
    numericPrecision: row.NUMERIC_PRECISION ?? undefined,
    numericScale: row.NUMERIC_SCALE ?? undefined,
  }));
}

// ---------------------------------------------------------------------------
// CDS model generation
// ---------------------------------------------------------------------------

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

  // Compute star schema hints
  const starAnnotations = computeStarSchemaAnnotations(schemaDefinition);

  for (const [tableName, metadata] of schemaDefinition.tables) {
    const annotation = starAnnotations.get(tableName);
    const isFact = annotation === '@Analytics.dataCategory: #FACT';
    if (annotation) {
      lines.push(annotation);
    }
    lines.push(...generateEntityDefinition(tableName, metadata, isFact));
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Detect fact vs dimension tables and return Analytics.dataCategory annotations.
 * Heuristic:
 *   Fact: entity has ≥ 3 Association (FK) elements → @Analytics.dataCategory: #FACT
 *   Dimension: entity has 0–1 associations AND is referenced by a fact → @Analytics.dataCategory: #DIMENSION
 */
function computeStarSchemaAnnotations(schema: SchemaDefinition): Map<string, string> {
  const annotations = new Map<string, string>();
  const fkCounts = new Map<string, number>();
  const referencedBy = new Map<string, Set<string>>(); // targetTable → set of tables referencing it

  for (const [tableName, metadata] of schema.tables) {
    const fkCount = metadata.foreignKeys.length;
    fkCounts.set(tableName, fkCount);
    for (const fk of metadata.foreignKeys) {
      const refs = referencedBy.get(fk.referencedTable) ?? new Set();
      refs.add(tableName);
      referencedBy.set(fk.referencedTable, refs);
    }
  }

  const factTables = new Set<string>();
  for (const [tableName, count] of fkCounts) {
    if (count >= 3) {
      factTables.add(tableName);
      annotations.set(tableName, '@Analytics.dataCategory: #FACT');
    }
  }

  for (const [tableName, referrers] of referencedBy) {
    if (annotations.has(tableName)) continue; // already annotated as FACT
    const ownFkCount = fkCounts.get(tableName) ?? 0;
    const isReferencedByFact = [...referrers].some(r => factTables.has(r));
    if (ownFkCount <= 1 && isReferencedByFact) {
      annotations.set(tableName, '@Analytics.dataCategory: #DIMENSION');
    }
  }

  return annotations;
}

/**
 * Generate single entity definition
 */
function generateEntityDefinition(tableName: string, metadata: TableMetadata, isFact: boolean): string[] {
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

  // Always emit the physical table name so deploying the generated CDS maps
  // back to the original table and doesn't create a new one named after the
  // PascalCase entity.
  lines.push(`@cds.persistence.name: '${tableName}'`);

  // Entity name (convert to PascalCase)
  const entityName = toPascalCase(tableName);
  lines.push(`entity ${entityName} {`);

  // Generate columns
  for (const column of metadata.columns) {
    lines.push(...generateColumnDefinition(column, metadata, isFact));
  }

  lines.push('}');

  return lines;
}

/** Numeric CDS types that qualify for @Aggregation.default on FACT tables */
const MEASURE_TYPES = new Set(['Integer', 'Integer64', 'Decimal', 'Double']);

/**
 * Generate column definition
 */
function generateColumnDefinition(column: ColumnInfo, metadata: TableMetadata, isFact: boolean): string[] {
  const lines: string[] = [];
  const indent = '  ';

  // Add comment if available
  if (column.comment) {
    lines.push(`${indent}// ${column.comment}`);
  }

  // Check if this is a foreign key — generate Association instead of scalar
  const fk = metadata.foreignKeys.find(fk => fk.columnName === column.columnName);
  if (fk) {
    const referencedEntity = toPascalCase(fk.referencedTable);
    lines.push(`${indent}${toCamelCase(column.columnName)} : Association to ${referencedEntity};`);
    return lines;
  }

  // Map Snowflake type to CDS type
  let cdsType = mapSnowflakeTypeToCDS(column.dataType);

  // Add length/precision if needed
  if (column.characterMaximumLength && cdsType === 'cds.String') {
    cdsType = `String(${column.characterMaximumLength})`;
  } else if (column.numericPrecision && cdsType === 'cds.Decimal') {
    const scale = column.numericScale ?? 0;
    cdsType = `Decimal(${column.numericPrecision}, ${scale})`;
  } else {
    // Strip cds. prefix for common types
    cdsType = cdsType.replace(/^cds\./, '');
  }

  // @Aggregation.default for numeric measure columns on FACT tables
  const baseType = cdsType.split('(')[0]; // e.g. "Decimal" from "Decimal(10, 2)"
  if (isFact && !column.isPrimaryKey && MEASURE_TYPES.has(baseType)) {
    lines.push(`${indent}@Aggregation.default: #SUM`);
  }

  // Key annotation
  const keyPrefix = column.isPrimaryKey ? 'key ' : '';

  let columnDef = `${indent}${keyPrefix}${toCamelCase(column.columnName)} : ${cdsType}`;

  // Not null annotation (skip for keys — they are always not null)
  if (!column.isNullable && !column.isPrimaryKey) {
    columnDef += ' @mandatory';
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
