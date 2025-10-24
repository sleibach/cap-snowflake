# Snowflake Setup Guide

Complete guide for setting up Snowflake for use with cap-snowflake adapter.

## Prerequisites

- Snowflake account with ACCOUNTADMIN access (for initial setup)
- Node.js 18+ installed
- SAP CAP project initialized

## Step 1: Snowflake Account Setup

### Create Dedicated User

```sql
-- As ACCOUNTADMIN
USE ROLE ACCOUNTADMIN;

-- Create integration user
CREATE USER IF NOT EXISTS CAP_INTEGRATION_USER
  PASSWORD = 'ChangeMe123!'
  DEFAULT_ROLE = CAP_INTEGRATION_ROLE
  DEFAULT_WAREHOUSE = CAP_WAREHOUSE
  COMMENT = 'User for SAP CAP integration';
```

### Create Role and Grant Permissions

```sql
-- Create role
CREATE ROLE IF NOT EXISTS CAP_INTEGRATION_ROLE
  COMMENT = 'Role for CAP database operations';

-- Grant role to user
GRANT ROLE CAP_INTEGRATION_ROLE TO USER CAP_INTEGRATION_USER;

-- Create warehouse
CREATE WAREHOUSE IF NOT EXISTS CAP_WAREHOUSE
  WAREHOUSE_SIZE = 'XSMALL'
  AUTO_SUSPEND = 300
  AUTO_RESUME = TRUE
  INITIALLY_SUSPENDED = TRUE
  COMMENT = 'Warehouse for CAP operations';

-- Grant warehouse usage
GRANT USAGE ON WAREHOUSE CAP_WAREHOUSE TO ROLE CAP_INTEGRATION_ROLE;
GRANT OPERATE ON WAREHOUSE CAP_WAREHOUSE TO ROLE CAP_INTEGRATION_ROLE;
```

### Create Database and Schema

```sql
-- Create database
CREATE DATABASE IF NOT EXISTS CAP_DB
  COMMENT = 'Database for CAP applications';

-- Create schema
CREATE SCHEMA IF NOT EXISTS CAP_DB.APP_SCHEMA
  COMMENT = 'Schema for CAP application data';

-- Grant permissions
GRANT USAGE ON DATABASE CAP_DB TO ROLE CAP_INTEGRATION_ROLE;
GRANT USAGE ON SCHEMA CAP_DB.APP_SCHEMA TO ROLE CAP_INTEGRATION_ROLE;

-- Grant table privileges
GRANT CREATE TABLE ON SCHEMA CAP_DB.APP_SCHEMA TO ROLE CAP_INTEGRATION_ROLE;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA CAP_DB.APP_SCHEMA TO ROLE CAP_INTEGRATION_ROLE;
GRANT SELECT, INSERT, UPDATE, DELETE ON FUTURE TABLES IN SCHEMA CAP_DB.APP_SCHEMA TO ROLE CAP_INTEGRATION_ROLE;
```

## Step 2: JWT Key-Pair Authentication Setup

### Generate RSA Key Pair

```bash
# Generate private key (unencrypted)
openssl genrsa 2048 | openssl pkcs8 -topk8 -inform PEM -out snowflake_key.p8 -nocrypt

# OR generate encrypted private key
openssl genrsa 2048 | openssl pkcs8 -topk8 -inform PEM -out snowflake_key.p8

# Extract public key
openssl rsa -in snowflake_key.p8 -pubout -out snowflake_key.pub

# Get public key without headers (for Snowflake)
grep -v "BEGIN PUBLIC" snowflake_key.pub | grep -v "END PUBLIC" | tr -d '\n' > snowflake_key_oneline.pub
```

### Configure Public Key in Snowflake

```sql
-- Set RSA public key for user
ALTER USER CAP_INTEGRATION_USER SET RSA_PUBLIC_KEY='<paste_content_of_snowflake_key_oneline.pub>';

-- Verify
DESCRIBE USER CAP_INTEGRATION_USER;
-- Should show RSA_PUBLIC_KEY_FP (fingerprint)
```

### Test Authentication

```bash
# Set environment variable
export SNOWFLAKE_PRIVATE_KEY=$(cat snowflake_key.p8)

# Test with snowsql (if installed)
snowsql -a <account> -u CAP_INTEGRATION_USER --private-key-path snowflake_key.p8
```

## Step 3: Create Database Tables

Based on your CDS model, create corresponding tables:

