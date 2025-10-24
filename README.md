# cap-snowflake

Production-ready SAP CAP database adapter for Snowflake with full OData support.

[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](LICENSE)
[![Node.js Version](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen.svg)](package.json)

## Features

✅ **Full CAP Integration** - Implements `cds.DatabaseService` contract  
✅ **OData Support** - `$select`, `$filter`, `$orderby`, `$top`, `$skip`, `$count`, basic `$expand`  
✅ **Dual Connectivity** - SQL API (JWT) or Snowflake Node.js SDK  
✅ **CQN Translation** - Complete SELECT/INSERT/UPDATE/DELETE/UPSERT (MERGE) support  
✅ **Type Safety** - Full TypeScript definitions  
✅ **Production Ready** - Error handling, retries, logging, connection management  
✅ **Security First** - JWT key-pair authentication, parameter binding, SQL injection prevention  

## Installation

```bash
npm install cap-snowflake
```

## Quick Start

### 1. Configure your CAP application

Add to your `package.json`:

```json
{
  "cds": {
    "requires": {
      "db": {
        "kind": "snowflake",
        "impl": "cap-snowflake",
        "credentials": {
          "account": "YOUR_ACCOUNT",
          "host": "YOUR_ACCOUNT.snowflakecomputing.com",
          "user": "YOUR_USER",
          "role": "YOUR_ROLE",
          "warehouse": "YOUR_WAREHOUSE",
          "database": "YOUR_DATABASE",
          "schema": "YOUR_SCHEMA",
          "auth": "jwt",
          "jwt": {
            "privateKey": "env:SNOWFLAKE_PRIVATE_KEY",
            "privateKeyPassphrase": "env:SNOWFLAKE_PASSPHRASE"
          }
        }
      }
    }
  }
}
```

### 2. Set up environment variables

```bash
export SNOWFLAKE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----
MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQC...
-----END PRIVATE KEY-----"

export SNOWFLAKE_PASSPHRASE="your-key-passphrase"
```

### 3. Run your CAP service

```bash
cds serve
```

The adapter automatically translates CAP queries to Snowflake SQL!

## Authentication Modes

### JWT Authentication (Recommended for BTP)

Uses RSA key-pair authentication with JWT tokens. Best for cloud deployments.

```json
{
  "credentials": {
    "auth": "jwt",
    "jwt": {
      "aud": "https://YOUR_ACCOUNT.snowflakecomputing.com",
      "issuer": "YOUR_ACCOUNT.YOUR_USER",
      "subject": "YOUR_USER",
      "privateKey": "env:SNOWFLAKE_PRIVATE_KEY",
      "privateKeyPassphrase": "env:SNOWFLAKE_PASSPHRASE",
      "algorithm": "RS256",
      "expiresIn": 3600
    }
  }
}
```

#### Generating Key Pair

```bash
# Generate private key
openssl genrsa 2048 | openssl pkcs8 -topk8 -inform PEM -out snowflake_key.p8 -nocrypt

# Extract public key
openssl rsa -in snowflake_key.p8 -pubout -out snowflake_key.pub

# Configure in Snowflake
ALTER USER YOUR_USER SET RSA_PUBLIC_KEY='<public_key_content>';
```

### SDK Authentication

Uses username/password. Simpler but less suitable for production.

```json
{
  "credentials": {
    "auth": "sdk",
    "password": "env:SNOWFLAKE_PASSWORD"
  }
}
```

## Configuration Reference

| Option | Required | Default | Description |
|--------|----------|---------|-------------|
| `account` | ✅ | - | Snowflake account identifier |
| `host` | | `{account}.snowflakecomputing.com` | Snowflake host URL |
| `user` | ✅ | - | Snowflake username |
| `role` | | - | Snowflake role to assume |
| `warehouse` | | - | Snowflake warehouse to use |
| `database` | | - | Default database |
| `schema` | | - | Default schema |
| `auth` | ✅ | - | Authentication mode: `jwt` or `sdk` |
| `timeout` | | 60 | Query timeout in seconds |

## Type Mappings

