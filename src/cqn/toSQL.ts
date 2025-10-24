/**
 * Main CQN to SQL translator
 */

import { quoteIdentifier, qualifyName } from '../identifiers.js';
import { placeholder } from '../params.js';
import { translateFilter } from './filters.js';
import { translateOrderBy } from './orderby.js';
import { translatePagination } from './pagination.js';
import { SnowflakeCredentials } from '../config.js';

export interface CQN {
  SELECT?: SelectCQN;
  INSERT?: InsertCQN;
  UPDATE?: UpdateCQN;
  DELETE?: DeleteCQN;
}

export interface SelectCQN {
  from: FromClause;
  columns?: ColumnSpec[];
  where?: any[];
  orderBy?: any[];
  limit?: { rows?: { val: number }; offset?: { val: number } };
  one?: boolean;
  distinct?: boolean;
  count?: boolean;
  having?: any[];
  groupBy?: any[];
}

export interface FromClause {
  ref?: string[];
  as?: string;
  join?: string;
  on?: any[];
}

export interface ColumnSpec {
  ref?: string[];
  as?: string;
  expand?: any[];
  inline?: any[];
  func?: string;
  args?: any[];
  val?: any;
}

export interface InsertCQN {
  into: string;
  entries?: any[];
  columns?: string[];
  values?: any[];
  rows?: any[][];
}

export interface UpdateCQN {
  entity: string;
  data?: any;
  where?: any[];
}

export interface DeleteCQN {
  from: string;
  where?: any[];
}

export interface SQLResult {
  sql: string;
  params: any[];
}

/**
 * Main entry point: translate CQN to SQL
 */
export function cqnToSQL(cqn: CQN, credentials: SnowflakeCredentials): SQLResult {
  const params: any[] = [];

  if (cqn.SELECT) {
    return translateSelect(cqn.SELECT, credentials, params);
  } else if (cqn.INSERT) {
    return translateInsert(cqn.INSERT, credentials, params);
  } else if (cqn.UPDATE) {
    return translateUpdate(cqn.UPDATE, credentials, params);
  } else if (cqn.DELETE) {
    return translateDelete(cqn.DELETE, credentials, params);
  }

  throw new Error('Unsupported CQN operation');
}

/**
 * Translate SELECT
 */
function translateSelect(select: SelectCQN, credentials: SnowflakeCredentials, params: any[]): SQLResult {
  let sql = 'SELECT';

  // DISTINCT
  if (select.distinct) {
    sql += ' DISTINCT';
  }

  // Check for expansions
  const hasExpansions = select.columns?.some(col => 
    (col as any).expand || (col as any).inline
  );

  // Columns
  if (select.columns && select.columns.length > 0) {
    if (hasExpansions) {
      // Handle expansions with JOINs
      const { baseColumns, expandColumns, joins } = processColumnsWithExpand(
        select.columns,
        select.from,
        credentials,
        params
      );
      
      const cols = [...baseColumns, ...expandColumns].join(', ');
      sql += ` ${cols}`;
      
      // FROM with joins
      sql += ` FROM ${translateFrom(select.from, credentials)}`;
      sql += joins.join(' ');
    } else {
      // Regular columns
      const cols = select.columns.map(col => translateColumn(col)).join(', ');
      sql += ` ${cols}`;
      sql += ` FROM ${translateFrom(select.from, credentials)}`;
    }
  } else {
    sql += ' *';
    sql += ` FROM ${translateFrom(select.from, credentials)}`;
  }

  // WHERE
  if (select.where && select.where.length > 0) {
    const whereClause = translateFilter(select.where, params);
    if (whereClause) {
      sql += ` WHERE ${whereClause}`;
    }
  }

  // GROUP BY
  if (select.groupBy && select.groupBy.length > 0) {
    const groupByClause = select.groupBy.map(g => translateGroupBy(g)).join(', ');
    sql += ` GROUP BY ${groupByClause}`;
  }

  // HAVING
  if (select.having && select.having.length > 0) {
    const havingClause = translateFilter(select.having, params);
    if (havingClause) {
      sql += ` HAVING ${havingClause}`;
    }
  }

  // ORDER BY
  if (select.orderBy && select.orderBy.length > 0) {
    const orderByClause = translateOrderBy(select.orderBy);
    if (orderByClause) {
      sql += ` ${orderByClause}`;
    }
  }

  // LIMIT/OFFSET
  if (select.limit) {
    const top = select.limit.rows?.val;
    const skip = select.limit.offset?.val;
    const pagination = translatePagination({ top, skip });
    if (pagination) {
      sql += ` ${pagination}`;
    }
  }

  return { sql, params };
}

/**
 * Process columns with expand/inline specifications
 */
