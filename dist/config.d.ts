/**
 * Configuration parser for Snowflake adapter
 */
export interface SnowflakeCredentials {
    account: string;
    host?: string;
    user: string;
    role?: string;
    warehouse?: string;
    database?: string;
    schema?: string;
    /** Schema name prefix for tenant schemas in multitenant deployments. Defaults to 'TENANT_'. */
    tenantSchemaPrefix?: string;
    auth: 'jwt' | 'sdk';
    timeout?: number;
    jwt?: {
        aud?: string;
        issuer?: string;
        subject?: string;
        privateKey: string;
        privateKeyPassphrase?: string;
        algorithm?: string;
        expiresIn?: string | number;
    };
    password?: string;
}
export interface SnowflakeConfig {
    kind: string;
    impl: string;
    credentials: SnowflakeCredentials;
}
/**
 * Parse and validate Snowflake configuration from cds.env
 */
export declare function getSnowflakeConfig(serviceName?: string): SnowflakeConfig;
//# sourceMappingURL=config.d.ts.map