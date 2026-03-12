/**
 * Temporal data support for Snowflake adapter
 * Handles application-time period tables (time slices)
 */
import { SnowflakeCredentials } from '../config.js';
export interface TemporalEntity {
    entityName: string;
    validFromField: string;
    validToField: string;
    keys: string[];
}
export interface TemporalQuery {
    asOf?: Date | string;
    from?: Date | string;
    to?: Date | string;
}
/**
 * Check if entity is temporal
 */
export declare function isTemporal(entity: any): boolean;
/**
 * Get temporal fields from entity
 */
export declare function getTemporalFields(entity: any): {
    validFrom: string;
    validTo: string;
} | null;
/**
 * Add temporal WHERE conditions for "as-of-now" query
 */
export declare function addTemporalConditions(whereClause: string, temporalFields: {
    validFrom: string;
    validTo: string;
}, temporalQuery?: TemporalQuery): string;
/**
 * Generate temporal table DDL with composite primary key
 */
export declare function generateTemporalTableDDL(entity: any, credentials: SnowflakeCredentials): string;
/**
 * Create view for temporal entity that shows current time slices
 */
export declare function generateTemporalView(entity: any, credentials: SnowflakeCredentials): string;
//# sourceMappingURL=temporal.d.ts.map