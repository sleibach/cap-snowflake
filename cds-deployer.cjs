'use strict';
/**
 * CJS shim for the Snowflake deployer.
 *
 * cds-dk uses require('./to-snowflake') which only works with CommonJS.
 * This file is the CJS entry point; it delegates to the compiled ESM
 * module dist/cli/cds-deployer.js via dynamic import().
 */

async function deploy(model, db, options) {
  const { deploy: impl } = await import('./dist/cli/cds-deployer.js');
  return impl(model, db, options);
}

module.exports = { deploy };
