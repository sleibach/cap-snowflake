const cds = require('@sap/cds');

module.exports = async function () {
  // Connect to the named 'snowflake' service defined in package.json cds.requires.
  // cds.connect.to() is lazy — the connection is established on first use.
  const snowflake = await cds.connect.to('snowflake');

  // Delegate all READ requests for MaterialValuation to Snowflake.
  // req.query is the CQN built by CAP from the incoming OData request.
  // The adapter translates it to SQL and runs it against the Snowflake table
  // identified by @cds.persistence.name on the entity.
  this.on('READ', 'MaterialValuation', (req) => snowflake.run(req.query));
};
