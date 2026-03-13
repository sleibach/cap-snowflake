/**
 * CQN filter/where clause translation to SQL
 */
import { toPhysicalIdentifier, qualifyName, quoteIdentifier } from '../identifiers.js';
import { placeholder } from '../params.js';
/**
 * Translate CQN where/having expression to SQL
 */
export function translateFilter(xpr, params, baseAlias, isDraft, sqlContext) {
    if (!xpr || xpr.length === 0) {
        return '';
    }
    return translateExpression(xpr, params, baseAlias, isDraft, sqlContext);
}
/**
 * Translate a CQN expression
 */
function translateExpression(xpr, params, baseAlias, isDraft, sqlContext) {
    const parts = [];
    for (let i = 0; i < xpr.length; i++) {
        const element = xpr[i];
        // String operators: 'and', 'or', '=', '!=', etc.
        if (typeof element === 'string') {
            const opUpper = element.toUpperCase();
            // Handle EXISTS pattern: 'exists' followed by { ref: [{ id: 'assoc', where: [...] }] }
            // CAP generates this for lambda any() / all() operators.
            if (opUpper === 'EXISTS' || opUpper === 'NOT EXISTS') {
                const nextEl = xpr[i + 1];
                if (nextEl?.ref?.length === 1 && typeof nextEl.ref[0] === 'object' && nextEl.ref[0].where) {
                    i += 1;
                    const existsSQL = buildExistsFromAssocRef(nextEl.ref[0], params, baseAlias, sqlContext);
                    parts.push(opUpper === 'NOT EXISTS' ? `NOT ${existsSQL}` : existsSQL);
                    continue;
                }
            }
            // 'not' followed by 'exists' + ref-with-where
            if (opUpper === 'NOT') {
                const nextStr = typeof xpr[i + 1] === 'string' ? xpr[i + 1].toUpperCase() : '';
                const refEl = xpr[i + 2];
                if (nextStr === 'EXISTS' && refEl?.ref?.length === 1 && typeof refEl.ref[0] === 'object' && refEl.ref[0].where) {
                    i += 2;
                    parts.push(`NOT ${buildExistsFromAssocRef(refEl.ref[0], params, baseAlias, sqlContext)}`);
                    continue;
                }
            }
            // Handle NULL comparison: `= null` → `IS NULL`, `!= null` / `<> null` → `IS NOT NULL`
            // Must check next token (right side). We look ahead one element for a {val: null} object.
            if ((opUpper === '=' || opUpper === '!=' || opUpper === '<>') && i + 1 < xpr.length) {
                const nextEl = xpr[i + 1];
                if (typeof nextEl === 'object' && nextEl !== null && 'val' in nextEl && nextEl.val === null) {
                    i += 1; // consume the {val: null}
                    const last = parts[parts.length - 1];
                    parts[parts.length - 1] = (opUpper === '=') ? `${last} IS NULL` : `${last} IS NOT NULL`;
                    continue;
                }
            }
            parts.push(translateOperator(element));
        }
        // Object: ref, val, func, xpr, list, lambda
        else if (typeof element === 'object' && element !== null) {
            // Skip comparisons involving navigation paths (e.g. DraftAdministrativeData/InProcessByUser)
            // that require JOINs we cannot resolve. For value comparisons, replace with TRUE.
            // For IS NULL patterns (nextVal is a string keyword), let translateRef return NULL so that
            // "NULL IS NULL" evaluates correctly in SQL.
            if (element.ref && element.ref.length > 1 && DRAFT_NAV_ENTITIES.has(refPartToString(element.ref[0]).toLowerCase())) {
                const nextOp = xpr[i + 1];
                const nextVal = xpr[i + 2];
                if (typeof nextOp === 'string' && nextVal !== null && nextVal !== undefined && typeof nextVal === 'object' && 'val' in nextVal) {
                    // e.g. SiblingEntity/X = value — skip operator+value, push TRUE
                    i += 2;
                    parts.push('TRUE');
                    continue;
                }
                // For IS NULL / IS NOT NULL patterns or bare refs, translateRef returns 'NULL'
                parts.push(translateRef(element.ref, baseAlias, isDraft));
                continue;
            }
            if (element.ref && element.lambda) {
                parts.push(translateLambda(element, params));
            }
            else if (element.ref) {
                parts.push(translateRef(element.ref, baseAlias, isDraft));
            }
            else if ('val' in element) {
                parts.push(translateVal(element.val, params));
            }
            else if (element.func) {
                parts.push(translateFunc(element, params));
            }
            else if (element.xpr) {
                parts.push(`(${translateExpression(element.xpr, params, baseAlias, isDraft, sqlContext)})`);
            }
            else if (element.list) {
                parts.push(translateList(element.list, params));
            }
        }
    }
    return parts.join(' ');
}
/**
 * Translate operator
 */
