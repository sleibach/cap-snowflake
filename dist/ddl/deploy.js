/**
 * DDL generation for cds deploy
 */
import cds from '@sap/cds';
import { mapCDSType } from './types.js';
import { qualifyName, toPhysicalIdentifier } from '../identifiers.js';
import { extractLocalizedElements, generateLocalizedView, generateTextsTable, getEntityKeys, hasLocalizedElements } from '../features/localized.js';
import { generateTemporalTableDDL, generateTemporalView, isTemporal } from '../features/temporal.js';
import { getVectorConfig, getClusteringKeys, getDataRetentionDays, isSearchOptimized, getMaskingPolicy, getRowAccessPolicy, getTags, getExternalTableConfig, } from '../features/snowflake-native.js';
import { logWarning } from '../utils/logger.js';
/**
 * Generate CREATE TABLE statement
 */
export function generateCreateTable(entity, credentials, ifNotExists = true) {
    const tableName = qualifyName(entity.name, credentials);
    const columns = [];
    const keys = [];
    // Process elements
    for (const [name, element] of Object.entries(entity.elements)) {
        const columnDef = generateColumnDefinition(name, element);
        columns.push(columnDef);
        if (element.key) {
            keys.push(toPhysicalIdentifier(name));
        }
    }
    let sql = `CREATE TABLE ${ifNotExists ? 'IF NOT EXISTS ' : ''}${tableName} (\n  ${columns.join(',\n  ')}`;
    // Add primary key constraint
    if (keys.length > 0) {
        sql += `,\n  PRIMARY KEY (${keys.join(', ')})`;
    }
    sql += '\n)';
    return sql;
}
/**
 * Generate column definition
 */
export function generateColumnDefinition(name, element) {
    const quotedName = toPhysicalIdentifier(name);
    const sqlType = mapCDSType(element.type, element.length, element.precision, element.scale, element.vectorConfig);
    let def = `${quotedName} ${sqlType}`;
    // Add constraints
    if (element.notNull) {
        def += ' NOT NULL';
    }
    if (element.default !== undefined) {
        def += ` DEFAULT ${formatDefault(element.default)}`;
    }
    return def;
}
/**
 * Format default value
 */
function formatDefault(value) {
    if (value === null) {
        return 'NULL';
    }
    if (typeof value === 'string') {
        return `'${value.replace(/'/g, "''")}'`;
    }
    if (typeof value === 'boolean') {
        return value ? 'TRUE' : 'FALSE';
    }
    if (typeof value === 'number') {
        return String(value);
    }
    return `'${String(value)}'`;
}
/**
 * Generate CREATE VIEW statement
 */
export function generateCreateView(viewName, selectSQL, credentials, orReplace = true) {
    const qualifiedName = qualifyName(viewName, credentials);
    return `CREATE ${orReplace ? 'OR REPLACE ' : ''}VIEW ${qualifiedName} AS\n${selectSQL}`;
}
/**
 * Generate DROP TABLE statement
 */
export function generateDropTable(tableName, credentials, ifExists = true) {
    const qualifiedName = qualifyName(tableName, credentials);
    return `DROP TABLE ${ifExists ? 'IF EXISTS ' : ''}${qualifiedName}`;
}
/**
 * Generate CREATE SEQUENCE statement (for auto-increment)
 */
export function generateCreateSequence(sequenceName, credentials) {
    const qualifiedName = qualifyName(sequenceName, credentials);
    return `CREATE SEQUENCE ${qualifiedName} START = 1 INCREMENT = 1`;
}
/**
 * Generate deploy SQL statements from a CSN model.
 */
