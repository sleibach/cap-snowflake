/**
 * DDL generation for cds deploy
 */
import { SnowflakeCredentials } from '../config.js';
export interface EntityDefinition {
    name: string;
    kind: string;
    elements: Record<string, ElementDefinition>;
    keys?: string[];
}
export interface ElementDefinition {
    type: string;
    length?: number;
    precision?: number;
    scale?: number;
    notNull?: boolean;
    default?: any;
    key?: boolean;
    vectorConfig?: {
        dimensions: number;
    };
}
/**
 * Generate CREATE TABLE statement
 */
export declare function generateCreateTable(entity: EntityDefinition, credentials: SnowflakeCredentials, ifNotExists?: boolean): string;
/**
 * Generate column definition
 */
export declare function generateColumnDefinition(name: string, element: ElementDefinition): string;
/**
 * Generate CREATE VIEW statement
 */
export declare function generateCreateView(viewName: string, selectSQL: string, credentials: SnowflakeCredentials, orReplace?: boolean): string;
/**
 * Generate DROP TABLE statement
 */
export declare function generateDropTable(tableName: string, credentials: SnowflakeCredentials, ifExists?: boolean): string;
/**
 * Generate CREATE SEQUENCE statement (for auto-increment)
 */
export declare function generateCreateSequence(sequenceName: string, credentials: SnowflakeCredentials): string;
interface DeployOptions {
    createViews?: boolean;
    migrate?: boolean;
}
/**
 * Generate deploy SQL statements from a CSN model.
 */
export declare function buildDeployStatements(model: any, credentials: SnowflakeCredentials, options?: DeployOptions): string[];
/**
 * Generate ALTER TABLE ADD COLUMN statements for new columns found in CSN but missing
 * from the existing database schema (safe migration — never drops columns).
 *
 * @param model       The CDS model
 * @param existingCols Map of tableName (upper) → Set of existing column names (upper)
 * @param credentials Snowflake credentials for identifier qualification
 */
export declare function generateMigrationStatements(model: any, existingCols: Map<string, Set<string>>, credentials: SnowflakeCredentials): string[];
/**
 * Generate a CREATE EXTERNAL TABLE statement for entities annotated with @Snowflake.external.
 */
export declare function generateExternalTable(tableName: string, stage: string, fileFormat: string, pattern: string | undefined, credentials: SnowflakeCredentials): string;
/**
 * Build ALTER TABLE statements to apply @Snowflake.* annotation-driven features
 * after the base CREATE TABLE statement has been issued.
 *
 * This function is synchronous and returns an array of DDL strings.
 * The caller is responsible for executing them in order.
 *
 * Supported annotations (entity-level unless noted):
 *   @Snowflake.clustering        → ALTER TABLE ... CLUSTER BY (col1, col2)
 *   @Snowflake.dataRetentionDays → ALTER TABLE ... SET DATA_RETENTION_TIME_IN_DAYS = n
 *   @Snowflake.searchOptimized   → ALTER TABLE ... ADD SEARCH OPTIMIZATION
 *   @Snowflake.tags              → ALTER TABLE ... SET TAG key = 'value'
 *   @Snowflake.rowAccessPolicy   → ALTER TABLE ... ADD ROW ACCESS POLICY policy ON (cols)
 *   @Snowflake.maskingPolicy     → ALTER TABLE ... MODIFY COLUMN col SET MASKING POLICY policy
 *   @Snowflake.tags (per-column) → ALTER TABLE ... MODIFY COLUMN col SET TAG key = 'value'
 */
export declare function buildSnowflakeAnnotationStatements(entityName: string, definition: any, credentials: SnowflakeCredentials): string[];
export {};
//# sourceMappingURL=deploy.d.ts.map