/**
 * Schema introspection - Import existing Snowflake tables as CDS entities
 */
import { SnowflakeSQLAPIClient } from '../client/sqlapi.js';
import { SnowflakeSDKClient } from '../client/sdk.js';
import { mapSnowflakeTypeToCDS } from '../ddl/types.js';
import { logInfo, logWarning } from '../utils/logger.js';
/**
 * Schema introspection class.
 *
 * Uses three batch queries against INFORMATION_SCHEMA (one per schema, not one
 * per table) so that a schema with N tables requires exactly 3 round-trips
 * regardless of N.
 */
export class SnowflakeSchemaIntrospector {
    credentials;
    sqlApiClient;
    sdkClient;
    constructor(credentials) {
        this.credentials = credentials;
        if (credentials.auth === 'jwt') {
            this.sqlApiClient = new SnowflakeSQLAPIClient(credentials);
        }
        else {
            this.sdkClient = new SnowflakeSDKClient(credentials);
        }
    }
    /**
     * Connect if using SDK
     */
    async connect() {
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
    async introspectSchema(schemaName) {
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
        const vectorDimensions = await this.getVectorDimensions(normalizedSchema);
        // Merge VECTOR dimensions into column rows so buildColumns can reconstruct
        // the full type string (e.g. VECTOR(FLOAT, 1536)).
        for (const [tableName, columnRows] of allColumns) {
            const tableDims = vectorDimensions.get(tableName);
            if (!tableDims)
                continue;
            for (const row of columnRows) {
                if (row.DATA_TYPE === 'VECTOR') {
                    const dim = tableDims.get(row.COLUMN_NAME);
                    if (dim)
                        row._vectorDim = dim;
                }
            }
        }
        const schemaDefinition = { tables: new Map() };
        for (const table of tables) {
            const tableName = table.tableName;
            schemaDefinition.tables.set(tableName, {
                info: table,
                columns: buildColumns(allColumns.get(tableName) ?? [], allPrimaryKeys.get(tableName) ?? []),
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
    async getTables(schemaName) {
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
            comment: row.COMMENT || undefined,
        }));
    }
    /**
     * Fetch all columns for the entire schema in one query.
     * Returns a map from table name to ordered column rows.
     */
    async getAllColumns(schemaName) {
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
     * Fetch all primary key columns for the entire schema using SHOW PRIMARY KEYS.
     * Returns a map from table name to ordered PK column names.
     *
     * TABLE_CONSTRAINTS / KEY_COLUMN_USAGE is unreliable in Snowflake —
     * SHOW PRIMARY KEYS IN SCHEMA is the authoritative source.
     */
    async getAllPrimaryKeys(schemaName) {
        try {
            // SHOW PRIMARY KEYS does not accept bind parameters — the schema name is
            // already normalised to UPPERCASE at the call site so injection risk is
            // negligible in this context (introspection-only, not user-facing SQL).
            const rows = await this.execute(`SHOW PRIMARY KEYS IN SCHEMA ${this.credentials.database}.${schemaName}`);
            // SHOW commands return lowercase column names: table_name, column_name, key_sequence
            const result = new Map();
            for (const row of rows) {
                const tableName = (row.table_name ?? row.TABLE_NAME);
                const colName = (row.column_name ?? row.COLUMN_NAME);
                if (!tableName || !colName)
                    continue;
                const existing = result.get(tableName);
                if (existing) {
                    existing.push(colName);
                }
                else {
                    result.set(tableName, [colName]);
                }
            }
            return result;
        }
        catch (error) {
            logWarning(`Could not retrieve primary key metadata for schema ${schemaName}`, {
                error: error?.message,
            });
            return new Map();
        }
    }
    /**
     * Fetch VECTOR column dimensions for the entire schema using SHOW COLUMNS.
     * Returns Map<tableName, Map<columnName, dimension>>.
     *
     * INFORMATION_SCHEMA.COLUMNS reports VECTOR type as bare 'VECTOR' without
     * the dimension.  SHOW COLUMNS includes a JSON `data_type` field that
     * contains the full vector metadata, e.g.
     *   {"type":"VECTOR","length":1536,"vectorElementType":"float",...}
     */
    async getVectorDimensions(schemaName) {
        const result = new Map();
        try {
            const rows = await this.execute(`SHOW COLUMNS IN SCHEMA ${this.credentials.database}.${schemaName}`);
            for (const row of rows) {
                const tableName = (row.table_name ?? row.TABLE_NAME);
                const colName = (row.column_name ?? row.COLUMN_NAME);
                const dataTypeRaw = row.data_type ?? row.DATA_TYPE;
                if (!tableName || !colName || dataTypeRaw == null)
                    continue;
                let parsed;
                if (typeof dataTypeRaw === 'object') {
                    parsed = dataTypeRaw;
                }
                else {
                    try {
                        parsed = JSON.parse(dataTypeRaw);
                    }
                    catch {
                        continue;
                    }
                }
                if (parsed?.type === 'VECTOR' && (parsed?.dimension ?? parsed?.length)) {
                    const dim = (parsed.dimension ?? parsed.length);
                    let tableMap = result.get(tableName);
                    if (!tableMap) {
                        tableMap = new Map();
                        result.set(tableName, tableMap);
                    }
                    tableMap.set(colName, dim);
                }
            }
        }
        catch (error) {
            logWarning('Could not retrieve VECTOR column dimensions via SHOW COLUMNS', {
                error: error?.message,
            });
        }
        return result;
    }
    /**
     * Fetch all foreign keys for the entire schema in one query.
     * Returns a map from table name to FK info records.
     *
     * Note: Snowflake does not enforce FKs, but they can be defined for metadata.
     */
    async getAllForeignKeys(schemaName) {
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
            const result = new Map();
            for (const [tbl, fkRows] of grouped) {
                result.set(tbl, fkRows.map(r => ({
                    constraintName: r.CONSTRAINT_NAME,
                    columnName: r.COLUMN_NAME,
                    referencedTable: r.REFERENCED_TABLE,
                    referencedColumn: r.REFERENCED_COLUMN,
                })));
            }
            return result;
        }
        catch (error) {
            logWarning(`Could not retrieve foreign key metadata for schema ${schemaName}`, {
                error: error?.message,
            });
            return new Map();
        }
    }
    /**
     * Execute SQL query
     */
    async execute(sql, params) {
        if (this.sqlApiClient) {
            const result = await this.sqlApiClient.execute(sql, params);
            return SnowflakeSQLAPIClient.parseRows(result);
        }
        else if (this.sdkClient) {
            const result = await this.sdkClient.execute(sql, params);
            return result.rows;
        }
        throw new Error('No client available');
    }
    /**
     * Disconnect
     */
    async disconnect() {
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
function groupBy(rows, keyFn) {
    const map = new Map();
    for (const row of rows) {
        const key = keyFn(row);
        const existing = map.get(key);
        if (existing) {
            existing.push(row);
        }
        else {
            map.set(key, [row]);
        }
    }
    return map;
}
/**
 * Build ColumnInfo records from raw column rows and the pre-fetched PK set.
 */
function buildColumns(columnRows, primaryKeys) {
    const pkSet = new Set(primaryKeys);
    return columnRows.map(row => {
        // Snowflake INFORMATION_SCHEMA stores NUMBER types internally as 'FIXED'.
        // Reconstruct the proper NUMBER(p,s) string so mapSnowflakeTypeToCDS works.
        let dataType = row.DATA_TYPE;
        if (dataType === 'FIXED' || dataType === 'NUMBER') {
            const p = row.NUMERIC_PRECISION;
            const s = row.NUMERIC_SCALE;
            // Reconstruct proper type string. Scale > 0 → Decimal; otherwise keep
            // bare NUMBER so it round-trips as cds.Integer without inflating precision.
            if (s != null && s > 0) {
                dataType = `NUMBER(${p},${s})`;
            }
            else {
                dataType = 'NUMBER';
            }
        }
        else if (dataType === 'VECTOR' && row._vectorDim) {
            // Dimension was populated by getVectorDimensions() via SHOW COLUMNS.
            dataType = `VECTOR(FLOAT, ${row._vectorDim})`;
        }
        return {
            columnName: row.COLUMN_NAME,
            dataType,
            isNullable: row.IS_NULLABLE === 'YES',
            defaultValue: row.COLUMN_DEFAULT ?? undefined,
            isPrimaryKey: pkSet.has(row.COLUMN_NAME),
            comment: row.COMMENT || undefined,
            characterMaximumLength: row.CHARACTER_MAXIMUM_LENGTH ?? undefined,
            numericPrecision: row.NUMERIC_PRECISION ?? undefined,
            numericScale: row.NUMERIC_SCALE ?? undefined,
        };
    });
}
// ---------------------------------------------------------------------------
// CDS model generation
// ---------------------------------------------------------------------------
/**
 * Generate CDS model from schema definition
 */
export function generateCDSModel(schemaDefinition, namespace = 'imported') {
    const lines = [];
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
function computeStarSchemaAnnotations(schema) {
    const annotations = new Map();
    const fkCounts = new Map();
    const referencedBy = new Map(); // targetTable → set of tables referencing it
    for (const [tableName, metadata] of schema.tables) {
        const fkCount = metadata.foreignKeys.length;
        fkCounts.set(tableName, fkCount);
        for (const fk of metadata.foreignKeys) {
            const refs = referencedBy.get(fk.referencedTable) ?? new Set();
            refs.add(tableName);
            referencedBy.set(fk.referencedTable, refs);
        }
    }
    const factTables = new Set();
    for (const [tableName, count] of fkCounts) {
        if (count >= 3) {
            factTables.add(tableName);
            annotations.set(tableName, '@Analytics.dataCategory: #FACT');
        }
    }
    for (const [tableName, referrers] of referencedBy) {
        if (annotations.has(tableName))
            continue; // already annotated as FACT
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
function generateEntityDefinition(tableName, metadata, isFact) {
    const lines = [];
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
function generateColumnDefinition(column, metadata, isFact) {
    const lines = [];
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
    }
    else if (column.numericPrecision && cdsType === 'cds.Decimal') {
        const scale = column.numericScale ?? 0;
        cdsType = `Decimal(${column.numericPrecision}, ${scale})`;
    }
    else {
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
function toPascalCase(str) {
    return str
        .toLowerCase()
        .split('_')
        .map(word => word.charAt(0).toUpperCase() + word.slice(1))
        .join('');
}
/**
 * Convert SNAKE_CASE to camelCase
 */
function toCamelCase(str) {
    const pascal = toPascalCase(str);
    return pascal.charAt(0).toLowerCase() + pascal.slice(1);
}
//# sourceMappingURL=schema.js.map