export function buildDeployStatements(model, credentials, options = {}) {
    // Start with the original definitions, then enrich with SQL-compiled definitions
    // (which includes draft tables: *.drafts, DRAFT.DraftAdministrativeData).
    // Only NEW definitions are merged in — existing ones are never overwritten so that
    // @cds.persistence.name and other annotations remain intact.
    const originalDefs = model?.definitions || {};
    const definitions = { ...originalDefs };
    try {
        if (cds.compile?.for?.sql) {
            const sqlModel = cds.compile.for.sql(model);
            const sqlDefs = sqlModel?.definitions || {};
            for (const [name, def] of Object.entries(sqlDefs)) {
                if (!definitions[name]) {
                    // Skip common CDS / SAP framework entities — they belong to reference-data
                    // packages and should not be deployed to the application schema.
                    if (name.startsWith('sap.') || name.startsWith('cds.'))
                        continue;
                    // For draft entities (*.drafts), fix the persistence name:
                    // cds.compile.for.sql() derives it from the entity path (e.g. E2ETESTSERVICE_BOOKS_DRAFTS),
                    // but CAP runtime uses the base entity's @cds.persistence.name + _DRAFTS
                    // (e.g. CAP_E2E_BOOKS_DRAFTS).  Override the annotation so the deployed
                    // table matches what the running server expects.
                    if (name.endsWith('.drafts')) {
                        const baseName = name.slice(0, -'.drafts'.length);
                        const baseDef = originalDefs[baseName] ?? originalDefs[baseName.split('.').pop()];
                        const basePersis = baseDef?.['@cds.persistence.name'];
                        if (basePersis) {
                            const clone = { ...def };
                            clone['@cds.persistence.name'] = `${basePersis}_DRAFTS`;
                            definitions[name] = clone;
                            continue;
                        }
                    }
                    definitions[name] = def;
                }
            }
        }
    }
    catch (compileError) {
        logWarning('cds.compile.for.sql() failed — draft tables will not be generated. ' +
            'Runtime failures possible for @odata.draft.enabled entities.', { error: compileError?.message ?? String(compileError) });
    }
    const statements = [];
    const createViews = options.createViews !== false;
    for (const [name, definition] of Object.entries(definitions)) {
        const def = definition;
        if (def.kind !== 'entity')
            continue;
        if (def.query)
            continue; // SQL views — skip
        if (def.projection)
            continue; // CDS projections (e.g. Service.DraftAdministrativeData) — skip
        if (def['@cds.persistence.skip'] || def['@cds.persistence.exists'])
            continue;
        // Skip framework entities from common CDS/SAP namespaces (e.g. sap.common.Languages)
        if (name.startsWith('sap.') || name.startsWith('cds.'))
            continue;
        // Skip .texts sub-entities without an explicit persistence name — they are
        // already handled by generateTextsTable() when the parent has localized elements.
        if (name.endsWith('.texts') && !def['@cds.persistence.name'])
            continue;
        const tableName = getPersistenceName(name, def);
        const entityDef = toEntityDefinition(tableName, def, name);
        if (Object.keys(entityDef.elements).length === 0)
            continue;
        const externalCfg = getExternalTableConfig(def);
        if (externalCfg) {
            statements.push(generateExternalTable(tableName, externalCfg.stage, externalCfg.fileFormat, externalCfg.pattern, credentials));
        }
        else if (isTemporal(def)) {
            statements.push(generateTemporalTableDDL({ ...def, name: tableName }, credentials));
        }
        else {
            statements.push(generateCreateTable(entityDef, credentials, true));
        }
        // Post-DDL: apply Snowflake-native annotation-driven ALTER statements
        const annotationStatements = buildSnowflakeAnnotationStatements(tableName, def, credentials);
        statements.push(...annotationStatements);
        if (hasLocalizedElements(def)) {
            const keys = getEntityKeys(def);
            if (keys.length > 0) {
                statements.push(generateTextsTable({
                    entityName: tableName,
                    localizedElements: extractLocalizedElements(def),
                    keys
                }, credentials));
                if (createViews) {
                    statements.push(generateLocalizedView({
                        entityName: tableName,
                        localizedElements: extractLocalizedElements(def),
                        keys
                    }, credentials));
                }
            }
        }
        if (isTemporal(def) && createViews) {
            statements.push(generateTemporalView({ ...def, name: tableName }, credentials));
        }
    }
    // Second pass: create Snowflake VIEWs for service-layer projection entities.
    // These are entities in the original CSN that have a `projection` property —
    // e.g. `E2ETestService.Books as projection on cap_e2e.Books`.
    // Other CAP adapters (sqlite, hana) also materialize these as DB views.
    if (createViews) {
        for (const [name, definition] of Object.entries(originalDefs)) {
            const def = definition;
            if (def.kind !== 'entity')
                continue;
            if (!def.projection)
                continue;
            if (name.startsWith('sap.') || name.startsWith('cds.'))
                continue;
            if (def['@cds.persistence.skip'] || def['@cds.persistence.exists'])
                continue;
            const sourceRef = def.projection?.from?.ref;
            if (!Array.isArray(sourceRef) || sourceRef.length === 0)
                continue;
            const sourceName = sourceRef.length === 1 ? sourceRef[0] : sourceRef.join('.');
            if (sourceName === name)
                continue; // self-reference guard
            const sourceDef = originalDefs[sourceName];
            if (sourceDef?.['@cds.persistence.skip'] || sourceDef?.['@cds.persistence.exists'])
                continue;
            const viewName = getPersistenceName(name, def);
            const baseTableName = getPersistenceName(sourceName, sourceDef ?? {});
            const qualifiedBase = qualifyName(baseTableName, credentials);
            statements.push(generateCreateView(viewName, `SELECT * FROM ${qualifiedBase}`, credentials, true));
        }
    }
    return statements;
}
/**
 * Generate ALTER TABLE ADD COLUMN statements for new columns found in CSN but missing
 * from the existing database schema (safe migration — never drops columns).
 *
 * @param model       The CDS model
 * @param existingCols Map of tableName (upper) → Set of existing column names (upper)
 * @param credentials Snowflake credentials for identifier qualification
 */
