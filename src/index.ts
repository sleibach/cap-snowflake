/**
 * CAP Snowflake Adapter Entry Point
 */

import cds from '@sap/cds';
import SnowflakeService from './SnowflakeService.js';

// Register the Snowflake service with CAP
cds.env.requires.kinds = cds.env.requires.kinds || {};
cds.env.requires.kinds.snowflake = SnowflakeService;

// Export for explicit usage
export { SnowflakeService };
export default SnowflakeService;

// Log registration
cds.log('snowflake-adapter').info('Snowflake database adapter registered');

