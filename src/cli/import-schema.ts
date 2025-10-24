#!/usr/bin/env node
/**
 * CLI tool to import Snowflake schema as CDS model
 */

import { writeFileSync } from 'fs';
import { resolve } from 'path';
import { getSnowflakeConfig } from '../config.js';
import { SnowflakeSchemaIntrospector, generateCDSModel } from '../introspect/schema.js';
import { logInfo, logError } from '../utils/logger.js';

async function main() {
  const args = process.argv.slice(2);
  
  // Parse arguments
  const outputFile = args.find(arg => arg.startsWith('--output='))?.split('=')[1] || 'db/schema.cds';
  const namespace = args.find(arg => arg.startsWith('--namespace='))?.split('=')[1] || 'imported';
  const schemaName = args.find(arg => arg.startsWith('--schema='))?.split('=')[1];

  if (args.includes('--help') || args.includes('-h')) {
    printHelp();
    process.exit(0);
  }

  console.log('🔍 Snowflake Schema Importer');
  console.log('================================\n');

  try {
    // Load configuration
    logInfo('Loading Snowflake configuration...');
    const config = getSnowflakeConfig();
    
    const schemaToIntrospect = schemaName || config.credentials.schema;
    if (!schemaToIntrospect) {
      throw new Error('Schema name not specified. Use --schema=SCHEMA_NAME or configure in cds.env');
    }

    logInfo(`Connecting to Snowflake account: ${config.credentials.account}`);
    logInfo(`Database: ${config.credentials.database}`);
    logInfo(`Schema: ${schemaToIntrospect}`);
    
    // Create introspector
    const introspector = new SnowflakeSchemaIntrospector(config.credentials);
    await introspector.connect();

    // Introspect schema
    console.log('\n📊 Introspecting schema...\n');
    const schemaDefinition = await introspector.introspectSchema(schemaToIntrospect);

    console.log(`\n✅ Found ${schemaDefinition.tables.size} tables/views:\n`);
    for (const [tableName, metadata] of schemaDefinition.tables) {
      const type = metadata.info.tableType === 'VIEW' ? 'VIEW' : 'TABLE';
      const pkCount = metadata.primaryKeys.length;
      const fkCount = metadata.foreignKeys.length;
      console.log(`   • ${tableName} (${type}) - ${metadata.columns.length} columns, ${pkCount} PK, ${fkCount} FK`);
    }

    // Generate CDS model
    console.log('\n📝 Generating CDS model...\n');
    const cdsModel = generateCDSModel(schemaDefinition, namespace);

    // Write to file
    const outputPath = resolve(process.cwd(), outputFile);
    writeFileSync(outputPath, cdsModel, 'utf-8');

    console.log(`✅ CDS model written to: ${outputPath}\n`);
    console.log('📋 Next steps:');
    console.log('   1. Review the generated model');
    console.log('   2. Add relationships and annotations as needed');
    console.log('   3. Define services using the imported entities\n');

    // Disconnect
    await introspector.disconnect();

    process.exit(0);
  } catch (error) {
    logError('Schema import failed', error);
    console.error('\n❌ Error:', (error as Error).message);
    process.exit(1);
  }
}

function printHelp() {
  console.log(`
Snowflake Schema Importer for CAP

Usage:
  npx cap-snowflake-import [options]

Options:
  --schema=NAME       Snowflake schema to introspect (default: from cds.env)
  --output=PATH       Output CDS file path (default: db/schema.cds)
  --namespace=NAME    CDS namespace (default: imported)
  --help, -h          Show this help

Examples:
  # Import default schema to db/schema.cds
  npx cap-snowflake-import

  # Import specific schema to custom location
  npx cap-snowflake-import --schema=MY_SCHEMA --output=db/imported.cds

  # Use custom namespace
  npx cap-snowflake-import --namespace=myapp.data

Environment:
  Reads Snowflake credentials from cds.env (package.json cds.requires.db)
  or environment variables (SNOWFLAKE_ACCOUNT, SNOWFLAKE_USER, etc.)
  `);
}

main();

