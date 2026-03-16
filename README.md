# cap-snowflake

SAP CAP database adapter for Snowflake — OData V4 support for the SAP Cloud Application Programming / CDS Model.

[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](LICENSE)
[![Node.js Version](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen.svg)](package.json)

> **Early Development Notice**
>
> This adapter is in active development and has not yet reached a stable release. Public APIs, configuration options, and internal behaviour may change between versions without prior notice. It is not recommended for production use without thorough evaluation in your specific environment. Feedback, bug reports, and contributions are welcome via GitHub Issues.

---

## Table of Contents

1. [Overview](#overview)
2. [Architect's Note — When to Use Snowflake vs. HANA](#architects-note--when-to-use-snowflake-vs-hana)
3. [Prerequisites](#prerequisites)
4. [Installation](#installation)
5. [Quick Start](#quick-start)
6. [Authentication](#authentication)
   - [JWT Key-Pair](#jwt-key-pair-recommended)
   - [SDK / Password](#sdk--password)
6. [Configuration Reference](#configuration-reference)
7. [Schema Deployment](#schema-deployment)
8. [OData V4 Feature Coverage](#odata-v4-feature-coverage)
   - [Query Capabilities](#query-capabilities)
   - [$expand Support](#expand-support)
   - [Data Modification](#data-modification)
   - [OData Draft (Fiori Elements)](#odata-draft-fiori-elements)
9. [Advanced Features](#advanced-features)
   - [Localization](#localization)
   - [Temporal Data](#temporal-data)
   - [Compositions (Deep CRUD)](#compositions-deep-crud)
   - [Star Schema and Analytics](#star-schema-and-analytics)
   - [Schema Introspection](#schema-introspection)
10. [Snowflake-Native Features](#snowflake-native-features)
    - [VECTOR Type and Similarity Search](#vector-type-and-similarity-search)
    - [Clustering Keys](#clustering-keys)
    - [Time Travel](#time-travel)
    - [Search Optimization](#search-optimization)
    - [Column Masking Policies](#column-masking-policies)
    - [Row Access Policies](#row-access-policies)
    - [Object and Column Tags](#object-and-column-tags)
    - [VARIANT Colon-Path Filters](#variant-colon-path-filters)
    - [External Tables](#external-tables)
11. [CDS Type Mappings](#cds-type-mappings)
12. [Identifier Handling](#identifier-handling)
13. [Limitations](#limitations)
14. [Troubleshooting](#troubleshooting)
15. [Example Projects](#example-projects)
16. [Development](#development)
17. [License](#license)
18. [Support](#support)

---

## Overview

`cap-snowflake` implements the `cds.DatabaseService` interface from `@cap-js/db-service`, allowing Snowflake to serve as the persistence layer for SAP CAP applications. It translates CAP Query Notation (CQN) to Snowflake SQL and provides full OData V4 compatibility for CAP services.

### Connectivity Modes

| Mode | Protocol | Authentication | Recommended For |
|------|----------|---------------|-----------------|
| **SQL API** (default) | HTTPS REST | JWT key-pair | SAP BTP, Cloud Foundry, serverless |
| **SDK** | Native Snowflake driver | Username/password | On-premise, local development |

---

## Architect's Note — When to Use Snowflake vs. HANA

While this adapter makes it technically possible to use Snowflake as the primary transactional database for a CAP application, that does not mean it is always the right choice. Snowflake is a cloud data warehouse optimised for large-scale analytical workloads — massively parallel scans, complex aggregations, and multi-terabyte joins across historical data. HANA, by contrast, is purpose-built for high-frequency OLTP: row-level locking, sub-millisecond point reads, and tight transactional guarantees that Fiori-driven business applications rely on.

Using Snowflake as a transactional store means working against the grain of how the platform is designed and priced. Snowflake's per-second compute billing and connection latency profile favour batch and analytical queries, not the many small, latency-sensitive reads and writes that a transactional UI generates. Draft handling, deep insertions, and concurrent user sessions are functional — but they stress exactly the characteristics where Snowflake offers the least advantage.

The recommended architecture for most SAP landscapes is the one shown in [Pattern B](#pattern-b--named-secondary-database-alongside-hana-or-sqlite): HANA handles all transactional data; Snowflake serves as a downstream analytical store or data mart — fed by replication or ETL — where complex reporting, ML scoring, and cross-system aggregations run without impacting the transactional tier.

The one pragmatic exception is cost consolidation: if Snowflake is already the only database available in a given environment and the workload is genuinely light, using it as the sole persistence layer can make sense. But that is an infrastructure constraint driving an architectural decision, not an architectural best practice. Choose the right tool for the job, not just the available one.

---

## Prerequisites

- Node.js 18 or later
- SAP CAP (`@sap/cds`) 7.0 or later
- A Snowflake account with a dedicated user, role, warehouse, database, and schema

---

## Installation

```bash
npm install github:sleibach/cap-snowflake
```

---

## Quick Start

There are two typical usage patterns: Snowflake as the **primary (only) database**, or as a **named secondary database** alongside a primary DB such as HANA.

---

### Pattern A — Primary database

Use this when Snowflake is the sole persistence layer for the application.

**`package.json`:**

```json
{
  "dependencies": {
    "cap-snowflake": "github:sleibach/cap-snowflake"
  },
  "cds": {
    "requires": {
      "db": {
        "kind": "snowflake",
        "impl": "node_modules/cap-snowflake"
      }
    }
  }
}
```

**Credentials** — `~/.cdsrc.json` (local dev) or a bound user-provided service on BTP/CF:

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

```bash
cds deploy --to snowflake    # creates tables in Snowflake
cds serve                    # starts the CAP OData service
```

---

### Pattern B — Named secondary database (alongside HANA or SQLite)

The more common real-world scenario is using Snowflake as an **analytics / reporting data mart** while a primary DB (HANA, SQLite) handles transactional data. Register the adapter under a custom service name instead of `db`.

**`package.json`:**

```json
{
  "dependencies": {
    "@cap-js/hana": "^2",
    "cap-snowflake": "github:sleibach/cap-snowflake"
  },
  "cds": {
    "requires": {
      "db": { "kind": "hana" },
      "snowflake": {
        "kind": "snowflake",
        "impl": "node_modules/cap-snowflake"
      }
    }
  }
}
```

**Credentials** — provide separately for each service in `~/.cdsrc-private.json`:

```json
{
  "cds": {
    "requires": {
      "snowflake": {
        "credentials": {
          "account": "myorg-myaccount",
          "host": "myorg-myaccount.eu-central-1.snowflakecomputing.com",
          "user": "CAP_SVC_USER",
          "role": "CAP_SVC_ROLE",
          "warehouse": "CAP_WH",
          "database": "CAP_DB",
          "schema": "DATA_MART",
          "auth": "jwt",
          "jwt": {
            "privateKey": "env:SNOWFLAKE_PRIVATE_KEY"
          }
        }
      }
    }
  }
}
```

**Service handler** — connect to the named service and delegate reads:

```js
// srv/MyAnalyticsService.js
const cds = require('@sap/cds');

module.exports = async function () {
  const snowflake = await cds.connect.to('snowflake');

  this.on('READ', 'MaterialValuation', async (req) => {
    return snowflake.run(req.query);
  });
};
```

**CDS model** — mark the entity as non-persistent in the primary DB and map it to the Snowflake table name:

```cds
// srv/MyAnalyticsService.cds
service MyAnalyticsService {
  @cds.persistence.skip
  @cds.persistence.name: 'MATERIAL_VALUATION'
  entity MaterialValuation {
    key material_id : String;
    name            : String;
    stock           : Decimal;
    coverage_days   : Decimal;
  };
}
```

`@cds.persistence.skip` prevents CAP from trying to deploy this entity to the primary DB. `@cds.persistence.name` maps it to the physical Snowflake table name.

> **Cloud Foundry / BTP**: Supply credentials at runtime via a user-provided service instance bound to the application. Do not hard-code credentials in project files or environment variables stored in the repository.

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
| External tables | `CREATE EXTERNAL TABLE` for entities with `@Snowflake.external` |

**Schema evolution:**

Re-running `cds deploy` on an existing database is idempotent — tables already present are preserved. New columns are added with `ALTER TABLE ... ADD COLUMN`. The adapter follows an add-only policy; column removal requires explicit migration SQL.

**Post-DDL Snowflake annotation pass:**

After each `CREATE TABLE`, the adapter automatically runs additional `ALTER TABLE` statements to apply Snowflake-specific annotations declared in the CDS model (clustering keys, data retention, search optimization, masking policies, row access policies, and tags). See [Snowflake-Native Features](#snowflake-native-features) for details.

---

## OData V4 Feature Coverage

### Query Capabilities

| Feature | OData Syntax | Status |
|---------|-------------|--------|
| Column projection | `$select=field1,field2` | ✅ |
| Equality / comparison filters | `$filter=price gt 10` | ✅ |
| String functions | `$filter=contains(title,'cap')` | ✅ |
| String concatenation | `$filter=concat(firstName,' ',lastName) eq 'John Doe'` | ✅ |
| String position | `$filter=indexof(title,'cap') ge 0` | ✅ |
| String trimming | `$filter=trim(name) eq 'Alice'` | ✅ |
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
| `$expand` with `$count` | ✅ |
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
| 404 on PATCH/DELETE of non-existent entity | ✅ |

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

### Star Schema and Analytics

The adapter fully supports Snowflake star schema patterns for analytical workloads. A fact table with FK associations to dimension tables can be queried with `$apply` groupby expressions that navigate through association paths:

```cds
entity SalesFacts : cuid, managed {
  book    : Association to Books;
  region  : String(50);
  channel : String(50);
  amount  : Decimal(10,2);
  units   : Integer;
}
```

**OData `$apply` examples:**

```
# Simple measure aggregation
GET /SalesFacts?$apply=aggregate(units with sum as totalUnits)

# Groupby a local dimension column
GET /SalesFacts?$apply=groupby((channel),aggregate(amount with sum as totalAmount))

# Groupby a navigation path (requires JOIN into dimension table)
GET /SalesFacts?$apply=groupby((book/title),aggregate(units with sum as totalUnits))
```

Navigation-path groupby expressions (e.g. `book/title`) are resolved by `cqn4sql` into proper JOINs before reaching the adapter, following the same pattern as HANA and SQLite adapters.

**Schema introspection annotations:**

When reverse-engineering a Snowflake schema, the introspector automatically annotates entities with `@Analytics.dataCategory` and measure columns with `@Aggregation.default` based on structural heuristics (association count, column types):

```cds
@Analytics.dataCategory: #FACT
entity SalesFacts { ... }

@Analytics.dataCategory: #DIMENSION
entity Books { ... }
```

### Schema Introspection

Import existing Snowflake tables as CDS entity definitions:

```bash
npx cap-snowflake-import --schema=MY_SCHEMA --output=db/schema.cds
```

The tool introspects tables and views, converts Snowflake types to CDS types, derives associations from naming conventions, and generates ready-to-use `.cds` files. Fact and dimension tables are annotated automatically based on association structure.

---

## Snowflake-Native Features

The `@Snowflake.*` annotation namespace lets you express Snowflake-specific capabilities directly in the CDS model without leaving the model layer. The adapter's deployment pass translates these annotations into the appropriate DDL statements after the base `CREATE TABLE`.

The annotation vocabulary is defined in `src/annotations/snowflake.cds`. No additional imports are required — annotations are read from the compiled CSN at deploy time.

### VECTOR Type and Similarity Search

Use the standard CDS `Vector(n)` type to store machine-learning embeddings. The dimension count is specified as the type parameter — no extra annotation required:

```cds
entity EmbeddedDocs {
  key ID      : UUID;
  content     : String;
  embedding   : Vector(1536);
}
```

**DDL generated:**

```sql
EMBEDDING VECTOR(FLOAT, 1536)
```

The `@Snowflake.vector` annotation is **optional** and only needed to override the default similarity function used by `vectorSearch`:

```cds
entity EmbeddedDocs {
  key ID      : UUID;
  content     : String;
  embedding   : Vector(768) @Snowflake.vector: { similarity: 'DOT_PRODUCT' };
}
```

**Supported similarity functions:**

| `similarity` value | Snowflake function |
|--------------------|--------------------|
| `COSINE` (default) | `VECTOR_COSINE_SIMILARITY` |
| `DOT_PRODUCT` | `VECTOR_INNER_PRODUCT` |
| `EUCLIDEAN` | `VECTOR_L2_DISTANCE` |

**`vectorSearch` action:**

The adapter exposes a `vectorSearch` action for ranked similarity queries:

```js
const results = await db.run('vectorSearch', {
  entity:       'my.EmbeddedDocs',
  queryVector:  [0.1, 0.2, ...],   // float array matching column dimensions
  topK:         10,                 // default: 10
  similarityFn: 'COSINE',          // default: 'COSINE'
});
// Returns rows ordered by similarity score (_score field added)
```

**Generated SQL (COSINE example):**

```sql
SELECT *, VECTOR_COSINE_SIMILARITY(EMBEDDING, [...]::VECTOR(FLOAT, 1536)) AS _score
FROM MY_DB.MY_SCHEMA.MY_EMBEDDEDDOCS
ORDER BY _score DESC
LIMIT 10
```

### Clustering Keys

Define a Snowflake micro-partition clustering key on a table. This improves pruning performance for large tables that are frequently filtered on specific columns.

```cds
@Snowflake.clustering: ['createdAt', 'region']
entity Events : cuid, managed {
  region    : String(50);
  eventType : String(100);
}
```

**DDL generated (post-CREATE):**

```sql
ALTER TABLE EVENTS CLUSTER BY (CREATEDAT, REGION)
```

### Time Travel

Query data as it existed at a specific point in the past using Snowflake's Time Travel feature. Include the `sap-snowflake-at` HTTP header with an ISO 8601 timestamp in any OData GET request:

```http
GET /odata/v4/my/Books
sap-snowflake-at: 2024-01-15T10:30:00Z
```

The adapter injects a Snowflake `AT` clause into the generated SQL:

```sql
SELECT * FROM "DB"."SCHEMA"."BOOKS"
  AT (TIMESTAMP => '2024-01-15T10:30:00Z'::TIMESTAMP_TZ)
WHERE ...
```

**Data retention** must be configured on the table (Snowflake default is 1 day for standard edition):

```cds
@Snowflake.dataRetentionDays: 7
entity Orders : cuid, managed { ... }
```

**DDL generated (post-CREATE):**

```sql
ALTER TABLE ORDERS SET DATA_RETENTION_TIME_IN_DAYS = 7
```

Set `@Snowflake.dataRetentionDays: 0` to disable Time Travel for a table.

### Search Optimization

Enable Snowflake's Search Optimization Service for fast point-lookup queries on large tables:

```cds
@Snowflake.searchOptimized: true
entity Products : cuid, managed {
  sku   : String(50);
  name  : String(200);
}
```

**DDL generated (post-CREATE):**

```sql
ALTER TABLE PRODUCTS ADD SEARCH OPTIMIZATION
```

> Note: Search Optimization requires Snowflake Enterprise Edition or higher and incurs additional storage cost.

### Column Masking Policies

Apply a Snowflake Dynamic Data Masking policy to protect sensitive column values. The policy must already exist in Snowflake before deployment.

```cds
entity Customers : cuid {
  name  : String(100);
  email : String(200)  @Snowflake.maskingPolicy: 'MY_SCHEMA.EMAIL_MASK';
  ssn   : String(11)   @Snowflake.maskingPolicy: 'MY_SCHEMA.SSN_MASK';
}
```

**DDL generated (post-CREATE, per column):**

```sql
ALTER TABLE CUSTOMERS MODIFY COLUMN EMAIL SET MASKING POLICY MY_SCHEMA.EMAIL_MASK;
ALTER TABLE CUSTOMERS MODIFY COLUMN SSN   SET MASKING POLICY MY_SCHEMA.SSN_MASK;
```

### Row Access Policies

Enforce row-level security by attaching a Snowflake Row Access Policy. The policy must already exist in Snowflake before deployment.

```cds
@Snowflake.rowAccessPolicy: {
  policy : 'MY_SCHEMA.TENANT_ROW_POLICY',
  on     : ['TENANT_ID']
}
entity TenantData : cuid {
  tenantId : String(36);
  payload  : String(500);
}
```

**DDL generated (post-CREATE):**

```sql
ALTER TABLE TENANTDATA ADD ROW ACCESS POLICY MY_SCHEMA.TENANT_ROW_POLICY ON (TENANT_ID)
```

### Object and Column Tags

Attach Snowflake object tags to tables or individual columns for governance, cost attribution, or data classification:

```cds
// Table-level tags
@Snowflake.tags: [
  { key: 'team',        value: 'data-engineering' },
  { key: 'cost-center', value: 'CC-1234' }
]
entity Orders : cuid, managed {

  // Column-level tags
  email : String(200)  @Snowflake.tags: [{ key: 'pii', value: 'true' }];
}
```

**DDL generated (post-CREATE):**

```sql
-- Table tags
ALTER TABLE ORDERS SET TAG team = 'data-engineering';
ALTER TABLE ORDERS SET TAG cost-center = 'CC-1234';

-- Column tags
ALTER TABLE ORDERS MODIFY COLUMN EMAIL SET TAG pii = 'true';
```

### VARIANT Colon-Path Filters

When a column is typed as Snowflake `VARIANT` (or annotated `@Snowflake.variant: true`), OData filter expressions that reference nested paths are automatically translated to Snowflake's colon-path syntax with a `::VARCHAR` cast.

```cds
entity Events : cuid {
  payload : Json  @Snowflake.variant: true;
}
```

**OData filter:**

```
GET /Events?$filter=payload/status eq 'active'
GET /Events?$filter=payload/nested/key eq 'value'
```

**Generated SQL:**

```sql
WHERE PAYLOAD:status::VARCHAR = ?
WHERE PAYLOAD:nested:key::VARCHAR = ?
```

This allows filtering into arbitrarily nested semi-structured data without defining a fixed schema upfront.

### External Tables

Expose an external stage (S3, Azure Blob, GCS) as a CDS entity backed by a Snowflake External Table. The stage and file format must already exist in Snowflake.

```cds
@Snowflake.external: {
  stage      : 'MY_STAGE',
  fileFormat : 'MY_PARQUET_FORMAT',
  pattern    : '.*\\.parquet'
}
entity RawEvents {
  key ID : UUID;
  // columns map to external file columns via Snowflake schema-on-read
}
```

**DDL generated (instead of CREATE TABLE):**

```sql
CREATE EXTERNAL TABLE IF NOT EXISTS "DB"."SCHEMA"."RAWEVENTS"
  WITH LOCATION = @MY_STAGE
  PATTERN = '.*\.parquet'
  FILE_FORMAT = (FORMAT_NAME = 'MY_PARQUET_FORMAT')
```

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
| `Vector(n)` | `VECTOR(FLOAT, n)` | n = dimension count; `@Snowflake.vector` annotation optional |

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
| **Search Optimization cost** | `@Snowflake.searchOptimized` requires Enterprise Edition and adds storage overhead. Evaluate before applying broadly. |
| **External table reads only** | Entities annotated with `@Snowflake.external` are read-only; INSERT/UPDATE/DELETE against external tables is not supported by Snowflake. |
| **Masking/row policies pre-exist** | `@Snowflake.maskingPolicy` and `@Snowflake.rowAccessPolicy` reference policies that must be created in Snowflake before `cds deploy` is run. |

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

### `Masking policy does not exist` during deploy

- The masking policy referenced by `@Snowflake.maskingPolicy` must be created in Snowflake before running `cds deploy`. Create the policy first, then deploy.

### `Insufficient privileges`

```sql
GRANT USAGE ON DATABASE CAP_DB TO ROLE CAP_ROLE;
GRANT USAGE ON SCHEMA CAP_DB.APP TO ROLE CAP_ROLE;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA CAP_DB.APP TO ROLE CAP_ROLE;
GRANT USAGE ON WAREHOUSE CAP_WH TO ROLE CAP_ROLE;
```

---

## Example Projects

Two ready-to-run examples are in the `examples/` directory:

| Example | Path | Description |
|---------|------|-------------|
| **Bookshop (primary DB)** | `examples/cap-svc/` | Snowflake is the only DB. Standard CAP projections — no custom handler needed. Includes CSV seed data and a local SQLite dev profile. |
| **Analytics (secondary DB)** | `examples/snowflake-secondary-db/` | HANA is the primary DB; Snowflake is a named secondary service for read-only analytics. Mirrors the pattern used in production apps. |

Each example has its own `README.md` with setup steps.

---

## Development

### Build

```bash
npm install
npm run build          # compiles src/ → dist/ (required for cds serve)
```

### Tests

```bash
npm run test:unit      # 364 unit tests — no Snowflake connection required
npm run test:integ     # 55 integration tests — requires .cdsrc-private.json
npm run test:e2e       # 119 end-to-end HTTP tests — requires live Snowflake
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

- **Issues**: [GitHub Issues](https://github.com/sleibach/cap-snowflake/issues)
- **CAP Community**: [SAP Community — CAP](https://community.sap.com/topics/cloud-application-programming)
