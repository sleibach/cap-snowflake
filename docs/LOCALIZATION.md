# Localization Support

Complete guide for using localized entities with the Snowflake adapter.

## Overview

The Snowflake adapter implements CAP's localization pattern, enabling multi-language support for text fields. This follows the same conventions as @cap-js/postgres, @cap-js/sqlite, and @cap-js/hana.

## Basic Usage

### Define Localized Entity

```cds
entity Books {
  key ID : UUID;
  title : localized String(100);
  description : localized LargeString;
  price : Decimal;  // Not localized
}
```

### Generated Database Schema

The adapter generates two objects:

**1. Main Table** (`BOOKS`):
```sql
CREATE TABLE BOOKS (
  ID VARCHAR(36) PRIMARY KEY,
  title VARCHAR(100),        -- Default language
  description TEXT,          -- Default language
  price NUMBER(10,2)
);
```

**2. Texts Table** (`BOOKS_TEXTS`):
```sql
CREATE TABLE BOOKS_TEXTS (
  locale VARCHAR(14) NOT NULL,   -- Language code (e.g., 'en', 'de', 'fr')
  ID VARCHAR(36) NOT NULL,       -- Foreign key to main table
  title VARCHAR(100),             -- Translated title
  description TEXT,               -- Translated description
  PRIMARY KEY (locale, ID)
);
```

**3. Localized View** (`LOCALIZED_BOOKS`):
```sql
CREATE VIEW LOCALIZED_BOOKS AS
SELECT 
  base.*,
  COALESCE(texts.title, base.title) AS title,
  COALESCE(texts.description, base.description) AS description
FROM BOOKS AS base
LEFT JOIN BOOKS_TEXTS AS texts
  ON base.ID = texts.ID
  AND texts.locale = COALESCE(SESSION_PARAMETER('LOCALE'), 'en');
```

## Querying Localized Data

### Set Locale Context

```sql
-- Set session locale
ALTER SESSION SET LOCALE = 'de';

-- Query returns German text (if available)
SELECT * FROM LOCALIZED_BOOKS;
```

### From CAP Service

The locale is automatically determined from:
1. HTTP Accept-Language header
2. User preferences
3. Default locale ('en')

```javascript
// CAP automatically queries localized_Books view
const books = await SELECT.from('Books');
// Returns text in user's preferred language
```

## Managing Translations

### Insert Default Language

```javascript
// Insert main record with default language (English)
await INSERT.into('Books').entries({
  ID: '123',
  title: 'The Great Adventure',
  description: 'An exciting story...',
  price: 29.99
});
```

### Add Translations

```javascript
// Add German translation
await INSERT.into('Books.texts').entries({
  locale: 'de',
  ID: '123',
  title: 'Das große Abenteuer',
  description: 'Eine spannende Geschichte...'
});

// Add French translation
await INSERT.into('Books.texts').entries({
  locale: 'fr',
  ID: '123',
  title: 'La Grande Aventure',
  description: 'Une histoire passionnante...'
});
```

### Update Translations

```javascript
// Update German translation
await UPDATE('Books.texts')
  .set({ title: 'Das fantastische Abenteuer' })
  .where({ locale: 'de', ID: '123' });
```

### Delete Translations

```javascript
// Delete specific translation
await DELETE.from('Books.texts')
  .where({ locale: 'fr', ID: '123' });

// Delete all translations for a book
await DELETE.from('Books.texts')
  .where({ ID: '123' });
```

## Advanced Patterns

### Fallback Chain

The COALESCE logic provides automatic fallback:
1. User's preferred locale
2. Default language from main table
3. NULL if neither exists

```sql
-- If German translation missing, falls back to English
SELECT title FROM LOCALIZED_BOOKS WHERE ID = '123';
-- Returns: 'The Great Adventure' (if 'de' not available)
```

### Query Specific Locale

```javascript
// Force specific locale
await SELECT.from('Books.texts')
  .where({ locale: 'de' });
```

### Bulk Translations

```javascript
// Insert multiple translations
await INSERT.into('Books.texts').entries([
  { locale: 'de', ID: '123', title: 'Deutsch Titel' },
  { locale: 'fr', ID: '123', title: 'Titre français' },
  { locale: 'es', ID: '123', title: 'Título español' },
]);
```

## Extending TextsAspect

Follow CAP convention for additional fields in all .texts tables:

```cds
using { sap.common.TextsAspect } from '@sap/cds/common';

extend sap.common.TextsAspect with {
  language : Association to sap.common.Languages on language.code = locale;
  translationStatus : String enum { draft; approved; rejected };
}
```

All Books.texts, Authors.texts, etc. will inherit these fields.

## Schema Introspection

When importing existing Snowflake schemas:

```bash
# Import will detect .texts tables automatically
npx cap-snowflake-import --schema=MY_SCHEMA
```

**Detection Rules**:
- Tables ending with `_TEXTS`
- Having `locale` column
- Composite PK including `locale`

Generated CDS will mark fields as `localized`:
```cds
entity Books {
  title : localized String;  // Auto-detected
}
```

## Performance Considerations

### Indexes

Add indexes for better performance:

```sql
-- Index on locale for faster lookups
CREATE INDEX idx_books_texts_locale 
  ON BOOKS_TEXTS(locale);

-- Composite index for joins
CREATE INDEX idx_books_texts_id_locale 
  ON BOOKS_TEXTS(ID, locale);
```

