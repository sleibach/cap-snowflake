/**
 * Snowflake Time Travel support.
 *
 * Time Travel lets you query data as it existed at a specific past timestamp.
 * Usage: include a `sap-snowflake-at` HTTP header with an ISO 8601 timestamp.
 *
 * Example:
 *   sap-snowflake-at: 2024-01-15T10:30:00Z
 *
 * The adapter injects `AT (TIMESTAMP => '<ts>'::TIMESTAMP_TZ)` into the FROM
 * clause of the generated SQL, enabling Snowflake's Time Travel semantics.
 */
/**
 * Read the `sap-snowflake-at` header from an HTTP request headers map.
 *
 * Returns the ISO timestamp string if the header is present and non-empty,
 * or `undefined` otherwise.
 */
export declare function parseTimeTravelHeader(headers: Record<string, string>): string | undefined;
/**
 * Inject Snowflake AT (TIMESTAMP => ...) clause into a SQL string.
 *
 * The clause is appended immediately after the first table reference in the
 * FROM clause.  Only the leading FROM table is modified — JOINed tables do
 * not need AT injected separately because Snowflake Time Travel applies to
 * the whole statement scope when the base table carries the clause.
 *
 * Input SQL (simplified):
 *   SELECT ... FROM "DB"."SCHEMA"."TABLE" WHERE ...
 *
 * Output SQL:
 *   SELECT ... FROM "DB"."SCHEMA"."TABLE" AT (TIMESTAMP => '2024-01-15T10:30:00Z'::TIMESTAMP_TZ) WHERE ...
 *
 * If the SQL does not contain a recognisable FROM clause the original string
 * is returned unchanged (safe fallback).
 */
export declare function injectTimeTravelClause(sql: string, at: string): string;
//# sourceMappingURL=time-travel.d.ts.map