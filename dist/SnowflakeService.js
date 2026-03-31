/**
 * Main Snowflake Database Service
 */
import cds from '@sap/cds';
import { createRequire } from 'node:module';
import { getSnowflakeConfig } from './config.js';
import { SnowflakeSQLAPIClient } from './client/sqlapi.js';
import { SnowflakeSDKPool } from './client/sdk-pool.js';
import { cqnToSQL, generateMerge, resolveEntityName } from './cqn/toSQL.js';
import { qualifyName, toPhysicalIdentifier } from './identifiers.js';
import { wrapWithCount, stripPagination } from './cqn/pagination.js';
import { logInfo, logError, logWarning, logDebug, logSQL } from './utils/logger.js';
import { normalizeError, isAlreadyExistsError } from './utils/errors.js';
import { buildDeployStatements } from './ddl/deploy.js';
import { isTemporal, getTemporalFields } from './features/temporal.js';
import { parseTimeTravelHeader, injectTimeTravelClause } from './features/time-travel.js';
import { getVectorConfig } from './features/snowflake-native.js';
const _require = createRequire(import.meta.url);
const { onDeep } = _require('@cap-js/db-service/lib/deep-queries');
let _cqn4sql;
function getCqn4sql() {
    if (!_cqn4sql) {
        _cqn4sql = _require('@cap-js/db-service/lib/cqn4sql');
    }
    return _cqn4sql;
}
export class SnowflakeService extends cds.DatabaseService {
    credentials;
    sqlApiClient;
    /** Default SDK pool for single-tenant / non-multitenant SDK mode */
    sdkPool;
    /** Per-tenant SDK pools, keyed by tenant ID (multitenant SDK mode) */
    tenantSdkPools = new Map();
    /** SDK clients currently holding an open transaction, keyed by cds.context.id */
    activeTransactionClients = new Map();
    transactionStates = new Map();
    get inTransaction() {
        return this.transactionStates.get(cds.context?.id ?? 'default') ?? false;
    }
    set inTransaction(value) {
        const key = cds.context?.id ?? 'default';
        if (value) {
            this.transactionStates.set(key, true);
        }
        else {
            this.transactionStates.delete(key);
        }
    }
    /**
     * CAP v9 DatabaseService compatibility:
     * base class initializes pool metadata with `this.factory`.
     * For this adapter we manage connectivity ourselves (SQL API / SDK),
     * so this lightweight no-op factory is sufficient.
     */
    get factory() {
        return {
            create: async () => ({}),
            destroy: async () => { },
        };
    }
    /**
     * CAP v9 hook used by base tx handling.
     * Our adapter manages context at query level, so this is intentionally a no-op.
     */
    set(_variables) {
        return;
    }
    // ---------------------------------------------------------------------------
    // Multitenancy helpers
    // ---------------------------------------------------------------------------
    /**
     * True when the CAP application is configured for multitenancy.
     * Checks this.options.multiTenant (service-level override) then
     * cds.env.requires.multitenancy (global flag set by @sap/cds-mtxs).
     */
    get isMultitenant() {
        const opts = this.options ?? {};
        return ('multiTenant' in opts)
            ? Boolean(opts.multiTenant)
            : Boolean(cds.env.requires?.multitenancy);
    }
    /**
     * Derive the Snowflake schema name for the given tenant ID.
     * Convention: <tenantSchemaPrefix><TENANT_ID> (sanitised to a valid Snowflake identifier).
     * The prefix defaults to "TENANT_" but can be overridden in credentials.tenantSchemaPrefix.
     */
    resolveTenantSchema(tenant) {
        const prefix = this.credentials.tenantSchemaPrefix ?? 'TENANT_';
        return `${prefix}${tenant}`.toUpperCase().replace(/[^A-Z0-9_]/g, '_');
    }
    /**
     * Returns credentials with the schema overridden to the current tenant's schema
     * when multitenancy is active and cds.context.tenant is set.
     * Falls back to this.credentials (static schema) in all other cases.
     */
    getEffectiveCredentials() {
        if (!this.isMultitenant)
            return this.credentials;
        const tenant = cds.context?.tenant;
        if (!tenant)
            return this.credentials;
        return { ...this.credentials, schema: this.resolveTenantSchema(tenant) };
    }
    /**
     * Get (or lazily create) the SDK pool for the current tenant.
     * In non-multitenant mode returns the single default pool.
     */
    getTenantSdkPool() {
        if (!this.isMultitenant)
            return this.sdkPool;
        const tenant = cds.context?.tenant ?? '_default';
        let pool = this.tenantSdkPools.get(tenant);
        if (!pool) {
            pool = new SnowflakeSDKPool(this.getEffectiveCredentials());
            this.tenantSdkPools.set(tenant, pool);
        }
        return pool;
    }
    /**
     * Initialize the service
     */
    async init() {
        // Load configuration
        const config = getSnowflakeConfig(this.name);
        this.credentials = config.credentials;
        logInfo('Initializing Snowflake adapter', {
            account: this.credentials.account,
            database: this.credentials.database,
            schema: this.credentials.schema,
            auth: this.credentials.auth,
        });
        // Initialize appropriate client
        if (this.credentials.auth === 'jwt') {
            this.sqlApiClient = new SnowflakeSQLAPIClient(this.credentials);
            logInfo('Using Snowflake SQL API with JWT authentication');
        }
        else {
            // Use a connection pool for SDK mode so concurrent requests and
            // multitenant workloads each get their own dedicated connection.
            this.sdkPool = new SnowflakeSDKPool(this.credentials);
            // Warm up one connection to validate credentials at startup.
            const warmup = await this.sdkPool.acquire();
            this.sdkPool.release(warmup);
            logInfo('Using Snowflake SDK with password authentication (pooled)');
        }
        // Register deep insert/update/delete middleware (handles compositions)
        this.on(['INSERT', 'UPSERT', 'UPDATE'], onDeep.bind(this));
        // Register query handlers
        this.on('READ', '*', this.onRead.bind(this));
        this.on('INSERT', '*', this.onInsert.bind(this));
        this.on('UPDATE', '*', this.onUpdate.bind(this));
        this.on('DELETE', '*', this.onDelete.bind(this));
        this.on('UPSERT', '*', this.onUpsert.bind(this));
        // Wildcard handler for raw SQL strings (e.g. db.run('SELECT ...'))
        this.on('*', this.onPlainSQL.bind(this));
        // Snowflake-native: vector similarity search action
        this.on('vectorSearch', this.onVectorSearch.bind(this));
        // Call parent init
        return super.init();
    }
    /**
     * Handle READ operations
     * Supports expand (LEFT JOIN), temporal queries, and localized data
     */
    async onRead(req) {
        const query = req.query;
        try {
            const select = query.SELECT;
            if (!select) {
                throw new Error('Invalid SELECT query');
            }
            logDebug('READ', () => ({ entity: req.entity, query: query.SELECT }));
            // Check if $count is requested
            const needsCount = select.count;
            // Apply cqn4sql to convert navigation property references in WHERE clauses
            // (e.g. author/name) to proper SQL JOINs, matching the behavior of HANA/SQLite adapters.
            // Only apply when there are navigation property refs (multi-part, non-draft) in the WHERE
            // to avoid changing the column structure for expand queries.
            let transformedQuery = query;
            const hasNavFilter = hasNavigationPropertyFilter(select);
            if (hasNavFilter && this.model) {
                try {
                    transformedQuery = getCqn4sql()(query, this.model);
                    logDebug('cqn4sql applied (navigation property filter detected)');
                }
                catch {
                    // If cqn4sql fails (e.g. for raw queries), fall back to the original query
                    transformedQuery = query;
                    logDebug('cqn4sql skipped (transform failed, using original query)');
                }
            }
            // Temporal entity: inject point-in-time WHERE conditions if CAP has not done so.
            // CAP may set cds.context.timestamp from the sap-valid-at request header.
            // We apply validFrom <= ts AND ts < validTo so temporal filtering is respected.
            if (isTemporal(req.target)) {
                const temporalFields = getTemporalFields(req.target);
                if (temporalFields) {
                    const ctxTs = cds.context?.timestamp ?? req.timestamp;
                    const ts = ctxTs
                        ? (ctxTs instanceof Date ? ctxTs.toISOString() : String(ctxTs))
                        : new Date().toISOString();
                    const sel = transformedQuery.SELECT ?? {};
                    const temporalFilter = [
                        { ref: [temporalFields.validFrom] }, '<=', { val: ts },
                        'and', { val: ts }, '<', { ref: [temporalFields.validTo] }
                    ];
                    // Only inject if there are no existing temporal conditions already in WHERE
                    const whereStr = JSON.stringify(sel.where ?? []);
                    const alreadyHasTemporal = whereStr.includes(temporalFields.validFrom) &&
                        whereStr.includes(temporalFields.validTo);
                    if (!alreadyHasTemporal) {
                        sel.where = sel.where?.length
                            ? [...sel.where, 'and', ...temporalFilter]
                            : temporalFilter;
                        logDebug('temporal filter injected', { ts, fields: temporalFields });
                    }
                    else {
                        logDebug('temporal filter already present, skipped');
                    }
                }
            }
            // Translate to SQL (now with JOIN-based expand support)
            const { sql: initialSql, params } = cqnToSQL(transformedQuery, this.getEffectiveCredentials(), { target: req.target });
            // Snowflake Time Travel: inject AT clause when sap-snowflake-at header is present
            const timeTravelAt = parseTimeTravelHeader(req.headers ?? {});
            const sql = timeTravelAt ? injectTimeTravelClause(initialSql, timeTravelAt) : initialSql;
            if (timeTravelAt)
                logDebug('time travel AT clause injected', { at: timeTravelAt });
            if (this.shouldStreamRead(req, select)) {
                logDebug('streaming read');
                return this.executeStream(sql, params, req?.data?.batchSize);
            }
            // Execute query
            let rows = await this.execute(sql, params);
            logDebug(`READ returned ${rows.length} row${rows.length !== 1 ? 's' : ''}`);
            rows = this.mapRowKeysToElements(rows, req.target);
            // Restructure expanded results if needed
            rows = this.restructureExpands(rows, select);
            // Handle $count if requested
            if (needsCount) {
                // Strip LIMIT/OFFSET before wrapping — the count must reflect ALL matching rows,
                // not just the current page. wrapWithCount(sql) with a LIMIT would return the
                // page size (e.g. 30) instead of the true total.
                const countSQL = wrapWithCount(stripPagination(sql));
                const countResult = await this.execute(countSQL, params);
                const count = Number(countResult[0]?.count ?? countResult[0]?.COUNT ?? 0);
                logDebug(`$count result: ${count}`);
                // Attach $count to result set
                rows.$count = count;
                // Add @odata.nextLink when more pages exist
                const top = select.limit?.rows?.val;
                const skip = select.limit?.offset?.val ?? 0;
                if (top && skip + rows.length < count) {
                    const nextOffset = skip + top;
                    const nextToken = Buffer.from(String(nextOffset)).toString('base64');
                    rows['@odata.nextLink'] = `?$skiptoken=${nextToken}`;
                }
            }
            else {
                // Without $count, emit nextLink heuristically when result fills page exactly
                const top = select.limit?.rows?.val;
                if (top && rows.length === top) {
                    const skip = select.limit?.offset?.val ?? 0;
                    const nextToken = Buffer.from(String(skip + top)).toString('base64');
                    rows['@odata.nextLink'] = `?$skiptoken=${nextToken}`;
                }
            }
            // Return one or many
            if (select.one) {
                return rows.length > 0 ? rows[0] : null;
            }
            return rows;
        }
        catch (error) {
            logError('READ operation failed', error);
            throw normalizeError(error);
        }
    }
    shouldStreamRead(req, select) {
        return req?.data?.$stream === true || select?.stream === true;
    }
    /**
     * Restructure expanded results from flat JOIN to nested objects
     */
    restructureExpands(rows, select) {
        if (!select.columns)
            return rows;
        // Check for expand columns
        const hasExpands = select.columns.some((col) => col.expand || col.inline);
        if (!hasExpands)
            return rows;
        return rows.map(row => {
            const result = {};
            const expanded = new Map();
            // Separate base and expanded fields
            for (const [key, value] of Object.entries(row)) {
                // To-many expansions are returned as aggregated JSON arrays under association name.
                const toManyCol = select.columns.find((col) => col.expand && col.ref?.[0] === key);
                if (toManyCol) {
                    // ARRAY_AGG returns null when no rows match; normalize to empty array.
                    result[key] = value == null ? [] : value;
                    continue;
                }
                // Check if this is an expanded field (contains association name prefix)
                let isExpandField = false;
                for (const col of select.columns) {
                    if (col.expand && col.ref) {
                        const assocName = col.ref[0];
                        // Expand columns use "__" (double underscore) as separator to avoid
                        // aliasing collisions with base FK columns (e.g. author_ID).
                        if (key.startsWith(`${assocName}__`)) {
                            const fieldSuffix = key.substring(assocName.length + 2);
                            if (!expanded.has(assocName))
                                expanded.set(assocName, {});
                            const nestedPath = fieldSuffix.split('__');
                            this.assignNested(expanded.get(assocName), nestedPath, value);
                            isExpandField = true;
                            break;
                        }
                    }
                }
                if (!isExpandField) {
                    result[key] = value;
                }
            }
            // Attach expanded objects
            for (const [assocName, data] of expanded.entries()) {
                // Check if all values are null (no related record)
                const hasData = Object.values(data).some(v => v !== null);
                result[assocName] = hasData ? data : null;
            }
            return result;
        });
    }
    assignNested(target, path, value) {
        if (path.length === 0)
            return;
        if (path.length === 1) {
            target[path[0]] = value;
            return;
        }
        const [head, ...tail] = path;
        if (!target[head] || typeof target[head] !== 'object') {
            target[head] = {};
        }
        this.assignNested(target[head], tail, value);
    }
    mapRowKeysToElements(rows, target) {
        const elements = target?.elements;
        if (!Array.isArray(rows))
            return rows;
        const elementNames = elements ? Object.keys(elements) : [];
        if (!elementNames.length && !elements) {
            return rows.map((row) => this.mapUppercaseFallback(row));
        }
        return rows.map((row) => {
            const mapped = {};
            for (const [key, value] of Object.entries(row)) {
                const exact = elementNames.find((n) => n === key);
                if (exact) {
                    mapped[exact] = value;
                    continue;
                }
                const caseInsensitive = elementNames.find((n) => n.toUpperCase() === key.toUpperCase());
                if (caseInsensitive) {
                    mapped[caseInsensitive] = value;
                    continue;
                }
                mapped[key] = value;
            }
            return mapped;
        });
    }
    mapUppercaseFallback(row) {
        const out = {};
        for (const [key, value] of Object.entries(row)) {
            if (/^[A-Z0-9_]+$/.test(key)) {
                out[key.toLowerCase()] = value;
            }
            else {
                out[key] = value;
            }
        }
        return out;
    }
    /**
     * Check if entity has annotation
     */
    hasAnnotation(entity, annotation) {
        if (!entity)
            return false;
        // Check entity definition for annotation
        return entity[`@${annotation}`] !== undefined;
    }
    /**
     * Get custom table/column name from @cds.persistence.name
     */
    getCustomName(definition) {
        return definition?.['@cds.persistence.name'];
    }
    /**
     * Direct-call adapters used by deep-queries.js (onDeep calls this.onINSERT etc.)
     */
    async onINSERT(req) { return this.onInsert(req); }
    async onUPDATE(req) { return this.onUpdate(req); }
    async onDELETE(req) { return this.onDelete(req); }
    /**
     * Handle INSERT operations
     */
    async onInsert(req) {
        const query = req.query;
        try {
            const insert = query.INSERT;
            if (!insert) {
                throw new Error('Invalid INSERT query');
            }
            logDebug('INSERT', () => ({ entity: req.entity, entries: insert.entries?.length ?? 1 }));
            // For draft entities, ensure IsActiveEntity=false is included in the data
            // BEFORE generating SQL — otherwise Snowflake stores it as NULL and draft
            // filter queries (IsActiveEntity eq false) return no results.
            const insertIntoName = typeof insert.into === 'string' ? insert.into
                : (insert.into?.ref?.[0]?.id ?? insert.into?.ref?.[0] ?? '');
            const isDraft = req.target?.name?.endsWith('.drafts') ||
                (typeof insertIntoName === 'string' && insertIntoName.endsWith('.drafts'));
            if (isDraft && insert.entries) {
                for (const entry of insert.entries) {
                    if (entry.IsActiveEntity === undefined)
                        entry.IsActiveEntity = false;
                    if (entry.HasActiveEntity === undefined)
                        entry.HasActiveEntity = false;
                    if (entry.HasDraftEntity === undefined)
                        entry.HasDraftEntity = false;
                }
            }
            const { sql, params } = cqnToSQL(query, this.getEffectiveCredentials(), { target: req.target });
            await this.execute(sql, params);
            // Return inserted entries for CAP
            if (insert.entries) {
                const result = insert.entries.length === 1 ? insert.entries[0] : insert.entries;
                return result;
            }
            return req.data;
        }
        catch (error) {
            logError('INSERT operation failed', error);
            throw normalizeError(error);
        }
    }
    /**
     * Handle UPDATE operations
     */
    async onUpdate(req) {
        const query = req.query;
        try {
            const update = query.UPDATE;
            if (!update) {
                throw new Error('Invalid UPDATE query');
            }
            logDebug('UPDATE', () => ({ entity: req.entity }));
            // Note: CAP runtime handles @readonly/@insertonly checks before reaching adapter
            // Note: CAP runtime updates managed fields (modifiedAt, modifiedBy) automatically
            const { sql, params } = cqnToSQL(query, this.getEffectiveCredentials(), { target: req.target });
            const result = await this.execute(sql, params);
            const rowCount = extractDMLRowCount(result);
            logDebug(`UPDATE affected ${rowCount} row${rowCount !== 1 ? 's' : ''}`);
            // Return 404 when a keyed UPDATE finds no matching row (e.g. PATCH on non-existent entity).
            // Skip this check for internal CAP draft/system entities which may legitimately update 0 rows.
            const entityName = req.entity ?? '';
            const isInternalEntity = entityName.toLowerCase().includes('draft');
            if (rowCount === 0 && !isInternalEntity) {
                return req.reject(404, `${entityName || 'Entity'} not found`);
            }
            return rowCount;
        }
        catch (error) {
            logError('UPDATE operation failed', error);
            throw normalizeError(error);
        }
    }
    /**
     * Handle DELETE operations — with cascade delete for compositions.
     */
    async onDelete(req) {
        const query = req.query;
        try {
            const del = query.DELETE;
            if (!del) {
                throw new Error('Invalid DELETE query');
            }
            logDebug('DELETE', () => ({ entity: req.entity }));
            const target = req.target;
            const compositions = target?.compositions ?? {};
            // Cascade delete: delete child composition rows BEFORE the parent.
            for (const [, comp] of Object.entries(compositions)) {
                const childTarget = comp._target;
                if (!childTarget || childTarget['@cds.persistence.skip'] === true)
                    continue;
                // Find the FK column name on the child table.
                // Composition 'on' conditions look like: [{ ref: ['items', 'catalog_ID'] }, '=', { ref: ['$self', 'ID'] }]
                // Or for association-based: [{ ref: ['items', 'catalog'] }, '=', { ref: ['$self'] }]
                // where 'catalog' is the association name; the physical FK column is 'catalog_ID'.
                const onCondition = comp.on ?? [];
                let childFKName = '';
                for (let i = 0; i < onCondition.length; i++) {
                    const el = onCondition[i];
                    if (el?.ref && el.ref.length === 2 && typeof el.ref[1] === 'string') {
                        const candidate = el.ref[1];
                        // If the child entity has an element with this exact name AND it's an association,
                        // the physical FK column is candidate + '_ID'.
                        const childEl = childTarget?.elements?.[candidate];
                        if (childEl?.type === 'cds.Association' || childEl?.isAssociation) {
                            childFKName = candidate + '_ID';
                        }
                        else {
                            childFKName = candidate;
                        }
                        break;
                    }
                }
                // Fallback: look for any association element on the child that targets the parent
                if (!childFKName && childTarget?.elements) {
                    const parentName = target?.name ?? '';
                    for (const [elName, el] of Object.entries(childTarget.elements)) {
                        if ((el?.isAssociation || el?.type === 'cds.Association') && el?.target === parentName) {
                            childFKName = elName + '_ID';
                            break;
                        }
                    }
                }
                if (!childFKName)
                    childFKName = 'ID';
                const parentTable = this.resolvePhysicalTable(target);
                const childTable = this.resolvePhysicalTable(childTarget);
                // Generate: DELETE FROM childTable WHERE fkCol IN (SELECT ID FROM parentTable WHERE <parent.where>)
                const { sql: parentSql, params: parentParams } = cqnToSQL(query, this.getEffectiveCredentials(), { target });
                const whereIdx = parentSql.indexOf(' WHERE ');
                if (whereIdx !== -1) {
                    const whereClause = parentSql.substring(whereIdx + 7);
                    const childDeleteSQL = `DELETE FROM ${childTable} WHERE ${toPhysicalIdentifier(childFKName)} IN (SELECT ID FROM ${parentTable} WHERE ${whereClause})`;
                    await this.execute(childDeleteSQL, parentParams);
                }
                else {
                    // No WHERE on parent delete — delete all children
                    await this.execute(`DELETE FROM ${childTable}`, []);
                }
            }
            const { sql, params } = cqnToSQL(query, this.getEffectiveCredentials(), { target });
            const result = await this.execute(sql, params);
            const rowCount = extractDMLRowCount(result);
            logDebug(`DELETE affected ${rowCount} row${rowCount !== 1 ? 's' : ''}`);
            // Return 404 when a keyed DELETE finds no matching row.
            // Skip for internal CAP draft/system entities.
            const entityName = req.entity ?? '';
            const isInternalEntity = entityName.toLowerCase().includes('draft');
            if (rowCount === 0 && !isInternalEntity) {
                return req.reject(404, `${entityName || 'Entity'} not found`);
            }
            return rowCount;
        }
        catch (error) {
            logError('DELETE operation failed', error);
            throw normalizeError(error);
        }
    }
    /**
     * Resolve the physical fully-qualified table name for a CDS entity.
     */
    resolvePhysicalTable(target) {
        const entityName = target?.name ?? '';
        const physicalName = resolveEntityName(entityName, target);
        // resolveEntityName may return the service-prefixed name (e.g. "E2ETestService.CatalogItems")
        // if no @cds.persistence.name annotation and no projection chain is found.
        // Extract the last segment and let qualifyName add db/schema prefix.
        const shortName = physicalName.includes('.') ? physicalName.split('.').pop() : physicalName;
        return qualifyName(shortName, this.getEffectiveCredentials());
    }
    /**
     * Handle UPSERT operations (using MERGE)
     */
    async onUpsert(req) {
        const query = req.query;
        try {
            const upsert = query.UPSERT;
            if (!upsert)
                throw new Error('Invalid UPSERT query');
            const entity = upsert.into?.ref?.[0] ?? upsert.into;
            const target = req.target;
            const keys = target?.keys ? Object.keys(target.keys) : ['ID'];
            const entries = upsert.entries ?? (upsert.entry ? [upsert.entry] : [req.data]);
            logDebug('UPSERT', () => ({ entity: req.entity, entries: entries.length, keys }));
            for (const entry of entries) {
                const { sql, params } = generateMerge(entity, keys, entry, this.getEffectiveCredentials());
                await this.execute(sql, params);
            }
            return entries;
        }
        catch (error) {
            logError('UPSERT operation failed', error);
            throw normalizeError(error);
        }
    }
    /**
     * Handle raw SQL strings passed via db.run('SELECT ...') or db.exec('...')
     * Mirrors the SQLService.onPlainSQL wildcard handler from @cap-js/db-service.
     */
    async onPlainSQL(req, next) {
        const { query, data } = req;
        if (typeof query !== 'string')
            return next();
        const isSelect = /^\s*(SELECT|WITH|SHOW|DESCRIBE)\b/i.test(query);
        try {
            if (Array.isArray(data) && Array.isArray(data[0])) {
                // Batch: array of param arrays
                const results = await Promise.all(data.map((row) => this.execute(query, row)));
                return isSelect ? results.flat() : results;
            }
            const params = Array.isArray(data) ? data : data != null ? [data] : undefined;
            return await this.execute(query, params);
        }
        catch (error) {
            logError('Plain SQL execution failed', error);
            throw normalizeError(error);
        }
    }
    /**
     * Execute SQL statement
     */
    async execute(sql, params) {
        logSQL(sql, params);
        if (this.sqlApiClient) {
            const result = await this.sqlApiClient.execute(sql, params);
            return SnowflakeSQLAPIClient.parseRows(result);
        }
        else if (this.sdkPool) {
            const txKey = cds.context?.id ?? 'default';
            const txClient = this.activeTransactionClients.get(txKey);
            if (txClient) {
                // Within an open transaction: reuse the dedicated client
                const result = await txClient.execute(sql, params);
                return result.rows;
            }
            // Non-transaction: acquire from the (tenant-)pool, execute, release
            const pool = this.getTenantSdkPool();
            const client = await pool.acquire();
            try {
                const result = await client.execute(sql, params);
                return result.rows;
            }
            finally {
                pool.release(client);
            }
        }
        throw new Error('No client available');
    }
    async executeStream(sql, params, batchSize) {
        const effectiveBatchSize = typeof batchSize === 'number' ? batchSize : 1000;
        if (this.sqlApiClient && this.sqlApiClient.queryStream) {
            return this.sqlApiClient.queryStream(sql, params, { batchSize: effectiveBatchSize });
        }
        else if (this.sdkPool) {
            // For SDK streaming, acquire from pool. Note: the client is released when the
            // stream is fully consumed via execute() fallback below — streaming over SDK
            // connections that need to be returned to the pool is not yet implemented.
            const txKey = cds.context?.id ?? 'default';
            const client = this.activeTransactionClients.get(txKey);
            if (client?.queryStream) {
                return client.queryStream(sql, params, { batchSize: effectiveBatchSize });
            }
        }
        return this.execute(sql, params);
    }
    /**
     * Begin transaction.
     *
     * SQL API mode: the HTTP API is stateless — every statement auto-commits and
     * explicit transaction control commands (BEGIN TRANSACTION etc.) are rejected
     * with error 391911. CAP still calls begin()/commit()/rollback() around every
     * request, so we track the state flag but send no SQL over the wire.
     *
     * SDK mode: delegates to the native driver's transaction support.
     */
    async begin() {
        if (this.inTransaction) {
            logDebug('transaction already in progress, begin() is a no-op', { contextId: cds.context?.id ?? 'default' });
            return;
        }
        if (this.transactionStates.size > 500) {
            logWarning(`transactionStates map has ${this.transactionStates.size} entries — possible context ID leak`);
        }
        try {
            if (this.sdkPool) {
                // Acquire a dedicated connection for this transaction and hold it until
                // commit/rollback so all statements in the tx run on the same connection.
                const pool = this.getTenantSdkPool();
                const client = await pool.acquire();
                const txKey = cds.context?.id ?? 'default';
                this.activeTransactionClients.set(txKey, client);
                await client.beginTransaction();
            }
            // SQL API: intentional no-op — stateless HTTP requests auto-commit
            this.inTransaction = true;
            logDebug('transaction started', { mode: this.sdkPool ? 'sdk' : 'sql-api (auto-commit)', contextId: cds.context?.id ?? 'default' });
        }
        catch (error) {
            logError('Failed to begin transaction', error);
            throw normalizeError(error);
        }
    }
    /**
     * Commit transaction.
     * SQL API mode: no-op (see begin()).
     */
    async commit() {
        if (!this.inTransaction) {
            return;
        }
        try {
            if (this.sdkPool) {
                const txKey = cds.context?.id ?? 'default';
                const client = this.activeTransactionClients.get(txKey);
                if (client) {
                    await client.commit();
                    this.getTenantSdkPool().release(client);
                    this.activeTransactionClients.delete(txKey);
                }
            }
            // SQL API: intentional no-op
            this.inTransaction = false;
            logDebug('transaction committed', { mode: this.sdkPool ? 'sdk' : 'sql-api (auto-commit)', contextId: cds.context?.id ?? 'default' });
        }
        catch (error) {
            logError('Failed to commit transaction', error);
            throw normalizeError(error);
        }
    }
    /**
     * Rollback transaction.
     * SQL API mode: no-op (see begin()). CAP may call this on error paths;
     * individual statements have already auto-committed, so this is best-effort.
     */
    async rollback() {
        if (!this.inTransaction) {
            return;
        }
        try {
            if (this.sdkPool) {
                const txKey = cds.context?.id ?? 'default';
                const client = this.activeTransactionClients.get(txKey);
                if (client) {
                    await client.rollback();
                    this.getTenantSdkPool().release(client);
                    this.activeTransactionClients.delete(txKey);
                }
            }
            // SQL API: intentional no-op
            this.inTransaction = false;
            logDebug('transaction rolled back', { mode: this.sdkPool ? 'sdk' : 'sql-api (auto-commit)', contextId: cds.context?.id ?? 'default' });
        }
        catch (error) {
            logError('Failed to rollback transaction', error);
            throw normalizeError(error);
        }
    }
    /**
     * Disconnect.
     *
     * When called with a tenant ID (by MTX on tenant unsubscribe) only that
     * tenant's connection pool is drained, leaving all other tenants running.
     * When called without arguments the full adapter is shut down.
     */
    async disconnect(tenant) {
        try {
            if (tenant) {
                // Tenant-specific teardown (MTX unsubscribe path):
                // 1. Drain SDK pool for this tenant
                const pool = this.tenantSdkPools.get(tenant);
                if (pool) {
                    await pool.destroyAll();
                    this.tenantSdkPools.delete(tenant);
                    logInfo(`Disconnected tenant SDK pool: ${tenant}`);
                }
                // 2. Drop the tenant schema (equivalent to dropping an HDI container in HANA).
                //    This permanently removes all tenant data — only called on unsubscribe.
                if (this.isMultitenant) {
                    const tenantSchema = this.resolveTenantSchema(tenant);
                    const dbPrefix = this.credentials.database
                        ? `${toPhysicalIdentifier(this.credentials.database)}.`
                        : '';
                    await this.execute(`DROP SCHEMA IF EXISTS ${dbPrefix}${toPhysicalIdentifier(tenantSchema)} CASCADE`);
                    logInfo(`Dropped tenant schema: ${tenantSchema}`, { tenant });
                }
                return;
            }
            // Full shutdown
            if (this.sdkPool) {
                await this.sdkPool.destroyAll();
            }
            for (const pool of this.tenantSdkPools.values()) {
                await pool.destroyAll().catch(() => { });
            }
            this.tenantSdkPools.clear();
            logInfo('Disconnected from Snowflake');
        }
        catch (error) {
            logError('Failed to disconnect', error);
            throw normalizeError(error);
        }
    }
    /**
     * Deploy database schema (for cds deploy)
     */
    async deploy(model, options) {
        const effectiveModel = model || this.model;
        await this.handleDeploy(effectiveModel, options);
        return effectiveModel;
    }
    /**
     * Snowflake-native: VECTOR similarity search action.
     *
     * Invoked via:  await db.run('vectorSearch', { entity, queryVector, topK, similarityFn })
     *
     * Parameters:
     *   entity       — Entity name (e.g. 'my.Books')
     *   queryVector  — Array of floats representing the query embedding
     *   topK         — Number of top results to return (default: 10)
     *   similarityFn — 'COSINE' | 'DOT_PRODUCT' | 'EUCLIDEAN' (default: 'COSINE')
     *
     * Finds the vector column on the entity (first element with @Snowflake.vector),
     * then executes a ranked similarity search using Snowflake's built-in functions.
     */
    async onVectorSearch(req) {
        const { entity, queryVector, topK = 10, similarityFn = 'COSINE' } = req.data ?? {};
        if (!entity || !Array.isArray(queryVector) || queryVector.length === 0) {
            return req.reject(400, 'vectorSearch requires entity, queryVector (non-empty array)');
        }
        // Resolve the entity definition to find the vector column
        const entityDef = this.model?.definitions?.[entity];
        if (!entityDef) {
            return req.reject(404, `Entity '${entity}' not found in model`);
        }
        let vectorCol;
        const elements = entityDef.elements ?? {};
        for (const [name, el] of Object.entries(elements)) {
            if (getVectorConfig(el) || /^cds\.vector$/i.test(el.type ?? '')) {
                vectorCol = name.toUpperCase();
                break;
            }
        }
        if (!vectorCol) {
            return req.reject(400, `Entity '${entity}' has no vector element (cds.Vector type or @Snowflake.vector annotation)`);
        }
        const { qualifyName: qualify } = await import('./identifiers.js');
        const tableName = entityDef['@cds.persistence.name'] ?? entity.replace(/\./g, '_').toUpperCase();
        const qualifiedTable = qualify(tableName, this.getEffectiveCredentials());
        const vecLiteral = `[${queryVector.join(',')}]::VECTOR(FLOAT, ${queryVector.length})`;
        const fnMap = {
            COSINE: 'VECTOR_COSINE_SIMILARITY',
            DOT_PRODUCT: 'VECTOR_INNER_PRODUCT',
            EUCLIDEAN: 'VECTOR_L2_DISTANCE',
        };
        const fn = fnMap[similarityFn.toUpperCase()] ?? 'VECTOR_COSINE_SIMILARITY';
        // For distance functions (L2), lower is better — use ASC; for similarity, DESC
        const order = fn === 'VECTOR_L2_DISTANCE' ? 'ASC' : 'DESC';
        const sql = `SELECT *, ${fn}(${vectorCol}, ${vecLiteral}) AS _score FROM ${qualifiedTable} ORDER BY _score ${order} LIMIT ${Number(topK)}`;
        try {
            const rows = await this.execute(sql, []);
            return rows;
        }
        catch (error) {
            logError('vectorSearch failed', error);
            throw normalizeError(error);
        }
    }
    async handleDeploy(model, options) {
        logInfo('Deploy operation called', options);
        if (!model) {
            throw new Error('Deploy requires a CDS model');
        }
        const effectiveCreds = this.getEffectiveCredentials();
        // Multitenancy: ensure the tenant schema exists before deploying tables into it.
        // CAP's MTX sidecar calls deploy() once per tenant with cds.context.tenant set.
        if (this.isMultitenant) {
            const tenant = cds.context?.tenant;
            if (tenant) {
                const tenantSchema = this.resolveTenantSchema(tenant);
                const dbPrefix = effectiveCreds.database
                    ? `${toPhysicalIdentifier(effectiveCreds.database)}.`
                    : '';
                await this.execute(`CREATE SCHEMA IF NOT EXISTS ${dbPrefix}${toPhysicalIdentifier(tenantSchema)}`);
                logInfo(`Created/verified tenant schema: ${tenantSchema}`, { tenant });
            }
        }
        const statements = buildDeployStatements(model, effectiveCreds, {
            createViews: options?.createViews !== false
        });
        if (statements.length === 0) {
            logWarning('No deploy statements generated for provided model');
            return;
        }
        for (const sql of statements) {
            try {
                await this.execute(sql);
            }
            catch (error) {
                // Snowflake may return "already exists" for views/tables from previous runs.
                if (isAlreadyExistsError(error)) {
                    logWarning('Deploy statement skipped (already exists)', { sql });
                    continue;
                }
                throw error;
            }
        }
        logInfo('Deploy operation finished', { statements: statements.length });
    }
}
/**
 * Extract the number of rows affected from a Snowflake DML result.
 * DML results have a single metadata row like { "number of rows updated": 1 }.
 */
