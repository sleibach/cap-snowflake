/**
 * Deployer module invoked by `cds deploy` when the database kind is 'snowflake'.
 *
 * cds-dk calls:  deployer.deploy(_model, _db, options)
 * where options may contain: { dry, xdry, schema_log, messages, ... }
 *
 * Loaded via the Module._resolveFilename patch in cds-plugin.js.
 */
import cds from '@sap/cds';
import { buildDeployStatements } from '../ddl/deploy.js';
import { loadCsvData } from '../ddl/csv.js';
import { SnowflakeSQLAPIClient } from '../client/sqlapi.js';
import { SnowflakeSDKClient } from '../client/sdk.js';
export async function deploy(_model, _db, options) {
    // Load model if not already provided by cds-dk
    const model = (_model && Object.keys(_model).length > 0)
        ? _model
        : await cds.load('*');
    // Resolve credentials from cds.env (set by cds-dk after loading plugins)
    const rawCreds = cds.env.requires?.db?.credentials;
    if (!rawCreds) {
        throw new Error('No Snowflake credentials found.\n' +
            'Add credentials to .cdsrc-private.json:\n' +
            '  { "cds": { "requires": { "db": { "credentials": { ... } } } } }');
    }
    const creds = { ...rawCreds };
    if (!creds.host)
        creds.host = `${creds.account}.snowflakecomputing.com`;
    const statements = buildDeployStatements(model, creds, { createViews: true });
    // Dry-run: print or collect statements without executing
    if (options.dry || options.xdry) {
        for (const stmt of statements) {
            if (Array.isArray(options.schema_log)) {
                options.schema_log.push(stmt);
            }
            else {
                console.log(stmt + ';\n');
            }
        }
        return;
    }
    // Execute statements against Snowflake
    const isSQLAPI = creds.auth === 'jwt';
    const client = isSQLAPI
        ? new SnowflakeSQLAPIClient(creds)
        : new SnowflakeSDKClient(creds);
    if (client instanceof SnowflakeSDKClient)
        await client.connect();
    for (const stmt of statements) {
        const label = stmt.split('\n')[0].slice(0, 80);
        try {
            await client.execute(stmt);
            if (Array.isArray(options.messages)) {
                options.messages.push({ msg: `  ✓  ${label}` });
            }
        }
        catch (err) {
            const msg = err?.response?.data?.message ?? err?.message ?? '';
            if (msg.toLowerCase().includes('already exists')) {
                // Idempotent — table/view already exists, skip silently
                if (Array.isArray(options.messages)) {
                    options.messages.push({ msg: `  –  ${label} (already exists, skipped)` });
                }
                continue;
            }
            throw err;
        }
    }
    // Load CSV initial data (db/data/*.csv) — idempotent MERGE
    if (!options.dry && !options.xdry) {
        const csvResult = await loadCsvData(model, creds, client);
        if (csvResult.loaded > 0 && Array.isArray(options.messages)) {
            options.messages.push({ msg: `  ✓  Loaded ${csvResult.loaded} rows from CSV data files` });
        }
    }
}
//# sourceMappingURL=cds-deployer.js.map