export function generateMigrationStatements(model, existingCols, credentials) {
    const definitions = { ...(model?.definitions || {}) };
    try {
        if (cds.compile?.for?.sql) {
            const sqlModel = cds.compile.for.sql(model);
            const sqlDefs = sqlModel?.definitions || {};
            for (const [name, def] of Object.entries(sqlDefs)) {
                if (!definitions[name])
                    definitions[name] = def;
            }
        }
    }
    catch { /* ignore */ }
    const statements = [];
    for (const [name, definition] of Object.entries(definitions)) {
        const def = definition;
        if (def.kind !== 'entity')
            continue;
        if (def.query || def.projection)
            continue;
        if (def['@cds.persistence.skip'] || def['@cds.persistence.exists'])
            continue;
        const tableName = getPersistenceName(name, def);
        const tableUpper = tableName.toUpperCase();
        const existing = existingCols.get(tableUpper) ?? new Set();
        const entityDef = toEntityDefinition(tableName, def, name);
        for (const [colName, colDef] of Object.entries(entityDef.elements)) {
            const colUpper = colName.toUpperCase();
            if (!existing.has(colUpper)) {
                const qualifiedTable = qualifyName(tableName, credentials);
                const colDefSQL = generateColumnDefinition(colName, colDef);
                statements.push(`ALTER TABLE ${qualifiedTable} ADD COLUMN IF NOT EXISTS ${colDefSQL}`);
            }
        }
    }
    return statements;
}
/**
 * Generate a CREATE EXTERNAL TABLE statement for entities annotated with @Snowflake.external.
 */
export function generateExternalTable(tableName, stage, fileFormat, pattern, credentials) {
    const qualifiedName = qualifyName(tableName, credentials);
    let sql = `CREATE EXTERNAL TABLE IF NOT EXISTS ${qualifiedName}`;
    sql += `\n  WITH LOCATION = @${stage}`;
    if (pattern) {
        sql += `\n  PATTERN = '${pattern.replace(/'/g, "''")}'`;
    }
    sql += `\n  FILE_FORMAT = (FORMAT_NAME = '${fileFormat.replace(/'/g, "''")}')`;
    return sql;
}
/**
 * Build ALTER TABLE statements to apply @Snowflake.* annotation-driven features
 * after the base CREATE TABLE statement has been issued.
 *
 * This function is synchronous and returns an array of DDL strings.
 * The caller is responsible for executing them in order.
 *
 * Supported annotations (entity-level unless noted):
 *   @Snowflake.clustering        → ALTER TABLE ... CLUSTER BY (col1, col2)
 *   @Snowflake.dataRetentionDays → ALTER TABLE ... SET DATA_RETENTION_TIME_IN_DAYS = n
 *   @Snowflake.searchOptimized   → ALTER TABLE ... ADD SEARCH OPTIMIZATION
 *   @Snowflake.tags              → ALTER TABLE ... SET TAG key = 'value'
 *   @Snowflake.rowAccessPolicy   → ALTER TABLE ... ADD ROW ACCESS POLICY policy ON (cols)
 *   @Snowflake.maskingPolicy     → ALTER TABLE ... MODIFY COLUMN col SET MASKING POLICY policy
 *   @Snowflake.tags (per-column) → ALTER TABLE ... MODIFY COLUMN col SET TAG key = 'value'
 */
