# Schema Import - Reverse Engineering from Snowflake

Import existing Snowflake tables and views as CDS entities.

## Overview

The schema import feature introspects your Snowflake database and automatically generates CDS model definitions from existing tables and views. This is perfect for:

- Integrating CAP with existing Snowflake databases
- Generating initial CDS models without manual typing
- Keeping CDS models synchronized with database schema

## Quick Start

```bash
# Import from configured schema
npx cap-snowflake-import

# Import specific schema
npx cap-snowflake-import --schema=MY_SCHEMA --output=db/imported.cds

# Custom namespace
npx cap-snowflake-import --namespace=myapp.snowflake
```

## What Gets Imported

### Tables and Views
- ✅ Table structure (columns, types)
- ✅ Primary keys
- ✅ Foreign keys (as associations)
- ✅ Not null constraints
- ✅ Comments/descriptions
- ✅ Views (marked as @readonly)

### Data Type Mapping
All Snowflake types are automatically mapped to CDS types:

| Snowflake | CDS |
|-----------|-----|
| VARCHAR(n) | String(n) |
| TEXT | LargeString |
| NUMBER(p,s) | Decimal(p,s) / Integer |
| BOOLEAN | Boolean |
| DATE | Date |
| TIMESTAMP_NTZ | DateTime |
| VARIANT | Json |
| ARRAY | Array |

### Naming Conventions
- **Tables**: `USER_PROFILES` → `entity UserProfiles`
- **Columns**: `FIRST_NAME` → `firstName`
- **Foreign Keys**: Converted to associations

## CLI Usage

### Basic Command

```bash
npx cap-snowflake-import [options]
```

### Options

| Option | Description | Default |
|--------|-------------|---------|
| `--schema=NAME` | Schema to introspect | From cds.env |
| `--output=PATH` | Output file path | `db/schema.cds` |
| `--namespace=NAME` | CDS namespace | `imported` |
| `--help, -h` | Show help | - |

### Examples

#### Import Production Schema
```bash
npx cap-snowflake-import \
  --schema=PROD_SCHEMA \
  --output=db/prod-schema.cds \
  --namespace=production
```

#### Import Multiple Schemas
```bash
# Import main schema
npx cap-snowflake-import \
  --schema=MAIN \
  --output=db/main.cds \
  --namespace=main

# Import reference data
npx cap-snowflake-import \
  --schema=REF_DATA \
  --output=db/reference.cds \
  --namespace=reference
```

## Generated CDS Model

### Example Input (Snowflake)

```sql
CREATE TABLE BOOKS (
  ID VARCHAR(36) PRIMARY KEY,
  TITLE VARCHAR(100) NOT NULL,
  AUTHOR_ID VARCHAR(36),
  PRICE NUMBER(10,2),
  STOCK INTEGER,
  CREATED_AT TIMESTAMP_NTZ
);

CREATE TABLE AUTHORS (
  ID VARCHAR(36) PRIMARY KEY,
  NAME VARCHAR(100) NOT NULL,
  COUNTRY VARCHAR(2)
);

ALTER TABLE BOOKS ADD CONSTRAINT FK_AUTHOR 
  FOREIGN KEY (AUTHOR_ID) REFERENCES AUTHORS(ID);
```

### Generated Output (CDS)

```cds
namespace imported;

// Auto-generated from Snowflake schema
// Generated: 2024-10-24T10:30:00.000Z

entity Books {
  key id : String(36);
  title : String(100) @mandatory;
  authorId : Association to Authors;
  price : Decimal(10, 2);
  stock : Integer;
  createdAt : DateTime;
}

entity Authors {
  key id : String(36);
  name : String(100) @mandatory;
  country : String(2);
}
```

## Programmatic Usage

You can also use the introspection API programmatically:

```typescript
import { SnowflakeSchemaIntrospector, generateCDSModel } from 'cap-snowflake/dist/introspect/schema';
import { getSnowflakeConfig } from 'cap-snowflake/dist/config';

// Get credentials
const config = getSnowflakeConfig();

// Create introspector
const introspector = new SnowflakeSchemaIntrospector(config.credentials);
await introspector.connect();

// Introspect schema
const schemaDefinition = await introspector.introspectSchema('MY_SCHEMA');

// Generate CDS model
const cdsModel = generateCDSModel(schemaDefinition, 'myapp');

console.log(cdsModel);

// Disconnect
await introspector.disconnect();
```

