/**
 * JOIN generation for associations and expansions
 */
import { SnowflakeCredentials } from '../config.js';
export interface JoinSpec {
    type: 'INNER' | 'LEFT' | 'RIGHT' | 'FULL';
    table: string;
    alias: string;
    on: string;
}
export interface AssociationMeta {
    name: string;
    target: string;
    cardinality: 'to-one' | 'to-many';
    keys?: {
        parent: string;
        child: string;
    };
    on?: any[];
}
/**
 * Generate JOIN clause for association
 */
export declare function generateJoin(association: AssociationMeta, parentAlias: string, joinAlias: string, credentials: SnowflakeCredentials, params: any[], joinType?: 'INNER' | 'LEFT'): string;
/**
 * Generate SELECT with expanded columns
 */
export declare function generateExpandedSelect(baseColumns: string[], expandedColumns: Map<string, string[]>, baseAlias: string): string[];
/**
 * Generate GROUP BY for to-many expansions with aggregation
 */
export declare function generateGroupByForExpand(baseColumns: string[], baseAlias: string): string;
/**
 * Generate to-many expansion using ARRAY_AGG with OBJECT_CONSTRUCT
 */
export declare function generateToManyAggregation(associationName: string, joinAlias: string, columns: string[]): string;
/**
 * Restructure flat JOIN results into nested structure
 */
export declare function restructureJoinedResults(rows: any[], expansions: Map<string, {
    type: 'to-one' | 'to-many';
    columns: string[];
}>): any[];
/**
 * Parse CQN column spec to extract expand information
 */
export declare function extractExpandInfo(columns: any[]): {
    baseColumns: string[];
    expands: Map<string, {
        columns: string[];
        nested?: any;
    }>;
};
//# sourceMappingURL=joins.d.ts.map