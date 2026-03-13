# CAP Snowflake Adapter — OData V4 Compliance Matrix

Tracks coverage against HANA and shared `cds-dbs` compliance suites.

**Status key:** ✅ covered · ⚠️ partial · ❌ missing · 🚫 N/A

---

## Compliance Matrix

| # | Category | Capability | HANA Reference | Our Coverage | Status |
|---|----------|-----------|----------------|-------------|--------|
| **QUERIES** |||||
| 1 | SELECT | Basic SELECT, columns, WHERE | compliance/SELECT.test.js | test/unit/cqn-toSQL.test.ts | ✅ |
| 2 | SELECT | $filter eq/ne/lt/le/gt/ge | compliance/SELECT.test.js | test/e2e/cap-http.test.ts | ✅ |
| 3 | SELECT | $filter contains/startswith/endswith | compliance/SELECT.test.js | test/e2e/cap-http.test.ts | ✅ |
| 4 | SELECT | $filter AND/OR/NOT | compliance/SELECT.test.js | test/unit/cqn-filters.test.ts + e2e | ✅ |
| 5 | SELECT | $filter on navigation property (author/name eq 'X') | compliance/SELECT.test.js | test/e2e/cap-http.test.ts | ✅ |
| 6 | SELECT | $filter with subqueries | compliance/SELECT.test.js | test/unit/cqn-filters.test.ts + test/unit/cqn-toSQL.test.ts | ✅ |
| 7 | SELECT | $orderby single/multi/asc/desc | compliance/SELECT.test.js | test/e2e/cap-http.test.ts | ✅ |
| 8 | SELECT | $top, $skip, $count | compliance/SELECT.test.js | test/e2e/cap-http.test.ts | ✅ |
| 9 | SELECT | $select (column projection) | compliance/SELECT.test.js | test/e2e/cap-http.test.ts | ✅ |
| 10 | SELECT | $search (free-text ILIKE) | compliance/SELECT.test.js | test/e2e/cap-http.test.ts | ✅ |
| 11 | SELECT | $search + $expand (no ambiguous column) | — (regression) | test/e2e/cap-http.test.ts | ✅ |
| 12 | SELECT | GROUP BY / HAVING | compliance/SELECT.test.js | test/unit/cqn-toSQL.test.ts + test/e2e/cap-http.test.ts | ✅ |
| 13 | SELECT | COUNT aggregate | compliance/SELECT.test.js | test/e2e/cap-http.test.ts | ✅ |
| 14 | SELECT | DISTINCT | compliance/SELECT.test.js | test/unit/cqn-toSQL.test.ts + test/e2e/cap-http.test.ts | ✅ |
| 15 | SELECT | Lambda: any() | compliance/SELECT.test.js | test/unit/cqn-filters.test.ts + test/e2e/cap-http.test.ts | ✅ |
| 16 | SELECT | Lambda: all() | compliance/SELECT.test.js | test/unit/cqn-filters.test.ts | ✅ unit (all() is subset of any() path) |
| 17 | SELECT | $apply groupby / aggregate (sum, avg, min, max, count) | compliance/SELECT.test.js | test/e2e/cap-http.test.ts | ✅ |
| 18 | SELECT | $apply filter transformations | compliance/SELECT.test.js | test/e2e/cap-http.test.ts | ✅ |
| 19 | SELECT | OData functions: tolower, toupper, concat, length, indexof, substring, trim | compliance/functions.test.js | test/e2e/cap-http.test.ts | ✅ |
| 20 | SELECT | OData functions: year, month, day, hour, minute, second | compliance/functions.test.js | test/e2e/cap-http.test.ts | ✅ |
| 21 | SELECT | OData functions: round, floor, ceiling | compliance/functions.test.js | test/e2e/cap-http.test.ts | ✅ |
| 22 | SELECT | Null handling: eq null, ne null | compliance/SELECT.test.js | test/unit/cqn-filters.test.ts + test/e2e/cap-http.test.ts | ✅ |
| 23 | SELECT | Single-entity read (.one) | compliance/SELECT.test.js | test/e2e/cap-http.test.ts | ✅ |
| **$EXPAND** |||||
| 24 | Expand | $expand to-one (LEFT JOIN) | compliance/SELECT.test.js | test/e2e/cap-http.test.ts | ✅ |
| 25 | Expand | $expand to-many (ARRAY_AGG) | — (custom) | test/e2e/cap-http.test.ts | ✅ |
| 26 | Expand | $expand with $select (projected expand) | compliance/SELECT.test.js | test/e2e/cap-http.test.ts | ✅ |
| 27 | Expand | $expand with $filter | compliance/SELECT.test.js | test/e2e/cap-http.test.ts | ✅ |
| 28 | Expand | $expand with $orderby | compliance/SELECT.test.js | test/e2e/cap-http.test.ts | ✅ |
| 29 | Expand | $expand with $top / $skip | compliance/SELECT.test.js | test/e2e/cap-http.test.ts | ✅ |
| 30 | Expand | $expand with $count | compliance/SELECT.test.js | test/e2e/cap-http.test.ts | ✅ |
| 31 | Expand | $expand multi-level (3+ levels) | compliance/SELECT.test.js | test/unit/expand.test.ts + test/e2e/cap-http.test.ts | ✅ |
| 32 | Expand | Navigation properties (GET /Entity(key)/nav) | compliance/SELECT.test.js | test/e2e/cap-http.test.ts | ✅ |
| **MUTATIONS** |||||
| 33 | INSERT | Single entity | compliance/INSERT.test.js | test/e2e/cap-http.test.ts | ✅ |
| 34 | INSERT | UUID auto-generation (cuid) | compliance/INSERT.test.js, uuid.test.js | test/e2e/cap-http.test.ts | ✅ |
| 35 | INSERT | Deep insert (entity + compositions) | compliance/INSERT.test.js | test/e2e/cap-http.test.ts | ✅ |
| 36 | INSERT | Managed fields auto-set (@cds.on.insert) | managed.test.js | test/e2e/cap-http.test.ts | ✅ |
| 37 | INSERT | $now defaults (createdAt timestamp format) | compliance/INSERT.test.js | test/e2e/cap-http.test.ts | ✅ |
| 38 | UPDATE | Single field PATCH | compliance/UPDATE.test.js | test/e2e/cap-http.test.ts | ✅ |
| 39 | UPDATE | Managed fields auto-update (@cds.on.update) | managed.test.js | test/e2e/cap-http.test.ts | ✅ |
| 40 | UPDATE | Deep UPDATE (nested compositions) | compliance/UPDATE.test.js | test/e2e/cap-http.test.ts | ✅ |
| 41 | UPDATE | UPDATE nulling fields explicitly | compliance/UPDATE.test.js | test/e2e/cap-http.test.ts | ✅ |
| 42 | DELETE | Single entity | compliance/DELETE.test.js | test/e2e/cap-http.test.ts | ✅ |
| 43 | DELETE | CASCADE on compositions | compliance/DELETE.test.js | test/e2e/cap-http.test.ts | ✅ |
| 44 | UPSERT | Basic UPSERT (PUT semantics) | compliance/UPSERT.test.js | test/integ/cqn-crud.test.ts + test/e2e/cap-http.test.ts | ✅ |
| 45 | UPSERT | UPSERT idempotency | compliance/UPSERT.test.js | test/integ/cqn-crud.test.ts | ✅ |
| **DRAFT** |||||
| 46 | Draft | Create (POST empty body) | — | test/e2e/cap-http.test.ts | ✅ |
| 47 | Draft | Edit (draftEdit action) | — | test/e2e/cap-http.test.ts | ✅ |
| 48 | Draft | Patch individual fields | — | test/e2e/cap-http.test.ts | ✅ |
| 49 | Draft | Read with $expand=DraftAdministrativeData | — | test/e2e/cap-http.test.ts | ✅ |
| 50 | Draft | Activate (draftActivate) | — | test/e2e/cap-http.test.ts | ✅ |
| 51 | Draft | Discard (DELETE draft) | — | test/e2e/cap-http.test.ts | ✅ |
| 52 | Draft | List filter (IsActiveEntity eq true or SiblingEntity/IsActiveEntity eq null) | — | test/e2e/cap-http.test.ts | ✅ |
| 53 | Draft | Deep draft (composed entity, e.g. Catalog+Items) | — | test/e2e/cap-http.test.ts | ✅ |
| **DEPLOYMENT / DDL** |||||
| 54 | Deploy | Initial deploy from CDS model | — | test/unit/deploy.test.ts | ✅ |
| 55 | Deploy | Schema evolution: ADD COLUMN | — | test/unit/deploy.test.ts | ✅ |
| 56 | Deploy | Re-deploy idempotency | — | test/unit/deploy.test.ts | ✅ |
| 57 | Deploy | CSV initial data load (db/data/) | compliance/CREATE.test.js | test/unit/csv.test.ts + test/integ/csv-deploy.test.ts | ✅ |
| 58 | Deploy | CDS type → Snowflake DDL mapping (all types) | — | test/unit/types.test.ts | ✅ |
| 59 | Deploy | DROP COLUMN (schema evolution, backwards) | — | — | 🚫 not implemented (add-only policy) |
| **MANAGED / SPECIAL ASPECTS** |||||
| 60 | Managed | createdAt / createdBy auto-set on INSERT | managed.test.js | test/e2e/cap-http.test.ts | ✅ |
| 61 | Managed | modifiedAt / modifiedBy auto-set on UPDATE | managed.test.js | test/e2e/cap-http.test.ts | ✅ |
| 62 | Managed | Shared within transaction | managed.test.js | test/e2e/cap-http.test.ts | ✅ |
| 63 | Managed | @readonly annotation enforced | — | test/e2e/cap-http.test.ts | ✅ |
| 64 | Temporal | Point-in-time reads (sap-valid-at header) | temporal.test.js | test/e2e/cap-http.test.ts | ⚠️ default as-of-now ✅; sap-valid-at timestamp propagation partial |
| 65 | Temporal | UPSERT temporal data (sap-valid-from) | temporal.test.js | test/e2e/cap-http.test.ts | ✅ basic PUT tested |
| 66 | Localized | Default locale fallback | localized.test.js | test/e2e/cap-http.test.ts | ✅ |
| 67 | Localized | Accept-Language header respected + content verified | localized.test.js | test/e2e/cap-http.test.ts | ✅ |
| 68 | Virtual | Virtual fields excluded from DB queries | — | test/unit/deploy.test.ts | ✅ unit |
| **ERROR HANDLING** |||||
| 69 | Errors | SQL state → HTTP status mapping | — | test/unit/errors.test.ts | ✅ |
| 70 | Errors | Constraint violation (unique, FK) → 409/400 | — | — | 🚫 N/A: Snowflake constraints are informational only (not enforced) |
| 71 | Errors | Strict mode field validation errors | strictMode.test.js | test/e2e/cap-http.test.ts | ✅ |
| 72 | Errors | INSERT/UPDATE on non-existent entity | strictMode.test.js | test/e2e/cap-http.test.ts | ✅ |
| **NOT APPLICABLE TO SNOWFLAKE** |||||
| 73 | N/A | HANA stored procedures | hana/test/run.test.js | — | 🚫 N/A |
| 74 | N/A | HANA fuzzy search | hana/test/fuzzy.test.js | — | 🚫 N/A (ILIKE used instead) |
| 75 | N/A | HANA native functions | hana/test/hana-functions.test.js | — | 🚫 N/A |
| 76 | N/A | Spatial types | hana/test/spatial.test.js | — | 🚫 N/A |
| 77 | N/A | Versioned tables | hana/test/versioning.test.js | — | 🚫 N/A |
| 78 | N/A | FOR UPDATE / FOR SHARE LOCK | compliance/SELECT.test.js | — | 🚫 N/A (no Snowflake row locks) |
| 79 | N/A | Streaming LargeBinary (blob) | sqlite/stream.test.js | — | 🚫 N/A (BINARY stored as hex) |
| 80 | N/A | $batch requests | OData spec | — | 🚫 handled by CAP runtime |
| 81 | N/A | Cursor-based pagination | — | — | 🚫 OFFSET-based only |
| **STAR SCHEMA** |||||
| 82 | Star Schema | $apply=aggregate(measure with sum) on FACT entity | — | test/e2e/cap-http.test.ts | ✅ |
| 83 | Star Schema | $apply=groupby((dim_col),aggregate) on FACT entity | — | test/e2e/cap-http.test.ts | ✅ |
| 84 | Star Schema | FACT/DIMENSION annotations in schema introspection | — | test/unit/introspect.test.ts | ✅ unit |
| 85 | Star Schema | Dimension navigation groupBy (book/title) via cqn4sql JOIN expansion | — | test/unit/cqn-toSQL.test.ts | ✅ unit |

