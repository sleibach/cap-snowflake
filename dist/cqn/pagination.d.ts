/**
 * CQN pagination ($top, $skip, $count) translation
 */
export interface PaginationOptions {
    top?: number;
    skip?: number;
    count?: boolean;
}
/**
 * Translate LIMIT/OFFSET clause
 */
export declare function translatePagination(options: PaginationOptions): string;
/**
 * Strip LIMIT / OFFSET clause from the end of a SQL string.
 * Used to obtain the unpaginated SQL for a COUNT(*) query.
 */
export declare function stripPagination(sql: string): string;
/**
 * Wrap query with COUNT — sql must NOT contain LIMIT/OFFSET.
 */
export declare function wrapWithCount(sql: string): string;
//# sourceMappingURL=pagination.d.ts.map