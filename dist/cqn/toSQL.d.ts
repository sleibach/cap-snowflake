/**
 * Main CQN to SQL translator
 */
import { SnowflakeCredentials } from '../config.js';
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
    limit?: {
        rows?: {
            val: number;
        };
        offset?: {
            val: number;
        };
    };
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
export declare function cqnToSQL(cqn: CQN, credentials: SnowflakeCredentials, context?: TranslateContext): SQLResult;
/**
 * Generate MERGE (UPSERT) statement
 */
export declare function generateMerge(tableName: string, keys: string[], data: any, credentials: SnowflakeCredentials): SQLResult;
export {};
//# sourceMappingURL=toSQL.d.ts.map