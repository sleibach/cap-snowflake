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
 * Wrap query with COUNT
 */
export declare function wrapWithCount(sql: string): string;
//# sourceMappingURL=pagination.d.ts.map