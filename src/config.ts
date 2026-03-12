/**
 * Configuration parser for Snowflake adapter
 */

import cds from '@sap/cds';

export interface SnowflakeCredentials {
  account: string;
  host?: string;
  user: string;
  role?: string;
  warehouse?: string;
  database?: string;
  schema?: string;
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
  password?: string; // For SDK mode
}

export interface SnowflakeConfig {
  kind: string;
  impl: string;
  credentials: SnowflakeCredentials;
}

/**
 * Parse and validate Snowflake configuration from cds.env
 */
export function getSnowflakeConfig(serviceName?: string): SnowflakeConfig {
  const requires = cds.env.requires || {};
  let dbConfig;

  // 1. Exact match by serviceName (handles any custom db service name)
  if (serviceName && requires[serviceName]?.kind === 'snowflake') {
    dbConfig = requires[serviceName];
  // 2. Primary 'db' alias
  } else if (requires.db?.kind === 'snowflake') {
    dbConfig = requires.db;
  // 3. Legacy 'snowflake' key
  } else if (requires.snowflake?.kind === 'snowflake') {
    dbConfig = requires.snowflake;
  // 4. Dynamic discovery: any entry with kind 'snowflake' (enables arbitrary service names)
  } else {
    const found = Object.values(requires).find(
      (v: any) => v && typeof v === 'object' && v.kind === 'snowflake'
    );
    if (found) dbConfig = found;
  }

  if (!dbConfig || (dbConfig as any).kind !== 'snowflake') {
    throw new Error('Snowflake database configuration not found or invalid kind');
  }

  const credentials = dbConfig.credentials as SnowflakeCredentials;

  // Validate required fields
  if (!credentials.account) {
    throw new Error('Snowflake account is required');
  }

  if (!credentials.user) {
    throw new Error('Snowflake user is required');
  }

  if (!credentials.auth || !['jwt', 'sdk'].includes(credentials.auth)) {
    throw new Error('Snowflake auth must be "jwt" or "sdk"');
  }

  // JWT validation
  if (credentials.auth === 'jwt') {
    if (!credentials.jwt?.privateKey) {
      throw new Error('JWT privateKey is required for jwt auth mode');
    }

    // Resolve environment variables in privateKey
    if (credentials.jwt.privateKey.startsWith('env:')) {
      const envVar = credentials.jwt.privateKey.substring(4);
      const envValue = process.env[envVar];
      if (!envValue) {
        throw new Error(`Environment variable ${envVar} not found`);
      }
      credentials.jwt.privateKey = envValue;
    }

    // Resolve passphrase if present
    if (credentials.jwt.privateKeyPassphrase?.startsWith('env:')) {
      const envVar = credentials.jwt.privateKeyPassphrase.substring(4);
      const envValue = process.env[envVar];
      if (envValue) {
        credentials.jwt.privateKeyPassphrase = envValue;
      }
    }
  }

  // SDK validation
  if (credentials.auth === 'sdk' && !credentials.password) {
    throw new Error('Password is required for sdk auth mode');
  }

  // Set defaults
  if (!credentials.host) {
    credentials.host = `${credentials.account}.snowflakecomputing.com`;
  }

  if (!credentials.timeout) {
    credentials.timeout = 60;
  }

  return dbConfig as SnowflakeConfig;
}

