# $expand Support

Complete guide for navigating associations and compositions using $expand.

## Overview

The Snowflake adapter implements efficient $expand handling using SQL JOINs and Snowflake's JSON aggregation functions, matching the behavior of @cap-js/postgres, @cap-js/sqlite, and @cap-js/hana.

## Expand Strategies

### To-One Associations (LEFT JOIN)

For managed to-one associations, the adapter generates a single SQL query with LEFT JOIN:

**CDS Model**:
```cds
entity Books {
  key ID : UUID;
  title : String;
  author : Association to Authors;  // Managed to-one
}

entity Authors {
  key ID : UUID;
  name : String;
  country : String;
}
```

**OData Query**:
```http
GET /catalog/Books?$expand=author
```

**Generated SQL**:
```sql
SELECT 
  base.ID,
  base.title,
  base.author_ID,
  expand_0.ID AS author_ID,
  expand_0.name AS author_name,
  expand_0.country AS author_country
FROM TEST_DB.TEST_SCHEMA.BOOKS AS base
LEFT JOIN TEST_DB.TEST_SCHEMA.AUTHORS AS expand_0 
  ON base.author_ID = expand_0.ID
```

**Result Structure**:
```json
[{
  "ID": "book-1",
  "title": "Test Book",
  "author_ID": "author-1",
  "author": {
    "ID": "author-1",
    "name": "John Doe",
    "country": "US"
  }
}]
```

### To-Many Associations (ARRAY_AGG)

For to-many associations, the adapter uses Snowflake's ARRAY_AGG with OBJECT_CONSTRUCT:

**CDS Model**:
```cds
entity Authors {
  key ID : UUID;
  name : String;
  books : Association to many Books on books.author = $self;
}
```

**OData Query**:
```http
GET /catalog/Authors?$expand=books
```

**Generated SQL**:
```sql
SELECT 
  base.ID,
  base.name,
  ARRAY_AGG(
    OBJECT_CONSTRUCT(
      'ID', books.ID,
      'title', books.title,
      'price', books.price
    )
  ) AS books
FROM TEST_DB.TEST_SCHEMA.AUTHORS AS base
LEFT JOIN TEST_DB.TEST_SCHEMA.BOOKS AS books 
  ON books.author_ID = base.ID
GROUP BY base.ID, base.name
```

**Result Structure**:
```json
[{
  "ID": "author-1",
  "name": "John Doe",
  "books": [
    { "ID": "book-1", "title": "First Book", "price": 19.99 },
    { "ID": "book-2", "title": "Second Book", "price": 29.99 }
  ]
}]
```

## Selective Expansion

### Specify Columns to Expand

```http
GET /catalog/Books?$expand=author($select=name,country)
```

**Generated SQL**:
```sql
SELECT 
  base.*,
  expand_0.name AS author_name,
  expand_0.country AS author_country
FROM BOOKS AS base
LEFT JOIN AUTHORS AS expand_0 ON base.author_ID = expand_0.ID
```

### Expand with Filter

```http
GET /catalog/Authors?$expand=books($filter=price lt 50)
```

**Generated SQL**:
```sql
SELECT 
  base.*,
  ARRAY_AGG(
    OBJECT_CONSTRUCT('ID', books.ID, 'title', books.title)
  ) AS books
FROM AUTHORS AS base
LEFT JOIN BOOKS AS books 
  ON books.author_ID = base.ID 
  AND books.price < 50
GROUP BY base.ID, base.name
```

### Expand with Ordering

```http
GET /catalog/Authors?$expand=books($orderby=title asc)
```

The adapter orders child records within each group before aggregation.

## Multiple Expansions

```http
GET /catalog/Books?$expand=author,publisher,genre
```

