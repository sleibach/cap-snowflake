/**
 * CDS plugin for cap-snowflake.
 *
 * Auto-discovered by @sap/cds from installed packages before any deployer
 * module is required.  Patches Module._resolveFilename so that cds-dk's
 * hardcoded  require('./to-' + kind)  (kind === 'snowflake')  is redirected
 * to our own deployer without modifying cds-dk itself.
 */

import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Access the CJS Module class to patch _resolveFilename
const _require = createRequire(import.meta.url);
const Module = _require('module');

const _orig = Module._resolveFilename.bind(Module);

Module._resolveFilename = function (request, parent, isMain, options) {
  // Intercept cds-dk's  require('./to-snowflake')
  if (request === './to-snowflake' ||
      (typeof request === 'string' && request.endsWith('/deploy/to-snowflake'))) {
    return join(__dirname, 'cds-deployer.cjs');
  }
  return _orig(request, parent, isMain, options);
};
