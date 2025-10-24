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
- Transaction support (SDK mode)
- Error normalization with HTTP status code mapping
- Comprehensive logging with debug levels
- TypeScript definitions
- Unit test suite
- Integration test suite
- Example CAP service application
- Complete documentation and README
- CI/CD pipeline with GitHub Actions

### Limitations
- DDL deployment not yet implemented (manual table creation required)
- Complex $expand uses multiple queries instead of JOINs
- SQL API mode has limited transaction support
- Auto-increment requires manual SEQUENCE setup

## [Unreleased]

### Planned
- Full DDL deployment support (cds deploy)
- JOIN optimization for $expand
- Streaming large result sets
- Connection pooling for SQL API mode
- Change data capture integration
- Advanced Snowflake features (clustering, time travel, etc.)

