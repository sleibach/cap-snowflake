/**
 * Temporal data support for Snowflake adapter
 * Handles application-time period tables (time slices)
 */

import { quoteIdentifier, qualifyName } from '../identifiers.js';
import { SnowflakeCredentials } from '../config.js';

export interface TemporalEntity {
  entityName: string;
  validFromField: string;
  validToField: string;
  keys: string[];
}

export interface TemporalQuery {
  asOf?: Date | string;
  from?: Date | string;
  to?: Date | string;
}

/**
 * Check if entity is temporal
 */
export function isTemporal(entity: any): boolean {
  if (!entity?.elements) return false;
  
  let hasValidFrom = false;
  let hasValidTo = false;
  
  for (const element of Object.values(entity.elements)) {
    const elem = element as any;
    if (elem['@cds.valid.from'] === true) hasValidFrom = true;
    if (elem['@cds.valid.to'] === true) hasValidTo = true;
  }
  
  return hasValidFrom && hasValidTo;
}

/**
 * Get temporal fields from entity
 */
export function getTemporalFields(entity: any): { validFrom: string; validTo: string } | null {
  if (!entity?.elements) return null;
  
  let validFrom: string | null = null;
  let validTo: string | null = null;
  
  for (const [name, element] of Object.entries(entity.elements)) {
    const elem = element as any;
    if (elem['@cds.valid.from'] === true) validFrom = name;
    if (elem['@cds.valid.to'] === true) validTo = name;
  }
  
  if (validFrom && validTo) {
    return { validFrom, validTo };
  }
  
  return null;
}

/**
 * Add temporal WHERE conditions for "as-of-now" query
 */
export function addTemporalConditions(
  whereClause: string,
  temporalFields: { validFrom: string; validTo: string },
  temporalQuery?: TemporalQuery
): string {
  const validFrom = quoteIdentifier(temporalFields.validFrom);
  const validTo = quoteIdentifier(temporalFields.validTo);
  
  const conditions: string[] = [];
  
  if (whereClause) {
    conditions.push(`(${whereClause})`);
  }
  
  if (temporalQuery?.asOf) {
    // Point-in-time query: validFrom <= asOf < validTo
    const asOfValue = formatTemporalValue(temporalQuery.asOf);
    conditions.push(`${validFrom} <= ${asOfValue}`);
    conditions.push(`${asOfValue} < ${validTo}`);
  } else if (temporalQuery?.from || temporalQuery?.to) {
    // Range query
    if (temporalQuery.from) {
      const fromValue = formatTemporalValue(temporalQuery.from);
      conditions.push(`${validTo} > ${fromValue}`);
    }
    if (temporalQuery.to) {
      const toValue = formatTemporalValue(temporalQuery.to);
      conditions.push(`${validFrom} < ${toValue}`);
    }
  } else {
    // Default: as-of-now (current time)
    conditions.push(`${validFrom} <= CURRENT_TIMESTAMP()`);
    conditions.push(`CURRENT_TIMESTAMP() < ${validTo}`);
  }
  
  return conditions.join(' AND ');
}

/**
 * Format temporal value for SQL
 */
function formatTemporalValue(value: Date | string): string {
  if (value instanceof Date) {
    return `'${value.toISOString()}'`;
  }
  return `'${value}'`;
}

/**
 * Generate temporal table DDL with composite primary key
 */
export function generateTemporalTableDDL(
  entity: any,
  credentials: SnowflakeCredentials
): string {
  const tableName = qualifyName(entity.name, credentials);
  const columns: string[] = [];
  const keys: string[] = [];
  
  // Get temporal fields
  const temporalFields = getTemporalFields(entity);
  if (!temporalFields) {
    throw new Error('Entity is not temporal');
  }
  
  // Process elements
  for (const [name, element] of Object.entries(entity.elements)) {
    const elem = element as any;
    const quotedName = quoteIdentifier(name);
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
  const sql = `CREATE TABLE ${tableName} (
  ${columns.join(',\n  ')},
  PRIMARY KEY (${keys.join(', ')})
)`;
  
  return sql;
}

/**
 * Import to avoid circular dependency
 */
function mapCDSType(type: string, length?: number, _precision?: number, _scale?: number): string {
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
export function generateTemporalView(
  entity: any,
  credentials: SnowflakeCredentials
): string {
  const viewName = `current_${entity.name}`;
  const qualifiedView = qualifyName(viewName, credentials);
  const tableName = qualifyName(entity.name, credentials);
  
  const temporalFields = getTemporalFields(entity);
  if (!temporalFields) {
    throw new Error('Entity is not temporal');
  }
  
  const validFrom = quoteIdentifier(temporalFields.validFrom);
  const validTo = quoteIdentifier(temporalFields.validTo);
  
  const sql = `CREATE VIEW ${qualifiedView} AS
SELECT * FROM ${tableName}
WHERE ${validFrom} <= CURRENT_TIMESTAMP()
  AND CURRENT_TIMESTAMP() < ${validTo}`;
  
  return sql;
}


