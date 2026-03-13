/**
 * Main CQN to SQL translator
 */

import { quoteIdentifier, qualifyName, toPhysicalIdentifier } from '../identifiers.js';
import { placeholder } from '../params.js';
import { translateFilter, translateSearch, FilterSqlContext } from './filters.js';
import { translateOrderBy } from './orderby.js';
import { translatePagination } from './pagination.js';
import { SnowflakeCredentials } from '../config.js';
import cds from '@sap/cds';

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
  args?: FromClause[];
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

interface TranslateContext {
  target?: any;
}

/**
 * Main entry point: translate CQN to SQL
 */
export function cqnToSQL(
  cqn: CQN,
  credentials: SnowflakeCredentials,
  context?: TranslateContext
): SQLResult {
  const params: any[] = [];

  if (cqn.SELECT) {
    return translateSelect(cqn.SELECT, credentials, params, context);
  } else if (cqn.INSERT) {
    return translateInsert(cqn.INSERT, credentials, params, context);
  } else if (cqn.UPDATE) {
    return translateUpdate(cqn.UPDATE, credentials, params, context);
  } else if (cqn.DELETE) {
    return translateDelete(cqn.DELETE, credentials, params, context);
  }

  throw new Error('Unsupported CQN operation');
}

/**
 * Translate SELECT
 */
