/**
 * Localization support for Snowflake adapter
 * Handles localized entities and .texts table generation
 */

import { qualifyName, toPhysicalIdentifier } from '../identifiers.js';
import { SnowflakeCredentials } from '../config.js';
import { mapCDSType } from '../ddl/types.js';

export interface LocalizedElement {
  name: string;
  type: string;
  length?: number;
  localized: boolean;
}

export interface LocalizedEntity {
  entityName: string;
  localizedElements: LocalizedElement[];
  keys: string[];
}

/**
 * Generate .texts table for localized entity
 */
export function generateTextsTable(
  entity: LocalizedEntity,
  credentials: SnowflakeCredentials
): string {
  const textsTableName = `${entity.entityName}_texts`;
  const qualifiedName = qualifyName(textsTableName, credentials);
  
  const columns: string[] = [];
  
  // Add locale key (from sap.common.TextsAspect)
  columns.push(`${toPhysicalIdentifier('locale')} VARCHAR(14) NOT NULL`);

  // Add original entity keys
  for (const key of entity.keys) {
    columns.push(`${toPhysicalIdentifier(key)} VARCHAR(36) NOT NULL`);
  }

  // Add localized elements
  for (const element of entity.localizedElements) {
    const sqlType = mapCDSType(element.type, element.length);
    columns.push(`${toPhysicalIdentifier(element.name)} ${sqlType}`);
  }

  // Composite primary key: locale + original keys
  const pkColumns = ['locale', ...entity.keys].map(c => toPhysicalIdentifier(c));
  
  const sql = `CREATE TABLE IF NOT EXISTS ${qualifiedName} (
  ${columns.join(',\n  ')},
  PRIMARY KEY (${pkColumns.join(', ')})
)`;
  
  return sql;
}

/**
 * Generate localized view for entity
 */
export function generateLocalizedView(
  entity: LocalizedEntity,
  credentials: SnowflakeCredentials,
  defaultLocale = 'en'
): string {
  const viewName = `localized_${entity.entityName}`;
  const qualifiedView = qualifyName(viewName, credentials);
  const mainTable = qualifyName(entity.entityName, credentials);
  const textsTable = qualifyName(`${entity.entityName}_texts`, credentials);
  
  const mainAlias = 'base';
  const textsAlias = 'texts';
  
  // Build column list
  const columns: string[] = [];

  // Add all non-localized columns from main table, excluding localized ones to avoid duplicates
  // (Snowflake supports EXCLUDE syntax)
  const excludeCols = entity.localizedElements
    .map(e => toPhysicalIdentifier(e.name))
    .join(', ');
  columns.push(excludeCols.length > 0
    ? `${mainAlias}.* EXCLUDE (${excludeCols})`
    : `${mainAlias}.*`);

  // Add localized columns from texts table with fallback to main table
  for (const element of entity.localizedElements) {
    const phys = toPhysicalIdentifier(element.name);
    columns.push(`COALESCE(${textsAlias}.${phys}, ${mainAlias}.${phys}) AS ${phys}`);
  }

  // Build join condition on keys
  const joinConditions = entity.keys.map(key => {
    const phys = toPhysicalIdentifier(key);
    return `${mainAlias}.${phys} = ${textsAlias}.${phys}`;
  });

  // Snowflake views cannot access session variables — use static default locale
  const localeCondition = `${textsAlias}.LOCALE = '${defaultLocale}'`;

  const sql = `CREATE OR REPLACE VIEW ${qualifiedView} AS
SELECT ${columns.join(', ')}
FROM ${mainTable} AS ${mainAlias}
LEFT JOIN ${textsTable} AS ${textsAlias}
  ON ${joinConditions.join(' AND ')}
  AND ${localeCondition}`;
  
  return sql;
}

/**
 * Check if entity has localized elements
 */
export function hasLocalizedElements(entity: any): boolean {
  if (!entity?.elements) return false;
  
  return Object.values(entity.elements).some(
    (element: any) => element.localized === true
  );
}

/**
 * Extract localized elements from entity definition
 */
export function extractLocalizedElements(entity: any): LocalizedElement[] {
  if (!entity?.elements) return [];
  
  const localizedElements: LocalizedElement[] = [];
  
  for (const [name, element] of Object.entries(entity.elements)) {
    const elem = element as any;
    if (elem.localized === true) {
      localizedElements.push({
        name,
        type: elem.type,
        length: elem.length,
        localized: true,
      });
    }
  }
  
  return localizedElements;
}

/**
 * Get entity keys
 */
export function getEntityKeys(entity: any): string[] {
  if (!entity?.elements) return [];
  
  const keys: string[] = [];
  
  for (const [name, element] of Object.entries(entity.elements)) {
    const elem = element as any;
    if (elem.key === true) {
      keys.push(name);
    }
  }
  
  return keys;
}