function translateOperator(op) {
    const opUpper = op.toUpperCase();
    switch (opUpper) {
        case 'AND':
        case 'OR':
        case 'NOT':
            return opUpper;
        case '=':
        case '!=':
        case '<>':
        case '<':
        case '<=':
        case '>':
        case '>=':
            return op;
        case 'LIKE':
        case 'IN':
        case 'BETWEEN':
        case 'IS':
            return opUpper;
        default:
            return op;
    }
}
/**
 * Translate reference (column name)
 */
/**
 * CAP draft indicator columns / navigation paths that do not exist on the
 * physical table.  In WHERE clauses we return their logical constant value so
 * that the overall predicate remains correct:
 *   IsActiveEntity         → TRUE   (all rows in the base table are active)
 *   HasActiveEntity        → FALSE
 *   HasDraftEntity         → FALSE
 *   SiblingEntity/...      → NULL   (no sibling entity exists)
 *   DraftAdministrativeData/... → NULL
 */
const DRAFT_REF_CONSTANTS = {
    isactiveentity: 'TRUE',
    hasactiveentity: 'FALSE',
    hasdraftentity: 'FALSE',
};
const DRAFT_NAV_ENTITIES = new Set(['siblingentity', 'draftadministrativedata']);
/** Safely convert a ref element to a string, handling both string and object forms. */
function refPartToString(part) {
    if (typeof part === 'string')
        return part;
    if (typeof part === 'object' && part !== null) {
        return part.id ?? part.name ?? String(part);
    }
    return String(part);
}
function translateRef(ref, baseAlias, isDraft) {
    if (ref.length === 1) {
        const partStr = refPartToString(ref[0]);
        // On draft tables, draft columns are physical — use them directly
        if (!isDraft) {
            const constant = DRAFT_REF_CONSTANTS[partStr.toLowerCase()];
            if (constant !== undefined)
                return constant;
        }
        const col = toPhysicalIdentifier(partStr);
        return baseAlias ? `${baseAlias}.${col}` : col;
    }
    // Navigation path starting with an association entity (SiblingEntity, DraftAdministrativeData)
    // These require JOINs — without them, return NULL regardless of isDraft
    const firstStr = refPartToString(ref[0]);
    if (DRAFT_NAV_ENTITIES.has(firstStr.toLowerCase()))
        return 'NULL';
    // Multiple parts: table.column or alias.column
    // The first part is a table alias (preserve case with quoteIdentifier),
    // remaining parts are physical column names (uppercase with toPhysicalIdentifier).
    return ref.map((part, i) => {
        const str = refPartToString(part);
        return i === 0 ? quoteIdentifier(str) : toPhysicalIdentifier(str);
    }).join('.');
}
/**
 * Translate value
 */
function translateVal(val, params) {
    if (val === null) {
        return 'NULL';
    }
    // Add to parameter array and return placeholder
    params.push(val);
    return placeholder();
}
/**
 * Translate function call
 */
function translateFunc(func, params) {
    const funcName = func.func.toUpperCase();
    const args = func.args || [];
    switch (funcName) {
        case 'TOLOWER':
        case 'LOWER':
            return `LOWER(${translateExpression(args, params)})`;
        case 'TOUPPER':
        case 'UPPER':
            return `UPPER(${translateExpression(args, params)})`;
        case 'LENGTH':
            return `LENGTH(${translateExpression(args, params)})`;
        case 'SUBSTRING':
            // SUBSTRING(str, start, length)
            if (args.length >= 2) {
                const str = translateExpression([args[0]], params);
                const start = translateExpression([args[1]], params);
                const len = args[2] ? translateExpression([args[2]], params) : undefined;
                if (len) {
                    return `SUBSTRING(${str}, ${start}, ${len})`;
                }
                return `SUBSTRING(${str}, ${start})`;
            }
            break;
        case 'CONTAINS':
            // CONTAINS(str, substr) -> str LIKE '%substr%'
            if (args.length === 2) {
                const str = translateExpression([args[0]], params);
                // For contains, we need to wrap the value with %
                const containsVal = args[1].val;
                if (containsVal !== undefined) {
                    params.push(`%${containsVal}%`);
                    return `${str} LIKE ${placeholder()}`;
                }
            }
            break;
        case 'STARTSWITH':
            // STARTSWITH(str, prefix) -> str LIKE 'prefix%'
            if (args.length === 2) {
                const str = translateExpression([args[0]], params);
                const startsVal = args[1].val;
                if (startsVal !== undefined) {
                    params.push(`${startsVal}%`);
                    return `${str} LIKE ${placeholder()}`;
                }
            }
            break;
        case 'ENDSWITH':
            // ENDSWITH(str, suffix) -> str LIKE '%suffix'
            if (args.length === 2) {
                const str = translateExpression([args[0]], params);
                const endsVal = args[1].val;
                if (endsVal !== undefined) {
                    params.push(`%${endsVal}`);
                    return `${str} LIKE ${placeholder()}`;
                }
            }
            break;
        case 'ROUND':
        case 'FLOOR':
            return `${funcName}(${args.map(arg => translateExpression([arg], params)).join(', ')})`;
        case 'CEILING':
            return `CEIL(${args.map(arg => translateExpression([arg], params)).join(', ')})`;
        case 'YEAR':
        case 'MONTH':
        case 'DAY':
        case 'HOUR':
        case 'MINUTE':
        case 'SECOND':
            return `${funcName}(${translateExpression(args, params)})`;
        default:
            // Generic function call
            return `${funcName}(${args.map(arg => translateExpression([arg], params)).join(', ')})`;
    }
    // Fallback
    return `${funcName}(${args.map(arg => translateExpression([arg], params)).join(', ')})`;
}
/**
 * Translate OData lambda operator (any / all) to EXISTS / NOT EXISTS SQL
 */