function translateSelect(
  select: SelectCQN,
  credentials: SnowflakeCredentials,
  params: any[],
  context?: TranslateContext
): SQLResult {
  let sql = 'SELECT';

  // DISTINCT
  if (select.distinct) {
    sql += ' DISTINCT';
  }

  // Check for expansions
  const hasExpansions = select.columns?.some(col =>
    (col as any).expand || (col as any).inline
  );

  // Pre-compute dimension JOINs for star schema groupBy navigation refs (shared across columns + GROUP BY)
  const _dimJoins = new Map<string, string>();
  if (!hasExpansions && select.groupBy?.some((g: any) => g.ref?.length > 1)) {
    for (const g of select.groupBy) {
      if (g.ref?.length > 1) {
        buildDimensionJoin(g.ref, context, credentials, _dimJoins);
      }
    }
  }

  // Columns
  if (select.columns && select.columns.length > 0) {
    if (hasExpansions) {
      // Handle expansions with JOINs
      const { baseColumns, expandColumns, joins } = processColumnsWithExpand(
        select.columns,
        select.from,
        credentials,
        params,
        context?.target
      );
      
      const cols = [...baseColumns, ...expandColumns].join(', ');
      sql += ` ${cols}`;
      
      // FROM with joins
      let fromClause = translateFrom(select.from, credentials, context?.target, params);
      // Only append AS base alias when FROM is a plain table ref (not a JOIN-based FROM clause).
      // JOIN-based FROM clauses already embed aliases from their args.
      if (!select.from.as && !(select.from as any).join) {
        fromClause += ' AS base';
      }
      sql += ` FROM ${fromClause}`;
      if (joins.length) {
        sql += ` ${joins.join(' ')}`;
      }
    } else {
      // Regular columns — handle synthetic draft columns on active-entity reads
      const isDraft = isDraftTarget(context?.target, select.from);

      // Use the pre-computed dimension JOINs (from above)
      const dimJoins = _dimJoins;
      const hasDimJoins = dimJoins.size > 0;

      const cols = select.columns.map(col => {
        if (col.ref && !isDraft) {
          const colName = col.ref[col.ref.length - 1];
          if (isSyntheticDraftColumn(colName)) {
            return `${syntheticColumnValue(colName)} AS ${quoteIdentifier(col.as || colName)}`;
          }
          if (col.ref.length > 1 && isSyntheticDraftColumn(String(col.ref[0]))) {
            return `NULL AS ${quoteIdentifier(col.as || colName)}`;
          }
          // Dimension nav ref in SELECT (e.g. book/title → _grp_book.TITLE)
          if (hasDimJoins && col.ref.length > 1) {
            const firstPart: any = col.ref[0];
            const assocPart = typeof firstPart === 'string' ? firstPart : String((firstPart as any)?.id ?? firstPart);
            if (dimJoins.has(assocPart)) {
              const alias = `_grp_${toPhysicalIdentifier(assocPart).toLowerCase()}`;
              const lastPart: any = col.ref[col.ref.length - 1];
              const colAlias = col.as || (col.ref as any[]).map((p: any) => typeof p === 'string' ? p : String((p as any)?.id ?? p)).join('_');
              const colIdentifier = toPhysicalIdentifier(typeof lastPart === 'string' ? lastPart : String((lastPart as any)?.id ?? lastPart));
              return `${alias}.${colIdentifier} AS ${quoteIdentifier(colAlias)}`;
            }
          }
          const element = context?.target?.elements?.[colName];
          const explicitlyNonPhysical = element !== undefined &&
            (!!element.virtual || !!element.target || !element.type);
          if (explicitlyNonPhysical) {
            return `${syntheticColumnValue(colName)} AS ${quoteIdentifier(col.as || colName)}`;
          }
        }
        return translateColumn(col);
      }).join(', ');
      sql += ` ${cols}`;
      let fromClause = translateFrom(select.from, credentials, context?.target, params);
      if (hasDimJoins && !select.from.as && !(select.from as any).join) {
        fromClause += ' AS base';
      }
      sql += ` FROM ${fromClause}`;
      if (hasDimJoins) {
        sql += ` ${[...dimJoins.values()].join(' ')}`;
      }
    }
  } else {
    sql += ' *';
    sql += ` FROM ${translateFrom(select.from, credentials, context?.target, params)}`;
  }

  // WHERE + $search — use base alias when JOINs are present to avoid ambiguity.
  // When the FROM clause itself is a JOIN (navigation property filter), aliases come from
  // the JOIN args, not a forced "base" alias — so leave filterAlias undefined in that case.
  const hasJoinFrom = !!(select.from as any).join;
  const filterAlias = (hasExpansions && !hasJoinFrom) ? (select.from.as || 'base') : undefined;
  const isDraftQuery = isDraftTarget(context?.target, select.from);
  let hasWhere = false;
  // CAP embeds inline WHERE in the FROM ref for readAfterWrite (SELECT.one with keys):
  // from: { ref: [{ id: 'Entity', where: [...] }] }
  // Only apply when ref has exactly 1 element — navigation paths (ref.length > 1) use a
  // different mechanism and the inline WHERE belongs to the source entity, not the target.
  const inlineFromWhere =
    Array.isArray(select.from?.ref) && select.from.ref.length === 1
      ? extractInlineWhere(select.from)
      : undefined;
  const effectiveWhere = (select.where && select.where.length > 0) ? select.where : inlineFromWhere;
  if (effectiveWhere && effectiveWhere.length > 0) {
    const filterCtx: FilterSqlContext = {
      credentials,
      target: context?.target,
      resolveTable: resolveEntityName,
      // Enable subquery translation inside WHERE: { SELECT: {...} } → (SELECT ...)
      // IMPORTANT: pass the outer params array so subquery bindings are appended inline.
      translateSelect: (selectBody: any, outerParams: any[]) =>
        translateSelect(selectBody, credentials, outerParams, context).sql,
    };
    const whereClause = translateFilter(effectiveWhere, params, filterAlias, isDraftQuery, filterCtx);
    if (whereClause) {
      sql += ` WHERE ${whereClause}`;
      hasWhere = true;
    }
  }

  // $search support: translate to ILIKE conditions over searchable string columns
  const searchExpr = (select as any).search;
  if (searchExpr && searchExpr.length > 0) {
    const targetElements = context?.target?.elements ?? {};
    const searchSQL = translateSearch(searchExpr, targetElements, params, filterAlias);
    if (searchSQL) {
      sql += hasWhere ? ` AND (${searchSQL})` : ` WHERE (${searchSQL})`;
      hasWhere = true; // eslint-disable-line @typescript-eslint/no-unused-vars
    }
  }

  // GROUP BY
  if (select.groupBy && select.groupBy.length > 0) {
    const groupByClause = select.groupBy.map((g: any) => translateGroupBy(g, _dimJoins.size > 0 ? _dimJoins : undefined)).join(', ');
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
  _params: any[],
  baseTarget?: any
): { baseColumns: string[]; expandColumns: string[]; joins: string[] } {
  
  const baseColumns: string[] = [];
  const expandColumns: string[] = [];
  const joins: string[] = [];
  
  const baseAlias = from.as || 'base';
  let joinCounter = 0;
  const isDraft = isDraftTarget(baseTarget, from);
  
  for (const col of columns) {
    if ((col as any).expand) {
      const assocName = (col.ref as string[])[0];
      const expandSpec = (col as any).expand as ColumnSpec[];

      if (isLikelyToMany(assocName, baseTarget)) {
        const targetEntity = resolveAssociationTargetName(baseTarget, assocName)
          || (assocName.charAt(0).toUpperCase() + assocName.slice(1));
        const targetTable = qualifyName(targetEntity, credentials);
        // Derive the FK name from the simple entity name (last segment after dot).
        // from.ref[0] may be a fully qualified name like 'E2ETestService.Authors'
        // or an object { id: '...' }; we need only the short name, e.g. 'Authors'.
        const fromRefFirst = (from.ref || [])[0];
        const fromRefName = typeof fromRefFirst === 'string' ? fromRefFirst
          : (fromRefFirst as any)?.id ?? (fromRefFirst as any)?.name ?? 'parent';
        const fromSimpleName = fromRefName.split('.').pop() ?? fromRefName;
        const parentFK = `${singularize(fromSimpleName)}_ID`;
        let subWhere = `tm.${toPhysicalIdentifier(parentFK)} = ${baseAlias}.ID`;
        const expandWhere = (col as any).where;
        if (expandWhere && expandWhere.length > 0) {
          const extraWhere = translateFilter(expandWhere, _params);
          if (extraWhere) subWhere += ` AND ${extraWhere}`;
        }
        // Build OBJECT_CONSTRUCT: use explicit key-value pairs so that CDS element names
        // (e.g. 'title') are used as JSON keys instead of Snowflake physical column names
        // (e.g. TITLE), fixing case-mismatch in OData responses.
        const isWildcard = !expandSpec || expandSpec.length === 0 || (expandSpec.length === 1 && (expandSpec[0] as any) === '*') || (expandSpec.length === 1 && (expandSpec[0] as any).ref?.[0] === '*');
        let objConstruct: string;
        if (!isWildcard) {
          const pairs = expandSpec
            .filter((c: any) => c.ref)
            .map((c: any) => {
              const cdsName = (c.ref as string[])[0];
              return `'${cdsName}', ${toPhysicalIdentifier(cdsName)}`;
            })
            .join(', ');
          objConstruct = pairs ? `OBJECT_CONSTRUCT(${pairs})` : 'OBJECT_CONSTRUCT(*)';
        } else {
          // Wildcard expand: resolve child entity elements to build explicit key-value pairs
          // so JSON keys match CDS element names instead of Snowflake UPPERCASE column names.
          const assocEl = baseTarget?.elements?.[assocName];
          const childEntityName: string | undefined = assocEl?.target;
          const childEntity = assocEl?._target
            ?? (childEntityName ? cds.model?.definitions?.[childEntityName] : undefined);
          if (childEntity?.elements) {
            const pairs = Object.entries(childEntity.elements as Record<string, any>)
              .filter(([, el]) => !el.isAssociation && !el.virtual && el['@cds.persistence.skip'] !== true)
              .map(([elName]) => `'${elName}', ${toPhysicalIdentifier(elName)}`)
              .join(', ');
            objConstruct = pairs ? `OBJECT_CONSTRUCT(${pairs})` : 'OBJECT_CONSTRUCT(*)';
          } else {
            objConstruct = 'OBJECT_CONSTRUCT(*)';
          }
        }
        // COALESCE ensures an empty array [] is returned instead of NULL when no rows match.
        const expandLimit = (col as any).limit?.rows?.val;
        const expandOrderBy: any[] | undefined = (col as any).orderBy;
        // Build WITHIN GROUP (ORDER BY ...) clause for ARRAY_AGG if orderBy present
        let withinGroup = '';
        if (expandOrderBy && expandOrderBy.length > 0) {
          const orderClauses = expandOrderBy.map((item: any) => {
            const colPart = item.ref ? item.ref.map((p: string) => toPhysicalIdentifier(p)).join('.') : String(item);
            const dir = item.sort ? ` ${item.sort.toUpperCase()}` : '';
            return `${colPart}${dir}`;
          }).join(', ');
          withinGroup = ` WITHIN GROUP (ORDER BY ${orderClauses})`;
        }
        let subQuery: string;
        if (expandLimit) {
          subQuery = `SELECT COALESCE(ARRAY_AGG(${objConstruct})${withinGroup}, ARRAY_CONSTRUCT()) FROM (SELECT * FROM ${targetTable} AS tmsub WHERE tmsub.${toPhysicalIdentifier(parentFK)} = ${baseAlias}.ID LIMIT ${expandLimit}) AS tm`;
        } else {
          subQuery = `SELECT COALESCE(ARRAY_AGG(${objConstruct})${withinGroup}, ARRAY_CONSTRUCT()) FROM ${targetTable} AS tm WHERE ${subWhere}`;
        }
        expandColumns.push(`(${subQuery}) AS ${quoteIdentifier(assocName)}`);
        if ((col as any).count) {
          const cntWhere = `tcnt.${toPhysicalIdentifier(parentFK)} = ${baseAlias}.ID`;
          const cntSubQuery = `SELECT COUNT(*) FROM ${targetTable} AS tcnt WHERE ${cntWhere}`;
          expandColumns.push(`(${cntSubQuery}) AS ${quoteIdentifier(assocName + '@odata.count')}`);
        }
      } else {
        const joinAlias = `expand_${joinCounter++}`;
        const foreignKey = resolveForeignKey(baseTarget, assocName);

        // On active-entity tables, draft associations have no physical FK.
        // On .drafts tables these columns ARE physical, so expand normally.
        const assocIsSynthetic = !isDraft && isSyntheticDraftColumn(assocName);
        const fkElement = baseTarget?.elements?.[foreignKey];
        const fkMissing = assocIsSynthetic ||
          (!isDraft && baseTarget?.elements !== undefined && fkElement === undefined);

        if (fkMissing) {
          collectNullExpandColumns(expandSpec, assocName, expandColumns);
        } else {
          const targetEntity = resolveAssociationTargetName(baseTarget, assocName)
            || (assocName.charAt(0).toUpperCase() + assocName.slice(1));
          const targetTable = qualifyName(targetEntity, credentials);
          const targetKey = resolveTargetKey(baseTarget, assocName);
          let joinCondition = `${baseAlias}.${toPhysicalIdentifier(foreignKey)} = ${joinAlias}.${toPhysicalIdentifier(targetKey)}`;
          const expandWhere = (col as any).where;
          if (expandWhere && expandWhere.length > 0) {
            const extraWhere = translateFilter(expandWhere, _params);
            if (extraWhere) joinCondition += ` AND ${extraWhere}`;
          }
          joins.push(`LEFT JOIN ${targetTable} AS ${joinAlias} ON ${joinCondition}`);

          // Look up the CDS definition for the expand target using the original
          // association target name (not the physical table name) so that element
          // metadata (for wildcard expand handling) is available.
          const assocCDSTarget = baseTarget?.elements?.[assocName]?.target;
          const targetDef = getDefinitionForEntity(assocCDSTarget) || getDefinitionForEntity(targetEntity);

          collectNestedExpandColumns(
            expandSpec,
            assocName,
            joinAlias,
            joins,
            expandColumns,
            credentials,
            () => `expand_${joinCounter++}`,
            targetDef,
            _params
          );
        }
      }
    } else if ((col as any).inline) {
      // Inline expansion: similar to expand but flattens structure
      const assocName = (col.ref as string[])[0];
      const joinAlias = `inline_${joinCounter++}`;
      
      const foreignKey = resolveForeignKey(baseTarget, assocName);
      const targetEntity = resolveAssociationTargetName(baseTarget, assocName)
        || (assocName.charAt(0).toUpperCase() + assocName.slice(1));
      const targetTable = qualifyName(targetEntity, credentials);
      const inlineTargetKey = resolveTargetKey(baseTarget, assocName);
      const joinSQL = `LEFT JOIN ${targetTable} AS ${joinAlias} ON ${baseAlias}.${toPhysicalIdentifier(foreignKey)} = ${joinAlias}.${toPhysicalIdentifier(inlineTargetKey)}`;
      joins.push(joinSQL);
      
      // Add inlined columns (flattened, no prefix)
      const inlineSpec = (col as any).inline as ColumnSpec[];
      for (const inlineCol of inlineSpec) {
        if (inlineCol.ref) {
          const colName = inlineCol.ref[inlineCol.ref.length - 1];
          const alias = inlineCol.as || `${assocName}_${colName}`;
          expandColumns.push(`${joinAlias}.${toPhysicalIdentifier(colName)} AS ${quoteIdentifier(alias)}`);
        }
      }
    } else {
      // Regular column
      if (col.ref) {
        const colName = col.ref[col.ref.length - 1];
        const alias = col.as || colName;
        // Multi-part nav refs (e.g. DraftAdministrativeData.DraftMessages)
        if (col.ref.length > 1) {
          baseColumns.push(`NULL AS ${quoteIdentifier(col.as || colName)}`);
        } else if (isSyntheticDraftColumn(colName)) {
          // Synthetic draft indicator columns (IsActiveEntity, HasDraftEntity, etc.)
          // do not exist on active-entity tables; emit constant values.
          // On actual draft tables they ARE physical but only appear in queries that
          // go through the non-expand path (translateColumn), not here.
          baseColumns.push(`${syntheticColumnValue(colName)} AS ${quoteIdentifier(alias)}`);
        } else {
          // Regular physical column.
          // FK columns like author_ID are NOT in the CDS runtime model elements
          // (only in cds.compile.for.sql), but they ARE physical DB columns.
          // Only suppress a column if the model explicitly marks it virtual/association.
          const element = baseTarget?.elements?.[colName];
          const explicitlyNonPhysical = element !== undefined &&
            (!!element.virtual || !!element.target || !element.type);
          if (explicitlyNonPhysical) {
            baseColumns.push(`${syntheticColumnValue(colName)} AS ${quoteIdentifier(alias)}`);
          } else {
            baseColumns.push(`${baseAlias}.${toPhysicalIdentifier(colName)} AS ${quoteIdentifier(alias)}`);
          }
        }
      } else if ((col as any) === '*' || (typeof (col as any) === 'string' && (col as any) === '*')) {
        // CAP wildcard column in a JOIN query — expand to qualified base columns to
        // avoid "ambiguous column name" errors when both tables share column names.
        if (baseTarget?.elements) {
          const wildcardCols: string[] = [];
          for (const [elName, el] of Object.entries<any>(baseTarget.elements)) {
            if (el.virtual || el.target) continue;
            // Only suppress synthetic draft columns on active-entity (non-draft) tables;
            // on draft tables they are physical BOOLEAN columns.
            if (!isDraft && isSyntheticDraftColumn(elName)) continue;
            // Note: do NOT filter on !el.type — projection elements may lack a direct
            // type annotation while still being valid physical columns.
            const physName = el['@cds.persistence.name'] ?? toPhysicalIdentifier(elName);
            wildcardCols.push(`${baseAlias}.${physName} AS ${quoteIdentifier(elName)}`);
          }
          if (wildcardCols.length > 0) {
            baseColumns.push(...wildcardCols);
          } else {
            // Elements exist but none qualify — fall back to qualified wildcard
            baseColumns.push(`${baseAlias}.*`);
          }
        } else {
          baseColumns.push(`${baseAlias}.*`); // qualified wildcard avoids ambiguity
        }
      } else {
        baseColumns.push(translateColumn(col));
      }
    }
  }

  return { baseColumns, expandColumns, joins };
}

/**
 * Emit NULL AS "prefix_col" for every leaf column in an expand spec.
 * Used when the association has no physical FK on the base table
 * (e.g. DraftAdministrativeData on an active-entity query).
 */
function collectNullExpandColumns(
  columns: ColumnSpec[],
  pathPrefix: string,
  expandColumns: string[]
) {
  for (const col of columns) {
    if (!col.ref) continue;
    const colName = col.ref[col.ref.length - 1];
    if ((col as any).expand) {
      collectNullExpandColumns((col as any).expand as ColumnSpec[], `${pathPrefix}__${colName}`, expandColumns);
    } else {
      const alias = col.as || `${pathPrefix}__${colName}`;
      expandColumns.push(`NULL AS ${quoteIdentifier(alias)}`);
    }
  }
}

function collectNestedExpandColumns(
  columns: ColumnSpec[],
  pathPrefix: string,
  parentAlias: string,
  joins: string[],
  expandColumns: string[],
  credentials: SnowflakeCredentials,
  nextAlias: () => string,
  parentTarget?: any,
  params: any[] = []
) {
  // If expand columns is a wildcard, expand all physical columns of the target entity.
  if (columns.length === 1 && (columns[0] as any) === '*') {
    if (parentTarget?.elements) {
      const wildcardCols: string[] = [];
      for (const [elName, el] of Object.entries<any>(parentTarget.elements)) {
        if (el.virtual || el.target) continue;
        // Note: do NOT filter on !el.type — projection elements may lack a direct type.
        const physName = el['@cds.persistence.name'] ?? toPhysicalIdentifier(elName);
        wildcardCols.push(`${parentAlias}.${physName} AS ${quoteIdentifier(`${pathPrefix}__${elName}`)}`);
      }
      if (wildcardCols.length > 0) {
        expandColumns.push(...wildcardCols);
      } else {
        expandColumns.push(`${parentAlias}.*`);
      }
    } else {
      expandColumns.push(`${parentAlias}.*`);
    }
    return;
  }

  for (const col of columns) {
    // Handle xpr (expression) columns — e.g. lean-draft.js injects CASE expressions
    // for InProcessByUser timeout logic.  Translate to SQL expression.
    if ((col as any).xpr && (col as any).as) {
      const alias = `${pathPrefix}__${(col as any).as}`;
      const xprSQL = xprToSQL((col as any).xpr, parentAlias, params);
      expandColumns.push(`${xprSQL} AS ${quoteIdentifier(alias)}`);
      continue;
    }
    if (!col.ref) continue;
    const colName = col.ref[col.ref.length - 1];

    if ((col as any).expand) {
      const nestedAssoc = colName;
      const nestedTargetName = resolveAssociationTargetName(parentTarget, nestedAssoc)
        || (nestedAssoc.charAt(0).toUpperCase() + nestedAssoc.slice(1));
      const nestedTable = qualifyName(nestedTargetName, credentials);
      const nestedTargetDef = getDefinitionForEntity(nestedTargetName);

      if (isLikelyToMany(nestedAssoc, parentTarget)) {
        // To-many nested expand: use ARRAY_AGG correlated subquery
        const expandSpec = (col as any).expand as ColumnSpec[];
        // Determine FK: parentTarget's PK is referenced by nestedTarget's FK
        // For to-many: the child table has a FK pointing back to the parent.
        // We need the FK name in the child table. Use heuristic: singularize(parentTarget name) + _ID
        const parentEntityShortName = (parentTarget?.name ?? '').split('.').pop() ?? '';
        const childFKCol = toPhysicalIdentifier(parentEntityShortName ? `${singularize(parentEntityShortName)}_ID` : 'ID');
        // Build OBJECT_CONSTRUCT for the nested records
        const isWildcard = !expandSpec || expandSpec.length === 0 || (expandSpec.length === 1 && (expandSpec[0] as any) === '*') || (expandSpec.length === 1 && (expandSpec[0] as any).ref?.[0] === '*');
        let objConstruct: string;
        if (!isWildcard && expandSpec.some(c => c.ref)) {
          const pairs = expandSpec
            .filter((c: any) => c.ref)
            .map((c: any) => {
              const cdsName = (c.ref as string[])[0];
              return `'${cdsName}', ${toPhysicalIdentifier(cdsName)}`;
            })
            .join(', ');
          objConstruct = pairs ? `OBJECT_CONSTRUCT(${pairs})` : 'OBJECT_CONSTRUCT(*)';
        } else if (nestedTargetDef?.elements) {
          const pairs = Object.entries(nestedTargetDef.elements as Record<string, any>)
            .filter(([, el]) => !el.isAssociation && !el.virtual && el['@cds.persistence.skip'] !== true)
            .map(([elName]) => `'${elName}', ${toPhysicalIdentifier(elName)}`)
            .join(', ');
          objConstruct = pairs ? `OBJECT_CONSTRUCT(${pairs})` : 'OBJECT_CONSTRUCT(*)';
        } else {
          objConstruct = 'OBJECT_CONSTRUCT(*)';
        }
        const subQuery = `SELECT COALESCE(ARRAY_AGG(${objConstruct}), ARRAY_CONSTRUCT()) FROM ${nestedTable} AS tm WHERE tm.${childFKCol} = ${parentAlias}.ID`;
        expandColumns.push(`(${subQuery}) AS ${quoteIdentifier(`${pathPrefix}__${nestedAssoc}`)}`);
      } else {
        // To-one nested expand: use LEFT JOIN
        const nestedAlias = nextAlias();
        const nestedFK = resolveForeignKey(parentTarget, nestedAssoc);
        const nestedTargetKey = resolveTargetKey(parentTarget, nestedAssoc);
        joins.push(
          `LEFT JOIN ${nestedTable} AS ${nestedAlias} ON ${parentAlias}.${toPhysicalIdentifier(nestedFK)} = ${nestedAlias}.${toPhysicalIdentifier(nestedTargetKey)}`
        );

        collectNestedExpandColumns(
          (col as any).expand as ColumnSpec[],
          `${pathPrefix}__${nestedAssoc}`,
          nestedAlias,
          joins,
          expandColumns,
          credentials,
          nextAlias,
          nestedTargetDef,
          params
        );
      }
      continue;
    }

    const alias = `${pathPrefix}__${colName}`;
    expandColumns.push(`${parentAlias}.${toPhysicalIdentifier(colName)} AS ${quoteIdentifier(alias)}`);
  }
}

/**
 * Translate a CQN xpr (expression array) to SQL.
 * Handles CASE/WHEN/THEN/ELSE/END, comparisons, column refs, and literal values.
 * Column refs are qualified with `tableAlias`.
 */
function xprToSQL(xpr: any[], tableAlias: string, params: any[]): string {
  const parts: string[] = [];
  for (const part of xpr) {
    if (typeof part === 'string') {
      // SQL keyword or operator — uppercase it
      parts.push(part.toUpperCase());
    } else if (part && typeof part === 'object') {
      if (Array.isArray(part.ref)) {
        const colName = part.ref[part.ref.length - 1];
        parts.push(`${tableAlias}.${toPhysicalIdentifier(colName)}`);
      } else if ('val' in part) {
        params.push(part.val);
        parts.push(placeholder());
      }
    }
  }
  return parts.join(' ');
}

function isLikelyToMany(associationName: string, baseTarget?: any): boolean {
  const assoc = baseTarget?.elements?.[associationName];
  if (assoc) {
    if (assoc.is2many) return true;
    if (assoc.cardinality?.max === '*') return true;
    // Found in CDS metadata — definitively not to-many
    return false;
  }
  // Heuristic fallback when no CDS metadata is present
  return associationName.endsWith('s');
}

function singularize(name: string): string {
  return name.endsWith('s') ? name.slice(0, -1) : name;
}

/**
 * Translate FROM clause
 */
function translateFrom(from: FromClause, credentials: SnowflakeCredentials, target?: any, params?: any[]): string {
  // Handle JOIN-based FROM clause (generated by CAP for navigation property filters)
  if (from.join) {
    const joinType = from.join.toUpperCase();
    const args = from.args as FromClause[] | undefined;
    if (args && args.length >= 2) {
      const leftSQL = translateFrom(args[0], credentials, target, params);
      const rightSQL = translateFrom(args[1], credentials, undefined, params);
      const onClause = (from as any).on
        ? translateFilter((from as any).on, params || [], undefined, false)
        : '1=1';
      return `${leftSQL} ${joinType} JOIN ${rightSQL} ON ${onClause}`;
    }
  }

  if (from.ref) {
    // Locale-aware handling: when target entity has localized elements, inject dynamic locale join
    if (params && target) {
      const localizedSQL = buildLocalizedFromSubqueryForTarget(target, credentials, params);
      if (localizedSQL) {
        if (from.as) return `${localizedSQL} AS ${quoteIdentifier(from.as)}`;
        return localizedSQL;
      }
    }
    // Also handle explicit localized.* prefix (CAP sometimes uses this)
    if (params) {
      const firstRef = from.ref[0];
      const refName = typeof firstRef === 'string' ? firstRef : (firstRef as any)?.id ?? (firstRef as any)?.name ?? '';
      if (typeof refName === 'string' && refName.startsWith('localized.')) {
        const localizedSQL = buildLocalizedFromSubquery(refName, credentials, params);
        if (localizedSQL) {
          if (from.as) return `${localizedSQL} AS ${quoteIdentifier(from.as)}`;
          return localizedSQL;
        }
      }
    }

    const tableName = resolveTableNameFromRef(from.ref, target);
    const qualified = qualifyName(tableName, credentials);

    if (from.as) {
      return `${qualified} AS ${quoteIdentifier(from.as)}`;
    }

    return qualified;
  }

  throw new Error('Invalid FROM clause');
}

/**
 * Build a locale-aware inline subquery using the target CDS entity definition.
 * Returns null if the entity has no localized elements.
 */
function buildLocalizedFromSubqueryForTarget(
  target: any,
  credentials: SnowflakeCredentials,
  params: any[]
): string | null {
  if (!target?.elements) return null;

  const localizedCols: string[] = [];
  const keyCols: string[] = [];
  for (const [colName, elem] of Object.entries(target.elements)) {
    const el = elem as any;
    if (el.key === true) keyCols.push(colName);
    if (el.localized === true) localizedCols.push(colName);
  }
  if (localizedCols.length === 0 || keyCols.length === 0) return null;

  // Get the physical table name from the target definition
  const tableName = resolveEntityName(target.name ?? target['@cds.persistence.name'], target);
  if (!tableName) return null;

  const textsName = tableName + '_TEXTS';
  const baseTable = qualifyName(tableName, credentials);
  const textsTable = qualifyName(textsName, credentials);

  const locale = (cds.context as any)?.locale ?? 'en';

  const excludeList = localizedCols.map(c => toPhysicalIdentifier(c)).join(', ');
  const coalesceCols = localizedCols.map(c => {
    const phys = toPhysicalIdentifier(c);
    return `COALESCE(t.${phys}, base.${phys}) AS ${phys}`;
  }).join(', ');
  const joinOn = keyCols.map(k => {
    const phys = toPhysicalIdentifier(k);
    return `base.${phys} = t.${phys}`;
  }).join(' AND ');

  params.push(locale);
  return `(SELECT base.* EXCLUDE (${excludeList}), ${coalesceCols} FROM ${baseTable} AS base LEFT JOIN ${textsTable} AS t ON ${joinOn} AND t.LOCALE = ?)`;
}

/**
 * Build a locale-aware inline subquery for a localized.* entity (explicit prefix path).
 * Returns null if the entity cannot be resolved or has no localized elements.
 */
function buildLocalizedFromSubquery(
  localizedEntityName: string,
  credentials: SnowflakeCredentials,
  params: any[]
): string | null {
  const baseEntityName = localizedEntityName.slice('localized.'.length);
  const baseDef = getDefinitionForEntity(baseEntityName);
  if (!baseDef?.elements) return null;

  const localizedCols: string[] = [];
  const keyCols: string[] = [];
  for (const [colName, elem] of Object.entries(baseDef.elements)) {
    const el = elem as any;
    if (el.key) keyCols.push(colName);
    if (el.localized) localizedCols.push(colName);
  }
  if (localizedCols.length === 0 || keyCols.length === 0) return null;

  const locale = (cds.context as any)?.locale ?? 'en';

  const baseName = resolveEntityName(baseEntityName);
  const textsName = baseName + '_TEXTS';
  const baseTable = qualifyName(baseName, credentials);
  const textsTable = qualifyName(textsName, credentials);

  const excludeList = localizedCols.map(c => toPhysicalIdentifier(c)).join(', ');
  const coalesceCols = localizedCols.map(c => {
    const phys = toPhysicalIdentifier(c);
    return `COALESCE(t.${phys}, base.${phys}) AS ${phys}`;
  }).join(', ');
  const joinOn = keyCols.map(k => {
    const phys = toPhysicalIdentifier(k);
    return `base.${phys} = t.${phys}`;
  }).join(' AND ');

  params.push(locale);
  return `(SELECT base.* EXCLUDE (${excludeList}), ${coalesceCols} FROM ${baseTable} AS base LEFT JOIN ${textsTable} AS t ON ${joinOn} AND t.LOCALE = ?)`;
}

/**
 * Translate column specification
 */
function translateColumn(col: ColumnSpec): string {
  if (typeof col === 'string') return col;
  if (col.ref) {
    if (col.ref.length > 1 && isSyntheticDraftColumn(String(col.ref[0]))) {
      // Navigation path through a synthetic draft association — return NULL
      const alias = col.as || col.ref[col.ref.length - 1];
      return `NULL AS ${quoteIdentifier(alias)}`;
    }
    const colName = col.ref.map(part => toPhysicalIdentifier(part)).join('.');
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

  if (col && typeof col === 'object' && 'val' in col) {
    // Literal value — must be properly quoted and aliased for valid SQL
    let expr: string;
    if (col.val === null || col.val === undefined) {
      expr = 'NULL';
    } else if (typeof col.val === 'boolean') {
      expr = col.val ? 'TRUE' : 'FALSE';
    } else if (typeof col.val === 'string') {
      // Quote the string literal (escape single quotes)
      expr = `'${String(col.val).replace(/'/g, "''")}'`;
    } else {
      expr = String(col.val);
    }
    if ((col as any).as) {
      return `${expr} AS ${quoteIdentifier((col as any).as)}`;
    }
    return expr;
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
        return arg.ref.map((p: string) => toPhysicalIdentifier(p)).join('.');
      }
      if ('val' in arg) return arg.val === null ? 'NULL' : String(arg.val);
      return '*';
    }).join(', ');

    // CAP emits "countdistinct" for $apply aggregate — Snowflake needs COUNT(DISTINCT ...)
    if (funcName === 'COUNTDISTINCT') {
      return `COUNT(DISTINCT ${args})`;
    }

    return `${funcName}(${args})`;
  }

  return `${funcName}()`;
}

