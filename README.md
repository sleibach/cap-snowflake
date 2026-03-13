# cap-snowflake

SAP CAP database adapter for Snowflake — production-grade OData V4 support for the SAP Cloud Application Programming Model.

[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](LICENSE)
[![Node.js Version](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen.svg)](package.json)

---

## Overview

`cap-snowflake` implements the `cds.DatabaseService` interface from `@cap-js/db-service`, allowing Snowflake to serve as the persistence layer for SAP CAP applications. It translates CAP Query Notation (CQN) to Snowflake SQL and provides full OData V4 compatibility for CAP services.

### Connectivity Modes

| Mode | Protocol | Authentication | Recommended For |
|------|----------|---------------|-----------------|
| **SQL API** (default) | HTTPS REST | JWT key-pair | SAP BTP, Cloud Foundry, serverless |
| **SDK** | Native Snowflake driver | Username/password | On-premise, local development |

---

## Prerequisites

- Node.js 18 or later
- SAP CAP (`@sap/cds`) 7.0 or later
- A Snowflake account with a dedicated user, role, warehouse, database, and schema

---

## Installation

```bash
npm install cap-snowflake
```

---

## Quick Start

### 1. Register the adapter

Add to your application's `package.json`:

```json
{
  "cds": {
    "requires": {
      "db": {
        "kind": "snowflake",
        "impl": "cap-snowflake"
      }
    }
  }
}
```

### 2. Provide credentials

Create `~/.cdsrc.json` for local development (or bind via a user-provided service on Cloud Foundry):

```json
{
  "requires": {
    "db": {
      "credentials": {
        "account": "myorg-myaccount",
        "host": "myorg-myaccount.snowflakecomputing.com",
        "user": "CAP_USER",
        "role": "CAP_ROLE",
        "warehouse": "CAP_WH",
        "database": "CAP_DB",
        "schema": "APP",
        "auth": "jwt",
        "jwt": {
          "privateKey": "env:SNOWFLAKE_PRIVATE_KEY",
          "privateKeyPassphrase": "env:SNOWFLAKE_PASSPHRASE"
        }
      }
    }
  }
}
```

> **Cloud Foundry / BTP**: Supply credentials at runtime via a user-provided service instance bound to the application. Do not hard-code credentials in project files or environment variables stored in the repository.

### 3. Deploy and serve

```bash
cds deploy --to snowflake    # creates tables in Snowflake
cds serve                    # starts the CAP OData service
```

---

## Authentication

### JWT Key-Pair (Recommended)

RSA key-pair authentication is the recommended approach for all cloud deployments. Tokens are short-lived and automatically refreshed.

**Generate a key pair:**

```bash
# Generate RSA private key (PKCS#8, unencrypted)
openssl genrsa 2048 | openssl pkcs8 -topk8 -inform PEM -out snowflake_key.p8 -nocrypt

# Extract public key
openssl rsa -in snowflake_key.p8 -pubout -out snowflake_key.pub

# Register the public key with your Snowflake user
ALTER USER CAP_USER SET RSA_PUBLIC_KEY='<content of snowflake_key.pub without headers>';
```

**Configuration:**

```json
{
  "credentials": {
    "auth": "jwt",
    "jwt": {
      "privateKey": "env:SNOWFLAKE_PRIVATE_KEY",
      "privateKeyPassphrase": "env:SNOWFLAKE_PASSPHRASE",
      "algorithm": "RS256",
      "expiresIn": 3600
    }
  }
}
```

The `env:` prefix instructs the adapter to read the value from the named environment variable at runtime.

### SDK / Password

For local development or environments where key-pair authentication is not available:

```json
{
  "credentials": {
    "auth": "sdk",
    "password": "env:SNOWFLAKE_PASSWORD"
  }
}
```

---

## Configuration Reference

