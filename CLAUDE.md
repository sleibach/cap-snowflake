# CAP CDS Snowflake Adapter — Development Guide

## Mission

Bring `@cap-js/snowflake` to production quality. Work incrementally — one concern at a time, fully tested before moving on.

## Golden Rule

**Never consider a task done without running tests against the real Snowflake instance.** Connection parameters are in `test/e2e/fixtures/.cdsrc-private.json` in the `test/` directory. This file exists and works — use it, do not mock connections.

## Reference Implementation

The HANA adapter is your primary reference:

```
node_modules/@cap-js/hana/lib/    → adapter implementation patterns
node_modules/@cap-js/hana/test/   → test patterns and coverage expectations
node_modules/@cap-js/db-service/  → base class interface you must implement
```

Read these **before** writing or changing adapter code. Match the HANA adapter's patterns unless Snowflake SQL requires deviation.

---

## Work Phases (execute in order)

### Phase 1: Test Infrastructure & Smoke Test

- Verify connection to real Snowflake works: `node test/smoke.js`
- Set up `cds.test()` based integration test suite mirroring HANA adapter structure
- Establish a test CDS model (bookshop or similar) that exercises all relevant CDS types
- **Exit criteria:** `npm test` connects, deploys the model, runs one SELECT, and cleans up

### Phase 2: Deployment / Schema Evolution

Analyse `@cap-js/hana`'s deployment logic thoroughly, then implement for Snowflake:

- Initial deployment (CREATE from CDS model)
- Schema evolution: ADD column, DROP column, type changes — **without data loss**
- `csv` initial data loading (`db/data/` convention)
- Idempotent re-deploy (running deploy twice must not fail or lose data)
- **Exit criteria:** Deploy model, insert data, alter model (add field), re-deploy, verify old data intact + new column exists

### Phase 3: CQL / Query Building

Test every CQL construct against the real instance. For each, write a test that:
1. Inserts test data
2. Executes the CQL query
3. Asserts correct results
4. Cleans up

Cover at minimum:
- Basic CRUD (INSERT, SELECT, UPDATE, DELETE)
- WHERE with all operators (=, !=, <, >, IN, BETWEEN, LIKE, NOT)
- ORDER BY, LIMIT/OFFSET, GROUP BY, HAVING
- COUNT, SUM, AVG, MIN, MAX
- $expand / deep reads (associations, compositions)
- $search and $filter
- Null handling, type coercion (especially Snowflake VARIANT if used)
- Managed aspects: `createdAt`, `modifiedAt`, `createdBy`, `modifiedBy`

**Exit criteria:** All CQL tests green against real Snowflake

### Phase 4: OData Draft Support (Fiori Elements)

This is critical and must be tested with **real OData HTTP requests**, not just CQL.

#### How Fiori Elements Draft Actually Works

Fiori Elements sends a very specific sequence of OData V4 requests. Do NOT guess these — follow this exact sequence:

**Draft Create Flow:**
```
1. POST /odata/v4/<service>/<Entity>
   → Body: {} (empty!) — server creates draft with IsActiveEntity=false
   → Response must include: ID, IsActiveEntity=false, HasActiveEntity=false

2. PATCH /odata/v4/<service>/<Entity>(ID=<uuid>,IsActiveEntity=false)
   → Body: { "field": "value" } — user edits individual fields
   → Fiori sends one PATCH per field change

3. GET /odata/v4/<service>/<Entity>(ID=<uuid>,IsActiveEntity=false)?$expand=DraftAdministrativeData
   → Fiori re-reads the draft after patches, always with DraftAdministrativeData expand

4. POST /odata/v4/<service>/<Entity>(ID=<uuid>,IsActiveEntity=false)/<Service>.draftActivate
   → Body: {} — activates the draft into the active entity
   → Response must have IsActiveEntity=true
```

**Draft Edit Flow (edit existing active entity):**
```
1. POST /odata/v4/<service>/<Entity>(ID=<uuid>,IsActiveEntity=true)/<Service>.draftEdit
   → Body: { "PreserveChanges": true }
   → Creates a draft copy, returns IsActiveEntity=false

2. PATCH ... (same as above)
3. POST .../draftActivate (same as above)
```

