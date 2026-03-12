/**
 * CQN ORDER BY translation
 */
export interface OrderByItem {
    ref?: string[];
    sort?: 'asc' | 'desc';
    nulls?: 'first' | 'last';
}
/**
 * Translate ORDER BY clause
 */
export declare function translateOrderBy(orderBy: OrderByItem[]): string;
//# sourceMappingURL=orderby.d.ts.map