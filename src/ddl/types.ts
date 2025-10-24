/**
 * CDS to Snowflake type mappings
 */

export interface TypeMapping {
  snowflakeType: string;
  requiresLength?: boolean;
  requiresPrecision?: boolean;
}

/**
 * Map CDS types to Snowflake types
 */
export function mapCDSType(cdsType: string, length?: number, precision?: number, scale?: number): string {
  // Normalize type (remove cds. prefix if present)
  const normalizedType = cdsType.replace(/^cds\./, '').toLowerCase();

  switch (normalizedType) {
    case 'string':
      return length ? `VARCHAR(${length})` : 'VARCHAR(5000)';
    
    case 'largestring':
      return 'TEXT';
    
    case 'boolean':
      return 'BOOLEAN';
    
    case 'integer':
    case 'integer64':
      return 'NUMBER(38,0)';
    
    case 'decimal':
    case 'number':
      if (precision !== undefined) {
        return scale !== undefined ? `NUMBER(${precision},${scale})` : `NUMBER(${precision})`;
      }
      return 'NUMBER(15,2)'; // Default
    
    case 'double':
    case 'float':
      return 'FLOAT';
    
    case 'date':
      return 'DATE';
    
    case 'time':
      return 'TIME';
    
    case 'datetime':
      return 'TIMESTAMP_NTZ';
    
    case 'timestamp':
      return 'TIMESTAMP_TZ';
    
    case 'uuid':
      return 'VARCHAR(36)';
    
    case 'binary':
    case 'largebinary':
      return length ? `BINARY(${length})` : 'BINARY';
    
    case 'array':
      return 'ARRAY';
    
    case 'json':
    case 'object':
      return 'VARIANT';
    
    default:
      // Fallback to VARCHAR for unknown types
      return 'VARCHAR(5000)';
  }
}

/**
 * Map Snowflake types back to CDS types (for reverse engineering)
 */
export function mapSnowflakeTypeToCDS(snowflakeType: string): string {
  const normalized = snowflakeType.toUpperCase();

  if (normalized.startsWith('VARCHAR') || normalized.startsWith('CHAR')) {
    return 'cds.String';
  }
  
  if (normalized === 'TEXT') {
    return 'cds.LargeString';
  }
  
  if (normalized === 'BOOLEAN') {
    return 'cds.Boolean';
  }
  
  if (normalized.startsWith('NUMBER')) {
    // Parse precision/scale if present
    const match = normalized.match(/NUMBER\((\d+),(\d+)\)/);
    if (match) {
      const scale = parseInt(match[2]);
      if (scale === 0) {
        return 'cds.Integer';
      }
      return 'cds.Decimal';
    }
    return 'cds.Integer';
  }
  
  if (normalized === 'FLOAT' || normalized === 'DOUBLE') {
    return 'cds.Double';
  }
  
  if (normalized === 'DATE') {
    return 'cds.Date';
  }
  
  if (normalized === 'TIME') {
    return 'cds.Time';
  }
  
  if (normalized.startsWith('TIMESTAMP_NTZ')) {
    return 'cds.DateTime';
  }
  
  if (normalized.startsWith('TIMESTAMP')) {
    return 'cds.Timestamp';
  }
  
  if (normalized.startsWith('BINARY')) {
    return 'cds.Binary';
  }
  
  if (normalized === 'ARRAY') {
    return 'cds.Array';
  }
  
  if (normalized === 'VARIANT' || normalized === 'OBJECT') {
    return 'cds.Json';
  }

  return 'cds.String'; // Default fallback
}

/**
 * Convert CDS value to Snowflake-compatible value
 */
export function convertValue(value: any, cdsType?: string): any {
  if (value === null || value === undefined) {
    return null;
  }

  if (!cdsType) {
    return value;
  }

  const normalizedType = cdsType.replace(/^cds\./, '').toLowerCase();

  switch (normalizedType) {
    case 'boolean':
      return Boolean(value);
    
    case 'date':
      if (value instanceof Date) {
        return value.toISOString().split('T')[0];
      }
      return value;
    
    case 'datetime':
    case 'timestamp':
      if (value instanceof Date) {
        return value.toISOString();
      }
      return value;
    
    case 'json':
    case 'object':
      if (typeof value === 'string') {
        return value; // Already JSON string
      }
      return JSON.stringify(value);
    
    default:
      return value;
  }
}

