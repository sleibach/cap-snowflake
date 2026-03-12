/**
 * JOIN generation for associations and expansions
 */
import { quoteIdentifier, qualifyName } from '../identifiers.js';
import { translateFilter } from './filters.js';
/**
 * Generate JOIN clause for association
 */
export function generateJoin(association, parentAlias, joinAlias, credentials, params, joinType = 'LEFT') {
    const targetTable = qualifyName(association.target, credentials);
    let onCondition;
    if (association.keys) {
        // Managed association: use foreign key
        const parentCol = quoteIdentifier(association.keys.parent);
        const childCol = quoteIdentifier(association.keys.child);
        onCondition = `${parentAlias}.${parentCol} = ${joinAlias}.${childCol}`;
    }
    else if (association.on) {
        // Unmanaged association: translate ON condition
        onCondition = translateJoinCondition(association.on, parentAlias, joinAlias, params);
    }
    else {
        throw new Error(`Cannot generate JOIN for association ${association.name}: missing keys or ON condition`);
    }
    return `${joinType} JOIN ${targetTable} AS ${joinAlias} ON ${onCondition}`;
}
/**
 * Translate CQN ON condition for JOIN
 */
function translateJoinCondition(onCondition, parentAlias, childAlias, params) {
    // Translate CQN expression
    let condition = translateFilter(onCondition, params);
    // Replace $self with parent alias
    condition = condition.replace(/\$self/g, parentAlias);
    // Qualify column references
    // This is simplified - full implementation would parse refs properly
    return condition;
}
/**
 * Generate SELECT with expanded columns
 */
export function generateExpandedSelect(baseColumns, expandedColumns, baseAlias) {
    const allColumns = [];
    // Add base columns
    for (const col of baseColumns) {
        if (col === '*') {
            allColumns.push(`${baseAlias}.*`);
        }
        else {
            allColumns.push(`${baseAlias}.${quoteIdentifier(col)}`);
        }
    }
    // Add expanded columns
    for (const [joinAlias, columns] of expandedColumns.entries()) {
        for (const col of columns) {
            if (col === '*') {
                // Use OBJECT_CONSTRUCT to create JSON object
                allColumns.push(`OBJECT_CONSTRUCT(*) AS ${quoteIdentifier(joinAlias + '_data')}`);
            }
            else {
                allColumns.push(`${joinAlias}.${quoteIdentifier(col)} AS ${quoteIdentifier(joinAlias + '_' + col)}`);
            }
        }
    }
    return allColumns;
}
/**
 * Generate GROUP BY for to-many expansions with aggregation
 */
export function generateGroupByForExpand(baseColumns, baseAlias) {
    const groupCols = baseColumns
        .filter(c => c !== '*')
        .map(c => `${baseAlias}.${quoteIdentifier(c)}`);
    if (groupCols.length === 0) {
        // If selecting *, group by primary key
        groupCols.push(`${baseAlias}.ID`);
    }
    return `GROUP BY ${groupCols.join(', ')}`;
}
/**
 * Generate to-many expansion using ARRAY_AGG with OBJECT_CONSTRUCT
 */
export function generateToManyAggregation(associationName, joinAlias, columns) {
    // Build object construction for each child row
    const objectParts = [];
    if (columns.length === 0 || columns.includes('*')) {
        // All columns - use OBJECT_CONSTRUCT(*)
        return `ARRAY_AGG(OBJECT_CONSTRUCT(*)) AS ${quoteIdentifier(associationName)}`;
    }
    else {
        // Specific columns
        for (const col of columns) {
            const quotedCol = quoteIdentifier(col);
            objectParts.push(`'${col}', ${joinAlias}.${quotedCol}`);
        }
        return `ARRAY_AGG(
      OBJECT_CONSTRUCT(${objectParts.join(', ')})
    ) AS ${quoteIdentifier(associationName)}`;
    }
}
/**
 * Restructure flat JOIN results into nested structure
 */
export function restructureJoinedResults(rows, expansions) {
    return rows.map(row => {
        const result = {};
        const expandedData = new Map();
        // Separate base columns from expanded columns
        for (const [key, value] of Object.entries(row)) {
            let isExpanded = false;
            for (const [assocName] of expansions.entries()) {
                if (key.startsWith(`${assocName}_`)) {
                    const fieldName = key.substring(assocName.length + 1);
                    if (!expandedData.has(assocName)) {
                        expandedData.set(assocName, {});
                    }
                    expandedData.get(assocName)[fieldName] = value;
                    isExpanded = true;
                    break;
                }
                else if (key === `${assocName}_data`) {
                    // JSON object from OBJECT_CONSTRUCT
                    expandedData.set(assocName, value);
                    isExpanded = true;
                    break;
                }
            }
            if (!isExpanded) {
                result[key] = value;
            }
        }
        // Attach expanded data
        for (const [assocName, data] of expandedData.entries()) {
            const meta = expansions.get(assocName);
            if (meta?.type === 'to-one') {
                // To-one: single object (or null if no match)
                const hasData = Object.values(data).some(v => v !== null);
                result[assocName] = hasData ? data : null;
            }
            else {
                // To-many: already an array from ARRAY_AGG
                result[assocName] = Array.isArray(data) ? data : (data ? [data] : []);
            }
        }
        return result;
    });
}
/**
 * Parse CQN column spec to extract expand information
 */
export function extractExpandInfo(columns) {
    const baseColumns = [];
    const expands = new Map();
    for (const col of columns) {
        if (typeof col === 'string') {
            baseColumns.push(col);
        }
        else if (col.ref && !col.expand) {
            baseColumns.push(col.ref[col.ref.length - 1]);
        }
        else if (col.ref && col.expand) {
            // Expansion
            const assocName = col.ref[col.ref.length - 1];
            const expandCols = col.expand.map((e) => typeof e === 'string' ? e : (e.ref ? e.ref[e.ref.length - 1] : '*'));
            expands.set(assocName, { columns: expandCols });
        }
    }
    return { baseColumns, expands };
}
//# sourceMappingURL=joins.js.map