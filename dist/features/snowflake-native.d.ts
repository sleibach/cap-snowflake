/**
 * Typed accessors for @Snowflake.* CDS annotations.
 *
 * All helpers read from standard CDS annotation convention:
 *   obj['@Snowflake.<name>']
 *
 * No other file should hard-code annotation string paths.
 */
export interface VectorConfig {
    dimensions: number;
    similarity: string;
}
export interface RowAccessPolicyConfig {
    policy: string;
    on: string[];
}
export interface TagEntry {
    key: string;
    value: string;
}
export interface ExternalTableConfig {
    stage: string;
    fileFormat: string;
    pattern?: string;
}
/**
 * Returns @Snowflake.vector config for a CDS element, or undefined if not annotated.
 */
export declare function getVectorConfig(el: any): VectorConfig | undefined;
/**
 * Returns @Snowflake.clustering key list for a CDS entity, or undefined.
 */
export declare function getClusteringKeys(entity: any): string[] | undefined;
/**
 * Returns @Snowflake.dataRetentionDays for a CDS entity, or undefined.
 */
export declare function getDataRetentionDays(entity: any): number | undefined;
/**
 * Returns true when the entity has @Snowflake.searchOptimized: true.
 */
export declare function isSearchOptimized(entity: any): boolean;
/**
 * Returns the masking policy name from @Snowflake.maskingPolicy on a column element,
 * or undefined if not set.
 */
export declare function getMaskingPolicy(el: any): string | undefined;
/**
 * Returns @Snowflake.rowAccessPolicy config for a CDS entity, or undefined.
 */
export declare function getRowAccessPolicy(entity: any): RowAccessPolicyConfig | undefined;
/**
 * Returns @Snowflake.tags array for an entity or element, or undefined.
 */
export declare function getTags(entityOrEl: any): TagEntry[] | undefined;
/**
 * Returns true when the element is annotated @Snowflake.variant: true.
 */
export declare function isVariantColumn(el: any): boolean;
/**
 * Returns @Snowflake.external config for a CDS entity (external table), or undefined.
 */
export declare function getExternalTableConfig(entity: any): ExternalTableConfig | undefined;
//# sourceMappingURL=snowflake-native.d.ts.map