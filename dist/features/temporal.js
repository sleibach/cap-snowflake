/**
 * Temporal data support for Snowflake adapter
 * Handles application-time period tables (time slices)
 */
import { qualifyName, toPhysicalIdentifier } from '../identifiers.js';
/**
 * Check if entity is temporal
 */
export function isTemporal(entity) {
    if (!entity?.elements)
        return false;
    let hasValidFrom = false;
    let hasValidTo = false;
    for (const element of Object.values(entity.elements)) {
        const elem = element;
        if (elem['@cds.valid.from'] === true)
            hasValidFrom = true;
        if (elem['@cds.valid.to'] === true)
            hasValidTo = true;
    }
    return hasValidFrom && hasValidTo;
}
/**
 * Get temporal fields from entity
 */
export function getTemporalFields(entity) {
    if (!entity?.elements)
        return null;
    let validFrom = null;
    let validTo = null;
    for (const [name, element] of Object.entries(entity.elements)) {
        const elem = element;
        if (elem['@cds.valid.from'] === true)
            validFrom = name;
        if (elem['@cds.valid.to'] === true)
            validTo = name;
    }
    if (validFrom && validTo) {
        return { validFrom, validTo };
    }
    return null;
}
/**
 * Add temporal WHERE conditions for "as-of-now" query
 */
export function addTemporalConditions(whereClause, temporalFields, temporalQuery) {
    const validFrom = toPhysicalIdentifier(temporalFields.validFrom);
    const validTo = toPhysicalIdentifier(temporalFields.validTo);
    const conditions = [];
    if (whereClause) {
        conditions.push(`(${whereClause})`);
    }
    if (temporalQuery?.asOf) {
        // Point-in-time query: validFrom <= asOf < validTo
        const asOfValue = formatTemporalValue(temporalQuery.asOf);
        conditions.push(`${validFrom} <= ${asOfValue}`);
        conditions.push(`${asOfValue} < ${validTo}`);
    }
    else if (temporalQuery?.from || temporalQuery?.to) {
        // Range query
        if (temporalQuery.from) {
            const fromValue = formatTemporalValue(temporalQuery.from);
            conditions.push(`${validTo} > ${fromValue}`);
        }
        if (temporalQuery.to) {
            const toValue = formatTemporalValue(temporalQuery.to);
            conditions.push(`${validFrom} < ${toValue}`);
        }
    }
    else {
        // Default: as-of-now (current time)
        conditions.push(`${validFrom} <= CURRENT_TIMESTAMP()`);
        conditions.push(`CURRENT_TIMESTAMP() < ${validTo}`);
    }
    return conditions.join(' AND ');
}
/**
 * Format temporal value for SQL
 */
function formatTemporalValue(value) {
    if (value instanceof Date) {
        return `'${value.toISOString()}'`;
    }
    return `'${value}'`;
}
/**
 * Generate temporal table DDL with composite primary key
 */
export function generateTemporalTableDDL(entity, credentials) {
    const tableName = qualifyName(entity.name, credentials);
    const columns = [];
    const keys = [];
    // Get temporal fields
    const temporalFields = getTemporalFields(entity);
    if (!temporalFields) {
        throw new Error('Entity is not temporal');
    }
    // Process elements
    for (const [name, element] of Object.entries(entity.elements)) {
        const elem = element;
        const quotedName = toPhysicalIdentifier(name);
        const sqlType = mapCDSType(elem.type, elem.length, elem.precision, elem.scale);
        let columnDef = `${quotedName} ${sqlType}`;
        if (elem.notNull || elem.key) {
            columnDef += ' NOT NULL';
        }
        columns.push(columnDef);
        if (elem.key || name === temporalFields.validFrom) {
            keys.push(quotedName);
        }
    }
    // Composite PK: original keys + validFrom
    const sql = `CREATE TABLE IF NOT EXISTS ${tableName} (
  ${columns.join(',\n  ')},
  PRIMARY KEY (${keys.join(', ')})
)`;
    return sql;
}
/**
 * Import to avoid circular dependency
 */
function mapCDSType(type, length, _precision, _scale) {
    // Simplified type mapping (full version in ddl/types.ts)
    const normalizedType = type.replace(/^cds\./, '').toLowerCase();
    switch (normalizedType) {
        case 'string':
            return length ? `VARCHAR(${length})` : 'VARCHAR(5000)';
        case 'timestamp':
        case 'datetime':
            return 'TIMESTAMP_NTZ';
        case 'date':
            return 'DATE';
        case 'uuid':
            return 'VARCHAR(36)';
        default:
            return 'VARCHAR(5000)';
    }
}
/**
 * Create view for temporal entity that shows current time slices
 */
export function generateTemporalView(entity, credentials) {
    const viewName = `current_${entity.name}`;
    const qualifiedView = qualifyName(viewName, credentials);
    const tableName = qualifyName(entity.name, credentials);
    const temporalFields = getTemporalFields(entity);
    if (!temporalFields) {
        throw new Error('Entity is not temporal');
    }
    const validFrom = toPhysicalIdentifier(temporalFields.validFrom);
    const validTo = toPhysicalIdentifier(temporalFields.validTo);
    const sql = `CREATE OR REPLACE VIEW ${qualifiedView} AS
SELECT * FROM ${tableName}
WHERE ${validFrom} <= CURRENT_TIMESTAMP()
  AND CURRENT_TIMESTAMP() < ${validTo}`;
    return sql;
}
//# sourceMappingURL=temporal.js.map