## Post-Import Steps

After generating the CDS model:

### 1. Review Generated Model

Check for:
- Correct type mappings
- Missing relationships
- Business logic requirements

### 2. Add Annotations

Enhance with CAP annotations:

```cds
entity Books {
  key id : String(36);
  
  @title: 'Book Title'
  title : String(100) @mandatory;
  
  @UI.Hidden
  authorId : Association to Authors;
  
  @Measures.ISOCurrency: currency
  price : Decimal(10, 2);
  
  currency : String(3) default 'USD';
  
  @readonly
  stock : Integer;
}
```

### 3. Define Services

Expose entities through services:

```cds
using { imported } from './db/schema';

service CatalogService {
  @readonly entity Books as projection on imported.Books;
  @readonly entity Authors as projection on imported.Authors;
}
```

### 4. Add Custom Logic

Implement handlers:

```javascript
module.exports = function() {
  this.before('READ', 'Books', async (req) => {
    // Add custom filtering
  });
  
  this.after('READ', 'Books', (books) => {
    // Enrich data
  });
};
```

## Advanced Features

### Selective Import

Import only specific tables by filtering after introspection:

```typescript
const schemaDefinition = await introspector.introspectSchema('MY_SCHEMA');

// Filter to specific tables
const filteredTables = new Map(
  Array.from(schemaDefinition.tables.entries())
    .filter(([name]) => name.startsWith('PRODUCT_'))
);

const cdsModel = generateCDSModel({ tables: filteredTables }, 'products');
```

### Custom Name Mapping

Override default naming conventions:

```typescript
// After generation, use search/replace or custom logic
let cdsModel = generateCDSModel(schemaDefinition, 'imported');
cdsModel = cdsModel.replace(/entity (\w+)/g, (match, name) => {
  return `entity My${name}`;
});
```

### Incremental Updates

Re-import schema periodically to detect changes:

```bash
# Run weekly to catch schema changes
npx cap-snowflake-import --output=db/schema-new.cds

# Diff against existing
diff db/schema.cds db/schema-new.cds
```

## Limitations

1. **Complex Types**: OBJECT and nested ARRAY types generate basic CDS equivalents
2. **Computed Columns**: Not introspected (views show computed results)
3. **Constraints**: Snowflake CHECK constraints not converted to CDS validations
4. **Sequences**: AUTOINCREMENT/SEQUENCE not detected
5. **Partitioning**: Clustering and partitioning metadata not included

## Troubleshooting

### "Schema name is required"
→ Specify schema: `--schema=MY_SCHEMA` or configure in package.json

### "Insufficient privileges"
```sql
GRANT USAGE ON SCHEMA MY_SCHEMA TO ROLE MY_ROLE;
GRANT SELECT ON ALL TABLES IN SCHEMA MY_SCHEMA TO ROLE MY_ROLE;
GRANT SELECT ON ALL VIEWS IN SCHEMA MY_SCHEMA TO ROLE MY_ROLE;
```

### "Could not retrieve primary keys"
→ Snowflake table created without constraints. Add manually to CDS:
```cds
entity MyTable {
  key id : String;  // Add 'key' manually
  // ...
}
```

### "Could not retrieve foreign keys"
→ Snowflake FKs may not be defined. Add associations manually:
```cds
entity Orders {
  customerId : Association to Customers;
}
```

## Best Practices

1. **Version Control**: Commit generated CDS files to track schema changes
2. **Separate Files**: Use different files for different schemas
3. **Documentation**: Add comments to generated models explaining business context
4. **Validation**: Always review generated models before deploying
5. **Namespaces**: Use meaningful namespaces to organize imported entities
6. **CI/CD**: Automate schema imports in build pipelines for consistency

## Example Workflow

```bash
# 1. Import schema
npx cap-snowflake-import --schema=PROD_DATA --namespace=production

# 2. Review generated file
cat db/schema.cds

# 3. Create service
cat > srv/data-service.cds << 'EOF'
using { production } from '../db/schema';

service DataService {
  entity Products as projection on production.Products;
  entity Orders as projection on production.Orders;
}
EOF

# 4. Test
cds serve

# 5. Query
curl http://localhost:4004/data/Products
```

## See Also

- [Type Mappings](../README.md#type-mappings)
- [Identifier Handling](../README.md#identifier-handling)
- [Setup Guide](./SETUP_GUIDE.md)

