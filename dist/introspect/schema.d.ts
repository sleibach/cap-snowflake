/**
 * Schema introspection - Import existing Snowflake tables as CDS entities
 */
import { SnowflakeCredentials } from '../config.js';
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
export declare class SnowflakeSchemaIntrospector {
    private credentials;
    private sqlApiClient?;
    private sdkClient?;
    constructor(credentials: SnowflakeCredentials);
    /**
     * Connect if using SDK
     */
    connect(): Promise<void>;
    /**
     * Introspect schema and get all tables.
     *
     * Performs exactly 4 SQL queries total (tables + 3 batch metadata queries),
     * regardless of the number of tables in the schema.
     */
    introspectSchema(schemaName?: string): Promise<SchemaDefinition>;
    /**
     * Get all tables and views in the schema.
     */
    private getTables;
    /**
     * Fetch all columns for the entire schema in one query.
     * Returns a map from table name to ordered column rows.
     */
    private getAllColumns;
    /**
     * Fetch all primary key columns for the entire schema in one query.
     * Returns a map from table name to ordered PK column names.
     */
    private getAllPrimaryKeys;
    /**
     * Fetch all foreign keys for the entire schema in one query.
     * Returns a map from table name to FK info records.
     *
     * Note: Snowflake does not enforce FKs, but they can be defined for metadata.
     */
    private getAllForeignKeys;
    /**
     * Execute SQL query
     */
    private execute;
    /**
     * Disconnect
     */
    disconnect(): Promise<void>;
}
/**
 * Generate CDS model from schema definition
 */
export declare function generateCDSModel(schemaDefinition: SchemaDefinition, namespace?: string): string;
//# sourceMappingURL=schema.d.ts.map