| CDS Type | Snowflake Type | Notes |
|----------|----------------|-------|
| `cds.String` | `VARCHAR(n)` | Default length: 5000 |
| `cds.LargeString` | `TEXT` | |
| `cds.Boolean` | `BOOLEAN` | |
| `cds.Integer` | `NUMBER(38,0)` | |
| `cds.Integer64` | `NUMBER(38,0)` | |
| `cds.Decimal(p,s)` | `NUMBER(p,s)` | |
| `cds.Double` | `FLOAT` | |
| `cds.Date` | `DATE` | |
| `cds.Time` | `TIME` | |
| `cds.DateTime` | `TIMESTAMP_NTZ` | No timezone |
| `cds.Timestamp` | `TIMESTAMP_TZ` | With timezone |
| `cds.UUID` | `VARCHAR(36)` | |
| `cds.Binary` | `BINARY` | |
| `cds.Array` | `ARRAY` | |
| `cds.Json` | `VARIANT` | |

## Identifier Handling

Snowflake's identifier rules:

- **Unquoted identifiers** → Stored as UPPERCASE
- **Quoted identifiers** → Preserve exact case
- **Reserved words** → Automatically quoted
- **Mixed case** → Automatically quoted

The adapter handles quoting automatically based on your CDS model.

```cds
// Uppercase (no quotes needed)
entity BOOKS { ... }

// Mixed case (auto-quoted as "Books")
entity Books { ... }

// Explicit quotes (preserved)
@cds.persistence.name: '"MyBooks"'
entity MyBooks { ... }
```

## Supported OData Features

### ✅ Fully Supported

- **$select** - Column projection
- **$filter** - Where clauses with operators: `=`, `!=`, `<`, `<=`, `>`, `>=`, `in`, `between`, `like`
- **$filter functions** - `contains`, `startswith`, `endswith`, `substring`, `tolower`, `toupper`
- **$orderby** - Sorting with `asc`/`desc`, `nulls first`/`nulls last`
- **$top** - Limit results (LIMIT)
- **$skip** - Offset results (OFFSET)
- **$count** - Include total count

### ⚠️ Partial Support

- **$expand** - Implemented via follow-up queries (not SQL JOINs)
  - Works for single-level expansions
  - Deep expansions execute multiple queries

### ❌ Not Yet Supported

- Complex multi-table JOINs in single query
- Aggregation via `$apply`
- Full text search

## CQN Operations

### SELECT

```javascript
const books = await SELECT.from('Books')
  .where({ price: { '<': 50 } })
  .orderBy('title')
  .limit(10, 20);
```

Translates to:
```sql
SELECT * FROM BOOKS 
WHERE price < ? 
ORDER BY title 
LIMIT 10 OFFSET 20
```

### INSERT

```javascript
await INSERT.into('Books').entries([
  { ID: '1', title: 'Book 1', price: 19.99 },
  { ID: '2', title: 'Book 2', price: 29.99 }
]);
```

Translates to:
```sql
INSERT INTO BOOKS (ID, title, price) 
VALUES (?, ?, ?), (?, ?, ?)
```

### UPDATE

```javascript
await UPDATE('Books')
  .set({ price: 24.99 })
  .where({ ID: '1' });
```

Translates to:
```sql
UPDATE BOOKS 
SET price = ? 
WHERE ID = ?
```

### DELETE

```javascript
await DELETE.from('Books').where({ ID: '1' });
```

Translates to:
```sql
DELETE FROM BOOKS WHERE ID = ?
```

### UPSERT (MERGE)

```javascript
await UPSERT.into('Books').entries({
  ID: '1',
  title: 'Updated Book',
  price: 24.99
});
```

Translates to:
```sql
MERGE INTO BOOKS AS target
USING (SELECT ? AS ID, ? AS title, ? AS price) AS source
ON target.ID = source.ID
WHEN MATCHED THEN UPDATE SET title = source.title, price = source.price
WHEN NOT MATCHED THEN INSERT (ID, title, price) VALUES (source.ID, source.title, source.price)
```

## Transactions

Transactions are supported when using SDK mode:

```javascript
const tx = cds.transaction();
try {
  await tx.run(INSERT.into('Books').entries({ ... }));
  await tx.run(UPDATE('Inventory').set({ ... }));
  await tx.commit();
} catch (error) {
  await tx.rollback();
  throw error;
}
```