| Property | Required | Default | Description |
|----------|----------|---------|-------------|
| `account` | ✅ | — | Snowflake account identifier (e.g., `myorg-myaccount`) |
| `host` | | `{account}.snowflakecomputing.com` | Snowflake endpoint |
| `user` | ✅ | — | Snowflake username |
| `role` | | — | Role to assume for all statements |
| `warehouse` | | — | Virtual warehouse for compute |
| `database` | | — | Default database |
| `schema` | | — | Default schema |
| `auth` | ✅ | — | `jwt` or `sdk` |
| `jwt.privateKey` | (jwt) | — | PEM private key or `env:VAR_NAME` reference |
| `jwt.privateKeyPassphrase` | | — | Passphrase for encrypted key |
| `jwt.expiresIn` | | `3600` | Token lifetime in seconds |
| `password` | (sdk) | — | Password or `env:VAR_NAME` reference |
| `timeout` | | `60` | Query timeout in seconds |
| `serviceName` | | — | Optional: override service name in requests |

---

## Schema Deployment

The adapter provides model-driven schema deployment via `cds deploy`:

```bash
cds deploy --to snowflake
```

**What gets created:**

| Artifact | Description |
|----------|-------------|
| Base tables | One table per persistent CDS entity |
| Localized `.texts` tables | For entities with `localized` elements |
| Localized views | `localized_<Entity>` views with COALESCE locale fallback |
| Draft tables | `<Entity>.drafts` tables for `@odata.draft.enabled` entities |
| Temporal views | `<Entity>_current` views for temporal entities |

**Schema evolution:**

Re-running `cds deploy` on an existing database is idempotent — tables already present are preserved. New columns are added with `ALTER TABLE ... ADD COLUMN`. The adapter follows an add-only policy; column removal requires explicit migration SQL.

---

## OData V4 Feature Coverage

### Query Capabilities

| Feature | OData Syntax | Status |
|---------|-------------|--------|
| Column projection | `$select=field1,field2` | ✅ |
| Equality / comparison filters | `$filter=price gt 10` | ✅ |
| String functions | `$filter=contains(title,'cap')` | ✅ |
| Case functions | `$filter=tolower(title) eq 'cap'` | ✅ |
| Math functions | `$filter=round(price) eq 20` | ✅ |
| Date/time functions | `$filter=year(createdAt) eq 2024` | ✅ |
| Null comparisons | `$filter=field eq null` | ✅ |
| Boolean logic | `$filter=... and/or/not ...` | ✅ |
| Navigation property filter | `$filter=author/name eq 'Doe'` | ✅ |
| Lambda operators | `$filter=books/any(b:b/price gt 30)` | ✅ |
| Free-text search | `$search=keyword` | ✅ |
| Sorting | `$orderby=title asc,price desc` | ✅ |
| Pagination | `$top=10&$skip=20` | ✅ |
| Total row count | `$count=true` | ✅ |
| Inline count | `$inlinecount=allpages` | ✅ |
| Aggregation | `$apply=groupby((field),aggregate(...))` | ✅ |
| Aggregation filter | `$apply=filter(price gt 10)/aggregate(...)` | ✅ |

### $expand Support

| Feature | Status |
|---------|--------|
| To-one association (LEFT JOIN) | ✅ |
| To-many association (ARRAY_AGG) | ✅ |
| Nested `$expand` (multi-level) | ✅ |
| `$expand` with `$select` | ✅ |
| `$expand` with `$filter` | ✅ |
| `$expand` with `$orderby` | ✅ |
| `$expand` with `$top`/`$skip` | ✅ |
| Navigation property read | ✅ |

### Data Modification

| Feature | Status |
|---------|--------|
| Single entity INSERT | ✅ |
| UUID auto-generation (`@cds.on.insert: $uuid`) | ✅ |
| Deep insert (compositions) | ✅ |
| Managed fields on insert (`createdAt`, `createdBy`) | ✅ |
| Single field PATCH | ✅ |
| Deep UPDATE (nested compositions) | ✅ |
| Null field update via PATCH | ✅ |
| Managed fields on update (`modifiedAt`, `modifiedBy`) | ✅ |
| DELETE single entity | ✅ |
| CASCADE DELETE (compositions) | ✅ |
| UPSERT (MERGE) | ✅ |