function processColumnsWithExpand(
  columns: ColumnSpec[],
  from: FromClause,
  credentials: SnowflakeCredentials,
  _params: any[]
): { baseColumns: string[]; expandColumns: string[]; joins: string[] } {
  
  const baseColumns: string[] = [];
  const expandColumns: string[] = [];
  const joins: string[] = [];
  
  const baseAlias = from.as || 'base';
  let joinCounter = 0;
  
  for (const col of columns) {
    if ((col as any).expand) {
      // To-one expansion: use LEFT JOIN
      const assocName = (col.ref as string[])[0];
      const joinAlias = `expand_${joinCounter++}`;
      
      // Assume managed association with {assocName}_ID foreign key
      const foreignKey = `${assocName}_ID`;
      const targetEntity = assocName.charAt(0).toUpperCase() + assocName.slice(1);
      const targetTable = qualifyName(targetEntity, credentials);
      
      const joinSQL = `LEFT JOIN ${targetTable} AS ${joinAlias} ON ${baseAlias}.${quoteIdentifier(foreignKey)} = ${joinAlias}.ID`;
      joins.push(joinSQL);
      
      // Add expanded columns
      const expandSpec = (col as any).expand as ColumnSpec[];
      for (const expandCol of expandSpec) {
        if (expandCol.ref) {
          const colName = expandCol.ref[expandCol.ref.length - 1];
          const alias = `${assocName}_${colName}`;
          expandColumns.push(`${joinAlias}.${quoteIdentifier(colName)} AS ${quoteIdentifier(alias)}`);
        }
      }
    } else if ((col as any).inline) {
      // Inline expansion: similar to expand but flattens structure
      const assocName = (col.ref as string[])[0];
      const joinAlias = `inline_${joinCounter++}`;
      
      const foreignKey = `${assocName}_ID`;
      const targetEntity = assocName.charAt(0).toUpperCase() + assocName.slice(1);
      const targetTable = qualifyName(targetEntity, credentials);
      
      const joinSQL = `LEFT JOIN ${targetTable} AS ${joinAlias} ON ${baseAlias}.${quoteIdentifier(foreignKey)} = ${joinAlias}.ID`;
      joins.push(joinSQL);
      
      // Add inlined columns (flattened, no prefix)
      const inlineSpec = (col as any).inline as ColumnSpec[];
      for (const inlineCol of inlineSpec) {
        if (inlineCol.ref) {
          const colName = inlineCol.ref[inlineCol.ref.length - 1];
          const alias = inlineCol.as || `${assocName}_${colName}`;
          expandColumns.push(`${joinAlias}.${quoteIdentifier(colName)} AS ${quoteIdentifier(alias)}`);
        }
      }
    } else {
      // Regular column
      baseColumns.push(translateColumn(col));
    }
  }
  
  return { baseColumns, expandColumns, joins };
}

/**
 * Translate FROM clause
 */
function translateFrom(from: FromClause, credentials: SnowflakeCredentials): string {
  if (from.ref) {
    const tableName = from.ref.join('.');
    const qualified = qualifyName(tableName, credentials);
    
    if (from.as) {
      return `${qualified} AS ${quoteIdentifier(from.as)}`;
    }
    
    return qualified;
  }

  throw new Error('Invalid FROM clause');
}

/**
 * Translate column specification
 */
function translateColumn(col: ColumnSpec): string {
  if (col.ref) {
    const colName = col.ref.map(part => quoteIdentifier(part)).join('.');
    if (col.as) {
      return `${colName} AS ${quoteIdentifier(col.as)}`;
    }
    return colName;
  }

  if (col.func) {
    const funcCall = translateColumnFunc(col);
    if (col.as) {
      return `${funcCall} AS ${quoteIdentifier(col.as)}`;
    }
    return funcCall;
  }

  if ('val' in col) {
    // Literal value
    if (col.val === null) {
      return 'NULL';
    }
    return String(col.val);
  }

  return '*';
}

/**
 * Translate column function
 */
function translateColumnFunc(col: ColumnSpec): string {
  const funcName = col.func!.toUpperCase();
  
  if (funcName === 'COUNT' && (!col.args || col.args.length === 0)) {
    return 'COUNT(*)';
  }

  if (col.args && col.args.length > 0) {
    const args = col.args.map(arg => {
      if (arg.ref) {
        return arg.ref.map((p: string) => quoteIdentifier(p)).join('.');
      }
      return '*';
    }).join(', ');
    return `${funcName}(${args})`;
  }

  return `${funcName}()`;
}

/**
 * Translate GROUP BY
 */
function translateGroupBy(groupBy: any): string {
  if (groupBy.ref) {
    return groupBy.ref.map((part: string) => quoteIdentifier(part)).join('.');
  }
  return String(groupBy);
}

/**
 * Translate INSERT
 */