**Generated SQL**:
```sql
SELECT 
  base.*,
  author.name AS author_name,
  publisher.name AS publisher_name,
  genre.name AS genre_name
FROM BOOKS AS base
LEFT JOIN AUTHORS AS author ON base.author_ID = author.ID
LEFT JOIN PUBLISHERS AS publisher ON base.publisher_ID = publisher.ID
LEFT JOIN GENRES AS genre ON base.genre_ID = genre.ID
```

## Deep (Nested) Expansion

```http
GET /catalog/Books?$expand=author($expand=country)
```

**CQN Equivalent**:
```javascript
SELECT.from('Books', b => {
  b.ID, b.title,
  b.author(a => {
    a.name,
    a.country(c => {
      c.name
    })
  })
})
```

**Generated SQL** (multiple JOINs):
```sql
SELECT 
  base.*,
  author.ID AS author_ID,
  author.name AS author_name,
  country.name AS author_country_name
FROM BOOKS AS base
LEFT JOIN AUTHORS AS author ON base.author_ID = author.ID
LEFT JOIN COUNTRIES AS country ON author.country_code = country.code
```

## Path Expressions

### In SELECT Clause

```javascript
const books = await SELECT.from('Books')
  .columns('title', 'author.name as authorName');
```

**Generated SQL**:
```sql
SELECT 
  base.title,
  author.name AS authorName
FROM BOOKS AS base
LEFT JOIN AUTHORS AS author ON base.author_ID = author.ID
```

### In WHERE Clause

```javascript
const books = await SELECT.from('Books')
  .where({ 'author.country.code': 'US' });
```

**Generated SQL**:
```sql
SELECT base.*
FROM BOOKS AS base
INNER JOIN AUTHORS AS author ON base.author_ID = author.ID
INNER JOIN COUNTRIES AS country ON author.country_code = country.code
WHERE country.code = ?
```

Note: Path expressions in WHERE use INNER JOIN (not LEFT) to ensure proper filtering.

## Compositions

### Expand Composition

```cds
entity Orders {
  key ID : UUID;
  items : Composition of many OrderItems;
}

entity OrderItems {
  key ID : UUID;
  product : Association to Products;
  quantity : Integer;
}
```

```http
GET /catalog/Orders?$expand=items
```

**Behavior**: Same as to-many Association, uses ARRAY_AGG.

### Deep Composition Expand

```http
GET /catalog/Orders?$expand=items($expand=product)
```

Expands composition and nested associations in single query chain.

## Inline Expansion

Flatten associated fields into parent:

```javascript
const books = await SELECT.from('Books', b => {
  b.ID,
  b.title,
  b.author(a => {
    a.name,
    a.country
  }).inline()  // Flatten instead of nesting
});
```

**Result Structure**:
```json
[{
  "ID": "book-1",
  "title": "Test Book",
  "author_name": "John Doe",
  "author_country": "US"
}]
```

## Performance Optimizations

### Single Query Execution

All to-one expansions are resolved in one SQL query:

```http
GET /catalog/Books?$expand=author,publisher,genre
```

Result: 1 SQL query with 3 LEFT JOINs

### Indexed Foreign Keys

Ensure foreign keys are indexed for JOIN performance:

```sql
CREATE INDEX idx_books_author ON BOOKS(author_ID);
CREATE INDEX idx_books_publisher ON BOOKS(publisher_ID);
CREATE INDEX idx_books_genre ON BOOKS(genre_ID);
```

### Avoid N+1 Queries

The adapter batches to-many expansions:

**Before (N+1 pattern)**:
```
SELECT * FROM AUTHORS;           -- 1 query
SELECT * FROM BOOKS WHERE author_ID = 'a1';  -- N queries
SELECT * FROM BOOKS WHERE author_ID = 'a2';
...
```

**After (optimized)**:
```
SELECT AUTHORS.*, ARRAY_AGG(...) AS books
FROM AUTHORS
LEFT JOIN BOOKS ON ...
GROUP BY AUTHORS.ID;              -- 1 query
```

## Limitations and Workarounds

### Snowflake-Specific Constraints

