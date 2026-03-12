/**
 * JWT authentication for Snowflake SQL API
 */
export interface JWTConfig {
    aud?: string;
    issuer?: string;
    subject?: string;
    privateKey: string;
    privateKeyPassphrase?: string;
    algorithm?: string;
    expiresIn?: string | number;
}
/**
 * Generate a JWT token for Snowflake authentication
 */
export declare function generateJWT(config: JWTConfig, account: string, user: string, host?: string): string;
/**
 * Validate JWT configuration
 */
export declare function validateJWTConfig(config: JWTConfig): void;
//# sourceMappingURL=jwt.d.ts.map