**Draft Delete / Discard:**
```
1. DELETE /odata/v4/<service>/<Entity>(ID=<uuid>,IsActiveEntity=false)
   → Discards draft, restores active entity if it existed
```

**Draft Listing (Fiori Elements List Report):**
```
GET /odata/v4/<service>/<Entity>?$filter=IsActiveEntity eq true or SiblingEntity/IsActiveEntity eq null&$expand=DraftAdministrativeData
```

#### Draft Test Implementation

Use `cds.test()` with real HTTP requests:

```js
const { GET, POST, PATCH, DELETE, expect } = cds.test('bookshop')

describe('OData Draft', () => {

  test('Create → Edit → Activate', async () => {
    // 1. Create draft
    const { data: draft } = await POST('/odata/v4/admin/Books', {})
    expect(draft.IsActiveEntity).to.equal(false)
    expect(draft.HasActiveEntity).to.equal(false)
    const draftKey = `(ID=${draft.ID},IsActiveEntity=false)`

    // 2. Patch draft fields (one by one, like Fiori does)
    await PATCH(`/odata/v4/admin/Books${draftKey}`, { title: 'Snowflake Test' })
    await PATCH(`/odata/v4/admin/Books${draftKey}`, { stock: 100 })

    // 3. Read back with DraftAdministrativeData
    const { data: read } = await GET(
      `/odata/v4/admin/Books${draftKey}?$expand=DraftAdministrativeData`
    )
    expect(read.title).to.equal('Snowflake Test')
    expect(read.DraftAdministrativeData).to.exist

    // 4. Activate
    const { data: active } = await POST(
      `/odata/v4/admin/Books${draftKey}/AdminService.draftActivate`, {}
    )
    expect(active.IsActiveEntity).to.equal(true)
    expect(active.title).to.equal('Snowflake Test')
  })

  test('Edit existing → Modify → Activate', async () => { /* ... */ })
  test('Create draft → Discard', async () => { /* ... */ })
  test('Draft listing filter', async () => { /* ... */ })
  test('Concurrent draft detection', async () => { /* ... */ })
})
```

**Test EVERY draft scenario above.** If a test fails, read the full error, check what SQL was generated (enable `DEBUG=sql`), compare with HANA adapter behavior, and fix.

**Exit criteria:** All draft flows work via HTTP requests identical to what Fiori Elements sends

### Phase 5: Hardening

- Utilize the cds mcp for obtaining cds (cap) knowledge / context
- Error handling: invalid types, constraint violations, connection drops
- Large result sets / pagination
- Transaction handling (commit/rollback)
- Concurrent access patterns
- Temporal data types, locale-specific behavior if applicable

---

## Mandatory Workflow (every change)

```
1. Write/modify adapter code in src/
2. Run: npm run build   ← compiles src/ → dist/ (REQUIRED for dev server)
3. Run: npm test
4. Read FULL output — do not skim
5. If failures: fix and go to 2
6. If green: commit and move to next task
```

> **Important**: `npm test` reads `src/` directly via tsx — no build needed for tests.
> `cds watch` (test/e2e/fixtures/) loads `dist/index.js` — only updated by `npm run build`.
> Skipping the build means tests can be green while the running server is broken.

For debugging SQL issues:
```bash
DEBUG=sql npm test        # shows generated SQL
DEBUG=* npm test          # full CDS debug output
```

## Snowflake SQL Pitfalls

- No `BOOLEAN` literal `TRUE/FALSE` in older contexts — use `1/0` or check compatibility
- `STRING` vs `VARCHAR` — Snowflake uses `VARCHAR` by default
- Semi-structured data uses `VARIANT`, `OBJECT`, `ARRAY` — map CDS types carefully  
- Case sensitivity: Snowflake upper-cases unquoted identifiers — decide on a quoting strategy early and be consistent
- `MERGE` syntax differs from HANA — verify upsert logic
- No implicit type casting in some comparison contexts

## Non-Goals (do NOT work on these)

- UI development / Fiori app code
- Authentication / XSUAA setup
- CI/CD pipeline
- npm publishing / packaging