**1. OBJECT_CONSTRUCT requires Snowflake Standard edition or higher**

If using Snowflake Essentials:
```javascript
// Fallback: Manual column mapping
const result = await db.run(sql);
// Post-process manually instead of using OBJECT_CONSTRUCT
```

**2. ARRAY_AGG with large datasets**

For tables with millions of related records, consider pagination:

```http
GET /catalog/Authors?$expand=books($top=100)
```

Or use separate queries for very large expansions.

### Circular References

The adapter detects and prevents infinite expansion loops:

```cds
entity Authors {
  books : Association to many Books on books.author = $self;
}
entity Books {
  author : Association to Authors;
}
```

```http
GET /catalog/Authors?$expand=books($expand=author($expand=books...))
```

Maximum depth: 5 levels (configurable)

## Unmanaged Associations

For associations with explicit ON conditions:

```cds
entity Books {
  author : Association to Authors on author.ID = authorId;
  authorId : UUID;
}
```

The adapter translates the ON condition into the JOIN clause:

```sql
LEFT JOIN AUTHORS AS author ON author.ID = base.authorId
```

## Comparison with Other Adapters

| Feature | PostgreSQL | SQLite | HANA | Snowflake |
|---------|-----------|--------|------|-----------|
| To-one JOIN | Yes | Yes | Yes | Yes |
| To-many Aggregation | JSON_AGG | JSON_GROUP_ARRAY | STRING_AGG | ARRAY_AGG |
| Nested Objects | JSON functions | JSON functions | NCLOB parse | OBJECT_CONSTRUCT |
| Deep Expand | Yes | Yes | Yes | Yes |
| Path Expressions | Yes | Yes | Yes | Yes |

**Result**: Feature parity with official adapters.

## Testing

```javascript
describe('$expand', () => {
  it('should expand to-one association', async () => {
    const books = await SELECT.from('Books', b => {
      b.ID, b.title,
      b.author(a => a.name, a.country)
    });

    expect(books[0].author).to.exist;
    expect(books[0].author.name).to.equal('John Doe');
  });

  it('should expand to-many association', async () => {
    const authors = await SELECT.from('Authors', a => {
      a.ID, a.name,
      a.books(b => b.title, b.price)
    });

    expect(authors[0].books).to.be.an('array');
    expect(authors[0].books).to.have.lengthOf(2);
  });

  it('should handle deep expansion', async () => {
    const books = await SELECT.from('Books', b => {
      b.title,
      b.author(a => {
        a.name,
        a.country(c => c.name)
      })
    });

    expect(books[0].author.country.name).to.equal('United States');
  });
});
```

## Best Practices

**1. Limit Expansion Depth**

```http
GET /catalog/Books?$expand=author  -- Good: Single level
```

Avoid excessive nesting which can impact performance.

**2. Select Specific Columns**

```http
GET /catalog/Books?$expand=author($select=name)  -- Good: Specific columns
```

Better than expanding all columns when only a few are needed.

**3. Use Inline for Flattening**

```javascript
// When you need flat structure, use inline instead of expand
const books = await SELECT.from('Books', b => {
  b.title,
  b.author(a => a.name).inline()  // Flattened as author_name
});
```

**4. Index Foreign Keys**

Always index foreign key columns for JOIN performance.

**5. Paginate To-Many**

For large child collections, use $top:

```http
GET /catalog/Authors?$expand=books($top=10;$orderby=publishDate desc)
```

## See Also

- [OData $expand specification](http://docs.oasis-open.org/odata/odata/v4.01/odata-v4.01-part2-url-conventions.html#sec_SystemQueryOptionexpand)
- [CAP Associations and Compositions](https://cap.cloud.sap/docs/cds/cdl#associations)
- [Snowflake JOIN Documentation](https://docs.snowflake.com/en/sql-reference/constructs/join)

---

**Version**: 1.0.0  
**Status**: Fully Implemented  
**Last Updated**: October 24, 2024

