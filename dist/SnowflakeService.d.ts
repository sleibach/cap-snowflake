/**
 * Main Snowflake Database Service
 */
import cds from '@sap/cds';
export declare class SnowflakeService extends cds.DatabaseService {
    private credentials;
    private sqlApiClient?;
    private sdkClient?;
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
     * Begin transaction
     */
    begin(): Promise<void>;
    /**
     * Commit transaction
     */
    commit(): Promise<void>;
    /**
     * Rollback transaction
     */
    rollback(): Promise<void>;
    /**
     * Disconnect
     */
    disconnect(): Promise<void>;
    /**
     * Deploy database schema (for cds deploy)
     */
    deploy(model?: any, options?: any): Promise<any>;
    private handleDeploy;
}
export default SnowflakeService;
//# sourceMappingURL=SnowflakeService.d.ts.map