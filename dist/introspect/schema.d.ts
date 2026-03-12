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
 * Schema introspection class
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
     * Introspect schema and get all tables
     */
    introspectSchema(schemaName?: string): Promise<SchemaDefinition>;
    /**
     * Get all tables in schema
     */
    private getTables;
    /**
     * Get columns for a table
     */
    private getColumns;
    /**
     * Get primary key columns
     */
    private getPrimaryKeys;
    /**
     * Get foreign keys
     */
    private getForeignKeys;
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