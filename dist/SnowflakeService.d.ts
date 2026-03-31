/**
 * Main Snowflake Database Service
 */
import cds from '@sap/cds';
export declare class SnowflakeService extends cds.DatabaseService {
    private credentials;
    private sqlApiClient?;
    /** Default SDK pool for single-tenant / non-multitenant SDK mode */
    private sdkPool?;
    /** Per-tenant SDK pools, keyed by tenant ID (multitenant SDK mode) */
    private tenantSdkPools;
    /** SDK clients currently holding an open transaction, keyed by cds.context.id */
    private activeTransactionClients;
    private transactionStates;
    private get inTransaction();
    private set inTransaction(value);
    /**
     * CAP v9 DatabaseService compatibility:
     * base class initializes pool metadata with `this.factory`.
     * For this adapter we manage connectivity ourselves (SQL API / SDK),
     * so this lightweight no-op factory is sufficient.
     */
    get factory(): {
        create: () => Promise<{}>;
        destroy: () => Promise<void>;
    };
    /**
     * CAP v9 hook used by base tx handling.
     * Our adapter manages context at query level, so this is intentionally a no-op.
     */
    set(_variables: any): void;
    /**
     * True when the CAP application is configured for multitenancy.
     * Checks this.options.multiTenant (service-level override) then
     * cds.env.requires.multitenancy (global flag set by @sap/cds-mtxs).
     */
    private get isMultitenant();
    /**
     * Derive the Snowflake schema name for the given tenant ID.
     * Convention: <tenantSchemaPrefix><TENANT_ID> (sanitised to a valid Snowflake identifier).
     * The prefix defaults to "TENANT_" but can be overridden in credentials.tenantSchemaPrefix.
     */
    private resolveTenantSchema;
    /**
     * Returns credentials with the schema overridden to the current tenant's schema
     * when multitenancy is active and cds.context.tenant is set.
     * Falls back to this.credentials (static schema) in all other cases.
     */
    private getEffectiveCredentials;
    /**
     * Get (or lazily create) the SDK pool for the current tenant.
     * In non-multitenant mode returns the single default pool.
     */
    private getTenantSdkPool;
    /**
     * Initialize the service
     */
    init(): Promise<void>;
    /**
     * Handle READ operations
     * Supports expand (LEFT JOIN), temporal queries, and localized data
     */
    private onRead;
    private shouldStreamRead;
    /**
     * Restructure expanded results from flat JOIN to nested objects
     */
    private restructureExpands;
    private assignNested;
    private mapRowKeysToElements;
    private mapUppercaseFallback;
    /**
     * Check if entity has annotation
     */
    private hasAnnotation;
    /**
     * Get custom table/column name from @cds.persistence.name
     */
    private getCustomName;
    /**
     * Direct-call adapters used by deep-queries.js (onDeep calls this.onINSERT etc.)
     */
    onINSERT(req: any): Promise<any>;
    onUPDATE(req: any): Promise<any>;
    onDELETE(req: any): Promise<any>;
    /**
     * Handle INSERT operations
     */
    private onInsert;
    /**
     * Handle UPDATE operations
     */
    private onUpdate;
    /**
     * Handle DELETE operations — with cascade delete for compositions.
     */
    private onDelete;
    /**
     * Resolve the physical fully-qualified table name for a CDS entity.
     */
    private resolvePhysicalTable;
    /**
     * Handle UPSERT operations (using MERGE)
     */
    private onUpsert;
    /**
     * Handle raw SQL strings passed via db.run('SELECT ...') or db.exec('...')
     * Mirrors the SQLService.onPlainSQL wildcard handler from @cap-js/db-service.
     */
    private onPlainSQL;
    /**
     * Execute SQL statement
     */
    private execute;
    private executeStream;
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
    begin(): Promise<void>;
    /**
     * Commit transaction.
     * SQL API mode: no-op (see begin()).
     */
    commit(): Promise<void>;
    /**
     * Rollback transaction.
     * SQL API mode: no-op (see begin()). CAP may call this on error paths;
     * individual statements have already auto-committed, so this is best-effort.
     */
    rollback(): Promise<void>;
    /**
     * Disconnect.
     *
     * When called with a tenant ID (by MTX on tenant unsubscribe) only that
     * tenant's connection pool is drained, leaving all other tenants running.
     * When called without arguments the full adapter is shut down.
     */
    disconnect(tenant?: string): Promise<void>;
    /**
     * Deploy database schema (for cds deploy)
     */
    deploy(model?: any, options?: any): Promise<any>;
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
    private onVectorSearch;
    private handleDeploy;
}
export default SnowflakeService;
//# sourceMappingURL=SnowflakeService.d.ts.map