/**
 * Build a LEFT JOIN entry for a star schema dimension association.
 * e.g. ref = ['book', 'title'] → LEFT JOIN <BOOKS_TABLE> AS _grp_book ON _grp_book.ID = base.BOOK_ID
 */
function buildDimensionJoin(
  ref: any[],
  context: TranslateContext | undefined,
  credentials: SnowflakeCredentials,
  dimJoins: Map<string, string>
): void {
  const assocName = typeof ref[0] === 'string' ? ref[0] : String(ref[0]?.id ?? ref[0]);
  if (dimJoins.has(assocName)) return;
  const assocEl = context?.target?.elements?.[assocName];
  const targetEntityName: string | undefined = assocEl?.target;
  if (!targetEntityName) return;
  const fkCol = toPhysicalIdentifier(`${assocName}_ID`);
  const targetShortName = targetEntityName.split('.').pop()!;
  const targetTable = qualifyName(targetShortName, credentials);
  const alias = `_grp_${toPhysicalIdentifier(assocName).toLowerCase()}`;
  dimJoins.set(assocName, `LEFT JOIN ${targetTable} AS ${alias} ON ${alias}.ID = base.${fkCol}`);
}

/**
 * Translate GROUP BY
 * For navigation path refs (ref.length > 1), uses dimension join alias if dimJoins is provided,
 * otherwise falls back to dot-separated identifiers.
 */
