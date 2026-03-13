/**
 * CDS to Snowflake type mappings
 */
export interface TypeMapping {
    snowflakeType: string;
    requiresLength?: boolean;
    requiresPrecision?: boolean;
}
/**
 * Map CDS types to Snowflake types
 */
export declare function mapCDSType(cdsType: string, length?: number, precision?: number, scale?: number, vectorConfig?: {
    dimensions: number;
}): string;
/**
 * Map Snowflake types back to CDS types (for reverse engineering)
 */
export declare function mapSnowflakeTypeToCDS(snowflakeType: string): string;
/**
 * Convert CDS value to Snowflake-compatible value
 */
export declare function convertValue(value: any, cdsType?: string): any;
//# sourceMappingURL=types.d.ts.map