function extractDMLRowCount(result) {
    if (!result || result.length === 0)
        return 0;
    const row = result[0];
    if (!row || typeof row !== 'object')
        return 0;
    for (const key of Object.keys(row)) {
        if (key.toLowerCase().startsWith('number of rows')) {
            const count = Number(row[key]);
            return isNaN(count) ? 0 : count;
        }
    }
    // Fallback: if result has rows but no "number of rows" key, assume 1 row affected
    return result.length;
}
/**
 * Detect whether a SELECT has navigation property references (multi-part refs like author/name)
 * in its WHERE clause that require cqn4sql JOIN expansion.
 */
const DRAFT_NAV_LOWER = new Set(['siblingentity', 'draftadministrativedata', 'isactiveentity', 'hasactiveentity', 'hasdraftentity']);
function hasNavigationPropertyFilter(select) {
    const hasNavRef = (el) => {
        if (!el || typeof el !== 'object')
            return false;
        if (el.ref && Array.isArray(el.ref) && el.ref.length > 1) {
            const firstPart = typeof el.ref[0] === 'string' ? el.ref[0] : el.ref[0]?.id ?? el.ref[0]?.name ?? '';
            if (DRAFT_NAV_LOWER.has(String(firstPart).toLowerCase()))
                return false;
            return true;
        }
        return false;
    };
    const where = select?.where;
    if (Array.isArray(where) && where.length > 0 && where.some(hasNavRef))
        return true;
    // Also check groupBy for star schema navigation paths (e.g. book/title)
    const groupBy = select?.groupBy;
    if (Array.isArray(groupBy) && groupBy.length > 0 && groupBy.some(hasNavRef))
        return true;
    return false;
}
// Export as default
export default SnowflakeService;
//# sourceMappingURL=SnowflakeService.js.map