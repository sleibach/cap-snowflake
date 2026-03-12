/**
 * Deployer module invoked by `cds deploy` when the database kind is 'snowflake'.
 *
 * cds-dk calls:  deployer.deploy(_model, _db, options)
 * where options may contain: { dry, xdry, schema_log, messages, ... }
 *
 * Loaded via the Module._resolveFilename patch in cds-plugin.js.
 */
export declare function deploy(_model: any, _db: string | undefined, options: any): Promise<void>;
//# sourceMappingURL=cds-deployer.d.ts.map