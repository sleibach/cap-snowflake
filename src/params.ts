/**
 * Parameter binding and sanitization
 */

/**
 * Parameter placeholder for Snowflake SQL
 * Snowflake uses ? for positional parameters
 */
export function placeholder(): string {
  return '?';
}

/**
 * Convert named parameters to positional parameters
 */
export function namedToPositional(
  sql: string,
  namedParams: Record<string, any>
): { sql: string; params: any[] } {
  const params: any[] = [];
  let index = 0;

  // Replace :paramName with ? and collect values
  const convertedSQL = sql.replace(/:([a-zA-Z_][a-zA-Z0-9_]*)/g, (match, name) => {
    if (name in namedParams) {
      params.push(namedParams[name]);
      return '?';
    }
    return match;
  });

  return { sql: convertedSQL, params };
}

/**
 * Sanitize a value for safe SQL embedding (use only when binding not possible)
 * PREFER BINDING - this is a fallback for SQL API limitations
 */
export function sanitizeValue(value: any): string {
  if (value === null || value === undefined) {
    return 'NULL';
  }

  if (typeof value === 'number') {
    if (!isFinite(value)) {
      throw new Error('Cannot sanitize Infinity or NaN');
    }
    return String(value);
  }

  if (typeof value === 'boolean') {
    return value ? 'TRUE' : 'FALSE';
  }

  if (typeof value === 'string') {
    // Escape single quotes by doubling them
    return `'${value.replace(/'/g, "''")}'`;
  }

  if (value instanceof Date) {
    return `'${value.toISOString()}'`;
  }

  if (Array.isArray(value)) {
    return `ARRAY_CONSTRUCT(${value.map(v => sanitizeValue(v)).join(', ')})`;
  }

  if (typeof value === 'object') {
    // JSON/VARIANT
    return `PARSE_JSON('${JSON.stringify(value).replace(/'/g, "''")}')`;
  }

  throw new Error(`Cannot sanitize value of type ${typeof value}`);
}

/**
 * Bind parameters to a SQL statement
 * For Snowflake SDK, returns array of values
 * For SQL API, may need to embed values (use sanitization)
 */
export function bindParameters(sql: string, params: any[]): { sql: string; binds: any[] } {
  // For now, return as-is for SDK
  // SQL API might require inlining values
  return { sql, binds: params };
}