function translateGroupBy(groupBy: any, dimJoins?: Map<string, string>): string {
  if (groupBy.ref) {
    if (groupBy.ref.length > 1 && dimJoins) {
      const assocName = typeof groupBy.ref[0] === 'string' ? groupBy.ref[0] : String(groupBy.ref[0]?.id ?? groupBy.ref[0]);
      const colParts = groupBy.ref.slice(1);
      const alias = `_grp_${toPhysicalIdentifier(assocName).toLowerCase()}`;
      if (dimJoins.has(assocName)) {
        return `${alias}.${colParts.map((p: string) => toPhysicalIdentifier(p)).join('.')}`;
      }
    }
    return groupBy.ref.map((part: string | any) =>
      toPhysicalIdentifier(typeof part === 'string' ? part : (part?.id ?? String(part)))
    ).join('.');
  }
  return String(groupBy);
}

/**
 * Translate INSERT
 */
function translateInsert(
  insert: InsertCQN,
  credentials: SnowflakeCredentials,
  params: any[],
  context?: TranslateContext
): SQLResult {
  // Prefer context.target.name over insert.into: CAP may pass a more specific
  // target (e.g. "E2ETestService.Books.drafts") while insert.into still holds
  // the base service entity ("E2ETestService.Books"), which would follow the
  // projection chain to the wrong physical table.
  const entityName = resolveDMLEntityName(context?.target?.name, insert.into);
  const tableName = qualifyName(resolveEntityName(entityName, context?.target), credentials);
  
  if (insert.entries && insert.entries.length > 0) {
    // Bulk insert from entries.
    // Filter out columns that don't have a physical mapping on the target entity
    // (e.g. DraftMessages on the active Books table during draftActivate).
    const targetElements = context?.target?.elements;
    const firstEntry = insert.entries[0];
    const allCols = Object.keys(firstEntry);
    const columns = targetElements
      ? allCols.filter(col => {
          const el = targetElements[col];
          // Keep the column if: no element metadata (unknown → keep for safety),
          // or element exists with a type (physical column), but not virtual/association.
          if (!el) return false; // element not in target model — skip
          if (el.virtual || el.isAssociation) return false;
          return true;
        })
      : allCols;
    const quotedCols = columns.map(c => toPhysicalIdentifier(c));
    
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
    const quotedCols = insert.columns.map(c => toPhysicalIdentifier(c));
    const valuePlaceholders = insert.values.map(v => {
      params.push(v);
      return placeholder();
    });
    
    const sql = `INSERT INTO ${tableName} (${quotedCols.join(', ')}) VALUES (${valuePlaceholders.join(', ')})`;
    return { sql, params };
  } else if (insert.rows) {
    // Multiple rows
    const quotedCols = insert.columns?.map(c => toPhysicalIdentifier(c)) || [];
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
function translateUpdate(
  update: UpdateCQN,
  credentials: SnowflakeCredentials,
  params: any[],
  context?: TranslateContext
): SQLResult {
  const entityName = resolveDMLEntityName(context?.target?.name, update.entity);
  const tableName = qualifyName(resolveEntityName(entityName, context?.target), credentials);

  if (!update.data) {
    throw new Error('UPDATE requires data');
  }

  const setClauses: string[] = [];
  for (const [key, value] of Object.entries(update.data)) {
    params.push(value);
    setClauses.push(`${toPhysicalIdentifier(key)} = ${placeholder()}`);
  }

  let sql = `UPDATE ${tableName} SET ${setClauses.join(', ')}`;

  // WHERE — may be in update.where OR embedded in the entity reference as
  // { ref: [{ id: 'Entity', where: [...] }] } (used by CAP for single-entity PATCH)
  const inlineEntityWhere = extractInlineWhere(update.entity);
  const effectiveWhere = update.where?.length ? update.where : inlineEntityWhere;
  if (effectiveWhere && effectiveWhere.length > 0) {
    // Pass isDraft flag so that IsActiveEntity in WHERE is treated as a physical
    // column on draft tables, not replaced by the constant TRUE/FALSE.
    const isDraftCtx = !!(context?.target?.name?.endsWith('.drafts'));
    const whereClause = translateFilter(effectiveWhere, params, undefined, isDraftCtx);
    if (whereClause) {
      sql += ` WHERE ${whereClause}`;
    }
  }

  return { sql, params };
}

/**
 * Translate DELETE
 */
function translateDelete(
  del: DeleteCQN,
  credentials: SnowflakeCredentials,
  params: any[],
  context?: TranslateContext
): SQLResult {
  const entityName = resolveDMLEntityName(context?.target?.name, del.from);
  const tableName = qualifyName(resolveEntityName(entityName, context?.target), credentials);
  let sql = `DELETE FROM ${tableName}`;

  // WHERE — may be in del.where OR embedded in the from reference
  const inlineFromWhere = extractInlineWhere(del.from);
  const effectiveWhere = del.where?.length ? del.where : inlineFromWhere;
  if (effectiveWhere && effectiveWhere.length > 0) {
    const isDraftCtx = !!(context?.target?.name?.endsWith('.drafts'));
    const whereClause = translateFilter(effectiveWhere, params, undefined, isDraftCtx);
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

/**
 * Lowercase names of CAP draft columns / associations that never exist on the
 * physical active-entity table.
 */
const SYNTHETIC_DRAFT_COLUMNS = new Set([
  'isactiveentity',
  'hasactiveentity',
  'hasdraftentity',
  'draftadministrativedata',
  'draftadministrativedata_draftuuid',
  'draftadministrativedata_id',
  'siblingentity',
]);

function isSyntheticDraftColumn(colName: string): boolean {
  const lower = colName.toLowerCase();
  if (SYNTHETIC_DRAFT_COLUMNS.has(lower)) return true;
  if (lower.startsWith('draftadministrativedata_')) return true;
  if (lower.startsWith('siblingentity_')) return true;
  return false;
}

function isDraftTarget(target: any, fromRef?: any): boolean {
  if (typeof target?.name === 'string' && target.name.endsWith('.drafts')) return true;
  // Also check the FROM clause ref for draft entity names
  if (fromRef?.ref) {
    const first = fromRef.ref[0];
    const name = typeof first === 'string' ? first : first?.id ?? first?.name ?? '';
    if (name.endsWith('.drafts')) return true;
  }
  return false;
}

function resolveForeignKey(target: any, assocName: string): string {
  const assoc = target?.elements?.[assocName];
  if (assoc?.keys && assoc.keys.length > 0) {
    const targetKeyName = assoc.keys[0].ref?.[0];
    if (targetKeyName) return `${assocName}_${targetKeyName}`;
  }
  if (target?.elements?.[`${assocName}_ID`]) return `${assocName}_ID`;
  if (target?.elements) {
    const prefix = `${assocName}_`;
    for (const elName of Object.keys(target.elements)) {
      if (elName.startsWith(prefix) && !target.elements[elName].target) {
        return elName;
      }
    }
  }
  return `${assocName}_ID`;
}

function resolveTargetKey(target: any, assocName: string): string {
  const assoc = target?.elements?.[assocName];
  if (assoc?.keys && assoc.keys.length > 0) {
    const keyName = assoc.keys[0].ref?.[0];
    if (keyName) return keyName;
  }
  return 'ID';
}

function syntheticColumnValue(colName: string): string {
  switch (colName.toLowerCase()) {
    case 'isactiveentity': return 'TRUE';
    case 'hasactiveentity': return 'FALSE';
    case 'hasdraftentity': return 'FALSE';
    default: return 'NULL';
  }
}

/**
 * Extract an inline WHERE predicate that CAP embeds inside the entity reference
 * for single-entity operations, e.g.:
 *   { ref: [{ id: 'E2ETestService.Books.drafts', where: [ID='abc', ...] }] }
 * Returns the where array if found, otherwise undefined.
 */
function extractInlineWhere(cqnEntity: any): any[] | undefined {
  if (!cqnEntity || typeof cqnEntity !== 'object') return undefined;
  const ref = Array.isArray(cqnEntity.ref) ? cqnEntity.ref : undefined;
  if (!ref) return undefined;
  const first = ref[0];
  if (first && typeof first === 'object' && Array.isArray(first.where) && first.where.length > 0) {
    return first.where;
  }
  return undefined;
}

function resolveDMLEntityName(targetName: string | undefined, cqnEntity: any): string {
  let cqnName: string | undefined;
  if (typeof cqnEntity === 'string') {
    cqnName = cqnEntity;
  } else if (cqnEntity && typeof cqnEntity === 'object') {
    if (Array.isArray(cqnEntity.ref)) {
      const first = cqnEntity.ref[0];
      cqnName = typeof first === 'string' ? first : first?.id ?? first?.name;
      if (cqnEntity.ref.length > 1) {
        cqnName = cqnEntity.ref.map((r: any) => typeof r === 'string' ? r : r?.id ?? r?.name ?? String(r)).join('.');
      }
    } else if (typeof cqnEntity.id === 'string') {
      cqnName = cqnEntity.id;
    } else if (typeof cqnEntity.name === 'string') {
      cqnName = cqnEntity.name;
    }
  }
  if (targetName?.endsWith('.drafts')) return targetName;
  if (cqnName?.endsWith('.drafts')) return cqnName;
  return targetName ?? cqnName ?? String(cqnEntity);
}

function getDefinitionForEntity(entityName: string): any | undefined {
  const defs = (cds.model as any)?.definitions;
  return defs?.[entityName];
}

function resolveAssociationTargetName(target: any, assocName: string): string | undefined {
  const assoc = target?.elements?.[assocName];
  const assocTargetName = assoc?.target;
  if (!assocTargetName) return undefined;
  return resolveEntityName(assocTargetName);
}

function resolveTableNameFromRef(ref: any[], target?: any): string {
  const first = ref[0];

  // Single-element ref: the element is the full entity/table name.
  // If it is a string already containing 2 dots (DB.SCHEMA.TABLE) and there is no
  // matching CDS model definition, treat it as a pre-qualified Snowflake table name
  // and return it as-is so qualifyName does not double-qualify it.
  if (ref.length === 1) {
    const name = typeof first === 'string' ? first : first?.id ?? first?.name ?? String(first);
    if (typeof first === 'string' && (first.match(/\./g) ?? []).length === 2 && !getDefinitionForEntity(first)) {
      return first;
    }
    return resolveEntityName(name, target);
  }

  // Multi-element ref: navigation path, e.g. [{id:'E2ETestService.Authors', where:[...]}, 'books'].
  // Resolve the association target from the base entity rather than joining parts as a string.
  if (ref.length === 2) {
    const baseId: string = typeof first === 'string' ? first : first?.id ?? first?.name ?? String(first);
    const assocName: string = typeof ref[1] === 'string' ? ref[1] : ref[1]?.id ?? ref[1]?.name ?? String(ref[1]);
    const baseDef = getDefinitionForEntity(baseId);
    if (baseDef) {
      const assoc = baseDef.elements?.[assocName];
      if (assoc?.target) {
        return resolveEntityName(assoc.target);
      }
    }
  }

  const parts = ref.map((r: any) => typeof r === 'string' ? r : r?.id ?? r?.name ?? String(r));
  return resolveEntityName(parts.join('.'), target);
}

export function resolveEntityName(entityName: any, target?: any): string {
  const MAX_DEPTH = 5;
  for (let i = 0; i < MAX_DEPTH && entityName && typeof entityName === 'object'; i++) {
    if (Array.isArray(entityName.ref)) {
      entityName = entityName.ref.length === 1 ? entityName.ref[0] : entityName.ref.join('.');
    } else if (typeof entityName.id === 'string') {
      entityName = entityName.id;
    } else if (typeof entityName.name === 'string') {
      entityName = entityName.name;
    } else {
      break;
    }
  }
  if (typeof entityName !== 'string') {
    return String(entityName);
  }
  // 1. Fast path: target entity already has persistence name
  if (target?.name === entityName && target?.['@cds.persistence.name']) {
    return target['@cds.persistence.name'];
  }
  const def = getDefinitionForEntity(entityName);
  // 2. Definition has persistence name directly
  if (def?.['@cds.persistence.name']) {
    return def['@cds.persistence.name'];
  }
  // 3. Definition is a projection/view — follow the chain to the source entity.
  //    IMPORTANT: Do NOT follow projections for .drafts entities — their physical
  //    table name must be derived from the entity name, not the base entity.
  if (def && !entityName.endsWith('.drafts')) {
    const sourceRef: string[] | undefined =
      def.projection?.from?.ref ??
      def.query?.SELECT?.from?.ref;
    if (Array.isArray(sourceRef) && sourceRef.length > 0) {
      const sourceName = sourceRef.length === 1 ? sourceRef[0] : sourceRef.join('.');
      if (sourceName !== entityName) {
        const sourceDef = getDefinitionForEntity(sourceName);
        if (sourceDef?.['@cds.persistence.name']) {
          return sourceDef['@cds.persistence.name'];
        }
        // Source entity has no @cds.persistence.name — derive from its qualified name
        // e.g. cap_e2e.Books → CAP_E2E_BOOKS  (matches CAP standard convention)
        return sourceName.replace(/\./g, '_').toUpperCase();
      }
    }
  }
  // 4. If the name already contains exactly 2 dots (DB.SCHEMA.TABLE) and has no
  //    matching CDS model definition, treat it as a pre-qualified Snowflake table
  //    name and return it as-is so qualifyName does not double-qualify it.
  //    e.g. CAP_E2E_DB.APP.INTEG_CQN_CRUD → returned as-is
  if ((entityName.match(/\./g) ?? []).length === 2 && !getDefinitionForEntity(entityName)) {
    return entityName;
  }

  // 5. Derive physical table name from the fully qualified entity name.
  //    Dots are replaced by underscores and the result is uppercased — the same
  //    convention used by @cap-js/sqlite, @cap-js/hana, and cds.compile.for.sql().
  //    This prevents qualifyName from misinterpreting a namespace prefix as a schema.
  //    e.g. cap_e2e.Authors → CAP_E2E_AUTHORS
  //         E2ETestService.Books → E2ETESTSERVICE_BOOKS (service entity without projection)
  //
  return entityName.replace(/\./g, '_').toUpperCase();
}

// toPhysicalIdentifier is imported from identifiers.ts

