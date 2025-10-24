# cap-snowflake Quick Start

Get started with cap-snowflake in 5 minutes!

## Installation

```bash
npm install cap-snowflake
```

## Minimal Configuration

**package.json**:
```json
{
  "cds": {
    "requires": {
      "db": {
        "kind": "snowflake",
        "impl": "cap-snowflake",
        "credentials": {
          "account": "xy12345",
          "user": "MY_USER",
          "database": "MY_DB",
          "schema": "MY_SCHEMA",
          "warehouse": "MY_WH",
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

**Environment**:
```bash
export SNOWFLAKE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----
...your key...
-----END PRIVATE KEY-----"
```

## Run Your Service

```bash
cds serve
```

That's it! Your CAP service now uses Snowflake as the database.

## Example Queries

### OData Queries

```bash
# Get all books
GET http://localhost:4004/catalog/Books

# Filter by price
GET http://localhost:4004/catalog/Books?$filter=price lt 50

# Order and limit
GET http://localhost:4004/catalog/Books?$orderby=title&$top=10

# Select specific fields
GET http://localhost:4004/catalog/Books?$select=title,price

# Get count
GET http://localhost:4004/catalog/Books?$count=true
```

### In Code

```javascript
// Read
const books = await SELECT.from('Books')
  .where({ price: { '<': 50 } })
  .orderBy('title');

// Insert
await INSERT.into('Books').entries({
  ID: '123',
  title: 'CAP with Snowflake',
  price: 29.99
});

// Update
await UPDATE('Books')
  .set({ price: 24.99 })
  .where({ ID: '123' });

// Delete
await DELETE.from('Books').where({ ID: '123' });

// Upsert
await UPSERT.into('Books').entries({
  ID: '123',
  title: 'Updated Title',
  price: 34.99
});
```

## Next Steps

1. **Setup Guide**: [docs/SETUP_GUIDE.md](./docs/SETUP_GUIDE.md)
2. **Full Documentation**: [README.md](./README.md)
3. **Example App**: [examples/cap-svc](./examples/cap-svc)
4. **Type Mappings**: See README.md
5. **OData Features**: See README.md

## Common Issues

**"JWT token is invalid"**
→ Verify public key is configured in Snowflake

**"Object does not exist"**
→ Check database/schema names, ensure tables exist

**"Insufficient privileges"**
→ Grant SELECT, INSERT, UPDATE, DELETE on tables to your role

See [README.md](./README.md#troubleshooting) for more troubleshooting tips.

