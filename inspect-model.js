const cds = require('@sap/cds');
process.chdir('/Users/soeren.leibach/Projects/cds-plugins/cap-snowflake/test/e2e/fixtures');
cds.load('.').then(m => {
  const entity = m.definitions['E2ETestService.Books.drafts'];
  if (!entity) { console.log('entity not found'); return; }
  const elems = {};
  for (const [k, v] of Object.entries(entity.elements || {})) {
    elems[k] = { virtual: v.virtual, hasTarget: v.target ? true : false, type: v.type };
  }
  console.log(JSON.stringify(elems, null, 2));
}).catch(e => console.error(e.message));
