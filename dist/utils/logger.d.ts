/**
 * Logging utility for the Snowflake adapter
 */
export declare const LOG: {
    trace: (message?: any, ...optionalParams: any[]) => void;
    debug: (message?: any, ...optionalParams: any[]) => void;
    info: (message?: any, ...optionalParams: any[]) => void;
    warn: (message?: any, ...optionalParams: any[]) => void;
    error: (message?: any, ...optionalParams: any[]) => void;
    log: (message?: any, ...optionalParams: any[]) => void;
    _trace: boolean;
    _debug: boolean;
    _info: boolean;
    _warn: boolean;
    _error: boolean;
    setFormat(formatter: (module: string, level: number, args: any[]) => any[]): any;
};
export declare function logSQL(sql: string, params?: any[], timing?: number): void;
export declare function logWarning(message: string, details?: any): void;
export declare function logError(message: string, error: any): void;
export declare function logInfo(message: string, details?: any): void;
//# sourceMappingURL=logger.d.ts.map