# Bookshop — Snowflake as primary database

A minimal CAP bookshop that uses Snowflake as its only database.
Standard CRUD for service projections works out of the box — no custom `.js` handler is needed.

```
db/
  schema.cds          ← domain model (Books, Authors, Orders)
  data/               ← CSV seed data loaded on first deploy
srv/
  catalog-service.cds ← OData service projections — no handler file
```

## Local development with SQLite

The `[development]` profile in `package.json` switches the DB to an in-memory SQLite instance
so you can iterate without a Snowflake connection:

```bash
npm install
cds watch          # uses SQLite in memory, hot-reloads on file changes
```

## Deploy to Snowflake

### 1. Copy and fill in the credentials template

```bash
cp .cdsrc-private.json.template .cdsrc-private.json
# edit .cdsrc-private.json — fill in account, user, role, warehouse, database, schema
```

Or set via environment variables referenced in the template:

```bash
export SNOWFLAKE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----
...
-----END PRIVATE KEY-----"
export SNOWFLAKE_PASSPHRASE="your-passphrase"   # omit if key is unencrypted
```

### 2. Deploy schema and seed data

```bash
npm run deploy
```

This creates `BOOKS`, `AUTHORS`, and `ORDERS` tables in Snowflake and loads the CSV files
from `db/data/` as initial data.

### 3. Start the service

```bash
npm start
```

## OData queries

```
GET  http://localhost:4004/catalog/Books
GET  http://localhost:4004/catalog/Books?$select=title,price&$filter=price lt 15
GET  http://localhost:4004/catalog/Books?$expand=author
GET  http://localhost:4004/catalog/Books?$orderby=title asc&$top=10
POST http://localhost:4004/catalog/Orders   {"book_ID":"<uuid>","quantity":2,"buyer":"alice"}
```