```sql
USE DATABASE CAP_DB;
USE SCHEMA APP_SCHEMA;

-- Example: Books table
CREATE TABLE BOOKS (
  ID VARCHAR(36) PRIMARY KEY,
  TITLE VARCHAR(100) NOT NULL,
  AUTHOR_ID VARCHAR(36),
  PRICE NUMBER(10,2),
  STOCK NUMBER(38,0),
  DESCRIPTION TEXT,
  CREATEDAT TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP(),
  CREATEDBY VARCHAR(100),
  MODIFIEDAT TIMESTAMP_NTZ,
  MODIFIEDBY VARCHAR(100)
);

-- Example: Authors table
CREATE TABLE AUTHORS (
  ID VARCHAR(36) PRIMARY KEY,
  NAME VARCHAR(100) NOT NULL,
  COUNTRY VARCHAR(2),
  CREATEDAT TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP(),
  CREATEDBY VARCHAR(100),
  MODIFIEDAT TIMESTAMP_NTZ,
  MODIFIEDBY VARCHAR(100)
);

-- Grant permissions
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE BOOKS TO ROLE CAP_INTEGRATION_ROLE;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE AUTHORS TO ROLE CAP_INTEGRATION_ROLE;
```

## Step 4: Configure CAP Application

### Update package.json

```json
{
  "cds": {
    "requires": {
      "db": {
        "kind": "snowflake",
        "impl": "cap-snowflake",
        "credentials": {
          "account": "xy12345.west-europe.azure",
          "host": "xy12345.west-europe.azure.snowflakecomputing.com",
          "user": "CAP_INTEGRATION_USER",
          "role": "CAP_INTEGRATION_ROLE",
          "warehouse": "CAP_WAREHOUSE",
          "database": "CAP_DB",
          "schema": "APP_SCHEMA",
          "auth": "jwt",
          "jwt": {
            "aud": "https://xy12345.west-europe.azure.snowflakecomputing.com",
            "issuer": "xy12345.CAP_INTEGRATION_USER",
            "subject": "CAP_INTEGRATION_USER",
            "privateKey": "env:SNOWFLAKE_PRIVATE_KEY",
            "privateKeyPassphrase": "env:SNOWFLAKE_PASSPHRASE"
          },
          "timeout": 60
        }
      }
    }
  }
}
```

### Set Environment Variables

```bash
# Create .env file
cat > .env << 'EOF'
SNOWFLAKE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----
<paste your private key here>
-----END PRIVATE KEY-----"

# Optional: if key is encrypted
SNOWFLAKE_PASSPHRASE=your_passphrase
EOF

# Or export directly
export SNOWFLAKE_PRIVATE_KEY="$(cat snowflake_key.p8)"
```

## Step 5: Test Connection

```bash
# Install dependencies
npm install

# Start CAP server
cds serve

# Test OData endpoint
curl http://localhost:4004/catalog/Books
```

## Troubleshooting

### "JWT token is invalid"

- Verify public key is set correctly: `DESCRIBE USER CAP_INTEGRATION_USER`
- Check that issuer/subject match exactly (case-sensitive)
- Ensure account identifier is correct

### "Insufficient privileges"

```sql
-- Grant additional privileges
GRANT SELECT ON ALL TABLES IN SCHEMA CAP_DB.APP_SCHEMA TO ROLE CAP_INTEGRATION_ROLE;
GRANT INSERT ON ALL TABLES IN SCHEMA CAP_DB.APP_SCHEMA TO ROLE CAP_INTEGRATION_ROLE;
```

### "Object does not exist"

- Verify database/schema names are correct
- Check object ownership and grants
- Ensure warehouse is running: `ALTER WAREHOUSE CAP_WAREHOUSE RESUME IF SUSPENDED`

### "Network timeout"

- Check firewall rules
- Verify Snowflake account URL
- Test with `ping your-account.snowflakecomputing.com`

## Security Best Practices

1. **Never commit private keys** to version control
2. **Use encrypted keys** in production
3. **Rotate keys** regularly (every 90 days)
4. **Use separate users** per environment (dev/test/prod)
5. **Grant minimal privileges** (principle of least privilege)
6. **Enable MFA** for Snowflake console access
7. **Monitor access logs** regularly

## Production Checklist

- [ ] Dedicated service account created
- [ ] JWT key-pair configured
- [ ] Private key secured (encrypted, in vault)
- [ ] Minimal privileges granted
- [ ] Warehouse auto-suspend configured
- [ ] Query timeout configured
- [ ] Logging enabled
- [ ] Monitoring alerts configured
- [ ] Backup/recovery tested
- [ ] Documentation updated

## BTP Integration

For SAP BTP deployment:

1. Store private key in BTP Destination or Credential Store
2. Use environment variables in Cloud Foundry/Kyma
3. Configure network policies for Snowflake access
4. Use BTP Identity Authentication integration (future)

Example BTP Destination configuration:
```json
{
  "Name": "snowflake-db",
  "Type": "HTTP",
  "URL": "https://xy12345.snowflakecomputing.com",
  "Authentication": "NoAuthentication",
  "ProxyType": "Internet",
  "snowflake.account": "xy12345",
  "snowflake.user": "CAP_INTEGRATION_USER",
  "snowflake.database": "CAP_DB",
  "snowflake.schema": "APP_SCHEMA",
  "snowflake.privateKey": "<stored_securely>"
}
```