function translateLambda(element, params) {
    const lambda = element.lambda; // 'any' or 'all'
    const rawAssoc = element.ref[element.ref.length - 1];
    const assocName = refPartToString(rawAssoc);
    const variable = element.variable || 'lv';
    // Translate the lambda condition, using the lambda variable as a table alias prefix
    const conditionSQL = element.where ? translateFilter(element.where, params, variable) : '1=1';
    const childTable = toPhysicalIdentifier(assocName);
    // Use singularized parent entity name as FK pattern
    // e.g. for 'books' association on 'Authors', FK is AUTHOR_ID (not BOOKS_ID)
    // If element has 'on' condition from CAP, we could use that — but for now use heuristic:
    // the FK in the child table pointing to the parent is typically <singularParent>_ID.
    // We fall back to <assocName>_ID which may be wrong but won't cause a crash.
    const fkFromOn = extractFKFromOn(element.on);
    const fkCol = fkFromOn ?? toPhysicalIdentifier(`${singularize(assocName)}_ID`);
    if (lambda === 'any') {
        return `EXISTS (SELECT 1 FROM ${childTable} AS ${variable} WHERE ${variable}.${fkCol} = ID AND (${conditionSQL}))`;
    }
    // 'all'
    return `NOT EXISTS (SELECT 1 FROM ${childTable} AS ${variable} WHERE ${variable}.${fkCol} = ID AND NOT (${conditionSQL}))`;
}
function singularize(name) {
    if (name.endsWith('ies'))
        return name.slice(0, -3) + 'y';
    if (name.endsWith('s') && !name.endsWith('ss'))
        return name.slice(0, -1);
    return name;
}
/**
 * Build EXISTS subquery for CAP lambda pattern:
 * CQN: ['exists', { ref: [{ id: 'books', where: [...] }] }]
 * SQL: EXISTS (SELECT 1 FROM CHILD_TABLE AS alias WHERE alias.FK = PARENT.ID AND (condition))
 */
function buildExistsFromAssocRef(refPart, params, parentAlias, sqlContext) {
    const assocName = refPart.id ?? refPart.name ?? String(refPart);
    const whereCondition = refPart.where ?? [];
    const alias = `_ex_${toPhysicalIdentifier(assocName).toLowerCase()}`;
    // Resolve child table: look up association target in model
    let childTable = toPhysicalIdentifier(assocName);
    if (sqlContext?.credentials) {
        const assocEl = sqlContext.target?.elements?.[assocName];
        const targetEntityName = assocEl?.target;
        if (targetEntityName && sqlContext.resolveTable) {
            const physName = sqlContext.resolveTable(targetEntityName);
            childTable = qualifyName(physName, sqlContext.credentials);
        }
        else if (targetEntityName) {
            childTable = qualifyName(targetEntityName.replace(/\./g, '_').toUpperCase(), sqlContext.credentials);
        }
        else {
            childTable = qualifyName(toPhysicalIdentifier(assocName), sqlContext.credentials);
        }
    }
    // Find FK: from assoc 'on' condition or heuristic (singularParent_ID)
    const assocEl = sqlContext?.target?.elements?.[assocName];
    let fkCol = extractFKFromOn(assocEl?.on);
    if (!fkCol) {
        // Heuristic: parent entity short name + _ID
        const parentName = sqlContext?.target?.name?.split('.').pop() ?? '';
        fkCol = toPhysicalIdentifier(parentName ? `${singularize(parentName)}_ID` : `${singularize(assocName)}_ID`);
    }
    // Qualify the parent ID reference to avoid ambiguity in Snowflake correlated subqueries.
    // When there's no outer alias, use the fully qualified outer table name.
    let parentIdRef;
    if (parentAlias) {
        parentIdRef = `${parentAlias}.ID`;
    }
    else if (sqlContext?.target && sqlContext.credentials) {
        const parentEntityName = sqlContext.target?.name ?? sqlContext.target?.['@cds.persistence.name'];
        const parentPhysName = sqlContext.resolveTable?.(parentEntityName) ?? parentEntityName?.replace(/\./g, '_').toUpperCase();
        const parentTable = parentPhysName ? qualifyName(parentPhysName, sqlContext.credentials) : undefined;
        parentIdRef = parentTable ? `${parentTable}.ID` : 'ID';
    }
    else {
        parentIdRef = 'ID';
    }
    const conditionSQL = whereCondition.length > 0
        ? translateFilter(whereCondition, params, alias, false, sqlContext)
        : '1=1';
    return `EXISTS (SELECT 1 FROM ${childTable} AS ${alias} WHERE ${alias}.${fkCol} = ${parentIdRef} AND (${conditionSQL}))`;
}
/**
 * Try to extract the FK column name from a CAP-generated 'on' condition.
 * CAP may include the join condition in element.on for lambda expressions.
 */
