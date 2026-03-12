/**
 * $expand support with JOIN-based queries
 * Handles navigation through associations and compositions
 */
import { SnowflakeCredentials } from '../config.js';
export interface ExpandSpec {
    ref: string[];
    expand?: ExpandSpec[];
    inline?: ExpandSpec[];
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
}
export interface AssociationInfo {
    name: string;
    target: string;
    type: 'to-one' | 'to-many';
    foreignKey?: string;
    on?: any[];
    isComposition?: boolean;
}
/**
 * Process expand specifications and generate appropriate SQL
 */
export declare function processExpands(baseQuery: string, expands: ExpandSpec[], credentials: SnowflakeCredentials, associationMap: Map<string, AssociationInfo>, params: any[]): {
    sql: string;
    postProcess?: (rows: any[]) => Promise<any[]>;
};
/**
 * Build JOIN expression for association
 */
export declare function buildJoinForAssociation(parentAlias: string, association: AssociationInfo, joinAlias: string, credentials: SnowflakeCredentials): string;
/**
 * Restructure flat JOIN results into nested objects
 */
export declare function restructureExpandedResults(rows: any[], expands: ExpandSpec[]): any[];
/**
 * Generate SQL for to-many expansion using JSON aggregation
 */
export declare function generateToManyExpand(parentTable: string, parentAlias: string, association: AssociationInfo, credentials: SnowflakeCredentials, expandColumns?: string[]): string;
//# sourceMappingURL=expand.d.ts.map