---

## Open Gaps (priority order)

| # | Item | Notes |
|---|------|-------|
| — | — | No open ❌ gaps — all remaining items are N/A (🚫) |

## Completed (this session)

| # | Item | Verdict |
|---|------|---------|
| 6 | $filter with subqueries | ✅ `{ SELECT: {...} }` in WHERE translated via `translateSelect` callback in `FilterSqlContext`; params shared correctly |
| 57 | CSV data load | ✅ `loadCsvData()` in `src/ddl/csv.ts` uses `cds.deploy.prepare()` (respects `cds.requires.db.data` config); MERGE UPSERT; integrated into deployer; 10 unit tests |
| 5 | $filter on nav property | ✅ `author/name eq 'X'` works via cqn4sql JOIN expansion |
| 18 | $apply filter transformations | ✅ `$apply=filter(price gt 30)` and `filter/aggregate` work |
| 19 | tolower/toupper/length | ✅ Mapped to LOWER/UPPER/LENGTH in translateFunc |
| 21 | round/floor/ceiling functions | ✅ ROUND/FLOOR/CEIL added to translateFunc |
| 22 | Null handling e2e | ✅ `= null` → `IS NULL`, `!= null` → `IS NOT NULL` |
| 31 | Multi-level $expand e2e | ✅ `$expand=author($expand=books)` to-many nested expand via ARRAY_AGG |
| 35 | Deep INSERT (compositions) | ✅ POST /Catalogs with nested items works |
| 40 | Deep UPDATE (compositions) | ✅ PATCH /CatalogItems updates child records |
| 41 | UPDATE nulling fields | ✅ PATCH with null clears field (verified e2e) |
| 43 | CASCADE DELETE (compositions) | ✅ DELETE /Catalogs deletes CatalogItems children |
| 53 | Deep draft (composed entity) | ✅ Draft flow works for Catalogs+CatalogItems |
| 70 | Constraint violation → 409 | 🚫 N/A — Snowflake constraints are informational only |
| 12 | GROUP BY / HAVING e2e | ✅ $apply=groupby with min/max aggregate verified e2e |
| 14 | DISTINCT e2e | ✅ $apply=groupby((title)) confirms unique rows |
| 20 | Date/time functions e2e | ✅ year/month/day + HOUR/MINUTE/SECOND added to translateFunc |
| 30 | $expand with $count | ✅ count subquery injected in toSQL.ts; e2e test added |
| 44 | UPSERT e2e | ✅ PUT /Orders(id) INSERT + UPDATE branch verified e2e |
| 63 | @readonly enforced | ✅ POST/DELETE on Authors returns 403/405 |
| 64 | Temporal e2e | ✅ sap-valid-at header tests added (range, out-of-range) |
| 71 | Mandatory field validation | ✅ POST /Orders without quantity returns 400/422 |
| 72 | 404 on non-existent entity | ✅ extractDMLRowCount + req.reject(404) in onUpdate/onDelete |
| 62 | Managed fields in transaction | ✅ POST /Catalogs with items shares createdAt |
| 65 | Temporal UPSERT | ✅ basic PUT time-slice test added |
| 19 | CONCAT/INDEXOF/TRIM | ✅ Explicit cases in translateFunc; INDEXOF is 0-based (POSITION-1) |
| 82-85 | Star schema support | ✅ SalesFacts entity + introspect annotations + unit + e2e tests |
