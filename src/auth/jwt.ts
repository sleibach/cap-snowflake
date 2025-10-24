/**
 * JWT authentication for Snowflake SQL API
 */

import jwt from 'jsonwebtoken';

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
export function generateJWT(config: JWTConfig, account: string, user: string): string {
  const now = Math.floor(Date.now() / 1000);
  
  // Build qualified user name: ACCOUNT.USER
  const qualifiedUser = `${account.toUpperCase()}.${user.toUpperCase()}`;

  const payload = {
    iss: config.issuer || qualifiedUser,
    sub: config.subject || user.toUpperCase(),
    iat: now,
    nbf: now,
    exp: now + (typeof config.expiresIn === 'number' ? config.expiresIn : 3600), // Default 1 hour
  };

  // Add audience if provided
  if (config.aud) {
    (payload as any).aud = config.aud;
  }

  const signOptions: jwt.SignOptions = {
    algorithm: (config.algorithm as jwt.Algorithm) || 'RS256',
  };

  // Sign the token
  try {
    const privateKey = config.privateKeyPassphrase
      ? { key: config.privateKey, passphrase: config.privateKeyPassphrase }
      : config.privateKey;

    return jwt.sign(payload, privateKey, signOptions);
  } catch (error) {
    throw new Error(`Failed to generate JWT: ${(error as Error).message}`);
  }
}

/**
 * Validate JWT configuration
 */
export function validateJWTConfig(config: JWTConfig): void {
  if (!config.privateKey) {
    throw new Error('JWT privateKey is required');
  }

  // Check if private key format is valid
  if (!config.privateKey.includes('BEGIN') || !config.privateKey.includes('PRIVATE KEY')) {
    throw new Error('Invalid private key format. Expected PEM format (-----BEGIN PRIVATE KEY-----)');
  }
}

