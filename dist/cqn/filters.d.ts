/**
 * CQN filter/where clause translation to SQL
 */
import { SnowflakeCredentials } from '../config.js';
export interface FilterSqlContext {
    credentials?: SnowflakeCredentials;
    target?: any;
    /** Resolve a CDS entity name to its physical table name (follows projection chains) */
    resolveTable?: (entityName: string) => string;
}
export interface CQNExpression {
    ref?: string[];
    val?: any;
    func?: string;
    args?: CQNExpression[];
    xpr?: any[];
    list?: any[];
}
/**
 * Translate CQN where/having expression to SQL
 */
export declare function translateFilter(xpr: any[], params: any[], baseAlias?: string, isDraft?: boolean, sqlContext?: FilterSqlContext): string;
/**
 * Translate CAP $search expression to ILIKE SQL conditions over searchable string columns.
 *
 * searchExpr format: [{ val: 'term' }, 'and', { val: 'other' }]
 * Returns an SQL fragment like:
 *   (COL1 ILIKE ? OR COL2 ILIKE ?) AND (COL1 ILIKE ? OR COL2 ILIKE ?)
 */
export declare function translateSearch(searchExpr: any[], targetElements: Record<string, any>, params: any[], baseAlias?: string): string;
//# sourceMappingURL=filters.d.ts.map