/**
 * CQN pagination ($top, $skip, $count) translation
 */
/**
 * Translate LIMIT/OFFSET clause
 */
export function translatePagination(options) {
    const parts = [];
    if (options.top !== undefined && options.top >= 0) {
        parts.push(`LIMIT ${options.top}`);
    }
    if (options.skip !== undefined && options.skip > 0) {
        parts.push(`OFFSET ${options.skip}`);
    }
    return parts.join(' ');
}
/**
 * Wrap query with COUNT
 */
export function wrapWithCount(sql) {
    return `SELECT COUNT(*) AS "count" FROM (${sql}) AS "countQuery"`;
}
//# sourceMappingURL=pagination.js.map