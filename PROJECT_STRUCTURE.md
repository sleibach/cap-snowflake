# cap-snowflake Project Structure

Complete overview of the project structure and key components.

## Directory Tree

```
cap-snowflake/
├── src/                          # Source code (TypeScript)
│   ├── index.ts                  # Entry point, service registration
│   ├── SnowflakeService.ts       # Main service implementation
│   ├── config.ts                 # Configuration parser
│   ├── identifiers.ts            # Identifier quoting/qualification
│   ├── params.ts                 # Parameter binding utilities
│   │
│   ├── auth/                     # Authentication
│   │   └── jwt.ts                # JWT token generation
│   │
│   ├── client/                   # Database clients
│   │   ├── sqlapi.ts             # SQL API HTTP client
│   │   └── sdk.ts                # Snowflake SDK wrapper
│   │
│   ├── cqn/                      # CQN to SQL translation
│   │   ├── toSQL.ts              # Main translator
│   │   ├── filters.ts            # WHERE/HAVING clause translator
│   │   ├── orderby.ts            # ORDER BY translator
│   │   └── pagination.ts         # LIMIT/OFFSET and $count
│   │
│   ├── ddl/                      # DDL and type mapping
│   │   ├── types.ts              # CDS ↔ Snowflake type mapping
│   │   └── deploy.ts             # DDL generation (CREATE TABLE, etc.)
│   │
│   └── utils/                    # Utilities
│       ├── logger.ts             # Logging wrapper
│       └── errors.ts             # Error normalization
│
├── test/                         # Test suite
│   ├── unit/                     # Unit tests
│   │   ├── identifiers.test.ts
│   │   ├── types.test.ts
│   │   ├── cqn-filters.test.ts
│   │   └── cqn-toSQL.test.ts
│   ├── integ/                    # Integration tests
│   │   └── snowflake.test.ts
│   └── mocha.opts                # Test configuration
│
├── examples/                     # Example applications
│   └── cap-svc/                  # Sample CAP service
│       ├── db/schema.cds
│       ├── srv/catalog-service.cds
│       ├── srv/catalog-service.js
│       ├── package.json
│       └── README.md
│
├── docs/                         # Documentation
│   └── SETUP_GUIDE.md            # Detailed setup instructions
│
├── .github/                      # GitHub configuration
│   └── workflows/
│       └── ci.yml                # CI/CD pipeline
│
├── dist/                         # Compiled JavaScript (generated)
│   ├── index.js
│   ├── index.d.ts
│   └── ...
│
├── package.json                  # NPM package configuration
├── tsconfig.json                 # TypeScript configuration
├── .eslintrc.json                # ESLint configuration
├── .gitignore                    # Git ignore rules
├── .npmignore                    # NPM ignore rules
├── README.md                     # Main documentation
├── CHANGELOG.md                  # Version history
├── CONTRIBUTING.md               # Contribution guidelines
└── LICENSE                       # Apache 2.0 license
```

## Key Components

### 1. Service Layer (`SnowflakeService.ts`)

Main service class that:
- Extends `cds.DatabaseService`
- Implements CAP database operations (read, insert, update, delete)
- Routes to appropriate client (SQL API or SDK)
- Manages transactions
- Handles errors

### 2. CQN Translation (`cqn/`)

Converts CAP Query Notation to Snowflake SQL:
- **toSQL.ts**: Main entry point, handles SELECT/INSERT/UPDATE/DELETE/MERGE
- **filters.ts**: Translates $filter expressions with operators and functions
- **orderby.ts**: Translates $orderby clauses
- **pagination.ts**: Handles $top, $skip, and $count

### 3. Clients (`client/`)

Two database connectivity modes:
- **sqlapi.ts**: HTTP-based SQL API with JWT auth (recommended for BTP)
- **sdk.ts**: Native Snowflake Node.js SDK with connection pooling

### 4. Authentication (`auth/jwt.ts`)

RS256 JWT token generation for Snowflake SQL API:
- PEM private key support
- Configurable claims (iss, sub, aud, exp)
- Passphrase support for encrypted keys

### 5. Type System (`ddl/types.ts`)

