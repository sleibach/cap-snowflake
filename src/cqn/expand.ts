/**
 * $expand support with JOIN-based queries
 * Handles navigation through associations and compositions
 */

import { quoteIdentifier, qualifyName } from '../identifiers.js';
import { SnowflakeCredentials } from '../config.js';
import { translateFilter } from './filters.js';
import { translateOrderBy } from './orderby.js';

export interface ExpandSpec {
  ref: string[];
  expand?: ExpandSpec[];
  inline?: ExpandSpec[];
  where?: any[];
  orderBy?: any[];
  limit?: { rows?: { val: number }; offset?: { val: number } };
}

export interface AssociationInfo {
  name: string;
  target: string;
  type: 'to-one' | 'to-many';
  foreignKey?: string;  // For managed to-one associations
  on?: any[];          // For unmanaged associations
  isComposition?: boolean;
}

/**
 * Process expand specifications and generate appropriate SQL
 */
export function processExpands(
  baseQuery: string,
  expands: ExpandSpec[],
  credentials: SnowflakeCredentials,
  associationMap: Map<string, AssociationInfo>,
  params: any[]
): { sql: string; postProcess?: (rows: any[]) => any[] } {
  
  if (!expands || expands.length === 0) {
    return { sql: baseQuery };
  }

  // Separate to-one and to-many expansions
  const toOneExpands = expands.filter(exp => {
    const assocName = exp.ref[exp.ref.length - 1];
    const assoc = associationMap.get(assocName);
    return assoc?.type === 'to-one';
  });

  const toManyExpands = expands.filter(exp => {
    const assocName = exp.ref[exp.ref.length - 1];
    const assoc = associationMap.get(assocName);
    return assoc?.type === 'to-many';
  });

  // Handle to-one expansions with LEFT JOINs
  let sql = baseQuery;
  if (toOneExpands.length > 0) {
    sql = addToOneJoins(sql, toOneExpands, associationMap, credentials, params);
  }

  // Handle to-many expansions
  if (toManyExpands.length > 0) {
    // To-many requires post-processing to structure results
    return {
      sql,
      postProcess: (rows) => postProcessToMany(rows, toManyExpands, associationMap, credentials)
    };
  }

  return { sql };
}

/**
 * Add LEFT JOINs for to-one associations
 */
function addToOneJoins(
  baseQuery: string,
  expands: ExpandSpec[],
  associationMap: Map<string, AssociationInfo>,
  credentials: SnowflakeCredentials,
  params: any[]
): string {
  
  let sql = baseQuery;
  
  // Extract FROM clause position
  const fromMatch = sql.match(/FROM\s+(\S+)(?:\s+AS\s+(\S+))?/i);
  if (!fromMatch) {
    return sql;
  }

  const baseAlias = fromMatch[2] || 'base';
  let joins = '';
  let additionalColumns: string[] = [];

  for (const expand of expands) {
    const assocName = expand.ref[expand.ref.length - 1];
    const assoc = associationMap.get(assocName);
    
    if (!assoc) continue;

    const joinAlias = `${assocName}_expand`;
    const targetTable = qualifyName(assoc.target, credentials);

    // Build join condition
    let joinCondition: string;
    
    if (assoc.foreignKey) {
      // Managed to-one: base.author_ID = author_expand.ID
      const fkCol = quoteIdentifier(assoc.foreignKey);
      joinCondition = `${baseAlias}.${fkCol} = ${joinAlias}.ID`;
    } else if (assoc.on) {
      // Unmanaged: use ON condition
      joinCondition = translateFilter(assoc.on, params);
      // Replace $self with base alias
      joinCondition = joinCondition.replace(/\$self/g, baseAlias);
    } else {
      continue;
    }

    // Add LEFT JOIN
    joins += ` LEFT JOIN ${targetTable} AS ${joinAlias} ON ${joinCondition}`;

    // Add columns from expanded entity
    if (expand.expand && expand.expand.length > 0) {
      // Specific columns requested
      for (const col of expand.expand) {
        if (col.ref) {
          const colName = col.ref[col.ref.length - 1];
          const quotedCol = quoteIdentifier(colName);
          additionalColumns.push(
            `${joinAlias}.${quotedCol} AS ${quoteIdentifier(`${assocName}_${colName}`)}`
          );
        }
      }
    } else {
      // All columns: use OBJECT_CONSTRUCT for JSON object
      additionalColumns.push(
        `OBJECT_CONSTRUCT(*) AS ${quoteIdentifier(assocName)}_expand_data`
      );
    }
  }

  // Insert joins after FROM clause
  sql = sql.replace(/FROM\s+\S+(?:\s+AS\s+\S+)?/i, match => match + joins);

  // Add columns to SELECT
  if (additionalColumns.length > 0) {
    sql = sql.replace(/SELECT\s+(DISTINCT\s+)?/, match => {
      return `${match}*, ${additionalColumns.join(', ')}, `;
    });
  }

  return sql;
}