**Note**: SQL API mode has limited transaction support due to API constraints.

## Error Handling

Errors are normalized to CAP error format with appropriate HTTP status codes:

```javascript
try {
  await SELECT.from('Books').where({ ID: 'invalid' });
} catch (error) {
  console.error(error.code);       // Snowflake error code
  console.error(error.sqlState);   // SQL state
  console.error(error.statusCode); // HTTP status (404, 400, 500, etc.)
}
```

## Performance Considerations

- **Projection pushdown** - Only requested columns are selected
- **Predicate pushdown** - Filters are executed in Snowflake
- **Pagination** - Uses native LIMIT/OFFSET
- **Connection pooling** - SDK mode uses connection pooling
- **Retries** - Automatic retry with exponential backoff for transient errors
- **Query timeout** - Configurable per-statement timeout

## Limitations (v1.0)

1. **DDL Generation** - Manual table creation required (deploy feature coming soon)
2. **Foreign Keys** - Snowflake doesn't enforce FKs; only for metadata
3. **Complex $expand** - Uses follow-up queries instead of JOINs
4. **SQL API Transactions** - Limited compared to SDK mode
5. **Auto-increment** - Requires SEQUENCE objects (manual setup)

## Development

```bash
# Install dependencies
npm install

# Build
npm run build

# Run unit tests
npm run test:unit

# Run integration tests (requires Snowflake account)
export SNOWFLAKE_TEST=true
export SNOWFLAKE_ACCOUNT=...
export SNOWFLAKE_USER=...
export SNOWFLAKE_PRIVATE_KEY=...
npm run test:integ

# Lint
npm run lint
```

## Examples

See the [examples/cap-svc](./examples/cap-svc) directory for a complete working CAP application.

## Troubleshooting

### "Failed to generate JWT"
- Check that your private key is in PEM format (PKCS#8)
- Verify the key is not encrypted or provide the passphrase
- Ensure no extra whitespace in the key

### "Authentication failed"
- Verify the public key is configured in Snowflake: `DESCRIBE USER YOUR_USER`
- Check that account and user names match exactly (case-sensitive)
- Ensure the JWT issuer/subject match the configured user

### "Object does not exist"
- Check database/schema configuration
- Verify table names match case (use quotes for mixed case)
- Ensure proper permissions: `GRANT SELECT ON TABLE ... TO ROLE ...`

### "Insufficient privileges"
- Grant necessary permissions to your Snowflake role
- Check warehouse access: `GRANT USAGE ON WAREHOUSE ... TO ROLE ...`

## Schema Introspection

**NEW**: Import existing Snowflake tables as CDS entities!

```bash
# Import schema from Snowflake
npx cap-snowflake-import --schema=MY_SCHEMA --output=db/schema.cds
```

This feature automatically:
- Introspects tables and views from Snowflake
- Generates CDS entity definitions
- Converts data types (Snowflake → CDS)
- Creates associations from foreign keys
- Handles naming conventions (SNAKE_CASE → camelCase)

See [Schema Import Guide](./docs/SCHEMA_IMPORT.md) for details.

## Roadmap

- [x] **Schema introspection** - Import existing tables ✅
- [ ] Full DDL deployment (`cds deploy`)
- [ ] Improved $expand with JOIN optimization
- [ ] Streaming large result sets
- [ ] Connection pooling for SQL API
- [ ] Change data capture (CDC) integration
- [ ] Advanced Snowflake features (clustering, time travel)

## Contributing

Contributions welcome! Please:

1. Fork the repository
2. Create a feature branch
3. Add tests for new functionality
4. Ensure all tests pass
5. Submit a pull request

## License

Apache 2.0

## Support

- **Issues**: [GitHub Issues](https://github.com/your-repo/cap-snowflake/issues)
- **Discussions**: [GitHub Discussions](https://github.com/your-repo/cap-snowflake/discussions)

## Acknowledgments

Built with inspiration from [@cap-js/postgres](https://github.com/cap-js/cds-dbs) and the SAP CAP community.

