# CAP Database Annotations Support

Complete reference for CAP annotations supported by the Snowflake adapter.

## Overview

This document details how the Snowflake adapter handles CAP/CDS annotations at the database level, ensuring full compliance with CAP standards similar to @cap-js/postgres, @cap-js/sqlite, and @cap-js/hana.

---

## Persistence Annotations

### @cds.persistence.skip

**Purpose**: Skip database artifact creation (runtime-only entity/view)

**Support**: ✅ Full

```cds
@cds.persistence.skip
entity BooksFromYear2000 as projection on Books {
   id, title as name
} where year = 2000;
```

**Implementation**: Adapter skips DDL generation; queries resolved at runtime.

---

### @cds.persistence.exists

**Purpose**: Indicate that database object already exists

**Support**: ✅ Full

```cds
annotate localized.ExistingEntity with @cds.persistence.exists: true;
```

**Implementation**: Adapter skips CREATE TABLE/VIEW; assumes object exists in Snowflake.

---

### @cds.persistence.table

**Purpose**: Custom database table name

**Support**: ✅ Full

```cds
@cds.persistence.table
entity Books { ... }
```

**Implementation**: Honors custom table names during SQL generation.

---

### @cds.persistence.name

**Purpose**: Custom database column or table name

**Support**: ✅ Full

```cds
entity Books {
  @cds.persistence.name: 'BOOK_TITLE'
  title : String;
}

@cds.persistence.name: '"MyBooks"'
entity MyBooks { ... }
```

**Implementation**: Maps CDS names to Snowflake identifiers; handles quoting.

---

### @cds.persistence.journal

**Purpose**: Use journal/migration table format (HANA-specific)

**Support**: ⚠️ Documented (N/A for Snowflake)

```cds
@cds.persistence.journal
entity Books { ... }
```

