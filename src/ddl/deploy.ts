/**
 * DDL generation for cds deploy
 */

import { mapCDSType } from './types.js';
import { quoteIdentifier, qualifyName } from '../identifiers.js';
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
}

/**
 * Generate CREATE TABLE statement
 */
export function generateCreateTable(
  entity: EntityDefinition,
  credentials: SnowflakeCredentials
): string {
  const tableName = qualifyName(entity.name, credentials);
  const columns: string[] = [];
  const keys: string[] = [];

  // Process elements
  for (const [name, element] of Object.entries(entity.elements)) {
    const columnDef = generateColumnDefinition(name, element);
    columns.push(columnDef);

    if (element.key) {
      keys.push(quoteIdentifier(name));
    }
  }

  let sql = `CREATE TABLE ${tableName} (\n  ${columns.join(',\n  ')}`;

  // Add primary key constraint
  if (keys.length > 0) {
    sql += `,\n  PRIMARY KEY (${keys.join(', ')})`;
  }

  sql += '\n)';

  return sql;
}

/**
 * Generate column definition
 */
function generateColumnDefinition(name: string, element: ElementDefinition): string {
  const quotedName = quoteIdentifier(name);
  const sqlType = mapCDSType(element.type, element.length, element.precision, element.scale);
  
  let def = `${quotedName} ${sqlType}`;

  // Add constraints
  if (element.notNull) {
    def += ' NOT NULL';
  }

  if (element.default !== undefined) {
    def += ` DEFAULT ${formatDefault(element.default)}`;
  }

  return def;
}

/**
 * Format default value
 */
function formatDefault(value: any): string {
  if (value === null) {
    return 'NULL';
  }
  if (typeof value === 'string') {
    return `'${value.replace(/'/g, "''")}'`;
  }
  if (typeof value === 'boolean') {
    return value ? 'TRUE' : 'FALSE';
  }
  if (typeof value === 'number') {
    return String(value);
  }
  return `'${String(value)}'`;
}

/**
 * Generate CREATE VIEW statement
 */
export function generateCreateView(
  viewName: string,
  selectSQL: string,
  credentials: SnowflakeCredentials
): string {
  const qualifiedName = qualifyName(viewName, credentials);
  return `CREATE VIEW ${qualifiedName} AS\n${selectSQL}`;
}

/**
 * Generate DROP TABLE statement
 */
export function generateDropTable(
  tableName: string,
  credentials: SnowflakeCredentials,
  ifExists = true
): string {
  const qualifiedName = qualifyName(tableName, credentials);
  return `DROP TABLE ${ifExists ? 'IF EXISTS ' : ''}${qualifiedName}`;
}

/**
 * Generate CREATE SEQUENCE statement (for auto-increment)
 */
export function generateCreateSequence(
  sequenceName: string,
  credentials: SnowflakeCredentials
): string {
  const qualifiedName = qualifyName(sequenceName, credentials);
  return `CREATE SEQUENCE ${qualifiedName} START = 1 INCREMENT = 1`;
}

