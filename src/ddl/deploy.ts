/**
 * DDL generation for cds deploy
 */

import cds from '@sap/cds';
import { mapCDSType } from './types.js';
import { qualifyName, toPhysicalIdentifier } from '../identifiers.js';
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
      keys.push(toPhysicalIdentifier(name));
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
export function generateColumnDefinition(name: string, element: ElementDefinition): string {
  const quotedName = toPhysicalIdentifier(name);
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
  migrate?: boolean;
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
  projection?: any;
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
  // Start with the original definitions, then enrich with SQL-compiled definitions
  // (which includes draft tables: *.drafts, DRAFT.DraftAdministrativeData).
  // Only NEW definitions are merged in — existing ones are never overwritten so that
  // @cds.persistence.name and other annotations remain intact.
  const originalDefs: Record<string, any> = model?.definitions || {};
  const definitions: Record<string, any> = { ...originalDefs };
  try {
    if (cds.compile?.for?.sql) {
      const sqlModel = cds.compile.for.sql(model);
      const sqlDefs = sqlModel?.definitions || {};
      for (const [name, def] of Object.entries(sqlDefs)) {
        if (!definitions[name]) {
          // Skip common CDS / SAP framework entities — they belong to reference-data
          // packages and should not be deployed to the application schema.
          if (name.startsWith('sap.') || name.startsWith('cds.')) continue;

          // For draft entities (*.drafts), fix the persistence name:
          // cds.compile.for.sql() derives it from the entity path (e.g. E2ETESTSERVICE_BOOKS_DRAFTS),
          // but CAP runtime uses the base entity's @cds.persistence.name + _DRAFTS
          // (e.g. CAP_E2E_BOOKS_DRAFTS).  Override the annotation so the deployed
          // table matches what the running server expects.
          if (name.endsWith('.drafts')) {
            const baseName = name.slice(0, -'.drafts'.length);
            const baseDef = originalDefs[baseName] ?? originalDefs[baseName.split('.').pop()!];
            const basePersis = baseDef?.['@cds.persistence.name'];
            if (basePersis) {
              const clone: any = { ...def };
              clone['@cds.persistence.name'] = `${basePersis}_DRAFTS`;
              definitions[name] = clone;
              continue;
            }
          }
          definitions[name] = def;
        }
      }
    }
  } catch {
    // Ignore compile errors — draft tables simply won't be generated
  }
  const statements: string[] = [];
  const createViews = options.createViews !== false;

  for (const [name, definition] of Object.entries(definitions)) {
    const def = definition as CSNDefinition;

    if (def.kind !== 'entity') continue;
    if (def.query) continue;      // SQL views — skip
    if (def.projection) continue; // CDS projections (e.g. Service.DraftAdministrativeData) — skip
    if (def['@cds.persistence.skip'] || def['@cds.persistence.exists']) continue;
    // Skip framework entities from common CDS/SAP namespaces (e.g. sap.common.Languages)
    if (name.startsWith('sap.') || name.startsWith('cds.')) continue;
    // Skip .texts sub-entities without an explicit persistence name — they are
    // already handled by generateTextsTable() when the parent has localized elements.
    if (name.endsWith('.texts') && !def['@cds.persistence.name']) continue;

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

  // Second pass: create Snowflake VIEWs for service-layer projection entities.
  // These are entities in the original CSN that have a `projection` property —
  // e.g. `E2ETestService.Books as projection on cap_e2e.Books`.
  // Other CAP adapters (sqlite, hana) also materialize these as DB views.
  if (createViews) {
    for (const [name, definition] of Object.entries(originalDefs)) {
      const def = definition as CSNDefinition;
      if (def.kind !== 'entity') continue;
      if (!def.projection) continue;
      if (name.startsWith('sap.') || name.startsWith('cds.')) continue;
      if (def['@cds.persistence.skip'] || def['@cds.persistence.exists']) continue;

      const sourceRef: string[] | undefined = (def.projection as any)?.from?.ref;
      if (!Array.isArray(sourceRef) || sourceRef.length === 0) continue;

      const sourceName = sourceRef.length === 1 ? sourceRef[0] : sourceRef.join('.');
      if (sourceName === name) continue; // self-reference guard

      const sourceDef = originalDefs[sourceName] as CSNDefinition | undefined;
      if (sourceDef?.['@cds.persistence.skip'] || sourceDef?.['@cds.persistence.exists']) continue;

      const viewName = getPersistenceName(name, def);
      const baseTableName = getPersistenceName(sourceName, sourceDef ?? {});
      const qualifiedBase = qualifyName(baseTableName, credentials);
      statements.push(generateCreateView(viewName, `SELECT * FROM ${qualifiedBase}`, credentials, true));
    }
  }

  return statements;
}

/**
 * Generate ALTER TABLE ADD COLUMN statements for new columns found in CSN but missing
 * from the existing database schema (safe migration — never drops columns).
 *
 * @param model       The CDS model
 * @param existingCols Map of tableName (upper) → Set of existing column names (upper)
 * @param credentials Snowflake credentials for identifier qualification
 */
export function generateMigrationStatements(
  model: any,
  existingCols: Map<string, Set<string>>,
  credentials: SnowflakeCredentials
): string[] {
  const definitions: Record<string, any> = { ...(model?.definitions || {}) };
  try {
    if (cds.compile?.for?.sql) {
      const sqlModel = cds.compile.for.sql(model);
      const sqlDefs = sqlModel?.definitions || {};
      for (const [name, def] of Object.entries(sqlDefs)) {
        if (!definitions[name]) definitions[name] = def;
      }
    }
  } catch { /* ignore */ }
  const statements: string[] = [];

  for (const [name, definition] of Object.entries(definitions)) {
    const def = definition as CSNDefinition;
    if (def.kind !== 'entity') continue;
    if (def.query || def.projection) continue;
    if (def['@cds.persistence.skip'] || def['@cds.persistence.exists']) continue;

    const tableName = getPersistenceName(name, def);
    const tableUpper = tableName.toUpperCase();
    const existing = existingCols.get(tableUpper) ?? new Set<string>();
    const entityDef = toEntityDefinition(tableName, def);

    for (const [colName, colDef] of Object.entries(entityDef.elements)) {
      const colUpper = colName.toUpperCase();
      if (!existing.has(colUpper)) {
        const qualifiedTable = qualifyName(tableName, credentials);
        const colDefSQL = generateColumnDefinition(colName, colDef);
        statements.push(`ALTER TABLE ${qualifiedTable} ADD COLUMN IF NOT EXISTS ${colDefSQL}`);
      }
    }
  }

  return statements;
}

function getPersistenceName(name: string, definition: CSNDefinition): string {
  const customName = definition['@cds.persistence.name'];
  if (typeof customName === 'string' && customName.length > 0) {
    return customName.replace(/^"|"$/g, '');
  }
  // Derive from fully qualified entity name: replace dots with underscores and uppercase.
  // Matches the convention used by @cap-js/sqlite, @cap-js/hana, and cds.compile.for.sql().
  // e.g. cap_e2e.Books → CAP_E2E_BOOKS
  return name.replace(/\./g, '_').toUpperCase();
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