### OData Draft (Fiori Elements)

| Flow | Status |
|------|--------|
| Create draft (`POST` with empty body) | ✅ |
| Edit existing active entity (`draftEdit`) | ✅ |
| Patch draft fields (`PATCH IsActiveEntity=false`) | ✅ |
| Read draft with `$expand=DraftAdministrativeData` | ✅ |
| Activate draft (`draftActivate`) | ✅ |
| Discard draft (`DELETE IsActiveEntity=false`) | ✅ |
| Draft list filter (`IsActiveEntity eq true or SiblingEntity/...`) | ✅ |
| Deep draft with composed entities | ✅ |

---

## Advanced Features

### Localization

The adapter supports CAP's localization pattern for multi-language content:

```cds
entity Books {
  key ID    : UUID;
  title     : localized String;
  abstract  : localized LargeString;
}
```

At deploy time the adapter creates:

- `BOOKS_TEXTS` — stores translations per `(ID, locale)` composite key
- `LOCALIZED_BOOKS` — view with `COALESCE(texts.title, base.title)` fallback to the default locale

At query time, the adapter resolves the locale from `Accept-Language` (via `cds.context.locale`) and injects a runtime JOIN on the texts table with the current locale value.

### Temporal Data

Application-time period tables (time slices) are supported via the `temporal` aspect:

```cds
using { temporal } from '@sap/cds/common';

entity Assignments : temporal {
  key ID    : UUID;
  role      : String;
  // Inherits: validFrom : DateTime @cds.valid.from
  //           validTo   : DateTime @cds.valid.to
}
```

The adapter generates a `_CURRENT` view that filters to the active slice using `CURRENT_TIMESTAMP BETWEEN validFrom AND validTo`. Point-in-time reads are supported via the `sap-valid-at` request header.

### Compositions (Deep CRUD)

Entities linked by `Composition of many` participate in deep operations automatically:

```cds
entity Catalogs : cuid, managed {
  name  : String(100);
  items : Composition of many CatalogItems on items.catalog = $self;
}

entity CatalogItems : cuid, managed {
  catalog : Association to Catalogs;
  title   : String(100);
  price   : Decimal(10,2);
}
```

- **Deep INSERT**: `POST /Catalogs` with `{ name: '...', items: [...] }` creates parent and all children in a single transaction.
- **Deep UPDATE**: `PATCH /Catalogs(id)` with an `items` array updates child records.
- **Cascade DELETE**: `DELETE /Catalogs(id)` automatically deletes all `CatalogItems` children before removing the parent.

### Schema Introspection

Import existing Snowflake tables as CDS entity definitions:

```bash
npx cap-snowflake-import --schema=MY_SCHEMA --output=db/schema.cds
```

The tool introspects tables and views, converts Snowflake types to CDS types, derives associations from naming conventions, and generates ready-to-use `.cds` files.

---

## CDS Type Mappings

| CDS Type | Snowflake DDL | Notes |
|----------|--------------|-------|
| `String(n)` | `VARCHAR(n)` | Default length: 5000 |
| `LargeString` | `TEXT` | |
| `Boolean` | `BOOLEAN` | |
| `Integer` | `NUMBER(38,0)` | |
| `Integer64` | `NUMBER(38,0)` | |
| `Decimal(p,s)` | `NUMBER(p,s)` | |
| `Double` | `FLOAT` | |
| `Date` | `DATE` | |
| `Time` | `TIME` | |
| `DateTime` | `TIMESTAMP_NTZ` | No timezone |
| `Timestamp` | `TIMESTAMP_TZ` | With timezone |
| `UUID` | `VARCHAR(36)` | |
| `Binary` | `BINARY` | |
| `Array` | `ARRAY` | |
| `Json` | `VARIANT` | |

---

## Identifier Handling

Snowflake stores unquoted identifiers as uppercase. The adapter uses the CDS entity name convention (dots replaced by underscores, all uppercase) for physical table names, with an application-configurable prefix:

