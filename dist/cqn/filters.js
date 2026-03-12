/**
 * CQN filter/where clause translation to SQL
 */
import { toPhysicalIdentifier } from '../identifiers.js';
import { placeholder } from '../params.js';
/**
 * Translate CQN where/having expression to SQL
 */
export function translateFilter(xpr, params, baseAlias, isDraft) {
    if (!xpr || xpr.length === 0) {
        return '';
    }
    return translateExpression(xpr, params, baseAlias, isDraft);
}
/**
 * Translate a CQN expression
 */
function translateExpression(xpr, params, baseAlias, isDraft) {
    const parts = [];
    for (let i = 0; i < xpr.length; i++) {
        const element = xpr[i];
        // String operators: 'and', 'or', '=', '!=', etc.
        if (typeof element === 'string') {
            parts.push(translateOperator(element));
        }
        // Object: ref, val, func, xpr, list, lambda
        else if (typeof element === 'object' && element !== null) {
            // Skip comparisons involving navigation paths (e.g. DraftAdministrativeData/InProcessByUser)
            // that require JOINs we cannot resolve. For value comparisons, replace with TRUE.
            // For IS NULL patterns (nextVal is a string keyword), let translateRef return NULL so that
            // "NULL IS NULL" evaluates correctly in SQL.
            if (element.ref && element.ref.length > 1 && DRAFT_NAV_ENTITIES.has(element.ref[0].toLowerCase())) {
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
                parts.push(`(${translateExpression(element.xpr, params, baseAlias, isDraft)})`);
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
function translateRef(ref, baseAlias, isDraft) {
    if (ref.length === 1) {
        // On draft tables, draft columns are physical — use them directly
        if (!isDraft) {
            const constant = DRAFT_REF_CONSTANTS[ref[0].toLowerCase()];
            if (constant !== undefined)
                return constant;
        }
        const col = toPhysicalIdentifier(ref[0]);
        return baseAlias ? `${baseAlias}.${col}` : col;
    }
    // Navigation path starting with an association entity (SiblingEntity, DraftAdministrativeData)
    // These require JOINs — without them, return NULL regardless of isDraft
    if (DRAFT_NAV_ENTITIES.has(ref[0].toLowerCase()))
        return 'NULL';
    // Multiple parts: table.column or alias.column
    return ref.map(part => toPhysicalIdentifier(part)).join('.');
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
        case 'LOWER':
        case 'UPPER':
        case 'LENGTH':
            return `${funcName}(${translateExpression(args, params)})`;
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
        case 'YEAR':
        case 'MONTH':
        case 'DAY':
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
    const assocName = element.ref[element.ref.length - 1];
    const variable = element.variable || 'lv';
    const conditionSQL = element.where ? translateFilter(element.where, params) : '1=1';
    const childTable = toPhysicalIdentifier(assocName);
    const fkCol = toPhysicalIdentifier(`${assocName}_ID`);
    if (lambda === 'any') {
        return `EXISTS (SELECT 1 FROM ${childTable} AS ${variable} WHERE ${variable}.${fkCol} = ${toPhysicalIdentifier('ID')} AND (${conditionSQL}))`;
    }
    // 'all'
    return `NOT EXISTS (SELECT 1 FROM ${childTable} AS ${variable} WHERE ${variable}.${fkCol} = ${toPhysicalIdentifier('ID')} AND NOT (${conditionSQL}))`;
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