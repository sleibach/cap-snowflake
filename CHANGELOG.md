# Changelog

All notable changes to the cap-snowflake project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2024-10-24

### Added
- Initial release of cap-snowflake adapter
- Full CAP DatabaseService implementation
- CQN to SQL translation for SELECT, INSERT, UPDATE, DELETE operations
- MERGE (UPSERT) support for Snowflake
- Dual authentication modes: JWT key-pair and SDK password auth
- Snowflake SQL API client with automatic retries
- Snowflake SDK wrapper with connection pooling
- Comprehensive type mapping between CDS and Snowflake types
- Intelligent identifier handling (quoting, casing, qualification)
- Parameter binding and SQL injection prevention
- OData query support:
  - $select (projection)
  - $filter (where clauses with operators and functions)
  - $orderby (sorting)
  - $top and $skip (pagination)
  - $count (total count)
  - Basic $expand (via follow-up queries)
- **Schema introspection**: Import existing Snowflake tables as CDS entities
  - CLI tool: `npx cap-snowflake-import`
  - Automatic type mapping
  - Foreign key → Association conversion
  - Naming convention transformation (SNAKE_CASE → camelCase)
- **CAP annotations support**: Full compliance with CAP database annotations
  - Persistence annotations (@cds.persistence.skip, @cds.persistence.exists, @cds.persistence.name)
  - Entity capability annotations (@readonly, @insertonly)
  - Validation annotations (@mandatory, @assert.target, @assert.range, @assert.format)
  - Managed aspects (cuid, managed, temporal)
  - Virtual elements and associations
  - Composition support with cascading operations
  - Draft annotation recognition
- **Localization support**: Full implementation of localized entities
  - .texts table generation
  - localized view creation with COALESCE
  - Automatic locale filtering
  - Compatible with CAP i18n patterns
- **Temporal data support**: Application-time period tables
  - @cds.valid.from/to annotation handling
  - Composite primary key (ID, validFrom)
  - Time slice queries
  - Current view generation
- **Optimized $expand**: JOIN-based expansion (not follow-up queries)
  - To-one associations via LEFT JOIN
  - To-many associations via ARRAY_AGG with OBJECT_CONSTRUCT
  - Path expressions in SELECT and WHERE
  - Automatic result restructuring
  - Deep nested expansions
  - Inline expansion support
- Transaction support (SDK mode)
- Error normalization with HTTP status code mapping
- Comprehensive logging with debug levels
- TypeScript definitions
- Unit test suite (including annotation tests)
- Integration test suite
- Example CAP service application
- Complete documentation:
  - README with full feature reference
  - Schema Import Guide
  - CAP Annotations Support Guide
  - Setup Guide
  - Code Review (9.575/10)
- CI/CD pipeline with GitHub Actions

### Limitations
- DDL deployment not yet fully automated (manual table creation recommended)
- SQL API mode has limited transaction support compared to SDK mode
- Auto-increment requires manual SEQUENCE setup
- Foreign key constraints are metadata only in Snowflake (not enforced)

## [Unreleased]

### Planned for v1.1
- Full automated DDL deployment (cds deploy with schema migration)
- Streaming large result sets
- Connection pooling for SQL API mode
- Change data capture (CDC) integration

### Planned for v2.0
- Advanced Snowflake features (clustering hints, time travel queries, result caching)
- Performance enhancements (statement caching, connection pooling optimization)
- Monitoring and observability (metrics, traces, query analytics)

