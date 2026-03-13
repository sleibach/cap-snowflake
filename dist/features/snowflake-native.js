/**
 * Typed accessors for @Snowflake.* CDS annotations.
 *
 * All helpers read from standard CDS annotation convention:
 *   obj['@Snowflake.<name>']
 *
 * No other file should hard-code annotation string paths.
 */
/**
 * Returns @Snowflake.vector config for a CDS element, or undefined if not annotated.
 */
export function getVectorConfig(el) {
    const cfg = el?.['@Snowflake.vector'];
    if (!cfg || typeof cfg !== 'object')
        return undefined;
    return {
        dimensions: cfg.dimensions ?? 1536,
        similarity: cfg.similarity ?? 'COSINE',
    };
}
/**
 * Returns @Snowflake.clustering key list for a CDS entity, or undefined.
 */
export function getClusteringKeys(entity) {
    const keys = entity?.['@Snowflake.clustering'];
    if (!Array.isArray(keys) || keys.length === 0)
        return undefined;
    return keys;
}
/**
 * Returns @Snowflake.dataRetentionDays for a CDS entity, or undefined.
 */
export function getDataRetentionDays(entity) {
    const val = entity?.['@Snowflake.dataRetentionDays'];
    if (typeof val !== 'number')
        return undefined;
    return val;
}
/**
 * Returns true when the entity has @Snowflake.searchOptimized: true.
 */
export function isSearchOptimized(entity) {
    return entity?.['@Snowflake.searchOptimized'] === true;
}
/**
 * Returns the masking policy name from @Snowflake.maskingPolicy on a column element,
 * or undefined if not set.
 */
export function getMaskingPolicy(el) {
    const val = el?.['@Snowflake.maskingPolicy'];
    if (typeof val !== 'string' || val.trim() === '')
        return undefined;
    return val;
}
/**
 * Returns @Snowflake.rowAccessPolicy config for a CDS entity, or undefined.
 */
export function getRowAccessPolicy(entity) {
    const cfg = entity?.['@Snowflake.rowAccessPolicy'];
    if (!cfg || typeof cfg !== 'object')
        return undefined;
    const policy = cfg.policy;
    const on = cfg.on;
    if (typeof policy !== 'string' || policy.trim() === '')
        return undefined;
    return {
        policy,
        on: Array.isArray(on) ? on : [],
    };
}
/**
 * Returns @Snowflake.tags array for an entity or element, or undefined.
 */
export function getTags(entityOrEl) {
    const tags = entityOrEl?.['@Snowflake.tags'];
    if (!Array.isArray(tags) || tags.length === 0)
        return undefined;
    return tags.filter(t => typeof t?.key === 'string');
}
/**
 * Returns true when the element is annotated @Snowflake.variant: true.
 */
export function isVariantColumn(el) {
    return el?.['@Snowflake.variant'] === true;
}
/**
 * Returns @Snowflake.external config for a CDS entity (external table), or undefined.
 */
export function getExternalTableConfig(entity) {
    const cfg = entity?.['@Snowflake.external'];
    if (!cfg || typeof cfg !== 'object')
        return undefined;
    const stage = cfg.stage;
    const fileFormat = cfg.fileFormat;
    if (typeof stage !== 'string' || stage.trim() === '')
        return undefined;
    if (typeof fileFormat !== 'string' || fileFormat.trim() === '')
        return undefined;
    return {
        stage,
        fileFormat,
        pattern: typeof cfg.pattern === 'string' ? cfg.pattern : undefined,
    };
}
//# sourceMappingURL=snowflake-native.js.map