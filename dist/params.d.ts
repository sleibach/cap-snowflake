/**
 * Parameter binding and sanitization
 */
/**
 * Parameter placeholder for Snowflake SQL
 * Snowflake uses ? for positional parameters
 */
export declare function placeholder(): string;
/**
 * Convert named parameters to positional parameters
 */
export declare function namedToPositional(sql: string, namedParams: Record<string, any>): {
    sql: string;
    params: any[];
};
/**
 * Sanitize a value for safe SQL embedding (use only when binding not possible)
 * PREFER BINDING - this is a fallback for SQL API limitations
 */
export declare function sanitizeValue(value: any): string;
/**
 * Bind parameters to a SQL statement
 * For Snowflake SDK, returns array of values
 * For SQL API, may need to embed values (use sanitization)
 */
export declare function bindParameters(sql: string, params: any[]): {
    sql: string;
    binds: any[];
};
//# sourceMappingURL=params.d.ts.map