function translateInsert(insert: InsertCQN, credentials: SnowflakeCredentials, params: any[]): SQLResult {
  const tableName = qualifyName(insert.into, credentials);
  
  if (insert.entries && insert.entries.length > 0) {
    // Bulk insert from entries
    const firstEntry = insert.entries[0];
    const columns = Object.keys(firstEntry);
    const quotedCols = columns.map(c => quoteIdentifier(c));
    
    const valueSets: string[] = [];
    for (const entry of insert.entries) {
      const values = columns.map(col => {
        params.push(entry[col]);
        return placeholder();
      });
      valueSets.push(`(${values.join(', ')})`);
    }
    
    const sql = `INSERT INTO ${tableName} (${quotedCols.join(', ')}) VALUES ${valueSets.join(', ')}`;
    return { sql, params };
  } else if (insert.columns && insert.values) {
    // Single insert with columns and values
    const quotedCols = insert.columns.map(c => quoteIdentifier(c));
    const valuePlaceholders = insert.values.map(v => {
      params.push(v);
      return placeholder();
    });
    
    const sql = `INSERT INTO ${tableName} (${quotedCols.join(', ')}) VALUES (${valuePlaceholders.join(', ')})`;
    return { sql, params };
  } else if (insert.rows) {
    // Multiple rows
    const quotedCols = insert.columns?.map(c => quoteIdentifier(c)) || [];
    const valueSets: string[] = [];
    
    for (const row of insert.rows) {
      const values = row.map((v: any) => {
        params.push(v);
        return placeholder();
      });
      valueSets.push(`(${values.join(', ')})`);
    }
    
    const sql = `INSERT INTO ${tableName} (${quotedCols.join(', ')}) VALUES ${valueSets.join(', ')}`;
    return { sql, params };
  }

  throw new Error('Invalid INSERT statement');
}

/**
 * Translate UPDATE
 */
function translateUpdate(update: UpdateCQN, credentials: SnowflakeCredentials, params: any[]): SQLResult {
  const tableName = qualifyName(update.entity, credentials);
  
  if (!update.data) {
    throw new Error('UPDATE requires data');
  }

  const setClauses: string[] = [];
  for (const [key, value] of Object.entries(update.data)) {
    params.push(value);
    setClauses.push(`${quoteIdentifier(key)} = ${placeholder()}`);
  }

  let sql = `UPDATE ${tableName} SET ${setClauses.join(', ')}`;

  // WHERE
  if (update.where && update.where.length > 0) {
    const whereClause = translateFilter(update.where, params);
    if (whereClause) {
      sql += ` WHERE ${whereClause}`;
    }
  }

  return { sql, params };
}

/**
 * Translate DELETE
 */
function translateDelete(del: DeleteCQN, credentials: SnowflakeCredentials, params: any[]): SQLResult {
  const tableName = qualifyName(del.from, credentials);
  let sql = `DELETE FROM ${tableName}`;

  // WHERE
  if (del.where && del.where.length > 0) {
    const whereClause = translateFilter(del.where, params);
    if (whereClause) {
      sql += ` WHERE ${whereClause}`;
    }
  }

  return { sql, params };
}

/**
 * Generate MERGE (UPSERT) statement
 */
export function generateMerge(
  tableName: string,
  keys: string[],
  data: any,
  credentials: SnowflakeCredentials
): SQLResult {
  const params: any[] = [];
  const qualified = qualifyName(tableName, credentials);
  
  const allColumns = Object.keys(data);
  const quotedKeys = keys.map(k => quoteIdentifier(k));
  const quotedCols = allColumns.map(c => quoteIdentifier(c));

  // VALUES clause for USING
  const valuePlaceholders = allColumns.map(col => {
    params.push(data[col]);
    return placeholder();
  });

  // ON clause (match on keys)
  const onConditions = quotedKeys.map(key => 
    `target.${key} = source.${key}`
  ).join(' AND ');

  // UPDATE SET clause (all columns except keys)
  const updateCols = allColumns.filter(col => !keys.includes(col));
  const updateSetClauses = updateCols.map(col => {
    const quoted = quoteIdentifier(col);
    return `${quoted} = source.${quoted}`;
  });

  let sql = `MERGE INTO ${qualified} AS target\n`;
  sql += `USING (SELECT ${quotedCols.map((col, idx) => `${valuePlaceholders[idx]} AS ${col}`).join(', ')}) AS source\n`;
  sql += `ON ${onConditions}\n`;
  
  if (updateSetClauses.length > 0) {
    sql += `WHEN MATCHED THEN UPDATE SET ${updateSetClauses.join(', ')}\n`;
  }
  
  sql += `WHEN NOT MATCHED THEN INSERT (${quotedCols.join(', ')}) VALUES (${quotedCols.map(col => `source.${col}`).join(', ')})`;

  return { sql, params };
}

