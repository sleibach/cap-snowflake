/**
 * Identifier handling: quoting, casing, schema qualification
 */

import { SnowflakeCredentials } from './config.js';

/**
 * Snowflake identifier rules:
 * - Unquoted identifiers are stored in UPPERCASE
 * - Quoted identifiers preserve case
 * - Must quote if: contains special chars, lowercase, mixed case, or reserved word
 */

const RESERVED_WORDS = new Set([
  'SELECT', 'FROM', 'WHERE', 'INSERT', 'UPDATE', 'DELETE', 'CREATE', 'DROP',
  'TABLE', 'VIEW', 'INDEX', 'ALTER', 'ADD', 'COLUMN', 'PRIMARY', 'KEY',
  'FOREIGN', 'REFERENCES', 'CONSTRAINT', 'UNIQUE', 'NOT', 'NULL', 'DEFAULT',
  'CHECK', 'AND', 'OR', 'IN', 'BETWEEN', 'LIKE', 'IS', 'AS', 'ON', 'JOIN',
  'LEFT', 'RIGHT', 'INNER', 'OUTER', 'FULL', 'CROSS', 'UNION', 'INTERSECT',
  'EXCEPT', 'ORDER', 'BY', 'GROUP', 'HAVING', 'LIMIT', 'OFFSET', 'MERGE',
  'INTO', 'USING', 'WHEN', 'MATCHED', 'THEN', 'VALUES', 'SET'
]);

/**
 * Determine if an identifier needs quoting
 */
export function needsQuoting(identifier: string): boolean {
  if (!identifier) return false;

  // Already quoted
  if (identifier.startsWith('"') && identifier.endsWith('"')) {
    return false;
  }

  // Reserved word
  if (RESERVED_WORDS.has(identifier.toUpperCase())) {
    return true;
  }

  // Check if uppercase version differs (has lowercase or mixed case)
  if (identifier !== identifier.toUpperCase()) {
    return true;
  }

  // Contains special characters other than underscore
  if (!/^[A-Z_][A-Z0-9_]*$/.test(identifier)) {
    return true;
  }

  return false;
}

/**
 * Quote an identifier if needed
 */
export function quoteIdentifier(identifier: string): string {
  if (!identifier) return identifier;

  // Already quoted
  if (identifier.startsWith('"') && identifier.endsWith('"')) {
    return identifier;
  }

  // Quote if needed
  if (needsQuoting(identifier)) {
    // Escape any internal quotes
    const escaped = identifier.replace(/"/g, '""');
    return `"${escaped}"`;
  }

  return identifier;
}

/**
 * Fully qualify a table/view name with database and schema
 */
export function qualifyName(
  name: string,
  credentials: SnowflakeCredentials,
  includeSchema = true
): string {
  // Parse name (might already be qualified)
  const parts = name.split('.');
  
  if (parts.length === 3) {
    // Already fully qualified: DATABASE.SCHEMA.TABLE
    return parts.map(p => quoteIdentifier(p)).join('.');
  } else if (parts.length === 2) {
    // Schema.Table - add database
    const [schema, table] = parts;
    if (credentials.database && includeSchema) {
      return `${quoteIdentifier(credentials.database)}.${quoteIdentifier(schema)}.${quoteIdentifier(table)}`;
    }
    return `${quoteIdentifier(schema)}.${quoteIdentifier(table)}`;
  } else {
    // Just table name - add schema and database if available
    const table = parts[0];
    if (credentials.database && credentials.schema && includeSchema) {
      return `${quoteIdentifier(credentials.database)}.${quoteIdentifier(credentials.schema)}.${quoteIdentifier(table)}`;
    } else if (credentials.schema && includeSchema) {
      return `${quoteIdentifier(credentials.schema)}.${quoteIdentifier(table)}`;
    }
    return quoteIdentifier(table);
  }
}

/**
 * Extract the simple table name from a qualified name
 */
export function getSimpleName(qualifiedName: string): string {
  const parts = qualifiedName.split('.');
  return parts[parts.length - 1].replace(/^"|"$/g, '');
}

/**
 * Build a column reference with optional table alias
 */
export function columnRef(column: string, alias?: string): string {
  const quotedCol = quoteIdentifier(column);
  if (alias) {
    return `${quoteIdentifier(alias)}.${quotedCol}`;
  }
  return quotedCol;
}