/**
 * Post-process results to add to-many associations
 * Uses separate queries for to-many (batched IN approach)
 */
async function postProcessToMany(
  rows: any[],
  expands: ExpandSpec[],
  associationMap: Map<string, AssociationInfo>,
  credentials: SnowflakeCredentials
): Promise<any[]> {
  
  // This would require database access, so return rows as-is
  // In a full implementation, would:
  // 1. Extract parent keys
  // 2. Query children with WHERE fk IN (parent_keys...)
  // 3. Group children by parent key
  // 4. Attach to parent rows

  return rows;
}

/**
 * Build JOIN expression for association
 */
export function buildJoinForAssociation(
  parentAlias: string,
  association: AssociationInfo,
  joinAlias: string,
  credentials: SnowflakeCredentials
): string {
  
  const targetTable = qualifyName(association.target, credentials);
  
  if (association.foreignKey) {
    // Managed to-one
    const fkCol = quoteIdentifier(association.foreignKey);
    const pkCol = quoteIdentifier('ID');  // Assume ID as primary key
    return `LEFT JOIN ${targetTable} AS ${joinAlias} ON ${parentAlias}.${fkCol} = ${joinAlias}.${pkCol}`;
  }
  
  if (association.on) {
    // Unmanaged - use ON condition
    // Note: Would need to translate ON expression properly
    return `LEFT JOIN ${targetTable} AS ${joinAlias} ON (custom ON condition)`;
  }

  return '';
}

/**
 * Restructure flat JOIN results into nested objects
 */
export function restructureExpandedResults(
  rows: any[],
  expands: ExpandSpec[]
): any[] {
  
  return rows.map(row => {
    const result: any = { ...row };
    
    for (const expand of expands) {
      const assocName = expand.ref[expand.ref.length - 1];
      const expandData: any = {};
      
      // Collect columns that belong to this expansion
      for (const key of Object.keys(row)) {
        if (key.startsWith(`${assocName}_`)) {
          const fieldName = key.substring(assocName.length + 1);
          expandData[fieldName] = row[key];
          delete result[key];  // Remove flattened field
        }
      }
      
      // Add as nested object
      if (Object.keys(expandData).length > 0) {
        result[assocName] = expandData;
      }
    }
    
    return result;
  });
}

/**
 * Generate SQL for to-many expansion using JSON aggregation
 */
export function generateToManyExpand(
  parentTable: string,
  parentAlias: string,
  association: AssociationInfo,
  credentials: SnowflakeCredentials,
  expandColumns?: string[]
): string {
  
  const childTable = qualifyName(association.target, credentials);
  const childAlias = 'child';
  
  // Build join condition
  let joinCondition: string;
  
  if (association.on) {
    // Unmanaged: use ON condition
    joinCondition = '1=1';  // Simplified - would need full translation
  } else {
    // Assume backlink pattern: child.parent_ID = parent.ID
    const backlink = `${parentTable.toLowerCase()}_ID`;
    joinCondition = `${childAlias}.${quoteIdentifier(backlink)} = ${parentAlias}.ID`;
  }
  
  // Select columns to include
  const columns = expandColumns && expandColumns.length > 0
    ? expandColumns.map(c => quoteIdentifier(c)).join(', ')
    : '*';
  
  // Use ARRAY_AGG with OBJECT_CONSTRUCT for JSON arrays
  const aggregation = `ARRAY_AGG(
    OBJECT_CONSTRUCT(${columns})
  ) AS ${quoteIdentifier(association.name)}`;
  
  return aggregation;
}