### View Materialization

For frequently accessed localized views:

```sql
-- Create materialized view (Snowflake Enterprise+)
CREATE MATERIALIZED VIEW LOCALIZED_BOOKS_MAT AS
SELECT * FROM LOCALIZED_BOOKS;

-- Refresh periodically
ALTER MATERIALIZED VIEW LOCALIZED_BOOKS_MAT REFRESH;
```

## Limitations

1. **Snowflake SESSION_PARAMETER**: Not all Snowflake editions support custom session parameters
   - **Workaround**: Use application-level locale management

2. **Locale Column Size**: VARCHAR(14) follows CAP convention (language-REGION-variant)
   - Examples: `en`, `en-US`, `de-AT`, `zh-Hans-CN`

3. **No Automatic View Creation**: Views must be created manually or via deploy script
   - Planned for cds deploy in v1.1

## Testing

```javascript
describe('Localized Entities', () => {
  it('should store translations', async () => {
    // Insert main record
    await INSERT.into('Books').entries({
      ID: '1',
      title: 'English Title',
    });

    // Add German translation
    await INSERT.into('Books.texts').entries({
      locale: 'de',
      ID: '1',
      title: 'Deutscher Titel',
    });

    // Query with locale
    const books = await SELECT.from('Books.texts')
      .where({ locale: 'de', ID: '1' });

    expect(books[0].title).to.equal('Deutscher Titel');
  });

  it('should fallback to default language', async () => {
    // Query localized view without German translation
    const books = await SELECT.from('localized_Books')
      .where({ ID: '1' });

    // Falls back to English if German not available
    expect(books[0].title).to.equal('English Title');
  });
});
```

## Migration from Other Adapters

Localized entities work identically across CAP adapters:

```cds
// This model works with postgres, sqlite, hana, and snowflake
entity Books {
  key ID : UUID;
  title : localized String;
}
```

**Database Objects Created**:
- PostgreSQL: `books`, `books_texts`, `localized_books` (view)
- SQLite: `Books`, `Books_texts`, `localized_Books` (view)
- HANA: `BOOKS`, `BOOKS_TEXTS`, `LOCALIZED_BOOKS` (view)
- Snowflake: `BOOKS`, `BOOKS_TEXTS`, `LOCALIZED_BOOKS` (view)

## Best Practices

### 1. Always Provide Default Language

Store default language text in main table:

```javascript
await INSERT.into('Books').entries({
  ID: '123',
  title: 'Default English Title',  // Always set default
});
```

### 2. Use ISO Language Codes

Follow BCP 47 standard:
- `en` - English
- `de` - German
- `fr` - French
- `en-US` - English (United States)
- `de-CH` - German (Switzerland)

### 3. Handle Missing Translations Gracefully

```javascript
this.after('READ', 'Books', (books) => {
  books.forEach(book => {
    if (!book.title) {
      book.title = '[Translation Missing]';
    }
  });
});
```

### 4. Batch Translation Updates

```javascript
// Update multiple translations in one transaction
const tx = cds.transaction();
try {
  await tx.run(INSERT.into('Books.texts').entries(translations));
  await tx.commit();
} catch (error) {
  await tx.rollback();
  throw error;
}
```

## Common Patterns

### Translation Management Service

```cds
service TranslationService {
  entity Books.texts as projection on bookshop.Books.texts;
  
  action importTranslations(locale: String, file: LargeBinary);
  action exportTranslations(locale: String) returns LargeBinary;
}
```

### Translation Status Tracking

```cds
extend sap.common.TextsAspect with {
  status : String enum {
    draft = 'D';
    review = 'R';
    approved = 'A';
  } default 'D';
  translatedBy : String;
  translatedAt : Timestamp;
}
```

## Troubleshooting

### "Table Books_texts does not exist"

**Solution**: Create the .texts table:

```sql
CREATE TABLE BOOKS_TEXTS (
  locale VARCHAR(14) NOT NULL,
  ID VARCHAR(36) NOT NULL,
  title VARCHAR(100),
  description TEXT,
  PRIMARY KEY (locale, ID),
  FOREIGN KEY (ID) REFERENCES BOOKS(ID) ON DELETE CASCADE
);
```

### "Translations not showing"

**Checks**:
1. Verify locale value matches: `SELECT DISTINCT locale FROM BOOKS_TEXTS`
2. Check view definition: `SHOW VIEW LOCALIZED_BOOKS`
3. Verify SESSION_PARAMETER support: `SELECT SESSION_PARAMETER('LOCALE')`

### "Performance issues with localized views"

**Solutions**:
- Add indexes on (ID, locale)
- Use materialized views for read-heavy workloads
- Consider denormalization for specific use cases

## See Also

- [CAP Localized Data Guide](https://cap.cloud.sap/docs/guides/localized-data)
- [CAP Common TextsAspect](https://cap.cloud.sap/docs/cds/common#textsaspect)
- [Annotations Support](./ANNOTATIONS_SUPPORT.md)
- [Type Mappings](../README.md#type-mappings)

---

**Version**: 1.0.0  
**Status**: Fully Implemented  
**Last Updated**: October 24, 2024


