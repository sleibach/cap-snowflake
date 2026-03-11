/**
 * JWT authentication for Snowflake SQL API
 */

import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';

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
export function generateJWT(config: JWTConfig, account: string, user: string, host?: string): string {
  const now = Math.floor(Date.now() / 1000);
  
  // Build qualified user name: ACCOUNT.USER
  const qualifiedUser = `${account.toUpperCase()}.${user.toUpperCase()}`;
  const normalizedKey = normalizePrivateKey(config.privateKey);
  const privateKey = config.privateKeyPassphrase
    ? { key: normalizedKey, passphrase: config.privateKeyPassphrase }
    : normalizedKey;
  const fingerprint = getPublicKeyFingerprint(privateKey);
  const audienceHost = host || `${account.toLowerCase()}.snowflakecomputing.com`;

  const payload = {
    // Snowflake key-pair JWT format:
    // iss = ACCOUNT.USER.SHA256:<public-key-fingerprint>
    // sub = ACCOUNT.USER
    iss: config.issuer || `${qualifiedUser}.SHA256:${fingerprint}`,
    sub: config.subject || qualifiedUser,
    iat: now,
    nbf: now,
    exp: now + (typeof config.expiresIn === 'number' ? config.expiresIn : 3600), // Default 1 hour
    aud: config.aud || `https://${audienceHost}`,
  };

  const signOptions: jwt.SignOptions = {
    algorithm: (config.algorithm as jwt.Algorithm) || 'RS256',
  };

  // Sign the token
  try {
    return jwt.sign(payload, privateKey, signOptions);
  } catch (error) {
    throw new Error(`Failed to generate JWT: ${(error as Error).message}`);
  }
}

function getPublicKeyFingerprint(privateKey: string | { key: string; passphrase: string }): string {
  const publicKey = crypto.createPublicKey(privateKey);
  const der = publicKey.export({ type: 'spki', format: 'der' }) as Buffer;
  return crypto.createHash('sha256').update(der).digest('base64');
}

function normalizePrivateKey(privateKey: string): string {
  if (!privateKey) return privateKey;
  const trimmed = privateKey.trim();
  if (trimmed.includes('BEGIN') && trimmed.includes('PRIVATE KEY')) {
    return trimmed;
  }
  // Accept raw base64-encoded PKCS8 key body from .cdsrc-private.json
  if (/^[A-Za-z0-9+/=]+$/.test(trimmed)) {
    const lines = trimmed.match(/.{1,64}/g)?.join('\n') || trimmed;
    return `-----BEGIN PRIVATE KEY-----\n${lines}\n-----END PRIVATE KEY-----`;
  }
  return trimmed;
}

/**
 * Validate JWT configuration
 */
export function validateJWTConfig(config: JWTConfig): void {
  if (!config.privateKey) {
    throw new Error('JWT privateKey is required');
  }

  const normalized = normalizePrivateKey(config.privateKey);
  if (!normalized.includes('BEGIN') || !normalized.includes('PRIVATE KEY')) {
    throw new Error('Invalid private key format. Expected PEM format or base64 PKCS8 key body');
  }
}