export function buildSnowflakeAnnotationStatements(entityName, definition, credentials) {
    const statements = [];
    const qualifiedTable = qualifyName(entityName, credentials);
    // CLUSTER BY
    const clusteringKeys = getClusteringKeys(definition);
    if (clusteringKeys && clusteringKeys.length > 0) {
        const cols = clusteringKeys.map(k => toPhysicalIdentifier(k)).join(', ');
        statements.push(`ALTER TABLE ${qualifiedTable} CLUSTER BY (${cols})`);
    }
    // DATA RETENTION
    const retentionDays = getDataRetentionDays(definition);
    if (retentionDays !== undefined) {
        statements.push(`ALTER TABLE ${qualifiedTable} SET DATA_RETENTION_TIME_IN_DAYS = ${retentionDays}`);
    }
    // SEARCH OPTIMIZATION
    if (isSearchOptimized(definition)) {
        statements.push(`ALTER TABLE ${qualifiedTable} ADD SEARCH OPTIMIZATION`);
    }
    // TABLE-LEVEL TAGS
    const tableTags = getTags(definition);
    if (tableTags) {
        for (const tag of tableTags) {
            const safeVal = tag.value.replace(/'/g, "''");
            statements.push(`ALTER TABLE ${qualifiedTable} SET TAG ${tag.key} = '${safeVal}'`);
        }
    }
    // ROW ACCESS POLICY
    const rowPolicy = getRowAccessPolicy(definition);
    if (rowPolicy) {
        const onCols = rowPolicy.on.map(c => toPhysicalIdentifier(c)).join(', ');
        statements.push(`ALTER TABLE ${qualifiedTable} ADD ROW ACCESS POLICY ${rowPolicy.policy} ON (${onCols})`);
    }
    // Per-column: MASKING POLICY + TAGS
    const elements = definition.elements ?? {};
    for (const [colName, element] of Object.entries(elements)) {
        const el = element;
        const physCol = toPhysicalIdentifier(colName);
        const maskingPolicy = getMaskingPolicy(el);
        if (maskingPolicy) {
            statements.push(`ALTER TABLE ${qualifiedTable} MODIFY COLUMN ${physCol} SET MASKING POLICY ${maskingPolicy}`);
        }
        const colTags = getTags(el);
        if (colTags) {
            for (const tag of colTags) {
                const safeVal = tag.value.replace(/'/g, "''");
                statements.push(`ALTER TABLE ${qualifiedTable} MODIFY COLUMN ${physCol} SET TAG ${tag.key} = '${safeVal}'`);
            }
        }
    }
    return statements;
}
function getPersistenceName(name, definition) {
    const customName = definition['@cds.persistence.name'];
    if (typeof customName === 'string' && customName.length > 0) {
        return customName.replace(/^"|"$/g, '');
    }
    // Derive from fully qualified entity name: replace dots with underscores and uppercase.
    // Matches the convention used by @cap-js/sqlite, @cap-js/hana, and cds.compile.for.sql().
    // e.g. cap_e2e.Books → CAP_E2E_BOOKS
    return name.replace(/\./g, '_').toUpperCase();
}
/**
 * Draft boolean columns that must default to FALSE so that Snowflake stores
 * the correct value when they are skipped by INSERT (they are marked
 * `virtual: true` in the CAP runtime model's Draft mixin, so adapters never
 * include them in generated INSERT statements).
 */
const DRAFT_BOOL_DEFAULTS = {
    IsActiveEntity: false,
    HasDraftEntity: false,
};
function toEntityDefinition(name, definition, entityName) {
    const elements = definition.elements || {};
    const mappedElements = {};
    const isDraftEntity = !!(entityName?.endsWith('.drafts'));
    for (const [elementName, element] of Object.entries(elements)) {
        // Skip associations/compositions/virtual elements; managed foreign keys are separate elements in linked CSN.
        if (element.virtual)
            continue;
        if (element.target || element.isAssociation)
            continue;
        if (!element.type)
            continue;
        // For draft tables, IsActiveEntity and HasDraftEntity need DEFAULT FALSE so
        // that rows inserted without these columns (they are virtual in the runtime
        // model) get FALSE rather than NULL.  Without the default, the PATCH handler
        // in lean-draft.js queries WHERE IsActiveEntity = false and finds nothing.
        let defaultVal = element.default?.val;
        if (isDraftEntity && defaultVal === undefined && elementName in DRAFT_BOOL_DEFAULTS) {
            defaultVal = DRAFT_BOOL_DEFAULTS[elementName];
        }
        const annotationCfg = getVectorConfig(element);
        const isNativeCdsVector = /^cds\.vector$/i.test(element.type ?? '');
        const vectorCfg = annotationCfg ?? (isNativeCdsVector ? { dimensions: element.length ?? 1536, similarity: 'COSINE' } : undefined);
        mappedElements[elementName] = {
            type: vectorCfg ? 'vector' : element.type,
            length: element.length,
            precision: element.precision,
            scale: element.scale,
            key: element.key,
            notNull: element.notNull || element.key || element['@mandatory'] === true,
            default: defaultVal,
            vectorConfig: vectorCfg,
        };
    }
    return {
        name,
        kind: 'entity',
        elements: mappedElements
    };
}
//# sourceMappingURL=deploy.js.map