Bidirectional type mapping:
- CDS → Snowflake (for table creation)
- Snowflake → CDS (for reverse engineering)
- Value conversion for runtime data

### 6. Identifier Handling (`identifiers.ts`)

Snowflake identifier rules:
- Automatic quoting for mixed-case names
- Reserved word detection
- Schema/database qualification
- Case preservation

### 7. Configuration (`config.ts`)

Environment-aware configuration:
- Parse from `cds.env.requires.db`
- Environment variable resolution
- Credential validation
- Defaults and fallbacks

## Data Flow

### Query Execution Flow

```
CAP Query (CQN)
    ↓
SnowflakeService.read()
    ↓
cqnToSQL() → SQL string + params
    ↓
sqlApiClient.execute() OR sdkClient.execute()
    ↓
HTTP Request / SDK Call
    ↓
Snowflake Database
    ↓
Result rows
    ↓
Parse and return to CAP
```

### Authentication Flow (JWT)

```
Configuration loaded
    ↓
generateJWT() with private key
    ↓
Sign RS256 token with claims
    ↓
Add Bearer token to HTTP headers
    ↓
Snowflake validates with public key
    ↓
Authenticated session
```

## Extension Points

### Adding New Functions

To add a new SQL function translation:

1. Edit `src/cqn/filters.ts`
2. Add case in `translateFunc()`
3. Map CAP function to Snowflake equivalent
4. Add tests in `test/unit/cqn-filters.test.ts`

### Adding New Types

To add a new type mapping:

1. Edit `src/ddl/types.ts`
2. Add case in `mapCDSType()`
3. Add reverse mapping in `mapSnowflakeTypeToCDS()`
4. Add value conversion in `convertValue()`
5. Add tests in `test/unit/types.test.ts`

### Custom Client

To add a new database client:

1. Create new file in `src/client/`
2. Implement `execute()` method
3. Return rows in standard format
4. Update `SnowflakeService` to use new client
5. Add configuration option

## Build and Distribution

### Development

```bash
npm install          # Install dependencies
npm run build        # Compile TypeScript → dist/
npm run watch        # Auto-rebuild on changes
npm run lint         # Check code style
npm test             # Run all tests
```

### Publishing

```bash
npm run build        # Build production files
npm pack             # Create tarball (dry-run)
npm publish          # Publish to NPM registry
```

### What Gets Published

The NPM package includes:
- `dist/` - Compiled JavaScript + TypeScript definitions
- `package.json` - Package metadata
- `README.md` - Documentation
- `LICENSE` - Apache 2.0 license

Excluded (via `.npmignore`):
- `src/` - TypeScript source
- `test/` - Test files
- `examples/` - Example apps
- `.github/` - CI configuration

## Dependencies

### Runtime Dependencies

- `@sap/cds` - CAP framework
- `jsonwebtoken` - JWT token generation
- `snowflake-sdk` - Snowflake Node.js driver

### Development Dependencies

- `typescript` - TypeScript compiler
- `eslint` - Code linting
- `mocha` - Test runner
- `chai` - Assertion library
- `tsx` - TypeScript execution for tests

## Testing Strategy

### Unit Tests

Test individual components in isolation:
- Identifier quoting logic
- Type mappings
- CQN → SQL translation
- Filter expression parsing

**Run**: `npm run test:unit`

### Integration Tests

Test against real Snowflake database:
- Connection establishment
- Query execution
- Transaction support
- Error handling

**Run**: `SNOWFLAKE_TEST=true npm run test:integ`

### CI/CD

GitHub Actions runs:
- Lint checks
- TypeScript compilation
- Unit tests on multiple Node versions
- Integration tests (on main branch only)

## Performance Considerations

- **Connection Pooling**: SDK mode reuses connections
- **Query Compilation**: CQN → SQL happens once per query
- **Parameter Binding**: Prevents SQL injection, enables prepared statements
- **Retry Logic**: Exponential backoff for transient failures
- **Logging**: Debug logs only when enabled

## Security

- Private keys never logged
- Parameter binding prevents SQL injection
- JWT tokens expire (configurable)
- Environment variable substitution for secrets
- HTTPS for SQL API communication