| CDS Entity | Physical Table (with prefix `CAP_APP`) |
|------------|---------------------------------------|
| `my.service.Books` | `CAP_APP_MY_SERVICE_BOOKS` |
| `db.Catalogs` | `CAP_APP_DB_CATALOGS` |

Mixed-case column names that require exact-case preservation are automatically double-quoted in generated SQL.

---

## Limitations

The following are known Snowflake-specific constraints that affect adapter behaviour:

| Item | Detail |
|------|--------|
| **Constraints not enforced** | Snowflake `NOT NULL`, `UNIQUE`, and `FOREIGN KEY` constraints are metadata-only and not enforced at DML time. CAP's own validation layer handles mandatory fields and integrity checks. |
| **No row-level locks** | `FOR UPDATE` / `FOR SHARE` semantics are not available on Snowflake. Draft concurrency relies on draft table state rather than database locks. |
| **SQL API transactions** | The SQL API (JWT) mode does not support multi-statement transactions. Use SDK mode when full transaction isolation is required. |
| **Add-only schema evolution** | `cds deploy` adds new columns but does not remove or rename existing columns. Structural renames require manual migration SQL. |
| **Streaming / LargeBinary** | Binary content is stored as hex-encoded `BINARY` columns. Byte-range streaming is not supported. |

---

## Troubleshooting

### `Failed to generate JWT`

- Verify the private key is in PKCS#8 PEM format.
- Confirm that `env:SNOWFLAKE_PRIVATE_KEY` resolves to the full key including `-----BEGIN PRIVATE KEY-----` headers.
- If the key is passphrase-protected, provide `privateKeyPassphrase`.

### `Authentication failed` / `390144`

- The public key registered in Snowflake must match the private key used by the adapter.
- Run `DESCRIBE USER CAP_USER;` in Snowflake and verify `RSA_PUBLIC_KEY_FP` is set.
- Account and user identifiers are case-sensitive in JWT claims.

### `Object '<database>.<schema>.<table>' does not exist`

- The physical table name is derived from the CDS entity name. Enable `DEBUG=sql` to inspect the generated statement and compare with `SHOW TABLES` output in Snowflake.
- Verify that the role in use has `SELECT` / `INSERT` / `UPDATE` / `DELETE` privileges on the schema.

### `Insufficient privileges`

```sql
GRANT USAGE ON DATABASE CAP_DB TO ROLE CAP_ROLE;
GRANT USAGE ON SCHEMA CAP_DB.APP TO ROLE CAP_ROLE;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA CAP_DB.APP TO ROLE CAP_ROLE;
GRANT USAGE ON WAREHOUSE CAP_WH TO ROLE CAP_ROLE;
```

---

## Development

### Build

```bash
npm install
npm run build          # compiles src/ → dist/ (required for cds serve)
```

### Tests

```bash
npm run test:unit      # 284 unit tests — no Snowflake connection required
npm run test:integ     # 52 integration tests — requires .cdsrc-private.json
npm run test:e2e       # 91 end-to-end HTTP tests — requires live Snowflake
npm test               # runs all three suites in sequence
```

For end-to-end tests, place credentials in `test/e2e/fixtures/.cdsrc-private.json`:

```json
{
  "requires": {
    "db": {
      "credentials": {
        "account": "...",
        "user": "...",
        "database": "...",
        "schema": "...",
        "auth": "jwt",
        "jwt": { "privateKey": "env:SNOWFLAKE_PRIVATE_KEY" }
      }
    }
  }
}
```

### Debugging

```bash
DEBUG=sql npm run test:e2e        # prints all generated SQL statements
DEBUG=* npm run test:e2e          # full CAP framework debug output
```

### Lint

```bash
npm run lint
```

---

## License

[Apache 2.0](LICENSE)

---

## Support

- **Issues**: [GitHub Issues](https://github.com/your-repo/cap-snowflake/issues)
- **CAP Community**: [SAP Community — CAP](https://community.sap.com/topics/cloud-application-programming)
