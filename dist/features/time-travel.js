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
export function parseTimeTravelHeader(headers) {
    // Header names are case-insensitive in HTTP; normalise to lowercase
    const lowerHeaders = {};
    for (const [k, v] of Object.entries(headers)) {
        lowerHeaders[k.toLowerCase()] = v;
    }
    const value = lowerHeaders['sap-snowflake-at'];
    if (typeof value !== 'string' || value.trim() === '')
        return undefined;
    return value.trim();
}
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
export function injectTimeTravelClause(sql, at) {
    // Escape single quotes in the timestamp (should not normally be needed but
    // defend against malformed input)
    const safeTs = at.replace(/'/g, "''");
    const atClause = ` AT (TIMESTAMP => '${safeTs}'::TIMESTAMP_TZ)`;
    // Match FROM followed by the first table reference (quoted or unquoted
    // identifier, including dots and quoted segments).
    // Pattern captures: FROM <optional-whitespace> <table-ref>
    // where table-ref = optional-schema-prefix + table-name (quoted/unquoted)
    // and stops at whitespace, WHERE, JOIN, GROUP, ORDER, HAVING, LIMIT, or end-of-string.
    const fromPattern = /(\bFROM\s+)((?:"[^"]*"|[A-Za-z0-9_$]+)(?:\.(?:"[^"]*"|[A-Za-z0-9_$]+))*)/i;
    const match = fromPattern.exec(sql);
    if (!match)
        return sql;
    const insertPos = match.index + match[0].length;
    return sql.slice(0, insertPos) + atClause + sql.slice(insertPos);
}
//# sourceMappingURL=time-travel.js.map