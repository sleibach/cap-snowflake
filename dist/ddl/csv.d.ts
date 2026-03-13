/**
 * CSV initial data loading for Snowflake.
 *
 * Uses cds.deploy.prepare() (CAP built-in) to discover CSV/JSON files in
 * db/data/ and parses them with cds.parse.csv().
 *
 * Each CSV file is loaded via a Snowflake MERGE statement so the operation is
 * idempotent: rows are upserted (matched by entity keys).
 */
import { SnowflakeCredentials } from '../config.js';
import { SnowflakeSQLAPIClient } from '../client/sqlapi.js';
import { SnowflakeSDKClient } from '../client/sdk.js';
export interface CsvLoadResult {
    loaded: number;
    skipped: number;
}
/**
 * Discover and load CSV initial data files into Snowflake tables.
 * Called after DDL deployment. Idempotent — uses MERGE semantics.
 *
 * @param model       Loaded CDS model (must have $sources for file discovery)
 * @param credentials Snowflake credentials (for table name qualification)
 * @param client      Connected SQL API or SDK client
 */
export declare function loadCsvData(model: any, credentials: SnowflakeCredentials, client: SnowflakeSQLAPIClient | SnowflakeSDKClient): Promise<CsvLoadResult>;
/**
 * Extract physical key column names from a CSN entity definition.
 * Falls back to checking elements for `key: true` if `.keys` is absent.
 */
export declare function getKeyColumns(entityDef: any): string[];
/**
 * Build a Snowflake MERGE statement for a batch of CSV rows.
 *
 * Generated SQL:
 *   MERGE INTO <table> AS target
 *   USING (SELECT ? AS COL1, ? AS COL2, ... UNION ALL ...) AS src
 *   ON (target.KEY = src.KEY)
 *   WHEN MATCHED THEN UPDATE SET target.NON_KEY = src.NON_KEY, ...
 *   WHEN NOT MATCHED THEN INSERT (COL1, ...) VALUES (src.COL1, ...)
 *
 * @param tableName   Fully qualified Snowflake table name
 * @param physCols    Physical column names aligned with CSV columns
 * @param keyColumns  Key columns for the ON match condition (empty → match all)
 * @param rows        Batch of CSV rows (each row aligned with physCols)
 */
export declare function buildMergeSql(tableName: string, physCols: string[], keyColumns: string[], rows: any[][]): {
    sql: string;
    params: any[];
};
//# sourceMappingURL=csv.d.ts.map