# Analytics service — Snowflake as a named secondary database

This example mirrors the pattern from a real production CAP application.
HANA (or SQLite locally) is the **primary database** for transactional entities.
Snowflake is a **named secondary service** used to surface data from an existing
Snowflake data mart — without any DDL deployment to Snowflake.

```
srv/
  analytics-service.cds   ← entity marked @cds.persistence.skip (not in primary DB)
  analytics-service.js    ← handler: cds.connect.to('snowflake') + delegate reads
```

## How it works

1. The `snowflake` service is registered in `package.json` under `cds.requires` with its own `kind` and `impl`, separate from the primary `db`.
2. The CDS entity is annotated `@cds.persistence.skip` so `cds deploy` ignores it for the primary DB.
3. `@cds.persistence.name` maps it to the physical Snowflake table name (`MATERIAL_VALUATION`).
4. The JS handler connects to the named service and passes the CAP-generated CQN query through unchanged — the adapter handles SQL translation, filtering, ordering, and pagination.

No changes to the Snowflake schema are needed. The table is expected to exist already.

## Local development

For local `cds watch`, the `snowflake` service still needs credentials because the handler
always connects to it. Use a local `.cdsrc-private.json`:

```bash
cp .cdsrc-private.json.template .cdsrc-private.json
# fill in your Snowflake account details
export SNOWFLAKE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----
...
-----END PRIVATE KEY-----"
```

```bash
npm install
cds watch
```

## Credential structure

Credentials for the named `snowflake` service are provided separately from the primary `db`.
Copy the template and fill in your values:

```bash
cp .cdsrc-private.json.template .cdsrc-private.json
```

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

On BTP/Cloud Foundry, bind the credentials via a user-provided service instance named `snowflake`.

## OData queries

```
GET http://localhost:4004/analytics/MaterialValuation
GET http://localhost:4004/analytics/MaterialValuation?$filter=category eq 'Antibiotics'
GET http://localhost:4004/analytics/MaterialValuation?$orderby=coverage_days asc&$top=20
GET http://localhost:4004/analytics/MaterialValuation?$select=material_id,material_name,stock_units
```

## Extending to multiple Snowflake services

Register additional named services in the same way and connect to them independently:

```json
{
  "cds": {
    "requires": {
      "snowflake-mart":    { "kind": "snowflake", "impl": "node_modules/cap-snowflake" },
      "snowflake-archive": { "kind": "snowflake", "impl": "node_modules/cap-snowflake" }
    }
  }
}
```

```js
const mart    = await cds.connect.to('snowflake-mart');
const archive = await cds.connect.to('snowflake-archive');
```
