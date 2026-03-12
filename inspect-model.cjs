const cds = require('@sap/cds');
const path = require('path');
const FIXTURE_DIR = path.join(__dirname, 'test/e2e/fixtures');
// Load model files directly
cds.load([
  path.join(FIXTURE_DIR, 'db/schema.cds'),
  path.join(FIXTURE_DIR, 'srv/e2e-service.cds'),
]).then(m => {
  const entity = m.definitions['E2ETestService.Books.drafts'];
  if (!entity) { console.log('entity not found; keys:', Object.keys(m.definitions).filter(k => k.includes('Books'))); return; }
  const elems = {};
  for (const [k, v] of Object.entries(entity.elements || {})) {
    elems[k] = { virtual: v.virtual, hasTarget: v.target ? true : false, type: v.type };
  }
  console.log(JSON.stringify(elems, null, 2));
}).catch(e => console.error(e.message));