**Implementation**: Annotation recognized but not enforced (Snowflake doesn't have .hdbmigrationtable concept).

---

## Entity Capability Annotations

### @readonly

**Purpose**: Read-only entity (no INSERT/UPDATE/DELETE)

**Support**: ✅ Full

```cds
@readonly
entity BooksView as projection on Books;
```

**Implementation**: Service layer blocks write operations; enforced at CAP runtime.

---

### @insertonly

**Purpose**: Insert-only entity (no UPDATE/DELETE)

**Support**: ✅ Full

```cds
@insertonly
entity Orders as projection on my.Orders;
```

**Implementation**: Service layer blocks UPDATE/DELETE; enforced at CAP runtime.

---

### @open

**Purpose**: Open type (allow additional properties)

**Support**: ⚠️ Partial (OData metadata only)

```cds
@open
entity Products {
    key productId : Int32;
}
```

**Implementation**: Generates OpenType="true" in EDMX; dynamic properties not persisted automatically.

---

## Validation Annotations

### @mandatory

**Purpose**: Required field (NOT NULL constraint + input validation)

**Support**: ✅ Full

```cds
entity Books {
  title  : String @mandatory;
}
```

**Implementation**:
- DDL: `title VARCHAR(5000) NOT NULL`
- Runtime: CAP validates non-empty values

---

### @assert.target

**Purpose**: Validate foreign key target exists

**Support**: ✅ Full

```cds
entity Books {
  author : Association to Authors @assert.target;
}
```

**Implementation**: Runtime validates referenced entity exists before INSERT/UPDATE.

---

### @assert.integrity

**Purpose**: Database-level referential integrity

**Support**: ⚠️ Documented (Snowflake limitations)

```cds
entity Books {
  author : Association to Authors @assert.integrity;
}
```

**Implementation**: 
- DDL generates FOREIGN KEY constraint
- **Note**: Snowflake doesn't enforce FK constraints; they're metadata only

---

### @assert.range

**Purpose**: Value range constraints

**Support**: ✅ Full (runtime validation)

```cds
entity Foo {
  bar : Integer @assert.range: [0, 100];
  car : DateTime @assert.range: ['2018-10-31', '2019-01-15'];
}
```

**Implementation**: Runtime validates values are within range; returns 400 if violated.

---

### @assert.format

**Purpose**: Regex pattern validation

**Support**: ✅ Full (runtime validation)

```cds
@assert.format: '/^\S+@\S+\.\S+$/'
@assert.format.message: 'Provide a valid email address'
entity Person {
  email : String;
}
```

**Implementation**: Runtime validates string matches pattern.

---

## Temporal Data Annotations

### @cds.valid.from / @cds.valid.to

**Purpose**: Application-time temporal data (time slices)

**Support**: Fully Implemented

```cds
entity WorkAssignments {
  start : Date @cds.valid.from;
  end   : Date @cds.valid.to;
}

// OR use aspect
using { temporal } from '@sap/cds/common';
entity WorkAssignments : temporal { ... }
```

**Implementation**: 
- DDL: Creates composite primary key (ID, validFrom)
- Runtime: Automatic filtering for current time slice
- Time-travel queries supported
- Current view generation
- **Status**: Fully implemented (v1.0)

---

## Localization Annotations

### localized

**Purpose**: Localized text fields

**Support**: Fully Implemented

```cds
entity Books {
  title : localized String;
  description : localized String;
}
```

**Implementation**:
- Generates Books_texts table with locale key (locale, ID as composite PK)
- Creates localized_Books view with COALESCE fallback
- SESSION_PARAMETER for locale detection
- Compatible with CAP i18n patterns
- **Status**: Fully implemented (v1.0)

---

## Managed Aspects

### cuid (Canonical Universal ID)

**Purpose**: UUID key with automatic generation

**Support**: ✅ Full

```cds
using { cuid } from '@sap/cds/common';
entity Books : cuid { ... }

// Expands to:
entity Books {
  key ID : UUID;
}
```

**Implementation**: CAP runtime generates UUIDs on INSERT.

---

### managed (Audit Fields)

**Purpose**: Automatic audit timestamps and users

**Support**: ✅ Full

```cds
using { managed } from '@sap/cds/common';
entity Books : managed { ... }

// Expands to:
entity Books {
  createdAt : Timestamp;
  createdBy : String(111);
  modifiedAt : Timestamp;
  modifiedBy : String(111);
}
```

**Implementation**: CAP runtime auto-fills on INSERT/UPDATE.

---

### temporal (Time Slices)

**Purpose**: Application-time temporal entity

**Support**: ⚠️ Roadmap

```cds
using { temporal } from '@sap/cds/common';
entity WorkAssignments : temporal { ... }

// Expands to:
entity WorkAssignments {
  validFrom : Timestamp @cds.valid.from;
  validTo   : Timestamp @cds.valid.to;
}
```

---

## Virtual and Calculated Elements

### Virtual Elements

**Purpose**: Transient elements (not persisted)

**Support**: ✅ Full

```cds
entity Books {
  title : String;
  virtual calculated : String;
}
```

**Implementation**: Excluded from DDL; values provided at runtime by custom handlers.

---

### Calculated Elements

**Purpose**: Computed fields with expressions

**Support**: ⚠️ Partial (simple expressions)

```cds
entity Books {
  price : Decimal;
  tax : Decimal = price * 0.1;
}
```

**Implementation**: 
- Simple expressions: computed at runtime
- Complex expressions: may require custom implementation
- **Status**: Basic support (v1.0), enhanced support (v1.1+)

---

## Draft Annotations

### @odata.draft.enabled

**Purpose**: Enable draft support for entity

**Support**: ✅ Full (via CAP runtime)

```cds
@odata.draft.enabled
entity Books { ... }
```

**Implementation**: 
- CAP generates Books.drafts table
- Adapter handles drafts table as regular entity
- Draft lifecycle managed by CAP runtime

---

## API Annotations

### @cds.api.ignore

**Purpose**: Omit element from OData/OpenAPI

**Support**: ✅ Full (via CAP)

```cds
entity Books {
  @cds.api.ignore
  internalField : String;
}
```

**Implementation**: Element excluded from OData metadata; persisted in database.

---

## Composition and Association Annotations

### Composition

**Support**: ✅ Full

```cds
entity Orders {
  items : Composition of many OrderItems;
}
```

**Implementation**: 
- Cascading DELETE operations
- Deep insert/update support
- Foreign key generation

---

### Association (Managed)

**Support**: ✅ Full

```cds
entity Books {
  author : Association to Authors;
  // Generates: author_ID foreign key
}
```

**Implementation**: 
- Automatic foreign key generation
- Join resolution for $expand
- @assert.target validation support

---

### Association (Unmanaged)

**Support**: ✅ Full

```cds
entity Books {
  author : Association to Authors on author.ID = authorId;
  authorId : UUID;
}
```

**Implementation**: Uses explicit ON condition; no automatic FK generation.

---

## Annotation Inheritance

### Composition of Aspects

**Support**: ✅ Full

```cds
aspect OrderItems {
  key pos : Integer;
  product : Association to Products;
}

entity Orders {
  Items : Composition of many OrderItems;
}
```

**Implementation**: Generates Orders.Items table/entity with aspect elements.

---

## Snowflake-Specific Extensions

### Clustering Hints

**Purpose**: Performance optimization

**Support**: 🔮 Future (v2.0+)

```cds
@snowflake.cluster: ['created_at', 'author_id']
entity Books { ... }
```

**Proposed**: Generate `CLUSTER BY (created_at, author_id)` in DDL.

---

### Time Travel

**Purpose**: Query historical data

**Support**: 🔮 Future (v2.0+)

```cds
// Proposed API
const books = await SELECT.from('Books')
  .at(timestamp: '2024-01-01T00:00:00Z');
```

**Proposed**: Use Snowflake's `AT(TIMESTAMP => ...)` syntax.

---

## Annotation Precedence

When multiple annotations apply:

1. **Most Specific Wins**: Element annotation > Entity annotation > Service annotation
2. **Runtime vs DDL**: Some annotations (like @mandatory) affect both DDL (NOT NULL) and runtime validation
3. **CAP Managed**: Annotations like `cuid`, `managed` are expanded by CAP before reaching the adapter

---

## Unsupported Features

### Not Applicable to Snowflake

| Annotation | Reason |
|------------|--------|
| @cds.persistence.journal | HANA-specific concept |
| Native HANA associations | Snowflake uses standard SQL foreign keys |

### Planned for Future Releases

| Feature | Target Version | Notes |
|---------|---------------|-------|
| Full temporal data support | v1.1 | Time slices, time-travel queries |
| Localized entity generation | v1.1 | .texts tables and views |
| Complex calculated elements | v1.1 | Expression engine enhancement |
| Snowflake-specific hints | v2.0 | Clustering, caching, time travel |

---

## Best Practices

### 1. Use Standard Aspects

```cds
using { cuid, managed } from '@sap/cds/common';

entity Books : cuid, managed {
  title : String @mandatory;
  author : Association to Authors @assert.target;
}
```

**Why**: Portable across all CAP database adapters.

---

### 2. Explicit Table Names for Mixed-Case

```cds
@cds.persistence.name: '"MixedCaseTable"'
entity MixedCaseTable { ... }
```

**Why**: Ensures consistent case handling in Snowflake.

---

### 3. Runtime Validation Over DB Constraints

```cds
entity Books {
  price : Decimal @assert.range: [0, 1000];  // Preferred
  // vs. CHECK constraint in DB
}
```

**Why**: Snowflake CHECK constraints have limitations; runtime validation is more flexible.

---

### 4. Virtual Elements for Computed Data

```cds
entity Books {
  price : Decimal;
  virtual priceWithTax : Decimal;
}

// In handler:
this.after('READ', 'Books', (books) => {
  books.forEach(book => {
    book.priceWithTax = book.price * 1.1;
  });
});
```

**Why**: More flexible than database computed columns.

---

## Testing Annotations

```javascript
// Test @mandatory
const { expect } = require('chai');

it('should enforce @mandatory', async () => {
  await expect(
    INSERT.into('Books').entries({ price: 10 })
  ).to.be.rejectedWith(/title.*mandatory/i);
});

// Test @assert.target
it('should validate @assert.target', async () => {
  await expect(
    INSERT.into('Books').entries({
      title: 'Test',
      author_ID: 'non-existent-id'
    })
  ).to.be.rejectedWith(/doesn't exist/i);
});

// Test @readonly
it('should enforce @readonly', async () => {
  await expect(
    UPDATE('BooksView').set({ title: 'New' })
  ).to.be.rejectedWith(/read-only/i);
});
```

---

## Migration Guide

### From Other CAP Database Adapters

Most annotations work identically. Key differences:

| Feature | PostgreSQL | SQLite | HANA | Snowflake |
|---------|-----------|--------|------|-----------|
| Foreign Keys | Enforced | Enforced | Enforced | Metadata only ⚠️ |
| Localized | ✅ | ✅ | ✅ | 🔮 Roadmap |
| Temporal | ✅ | ✅ | ✅ | 🔮 Roadmap |
| JSON/VARIANT | JSONB | JSON | NCLOB | VARIANT ✅ |
| Arrays | ARRAY | - | - | ARRAY ✅ |

---

## See Also

- [CAP Common Types and Aspects](https://cap.cloud.sap/docs/cds/common)
- [CAP Providing Services](https://cap.cloud.sap/docs/guides/providing-services)
- [CAP Temporal Data](https://cap.cloud.sap/docs/guides/temporal-data)
- [CAP Localized Data](https://cap.cloud.sap/docs/guides/localized-data)
- [Snowflake Type Mapping](../README.md#type-mappings)

---

**Last Updated**: October 24, 2024  
**Version**: 1.0.0


