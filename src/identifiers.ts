/**
 * Identifier handling: quoting, casing, schema qualification
 *
 * Design: Snowflake stores unquoted identifiers in UPPERCASE. This adapter
 * normalises all plain identifiers (letters, digits, underscore) to UPPERCASE
 * so that DDL and DML are consistent and case-insensitive on Snowflake.
 * Identifiers containing special characters are double-quoted to preserve them.
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
 * Determine if an identifier needs quoting to preserve its case or special characters.
 *
 * Use this for aliases and key references where the exact string matters.
 * For table/column references use toPhysicalIdentifier instead.
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

  // Mixed-case or lowercase identifiers – Snowflake would uppercase them unquoted,
  // so quote to preserve the original case (important for aliases returned to callers)
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
 * Normalise an identifier to its physical Snowflake form:
 * - Simple identifiers (letters, digits, underscores) → UPPERCASE (unquoted)
 * - Identifiers with special characters → double-quoted (case preserved)
 * - Already-quoted identifiers → returned as-is
 */
export function toPhysicalIdentifier(identifier: string): string {
  if (!identifier) return identifier;
  if (identifier === '*') return identifier;

  // Already quoted
  if (identifier.startsWith('"') && identifier.endsWith('"')) return identifier;

  // Simple identifiers: uppercase (Snowflake default behaviour)
  if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(identifier)) {
    return identifier.toUpperCase();
  }

  // Otherwise quote to preserve special characters
  return `"${identifier.replace(/"/g, '""')}"`;
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
 * Fully qualify a table/view name with database and schema.
 * Each name component is normalised via toPhysicalIdentifier so that plain
 * identifiers are UPPERCASE (matching Snowflake's unquoted default).
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
    return parts.map(p => toPhysicalIdentifier(p)).join('.');
  } else if (parts.length === 2) {
    // Schema.Table - add database
    const [schema, table] = parts;
    if (credentials.database && includeSchema) {
      return `${toPhysicalIdentifier(credentials.database)}.${toPhysicalIdentifier(schema)}.${toPhysicalIdentifier(table)}`;
    }
    return `${toPhysicalIdentifier(schema)}.${toPhysicalIdentifier(table)}`;
  } else {
    // Just table name - add schema and database if available
    const table = parts[0];
    if (credentials.database && credentials.schema && includeSchema) {
      return `${toPhysicalIdentifier(credentials.database)}.${toPhysicalIdentifier(credentials.schema)}.${toPhysicalIdentifier(table)}`;
    } else if (credentials.schema && includeSchema) {
      return `${toPhysicalIdentifier(credentials.schema)}.${toPhysicalIdentifier(table)}`;
    }
    return toPhysicalIdentifier(table);
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

