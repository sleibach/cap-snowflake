/**
 * Main CQN to SQL translator
 */
import { quoteIdentifier, qualifyName, toPhysicalIdentifier } from '../identifiers.js';
import { logWarning } from '../utils/logger.js';
import { placeholder } from '../params.js';
import { translateFilter, translateSearch } from './filters.js';
import { translateOrderBy } from './orderby.js';
import { translatePagination } from './pagination.js';
import cds from '@sap/cds';
/**
 * Main entry point: translate CQN to SQL
 */
export function cqnToSQL(cqn, credentials, context) {
    const params = [];
    if (cqn.SELECT) {
        return translateSelect(cqn.SELECT, credentials, params, context);
    }
    else if (cqn.INSERT) {
        return translateInsert(cqn.INSERT, credentials, params, context);
    }
    else if (cqn.UPDATE) {
        return translateUpdate(cqn.UPDATE, credentials, params, context);
    }
    else if (cqn.DELETE) {
        return translateDelete(cqn.DELETE, credentials, params, context);
    }
    throw new Error('Unsupported CQN operation');
}
/**
 * Translate SELECT
 */
function translateSelect(select, credentials, params, context) {
    let sql = 'SELECT';
    // DISTINCT
    if (select.distinct) {
        sql += ' DISTINCT';
    }
    // Check for expansions
    const hasExpansions = select.columns?.some(col => col.expand || col.inline);
    // Pre-compute dimension JOINs for star schema groupBy navigation refs (shared across columns + GROUP BY)
    const _dimJoins = new Map();
    if (!hasExpansions && select.groupBy?.some((g) => g.ref?.length > 1)) {
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
            const { baseColumns, expandColumns, joins } = processColumnsWithExpand(select.columns, select.from, credentials, params, context?.target);
            const cols = [...baseColumns, ...expandColumns].join(', ');
            sql += ` ${cols}`;
            // FROM with joins
            let fromClause = translateFrom(select.from, credentials, context?.target, params);
            // Only append AS base alias when FROM is a plain table ref (not a JOIN-based FROM clause).
            // JOIN-based FROM clauses already embed aliases from their args.
            if (!select.from.as && !select.from.join) {
                fromClause += ' AS base';
            }
            sql += ` FROM ${fromClause}`;
            if (joins.length) {
                sql += ` ${joins.join(' ')}`;
            }
        }
        else {
            // Regular columns — handle synthetic draft columns on active-entity reads
            const isDraft = isDraftTarget(context?.target, select.from);
            // Use the pre-computed dimension JOINs (from above)
            const dimJoins = _dimJoins;
            const hasDimJoins = dimJoins.size > 0;
            const cols = select.columns.map(col => {
                if (col.ref) {
                    const colName = col.ref[col.ref.length - 1];
                    if (!isDraft) {
                        // Active entity: replace synthetic draft columns with constants
                        if (isSyntheticDraftColumn(colName)) {
                            return `${syntheticColumnValue(colName)} AS ${quoteIdentifier(col.as || colName)}`;
                        }
                        if (col.ref.length > 1 && isSyntheticDraftColumn(String(col.ref[0]))) {
                            return `NULL AS ${quoteIdentifier(col.as || colName)}`;
                        }
                    }
                    // Dimension nav ref in SELECT (e.g. book/title → _grp_book.TITLE)
                    if (hasDimJoins && col.ref.length > 1) {
                        const firstPart = col.ref[0];
                        const assocPart = typeof firstPart === 'string' ? firstPart : String(firstPart?.id ?? firstPart);
                        if (dimJoins.has(assocPart)) {
                            const alias = `_grp_${toPhysicalIdentifier(assocPart).toLowerCase()}`;
                            const lastPart = col.ref[col.ref.length - 1];
                            const colAlias = col.as || col.ref.map((p) => typeof p === 'string' ? p : String(p?.id ?? p)).join('_');
                            const colIdentifier = toPhysicalIdentifier(typeof lastPart === 'string' ? lastPart : String(lastPart?.id ?? lastPart));
                            return `${alias}.${colIdentifier} AS ${quoteIdentifier(colAlias)}`;
                        }
                    }
                    // For both active and draft tables: suppress navigation properties and
                    // non-physical virtual elements (e.g. DraftMessages on draft tables).
                    // Exception: virtual draft booleans (IsActiveEntity, HasDraftEntity) ARE
                    // stored physically on draft tables — let them pass through to translateColumn.
                    const element = context?.target?.elements?.[colName];
                    const isVirtualDraftBool = isDraft && element?.virtual && isSyntheticDraftColumn(colName);
                    const explicitlyNonPhysical = !isVirtualDraftBool && element !== undefined &&
                        (!!element.virtual || !!element.target || !element.type);
                    if (explicitlyNonPhysical) {
                        return `${syntheticColumnValue(colName)} AS ${quoteIdentifier(col.as || colName)}`;
                    }
                }
                return translateColumn(col);
            }).join(', ');
            sql += ` ${cols}`;
            let fromClause = translateFrom(select.from, credentials, context?.target, params);
            if (hasDimJoins && !select.from.as && !select.from.join) {
                fromClause += ' AS base';
            }
            sql += ` FROM ${fromClause}`;
            if (hasDimJoins) {
                sql += ` ${[...dimJoins.values()].join(' ')}`;
            }
        }
    }
    else {
        sql += ' *';
        sql += ` FROM ${translateFrom(select.from, credentials, context?.target, params)}`;
    }
    // WHERE + $search — use base alias when JOINs are present to avoid ambiguity.
    // When the FROM clause itself is a JOIN (navigation property filter), aliases come from
    // the JOIN args, not a forced "base" alias — so leave filterAlias undefined in that case.
    const hasJoinFrom = !!select.from.join;
    const filterAlias = (hasExpansions && !hasJoinFrom) ? (select.from.as || 'base') : undefined;
    const isDraftQuery = isDraftTarget(context?.target, select.from);
    let hasWhere = false;
    // CAP embeds inline WHERE in the FROM ref for readAfterWrite (SELECT.one with keys):
    // from: { ref: [{ id: 'Entity', where: [...] }] }
    // Only apply when ref has exactly 1 element — navigation paths (ref.length > 1) use a
    // different mechanism and the inline WHERE belongs to the source entity, not the target.
    const inlineFromWhere = Array.isArray(select.from?.ref) && select.from.ref.length === 1
        ? extractInlineWhere(select.from)
        : undefined;
    const effectiveWhere = (select.where && select.where.length > 0) ? select.where : inlineFromWhere;
    if (effectiveWhere && effectiveWhere.length > 0) {
        const filterCtx = {
            credentials,
            target: context?.target,
            resolveTable: resolveEntityName,
            // Enable subquery translation inside WHERE: { SELECT: {...} } → (SELECT ...)
            // IMPORTANT: pass the outer params array so subquery bindings are appended inline.
            translateSelect: (selectBody, outerParams) => translateSelect(selectBody, credentials, outerParams, context).sql,
        };
        const whereClause = translateFilter(effectiveWhere, params, filterAlias, isDraftQuery, filterCtx);
        if (whereClause) {
            sql += ` WHERE ${whereClause}`;
            hasWhere = true;
        }
    }
    // $search support: translate to ILIKE conditions over searchable string columns
    const searchExpr = select.search;
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
        const groupByClause = select.groupBy.map((g) => translateGroupBy(g, _dimJoins.size > 0 ? _dimJoins : undefined)).join(', ');
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
function processColumnsWithExpand(columns, from, credentials, _params, baseTarget) {
    const baseColumns = [];
    const expandColumns = [];
    const joins = [];
    const baseAlias = from.as || 'base';
    let joinCounter = 0;
    const isDraft = isDraftTarget(baseTarget, from);
    for (const col of columns) {
        if (col.expand) {
            const assocName = col.ref[0];
            const expandSpec = col.expand;
            if (isLikelyToMany(assocName, baseTarget)) {
                const targetEntity = resolveAssociationTargetName(baseTarget, assocName)
                    || (assocName.charAt(0).toUpperCase() + assocName.slice(1));
                const targetTable = qualifyName(targetEntity, credentials);
                // Derive the FK name from the simple entity name (last segment after dot).
                // from.ref[0] may be a fully qualified name like 'E2ETestService.Authors'
                // or an object { id: '...' }; we need only the short name, e.g. 'Authors'.
                const fromRefFirst = (from.ref || [])[0];
                const fromRefName = typeof fromRefFirst === 'string' ? fromRefFirst
                    : fromRefFirst?.id ?? fromRefFirst?.name ?? 'parent';
                const fromSimpleName = fromRefName.split('.').pop() ?? fromRefName;
                const parentFK = `${singularize(fromSimpleName)}_ID`;
                let subWhere = `tm.${toPhysicalIdentifier(parentFK)} = ${baseAlias}.ID`;
                const expandWhere = col.where;
                if (expandWhere && expandWhere.length > 0) {
                    const extraWhere = translateFilter(expandWhere, _params);
                    if (extraWhere)
                        subWhere += ` AND ${extraWhere}`;
                }
                // Build OBJECT_CONSTRUCT: use explicit key-value pairs so that CDS element names
                // (e.g. 'title') are used as JSON keys instead of Snowflake physical column names
                // (e.g. TITLE), fixing case-mismatch in OData responses.
                const isWildcard = !expandSpec || expandSpec.length === 0 || (expandSpec.length === 1 && expandSpec[0] === '*') || (expandSpec.length === 1 && expandSpec[0].ref?.[0] === '*');
                let objConstruct;
                if (!isWildcard) {
                    const pairs = expandSpec
                        .filter((c) => c.ref)
                        .map((c) => {
                        const cdsName = c.ref[0];
                        return `'${cdsName}', ${toPhysicalIdentifier(cdsName)}`;
                    })
                        .join(', ');
                    objConstruct = pairs ? `OBJECT_CONSTRUCT(${pairs})` : 'OBJECT_CONSTRUCT(*)';
                }
                else {
                    // Wildcard expand: resolve child entity elements to build explicit key-value pairs
                    // so JSON keys match CDS element names instead of Snowflake UPPERCASE column names.
                    const assocEl = baseTarget?.elements?.[assocName];
                    const childEntityName = assocEl?.target;
                    const childEntity = assocEl?._target
                        ?? (childEntityName ? cds.model?.definitions?.[childEntityName] : undefined);
                    if (childEntity?.elements) {
                        const pairs = Object.entries(childEntity.elements)
                            .filter(([, el]) => !el.isAssociation && !el.virtual && el['@cds.persistence.skip'] !== true)
                            .map(([elName]) => `'${elName}', ${toPhysicalIdentifier(elName)}`)
                            .join(', ');
                        objConstruct = pairs ? `OBJECT_CONSTRUCT(${pairs})` : 'OBJECT_CONSTRUCT(*)';
                    }
                    else {
                        objConstruct = 'OBJECT_CONSTRUCT(*)';
                    }
                }
                // COALESCE ensures an empty array [] is returned instead of NULL when no rows match.
                const expandLimit = col.limit?.rows?.val;
                const expandSkip = col.limit?.offset?.val;
                const expandOrderBy = col.orderBy;
                // Build WITHIN GROUP (ORDER BY ...) clause for ARRAY_AGG if orderBy present
                let withinGroup = '';
                if (expandOrderBy && expandOrderBy.length > 0) {
                    const orderClauses = expandOrderBy.map((item) => {
                        const colPart = item.ref ? item.ref.map((p) => toPhysicalIdentifier(p)).join('.') : String(item);
                        const dir = item.sort ? ` ${item.sort.toUpperCase()}` : '';
                        return `${colPart}${dir}`;
                    }).join(', ');
                    withinGroup = ` WITHIN GROUP (ORDER BY ${orderClauses})`;
                }
                let subQuery;
                if (expandSkip) {
                    // $skip (with optional $top): use ARRAY_SLICE on the fully-ordered aggregate.
                    // A derived-table approach with ORDER BY + OFFSET fails for correlated
                    // subqueries in Snowflake because the correlated outer reference (base.ID)
                    // is not visible inside the derived table when ORDER BY is present.
                    // ARRAY_SLICE(agg, start, end) avoids that limitation entirely.
                    const startIdx = expandSkip;
                    const endIdx = expandLimit ? expandSkip + expandLimit : 2147483647;
                    subQuery = `SELECT COALESCE(ARRAY_SLICE(ARRAY_AGG(${objConstruct})${withinGroup}, ${startIdx}, ${endIdx}), ARRAY_CONSTRUCT()) FROM ${targetTable} AS tm WHERE ${subWhere}`;
                }
                else if (expandLimit) {
                    subQuery = `SELECT COALESCE(ARRAY_AGG(${objConstruct})${withinGroup}, ARRAY_CONSTRUCT()) FROM (SELECT * FROM ${targetTable} AS tmsub WHERE tmsub.${toPhysicalIdentifier(parentFK)} = ${baseAlias}.ID LIMIT ${expandLimit}) AS tm`;
                }
                else {
                    subQuery = `SELECT COALESCE(ARRAY_AGG(${objConstruct})${withinGroup}, ARRAY_CONSTRUCT()) FROM ${targetTable} AS tm WHERE ${subWhere}`;
                }
                expandColumns.push(`(${subQuery}) AS ${quoteIdentifier(assocName)}`);
                if (col.count) {
                    const cntWhere = `tcnt.${toPhysicalIdentifier(parentFK)} = ${baseAlias}.ID`;
                    const cntSubQuery = `SELECT COUNT(*) FROM ${targetTable} AS tcnt WHERE ${cntWhere}`;
                    expandColumns.push(`(${cntSubQuery}) AS ${quoteIdentifier(assocName + '@odata.count')}`);
                }
            }
            else {
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
                }
                else {
                    const targetEntity = resolveAssociationTargetName(baseTarget, assocName)
                        || (assocName.charAt(0).toUpperCase() + assocName.slice(1));
                    const targetTable = qualifyName(targetEntity, credentials);
                    const targetKey = resolveTargetKey(baseTarget, assocName);
                    let joinCondition = `${baseAlias}.${toPhysicalIdentifier(foreignKey)} = ${joinAlias}.${toPhysicalIdentifier(targetKey)}`;
                    // Look up the CDS definition for the expand target using the original
                    // association target name (not the physical table name) so that element
                    // metadata (for wildcard expand handling) is available.
                    const assocCDSTarget = baseTarget?.elements?.[assocName]?.target;
                    const targetDef = getDefinitionForEntity(assocCDSTarget) || getDefinitionForEntity(targetEntity);
                    // PARAM ORDERING: expandColumns (SELECT) appear before joins (FROM) in the
                    // final SQL, so any `?` inside nested expand columns must be pushed to _params
                    // BEFORE the `?` from the JOIN WHERE condition — otherwise positional binding
                    // maps parameters to the wrong placeholders.
                    // Collect nested expand columns + their params into temporary arrays first.
                    const nestedParams = [];
                    const nestedJoins = [];
                    const nestedExpandCols = [];
                    collectNestedExpandColumns(expandSpec, assocName, joinAlias, nestedJoins, nestedExpandCols, credentials, () => `expand_${joinCounter++}`, targetDef, nestedParams);
                    // NOW translate the JOIN WHERE condition (its params belong after SELECT params).
                    const expandWhere = col.where;
                    const joinWhereParams = [];
                    if (expandWhere && expandWhere.length > 0) {
                        const extraWhere = translateFilter(expandWhere, joinWhereParams);
                        if (extraWhere)
                            joinCondition += ` AND ${extraWhere}`;
                    }
                    // Add parent JOIN first (must precede nested JOINs referencing it).
                    joins.push(`LEFT JOIN ${targetTable} AS ${joinAlias} ON ${joinCondition}`);
                    joins.push(...nestedJoins);
                    expandColumns.push(...nestedExpandCols);
                    // Merge params: nested expand first (for SELECT ?s), then JOIN WHERE (for FROM ?s).
                    _params.push(...nestedParams, ...joinWhereParams);
                }
            }
        }
        else if (col.inline) {
            // Inline expansion: similar to expand but flattens structure
            const assocName = col.ref[0];
            const joinAlias = `inline_${joinCounter++}`;
            const foreignKey = resolveForeignKey(baseTarget, assocName);
            const targetEntity = resolveAssociationTargetName(baseTarget, assocName)
                || (assocName.charAt(0).toUpperCase() + assocName.slice(1));
            const targetTable = qualifyName(targetEntity, credentials);
            const inlineTargetKey = resolveTargetKey(baseTarget, assocName);
            const joinSQL = `LEFT JOIN ${targetTable} AS ${joinAlias} ON ${baseAlias}.${toPhysicalIdentifier(foreignKey)} = ${joinAlias}.${toPhysicalIdentifier(inlineTargetKey)}`;
            joins.push(joinSQL);
            // Add inlined columns (flattened, no prefix)
            const inlineSpec = col.inline;
            for (const inlineCol of inlineSpec) {
                if (inlineCol.ref) {
                    const colName = inlineCol.ref[inlineCol.ref.length - 1];
                    const alias = inlineCol.as || `${assocName}_${colName}`;
                    expandColumns.push(`${joinAlias}.${toPhysicalIdentifier(colName)} AS ${quoteIdentifier(alias)}`);
                }
            }
        }
        else {
            // Regular column
            if (col.ref) {
                const colName = col.ref[col.ref.length - 1];
                const alias = col.as || colName;
                // Multi-part nav refs (e.g. DraftAdministrativeData.DraftMessages)
                if (col.ref.length > 1) {
                    baseColumns.push(`NULL AS ${quoteIdentifier(col.as || colName)}`);
                }
                else if (!isDraft && isSyntheticDraftColumn(colName)) {
                    // Synthetic draft indicator columns (IsActiveEntity, HasDraftEntity, HasActiveEntity, etc.)
                    // do not exist on active-entity tables — emit constant values.
                    // On DRAFT tables these ARE physical columns; fall through to the physical-column path.
                    baseColumns.push(`${syntheticColumnValue(colName)} AS ${quoteIdentifier(alias)}`);
                }
                else {
                    // Regular physical column — also covers draft boolean columns on .drafts tables.
                    // FK columns like author_ID are NOT in the CDS runtime model elements
                    // (only in cds.compile.for.sql), but they ARE physical DB columns.
                    // Only suppress a column if the model explicitly marks it virtual/association AND
                    // we are NOT on a draft table (where virtual draft booleans ARE stored physically).
                    const element = baseTarget?.elements?.[colName];
                    const isVirtualDraftBool = isDraft && element?.virtual && isSyntheticDraftColumn(colName);
                    const explicitlyNonPhysical = !isVirtualDraftBool && element !== undefined &&
                        (!!element.virtual || !!element.target || !element.type);
                    if (explicitlyNonPhysical) {
                        baseColumns.push(`${syntheticColumnValue(colName)} AS ${quoteIdentifier(alias)}`);
                    }
                    else {
                        baseColumns.push(`${baseAlias}.${toPhysicalIdentifier(colName)} AS ${quoteIdentifier(alias)}`);
                    }
                }
            }
            else if (col === '*' || (typeof col === 'string' && col === '*')) {
                // CAP wildcard column in a JOIN query — expand to qualified base columns to
                // avoid "ambiguous column name" errors when both tables share column names.
                if (baseTarget?.elements) {
                    const wildcardCols = [];
                    for (const [elName, el] of Object.entries(baseTarget.elements)) {
                        if (el.virtual || el.target)
                            continue;
                        // Only suppress synthetic draft columns on active-entity (non-draft) tables;
                        // on draft tables they are physical BOOLEAN columns.
                        if (!isDraft && isSyntheticDraftColumn(elName))
                            continue;
                        // Note: do NOT filter on !el.type — projection elements may lack a direct
                        // type annotation while still being valid physical columns.
                        const physName = el['@cds.persistence.name'] ?? toPhysicalIdentifier(elName);
                        wildcardCols.push(`${baseAlias}.${physName} AS ${quoteIdentifier(elName)}`);
                    }
                    if (wildcardCols.length > 0) {
                        baseColumns.push(...wildcardCols);
                    }
                    else {
                        // Elements exist but none qualify — fall back to qualified wildcard
                        baseColumns.push(`${baseAlias}.*`);
                    }
                }
                else {
                    baseColumns.push(`${baseAlias}.*`); // qualified wildcard avoids ambiguity
                }
            }
            else {
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
function collectNullExpandColumns(columns, pathPrefix, expandColumns) {
    for (const col of columns) {
        if (!col.ref)
            continue;
        const colName = col.ref[col.ref.length - 1];
        if (col.expand) {
            collectNullExpandColumns(col.expand, `${pathPrefix}__${colName}`, expandColumns);
        }
        else {
            const alias = col.as || `${pathPrefix}__${colName}`;
            expandColumns.push(`NULL AS ${quoteIdentifier(alias)}`);
        }
    }
}
const MAX_EXPAND_DEPTH = 8;
function collectNestedExpandColumns(columns, pathPrefix, parentAlias, joins, expandColumns, credentials, nextAlias, parentTarget, params = [], depth = 0) {
    if (depth >= MAX_EXPAND_DEPTH) {
        logWarning(`Max expand depth (${MAX_EXPAND_DEPTH}) reached — stopping recursion at: ${pathPrefix}`);
        return;
    }
    // If expand columns is a wildcard, expand all physical columns of the target entity.
    if (columns.length === 1 && columns[0] === '*') {
        if (parentTarget?.elements) {
            const wildcardCols = [];
            for (const [elName, el] of Object.entries(parentTarget.elements)) {
                if (el.virtual || el.target)
                    continue;
                // Note: do NOT filter on !el.type — projection elements may lack a direct type.
                const physName = el['@cds.persistence.name'] ?? toPhysicalIdentifier(elName);
                wildcardCols.push(`${parentAlias}.${physName} AS ${quoteIdentifier(`${pathPrefix}__${elName}`)}`);
            }
            if (wildcardCols.length > 0) {
                expandColumns.push(...wildcardCols);
            }
            else {
                expandColumns.push(`${parentAlias}.*`);
            }
        }
        else {
            expandColumns.push(`${parentAlias}.*`);
        }
        return;
    }
    // If no column in the spec is a plain scalar ref (all entries are sub-expands or
    // expressions), the caller supplied only nested expands (e.g. $expand=author($expand=books)).
    // In that case we must also SELECT all scalar fields of the join-ed entity, otherwise the
    // parent object will exist in the result but every scalar property will be undefined.
    const hasScalarRefs = columns.some((c) => c.ref && !c.expand && !c.xpr);
    if (!hasScalarRefs && parentTarget?.elements) {
        for (const [elName, el] of Object.entries(parentTarget.elements)) {
            if (el.virtual || el.target)
                continue;
            const physName = el['@cds.persistence.name'] ?? toPhysicalIdentifier(elName);
            expandColumns.push(`${parentAlias}.${physName} AS ${quoteIdentifier(`${pathPrefix}__${elName}`)}`);
        }
    }
    for (const col of columns) {
        // Handle xpr (expression) columns — e.g. lean-draft.js injects CASE expressions
        // for InProcessByUser timeout logic.  Translate to SQL expression.
        if (col.xpr && col.as) {
            const alias = `${pathPrefix}__${col.as}`;
            const xprSQL = xprToSQL(col.xpr, parentAlias, params);
            expandColumns.push(`${xprSQL} AS ${quoteIdentifier(alias)}`);
            continue;
        }
        if (!col.ref)
            continue;
        const colName = col.ref[col.ref.length - 1];
        if (col.expand) {
            const nestedAssoc = colName;
            const nestedTargetName = resolveAssociationTargetName(parentTarget, nestedAssoc)
                || (nestedAssoc.charAt(0).toUpperCase() + nestedAssoc.slice(1));
            const nestedTable = qualifyName(nestedTargetName, credentials);
            // resolveAssociationTargetName returns the physical name (e.g. 'CAP_E2E_BOOKS').
            // For the CDS definition lookup we need the logical name (e.g. 'E2ETestService.Books').
            const nestedAssocCDSTarget = parentTarget?.elements?.[nestedAssoc]?.target;
            const nestedTargetDef = getDefinitionForEntity(nestedAssocCDSTarget) || getDefinitionForEntity(nestedTargetName);
            if (isLikelyToMany(nestedAssoc, parentTarget)) {
                // To-many nested expand: use ARRAY_AGG correlated subquery
                const expandSpec = col.expand;
                // Determine FK: parentTarget's PK is referenced by nestedTarget's FK
                // For to-many: the child table has a FK pointing back to the parent.
                // We need the FK name in the child table. Use heuristic: singularize(parentTarget name) + _ID
                const parentEntityShortName = (parentTarget?.name ?? '').split('.').pop() ?? '';
                const childFKCol = toPhysicalIdentifier(parentEntityShortName ? `${singularize(parentEntityShortName)}_ID` : 'ID');
                // Build OBJECT_CONSTRUCT for the nested records.
                // Prefer the entity definition when available: it provides the correct CDS element
                // names (camelCase) as keys, which is what calling code expects. Deriving keys from
                // the expand spec is unreliable because CAP may inject draft columns (e.g. '*' plus
                // {ref:['DraftAdministrativeData']}) which causes only non-scalar refs to be listed.
                let objConstruct;
                if (nestedTargetDef?.elements) {
                    const pairs = Object.entries(nestedTargetDef.elements)
                        .filter(([, el]) => !el.isAssociation && !el.virtual && el['@cds.persistence.skip'] !== true)
                        .map(([elName]) => `'${elName}', ${toPhysicalIdentifier(elName)}`)
                        .join(', ');
                    objConstruct = pairs ? `OBJECT_CONSTRUCT(${pairs})` : 'OBJECT_CONSTRUCT(*)';
                }
                else {
                    // No entity definition — fall back to explicit scalar refs from expand spec or *
                    const isWildcard = !expandSpec || expandSpec.length === 0
                        || expandSpec.some((c) => c === '*' || c.ref?.[0] === '*');
                    if (!isWildcard) {
                        const pairs = expandSpec
                            .filter((c) => c.ref && !c.expand) // scalar refs only, not sub-expands
                            .map((c) => {
                            const cdsName = c.ref[0];
                            return `'${cdsName}', ${toPhysicalIdentifier(cdsName)}`;
                        })
                            .join(', ');
                        objConstruct = pairs ? `OBJECT_CONSTRUCT(${pairs})` : 'OBJECT_CONSTRUCT(*)';
                    }
                    else {
                        objConstruct = 'OBJECT_CONSTRUCT(*)';
                    }
                }
                // Apply any $filter from the expand option (e.g. $expand=books($filter=price gt 30))
                const nestedWhere = col.where;
                let nestedWhereSQL = `tm.${childFKCol} = ${parentAlias}.ID`;
                if (nestedWhere && nestedWhere.length > 0) {
                    const extraWhere = translateFilter(nestedWhere, params);
                    if (extraWhere)
                        nestedWhereSQL += ` AND ${extraWhere}`;
                }
                const subQuery = `SELECT COALESCE(ARRAY_AGG(${objConstruct}), ARRAY_CONSTRUCT()) FROM ${nestedTable} AS tm WHERE ${nestedWhereSQL}`;
                expandColumns.push(`(${subQuery}) AS ${quoteIdentifier(`${pathPrefix}__${nestedAssoc}`)}`);
            }
            else {
                // To-one nested expand: use LEFT JOIN
                const nestedAlias = nextAlias();
                const nestedFK = resolveForeignKey(parentTarget, nestedAssoc);
                const nestedTargetKey = resolveTargetKey(parentTarget, nestedAssoc);
                joins.push(`LEFT JOIN ${nestedTable} AS ${nestedAlias} ON ${parentAlias}.${toPhysicalIdentifier(nestedFK)} = ${nestedAlias}.${toPhysicalIdentifier(nestedTargetKey)}`);
                collectNestedExpandColumns(col.expand, `${pathPrefix}__${nestedAssoc}`, nestedAlias, joins, expandColumns, credentials, nextAlias, nestedTargetDef, params, depth + 1);
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
function xprToSQL(xpr, tableAlias, params) {
    const parts = [];
    for (const part of xpr) {
        if (typeof part === 'string') {
            // SQL keyword or operator — uppercase it
            parts.push(part.toUpperCase());
        }
        else if (part && typeof part === 'object') {
            if (Array.isArray(part.ref)) {
                const colName = part.ref[part.ref.length - 1];
                parts.push(`${tableAlias}.${toPhysicalIdentifier(colName)}`);
            }
            else if ('val' in part) {
                params.push(part.val);
                parts.push(placeholder());
            }
        }
    }
    return parts.join(' ');
}
function isLikelyToMany(associationName, baseTarget) {
    const assoc = baseTarget?.elements?.[associationName];
    if (assoc) {
        if (assoc.is2many)
            return true;
        if (assoc.cardinality?.max === '*')
            return true;
        // Found in CDS metadata — definitively not to-many
        return false;
    }
    // Heuristic fallback when no CDS metadata is present
    return associationName.endsWith('s');
}
function singularize(name) {
    return name.endsWith('s') ? name.slice(0, -1) : name;
}
/**
 * Translate FROM clause
 */
function translateFrom(from, credentials, target, params) {
    // Handle JOIN-based FROM clause (generated by CAP for navigation property filters)
    if (from.join) {
        const joinType = from.join.toUpperCase();
        const args = from.args;
        if (args && args.length >= 2) {
            const leftSQL = translateFrom(args[0], credentials, target, params);
            const rightSQL = translateFrom(args[1], credentials, undefined, params);
            const onClause = from.on
                ? translateFilter(from.on, params || [], undefined, false)
                : '1=1';
            return `${leftSQL} ${joinType} JOIN ${rightSQL} ON ${onClause}`;
        }
    }
    if (from.ref) {
        // Locale-aware handling: when target entity has localized elements, inject dynamic locale join
        if (params && target) {
            const localizedSQL = buildLocalizedFromSubqueryForTarget(target, credentials, params);
            if (localizedSQL) {
                if (from.as)
                    return `${localizedSQL} AS ${quoteIdentifier(from.as)}`;
                return localizedSQL;
            }
        }
        // Also handle explicit localized.* prefix (CAP sometimes uses this)
        if (params) {
            const firstRef = from.ref[0];
            const refName = typeof firstRef === 'string' ? firstRef : firstRef?.id ?? firstRef?.name ?? '';
            if (typeof refName === 'string' && refName.startsWith('localized.')) {
                const localizedSQL = buildLocalizedFromSubquery(refName, credentials, params);
                if (localizedSQL) {
                    if (from.as)
                        return `${localizedSQL} AS ${quoteIdentifier(from.as)}`;
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
function buildLocalizedFromSubqueryForTarget(target, credentials, params) {
    if (!target?.elements)
        return null;
    const localizedCols = [];
    const keyCols = [];
    for (const [colName, elem] of Object.entries(target.elements)) {
        const el = elem;
        if (el.key === true)
            keyCols.push(colName);
        if (el.localized === true)
            localizedCols.push(colName);
    }
    if (localizedCols.length === 0 || keyCols.length === 0)
        return null;
    // Get the physical table name from the target definition
    const tableName = resolveEntityName(target.name ?? target['@cds.persistence.name'], target);
    if (!tableName)
        return null;
    const textsName = tableName + '_TEXTS';
    const baseTable = qualifyName(tableName, credentials);
    const textsTable = qualifyName(textsName, credentials);
    const locale = cds.context?.locale ?? 'en';
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
function buildLocalizedFromSubquery(localizedEntityName, credentials, params) {
    const baseEntityName = localizedEntityName.slice('localized.'.length);
    const baseDef = getDefinitionForEntity(baseEntityName);
    if (!baseDef?.elements)
        return null;
    const localizedCols = [];
    const keyCols = [];
    for (const [colName, elem] of Object.entries(baseDef.elements)) {
        const el = elem;
        if (el.key)
            keyCols.push(colName);
        if (el.localized)
            localizedCols.push(colName);
    }
    if (localizedCols.length === 0 || keyCols.length === 0)
        return null;
    const locale = cds.context?.locale ?? 'en';
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
function translateColumn(col) {
    if (typeof col === 'string')
        return col;
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
        let expr;
        if (col.val === null || col.val === undefined) {
            expr = 'NULL';
        }
        else if (typeof col.val === 'boolean') {
            expr = col.val ? 'TRUE' : 'FALSE';
        }
        else if (typeof col.val === 'string') {
            // Quote the string literal (escape single quotes)
            expr = `'${String(col.val).replace(/'/g, "''")}'`;
        }
        else {
            expr = String(col.val);
        }
        if (col.as) {
            return `${expr} AS ${quoteIdentifier(col.as)}`;
        }
        return expr;
    }
    return '*';
}
/**
 * Translate column function
 */
function translateColumnFunc(col) {
    const funcName = col.func.toUpperCase();
    if (funcName === 'COUNT' && (!col.args || col.args.length === 0)) {
        return 'COUNT(*)';
    }
    if (col.args && col.args.length > 0) {
        const args = col.args.map(arg => {
            if (arg.ref) {
                return arg.ref.map((p) => toPhysicalIdentifier(p)).join('.');
            }
            if ('val' in arg)
                return arg.val === null ? 'NULL' : String(arg.val);
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
function buildDimensionJoin(ref, context, credentials, dimJoins) {
    const assocName = typeof ref[0] === 'string' ? ref[0] : String(ref[0]?.id ?? ref[0]);
    if (dimJoins.has(assocName))
        return;
    const assocEl = context?.target?.elements?.[assocName];
    const targetEntityName = assocEl?.target;
    if (!targetEntityName)
        return;
    const fkCol = toPhysicalIdentifier(`${assocName}_ID`);
    const targetShortName = targetEntityName.split('.').pop();
    const targetTable = qualifyName(targetShortName, credentials);
    const alias = `_grp_${toPhysicalIdentifier(assocName).toLowerCase()}`;
    dimJoins.set(assocName, `LEFT JOIN ${targetTable} AS ${alias} ON ${alias}.ID = base.${fkCol}`);
}
/**
 * Translate GROUP BY
 * For navigation path refs (ref.length > 1), uses dimension join alias if dimJoins is provided,
 * otherwise falls back to dot-separated identifiers.
 */
function translateGroupBy(groupBy, dimJoins) {
    if (groupBy.ref) {
        if (groupBy.ref.length > 1 && dimJoins) {
            const assocName = typeof groupBy.ref[0] === 'string' ? groupBy.ref[0] : String(groupBy.ref[0]?.id ?? groupBy.ref[0]);
            const colParts = groupBy.ref.slice(1);
            const alias = `_grp_${toPhysicalIdentifier(assocName).toLowerCase()}`;
            if (dimJoins.has(assocName)) {
                return `${alias}.${colParts.map((p) => toPhysicalIdentifier(p)).join('.')}`;
            }
        }
        return groupBy.ref.map((part) => toPhysicalIdentifier(typeof part === 'string' ? part : (part?.id ?? String(part)))).join('.');
    }
    return String(groupBy);
}
/**
 * Translate INSERT
 */
function translateInsert(insert, credentials, params, context) {
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
        // On draft tables, IsActiveEntity and HasDraftEntity are marked `virtual: true`
        // in CAP's runtime Draft mixin but ARE physically stored in the DB.  Do NOT skip
        // them based on virtual — onInsert sets them to false before this point so they
        // end up in the INSERT explicitly rather than relying solely on DEFAULT FALSE.
        const isDraftInsert = !!(context?.target?.name?.endsWith('.drafts'));
        const columns = targetElements
            ? allCols.filter(col => {
                const el = targetElements[col];
                // Keep the column if: no element metadata (unknown → keep for safety),
                // or element exists with a type (physical column), but not virtual/association.
                if (!el)
                    return false; // element not in target model — skip
                if (el.isAssociation)
                    return false;
                if (el.items)
                    return false; // array/composition element (e.g. DraftMessages) — not physically stored
                // For draft tables: include virtual columns that have a physical type (e.g. IsActiveEntity, HasDraftEntity)
                // but NOT virtual elements without a type (computed arrays, DraftMessages, etc.)
                if (el.virtual && (!isDraftInsert || !el.type))
                    return false;
                return true;
            })
            : allCols;
        const quotedCols = columns.map(c => toPhysicalIdentifier(c));
        const valueSets = [];
        for (const entry of insert.entries) {
            const values = columns.map(col => {
                params.push(entry[col]);
                return placeholder();
            });
            valueSets.push(`(${values.join(', ')})`);
        }
        const sql = `INSERT INTO ${tableName} (${quotedCols.join(', ')}) VALUES ${valueSets.join(', ')}`;
        return { sql, params };
    }
    else if (insert.columns && insert.values) {
        // Single insert with columns and values
        const quotedCols = insert.columns.map(c => toPhysicalIdentifier(c));
        const valuePlaceholders = insert.values.map(v => {
            params.push(v);
            return placeholder();
        });
        const sql = `INSERT INTO ${tableName} (${quotedCols.join(', ')}) VALUES (${valuePlaceholders.join(', ')})`;
        return { sql, params };
    }
    else if (insert.rows) {
        // Multiple rows
        const quotedCols = insert.columns?.map(c => toPhysicalIdentifier(c)) || [];
        const valueSets = [];
        for (const row of insert.rows) {
            const values = row.map((v) => {
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
function translateUpdate(update, credentials, params, context) {
    const entityName = resolveDMLEntityName(context?.target?.name, update.entity);
    const tableName = qualifyName(resolveEntityName(entityName, context?.target), credentials);
    if (!update.data) {
        throw new Error('UPDATE requires data');
    }
    const setClauses = [];
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
function translateDelete(del, credentials, params, context) {
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
export function generateMerge(tableName, keys, data, credentials) {
    const params = [];
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
    const onConditions = quotedKeys.map(key => `target.${key} = source.${key}`).join(' AND ');
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
function isSyntheticDraftColumn(colName) {
    const lower = colName.toLowerCase();
    if (SYNTHETIC_DRAFT_COLUMNS.has(lower))
        return true;
    if (lower.startsWith('draftadministrativedata_'))
        return true;
    if (lower.startsWith('siblingentity_'))
        return true;
    return false;
}
function isDraftTarget(target, fromRef) {
    if (typeof target?.name === 'string' && target.name.endsWith('.drafts'))
        return true;
    // Also check the FROM clause ref for draft entity names
    if (fromRef?.ref) {
        const first = fromRef.ref[0];
        const name = typeof first === 'string' ? first : first?.id ?? first?.name ?? '';
        if (name.endsWith('.drafts'))
            return true;
    }
    return false;
}
function resolveForeignKey(target, assocName) {
    const assoc = target?.elements?.[assocName];
    if (assoc?.keys && assoc.keys.length > 0) {
        const targetKeyName = assoc.keys[0].ref?.[0];
        if (targetKeyName)
            return `${assocName}_${targetKeyName}`;
    }
    if (target?.elements?.[`${assocName}_ID`])
        return `${assocName}_ID`;
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
function resolveTargetKey(target, assocName) {
    const assoc = target?.elements?.[assocName];
    if (assoc?.keys && assoc.keys.length > 0) {
        const keyName = assoc.keys[0].ref?.[0];
        if (keyName)
            return keyName;
    }
    return 'ID';
}
function syntheticColumnValue(colName) {
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
function extractInlineWhere(cqnEntity) {
    if (!cqnEntity || typeof cqnEntity !== 'object')
        return undefined;
    const ref = Array.isArray(cqnEntity.ref) ? cqnEntity.ref : undefined;
    if (!ref)
        return undefined;
    const first = ref[0];
    if (first && typeof first === 'object' && Array.isArray(first.where) && first.where.length > 0) {
        return first.where;
    }
    return undefined;
}
function resolveDMLEntityName(targetName, cqnEntity) {
    let cqnName;
    if (typeof cqnEntity === 'string') {
        cqnName = cqnEntity;
    }
    else if (cqnEntity && typeof cqnEntity === 'object') {
        if (Array.isArray(cqnEntity.ref)) {
            const first = cqnEntity.ref[0];
            cqnName = typeof first === 'string' ? first : first?.id ?? first?.name;
            if (cqnEntity.ref.length > 1) {
                cqnName = cqnEntity.ref.map((r) => typeof r === 'string' ? r : r?.id ?? r?.name ?? String(r)).join('.');
            }
        }
        else if (typeof cqnEntity.id === 'string') {
            cqnName = cqnEntity.id;
        }
        else if (typeof cqnEntity.name === 'string') {
            cqnName = cqnEntity.name;
        }
    }
    if (targetName?.endsWith('.drafts'))
        return targetName;
    if (cqnName?.endsWith('.drafts'))
        return cqnName;
    return targetName ?? cqnName ?? String(cqnEntity);
}
function getDefinitionForEntity(entityName) {
    const defs = cds.model?.definitions;
    return defs?.[entityName];
}
function resolveAssociationTargetName(target, assocName) {
    const assoc = target?.elements?.[assocName];
    const assocTargetName = assoc?.target;
    if (!assocTargetName)
        return undefined;
    return resolveEntityName(assocTargetName);
}
function resolveTableNameFromRef(ref, target) {
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
        const baseId = typeof first === 'string' ? first : first?.id ?? first?.name ?? String(first);
        const assocName = typeof ref[1] === 'string' ? ref[1] : ref[1]?.id ?? ref[1]?.name ?? String(ref[1]);
        const baseDef = getDefinitionForEntity(baseId);
        if (baseDef) {
            const assoc = baseDef.elements?.[assocName];
            if (assoc?.target) {
                return resolveEntityName(assoc.target);
            }
        }
    }
    const parts = ref.map((r) => typeof r === 'string' ? r : r?.id ?? r?.name ?? String(r));
    return resolveEntityName(parts.join('.'), target);
}
export function resolveEntityName(entityName, target) {
    const MAX_DEPTH = 5;
    for (let i = 0; i < MAX_DEPTH && entityName && typeof entityName === 'object'; i++) {
        if (Array.isArray(entityName.ref)) {
            entityName = entityName.ref.length === 1 ? entityName.ref[0] : entityName.ref.join('.');
        }
        else if (typeof entityName.id === 'string') {
            entityName = entityName.id;
        }
        else if (typeof entityName.name === 'string') {
            entityName = entityName.name;
        }
        else {
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
        const sourceRef = def.projection?.from?.ref ??
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
//# sourceMappingURL=toSQL.js.map