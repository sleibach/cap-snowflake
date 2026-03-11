/**
 * DDL generation for cds deploy
 */

import { mapCDSType } from './types.js';
import { quoteIdentifier, qualifyName } from '../identifiers.js';
import { SnowflakeCredentials } from '../config.js';
import {
  extractLocalizedElements,
  generateLocalizedView,
  generateTextsTable,
  getEntityKeys,
  hasLocalizedElements
} from '../features/localized.js';
import {
  generateTemporalTableDDL,
  generateTemporalView,
  isTemporal
} from '../features/temporal.js';

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
  credentials: SnowflakeCredentials,
  ifNotExists = true
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

  let sql = `CREATE TABLE ${ifNotExists ? 'IF NOT EXISTS ' : ''}${tableName} (\n  ${columns.join(',\n  ')}`;

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
  credentials: SnowflakeCredentials,
  orReplace = true
): string {
  const qualifiedName = qualifyName(viewName, credentials);
  return `CREATE ${orReplace ? 'OR REPLACE ' : ''}VIEW ${qualifiedName} AS\n${selectSQL}`;
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

interface DeployOptions {
  createViews?: boolean;
}

interface CSNElement {
  type?: string;
  length?: number;
  precision?: number;
  scale?: number;
  key?: boolean;
  notNull?: boolean;
  virtual?: boolean;
  target?: string;
  isAssociation?: boolean;
  default?: { val?: any };
  ['@mandatory']?: boolean;
}

interface CSNDefinition {
  kind?: string;
  query?: any;
  elements?: Record<string, CSNElement>;
  ['@cds.persistence.skip']?: boolean;
  ['@cds.persistence.exists']?: boolean;
  ['@cds.persistence.name']?: string;
}

/**
 * Generate deploy SQL statements from a CSN model.
 */
export function buildDeployStatements(
  model: any,
  credentials: SnowflakeCredentials,
  options: DeployOptions = {}
): string[] {
  const definitions = model?.definitions || {};
  const statements: string[] = [];
  const createViews = options.createViews !== false;

  for (const [name, definition] of Object.entries(definitions)) {
    const def = definition as CSNDefinition;

    if (def.kind !== 'entity') continue;
    if (def.query) continue; // projections/views are not deployed as tables here
    if (def['@cds.persistence.skip'] || def['@cds.persistence.exists']) continue;

    const tableName = getPersistenceName(name, def);
    const entityDef = toEntityDefinition(tableName, def);
    if (Object.keys(entityDef.elements).length === 0) continue;

    if (isTemporal(def)) {
      statements.push(generateTemporalTableDDL({ ...def, name: tableName }, credentials));
    } else {
      statements.push(generateCreateTable(entityDef, credentials, true));
    }

    if (hasLocalizedElements(def)) {
      const keys = getEntityKeys(def);
      if (keys.length > 0) {
        statements.push(
          generateTextsTable(
            {
              entityName: tableName,
              localizedElements: extractLocalizedElements(def),
              keys
            },
            credentials
          )
        );
        if (createViews) {
          statements.push(
            generateLocalizedView(
              {
                entityName: tableName,
                localizedElements: extractLocalizedElements(def),
                keys
              },
              credentials
            )
          );
        }
      }
    }

    if (isTemporal(def) && createViews) {
      statements.push(generateTemporalView({ ...def, name: tableName }, credentials));
    }
  }

  return statements;
}

function getPersistenceName(name: string, definition: CSNDefinition): string {
  const customName = definition['@cds.persistence.name'];
  if (typeof customName === 'string' && customName.length > 0) {
    return customName.replace(/^"|"$/g, '');
  }
  const parts = name.split('.');
  return parts[parts.length - 1];
}

function toEntityDefinition(name: string, definition: CSNDefinition): EntityDefinition {
  const elements = definition.elements || {};
  const mappedElements: Record<string, ElementDefinition> = {};

  for (const [elementName, element] of Object.entries(elements)) {
    // Skip associations/compositions/virtual elements; managed foreign keys are separate elements in linked CSN.
    if (element.virtual) continue;
    if (element.target || element.isAssociation) continue;
    if (!element.type) continue;

    mappedElements[elementName] = {
      type: element.type,
      length: element.length,
      precision: element.precision,
      scale: element.scale,
      key: element.key,
      notNull: element.notNull || element.key || element['@mandatory'] === true,
      default: element.default?.val
    };
  }

  return {
    name,
    kind: 'entity',
    elements: mappedElements
  };
}

