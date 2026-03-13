/**
 * CSV initial data loading for Snowflake.
 *
 * Uses cds.deploy.prepare() (CAP built-in) to discover CSV/JSON files in
 * db/data/ and parses them with cds.parse.csv().
 *
 * Each CSV file is loaded via a Snowflake MERGE statement so the operation is
 * idempotent: rows are upserted (matched by entity keys).
 */
import cds from '@sap/cds';
import { qualifyName, toPhysicalIdentifier } from '../identifiers.js';
/** Maximum rows per MERGE statement to stay within Snowflake parameter limits */
const BATCH_SIZE = 200;
/**
 * Discover and load CSV initial data files into Snowflake tables.
 * Called after DDL deployment. Idempotent — uses MERGE semantics.
 *
 * @param model       Loaded CDS model (must have $sources for file discovery)
 * @param credentials Snowflake credentials (for table name qualification)
 * @param client      Connected SQL API or SDK client
 */
export async function loadCsvData(model, credentials, client) {
    const deployCds = cds.deploy;
    if (typeof deployCds?.prepare !== 'function') {
        throw new Error('cds.deploy.prepare is not available — requires @sap/cds >= 7.x');
    }
    // prepare() returns [[filepath, entityNameOrDef, fileContent], ...]
    const entries = await deployCds.prepare(model);
    let loaded = 0;
    let skipped = 0;
    for (const [filepath, entityNameOrDef, content] of entries) {
        if (!filepath.endsWith('.csv')) {
            skipped++;
            continue;
        }
        if (!content || typeof content !== 'string') {
            skipped++;
            continue;
        }
        if (!entityNameOrDef) {
            skipped++;
            continue;
        }
        // Entity name is either a string or a CSN entity definition
        const entityName = typeof entityNameOrDef === 'string'
            ? entityNameOrDef
            : (entityNameOrDef.name ?? '');
        if (!entityName) {
            skipped++;
            continue;
        }
        const entityDef = model.definitions?.[entityName];
        if (!entityDef) {
            console.warn(`[csv] Entity '${entityName}' not found in model — skipping ${filepath}`);
            skipped++;
            continue;
        }
        // Parse CSV
        let cols;
        let rows;
        try {
            const parsed = cds.parse.csv(content);
            [cols, ...rows] = parsed;
            if (!cols?.length || !rows.length) {
                skipped++;
                continue;
            }
        }
        catch (err) {
            console.warn(`[csv] Failed to parse ${filepath}: ${err?.message ?? err}`);
            skipped++;
            continue;
        }
        // Derive physical table name
        const persistenceName = entityDef['@cds.persistence.name'] ??
            entityName.replace(/\./g, '_').toUpperCase();
        const tableName = qualifyName(persistenceName, credentials);
        const keyColumns = getKeyColumns(entityDef);
        const physCols = cols.map(c => toPhysicalIdentifier(c));
        // Execute in batches to respect Snowflake parameter limits
        for (let start = 0; start < rows.length; start += BATCH_SIZE) {
            const batch = rows.slice(start, start + BATCH_SIZE);
            const { sql, params } = buildMergeSql(tableName, physCols, keyColumns, batch);
            await client.execute(sql, params);
        }
        loaded += rows.length;
    }
    return { loaded, skipped };
}
/**
 * Extract physical key column names from a CSN entity definition.
 * Falls back to checking elements for `key: true` if `.keys` is absent.
 */
export function getKeyColumns(entityDef) {
    if (!entityDef)
        return [];
    // CSN entity.keys is a Record<name, elementDef> for all key elements
    if (entityDef.keys && Object.keys(entityDef.keys).length > 0) {
        return Object.keys(entityDef.keys).map((k) => toPhysicalIdentifier(k));
    }
    // Fallback: scan elements for key: true
    const elements = entityDef.elements ?? {};
    return Object.entries(elements)
        .filter(([, el]) => el?.key)
        .map(([name]) => toPhysicalIdentifier(name));
}
/**
 * Build a Snowflake MERGE statement for a batch of CSV rows.
 *
 * Generated SQL:
 *   MERGE INTO <table> AS target
 *   USING (SELECT ? AS COL1, ? AS COL2, ... UNION ALL ...) AS src
 *   ON (target.KEY = src.KEY)
 *   WHEN MATCHED THEN UPDATE SET target.NON_KEY = src.NON_KEY, ...
 *   WHEN NOT MATCHED THEN INSERT (COL1, ...) VALUES (src.COL1, ...)
 *
 * @param tableName   Fully qualified Snowflake table name
 * @param physCols    Physical column names aligned with CSV columns
 * @param keyColumns  Key columns for the ON match condition (empty → match all)
 * @param rows        Batch of CSV rows (each row aligned with physCols)
 */
export function buildMergeSql(tableName, physCols, keyColumns, rows) {
    if (!rows.length) {
        throw new Error('buildMergeSql: rows must not be empty');
    }
    const params = [];
    // USING clause: one SELECT per row, joined with UNION ALL
    const selectRows = rows.map(row => 'SELECT ' + physCols.map((col, i) => {
        params.push(row[i] ?? null);
        return `? AS ${col}`;
    }).join(', '));
    // ON condition: match on key columns (or all columns if no keys defined)
    const matchCols = keyColumns.length > 0 ? keyColumns : physCols;
    const onClause = matchCols.map(k => `target.${k} = src.${k}`).join(' AND ');
    // UPDATE: only non-key columns (updating keys is redundant and may error)
    const updateCols = physCols.filter(c => !matchCols.includes(c));
    const updateSet = updateCols.length > 0
        ? updateCols.map(c => `target.${c} = src.${c}`).join(', ')
        : physCols.map(c => `target.${c} = src.${c}`).join(', ');
    const insertCols = physCols.join(', ');
    const insertVals = physCols.map(c => `src.${c}`).join(', ');
    const sql = [
        `MERGE INTO ${tableName} AS target`,
        `USING (${selectRows.join(' UNION ALL ')}) AS src`,
        `ON (${onClause})`,
        `WHEN MATCHED THEN UPDATE SET ${updateSet}`,
        `WHEN NOT MATCHED THEN INSERT (${insertCols}) VALUES (${insertVals})`,
    ].join('\n');
    return { sql, params };
}
//# sourceMappingURL=csv.js.map