function extractFKFromOn(on) {
    if (!Array.isArray(on) || on.length < 3)
        return null;
    // Pattern: [{ref: ['variable', 'fkCol']}, '=', {ref: ['$self', 'ID']}] or similar
    for (let i = 0; i < on.length - 2; i++) {
        const left = on[i];
        const op = on[i + 1];
        if (op === '=' || op === '==') {
            if (left?.ref && left.ref.length === 2) {
                const colPart = refPartToString(left.ref[1]);
                if (colPart.toUpperCase().endsWith('_ID')) {
                    return toPhysicalIdentifier(colPart);
                }
            }
            const right = on[i + 2];
            if (right?.ref && right.ref.length === 2) {
                const colPart = refPartToString(right.ref[1]);
                if (colPart.toUpperCase().endsWith('_ID')) {
                    return toPhysicalIdentifier(colPart);
                }
            }
        }
    }
    return null;
}
/**
 * Translate list (for IN operator)
 */
function translateList(list, params) {
    const values = list.map(item => {
        if (item.val !== undefined) {
            params.push(item.val);
            return placeholder();
        }
        return translateExpression([item], params);
    });
    return `(${values.join(', ')})`;
}
/**
 * Translate CAP $search expression to ILIKE SQL conditions over searchable string columns.
 *
 * searchExpr format: [{ val: 'term' }, 'and', { val: 'other' }]
 * Returns an SQL fragment like:
 *   (COL1 ILIKE ? OR COL2 ILIKE ?) AND (COL1 ILIKE ? OR COL2 ILIKE ?)
 */
export function translateSearch(searchExpr, targetElements, params, baseAlias) {
    // Collect searchable string columns, qualified with baseAlias when JOINs are present
    // to avoid "ambiguous column name" errors (e.g. CREATEDBY in both joined tables).
    const searchableCols = Object.entries(targetElements)
        .filter(([, el]) => {
        if (!el || typeof el !== 'object')
            return false;
        if (el['@cds.search'] === false)
            return false;
        const t = (el.type ?? '').toLowerCase();
        return t.includes('string') || t.includes('largestring') || t === 'cds.string' || t === 'cds.largestring';
    })
        .map(([name]) => {
        const physical = toPhysicalIdentifier(name);
        return baseAlias ? `${baseAlias}.${physical}` : physical;
    });
    if (searchableCols.length === 0) {
        return '';
    }
    // Parse search expression: terms separated by 'and'/'or'
    // Each term is { val: 'string' }; operators are plain strings
    const termBlocks = [];
    const operators = [];
    for (const item of searchExpr) {
        if (typeof item === 'string') {
            operators.push(item.toUpperCase());
        }
        else if (item && 'val' in item) {
            // Each column gets its own bound parameter
            const orBlock = searchableCols.map(col => {
                params.push(`%${item.val}%`);
                return `${col} ILIKE ${placeholder()}`;
            }).join(' OR ');
            termBlocks.push(`(${orBlock})`);
        }
    }
    if (termBlocks.length === 0)
        return '';
    if (termBlocks.length === 1)
        return termBlocks[0];
    // Interleave term blocks with operators (default AND when missing)
    const parts = [termBlocks[0]];
    for (let i = 1; i < termBlocks.length; i++) {
        parts.push(operators[i - 1] ?? 'AND');
        parts.push(termBlocks[i]);
    }
    return parts.join(' ');
}
// toPhysicalIdentifier is imported from identifiers.ts
//# sourceMappingURL=filters.js.map