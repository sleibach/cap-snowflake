/**
 * Unit tests for temporal data support
 *
 * Temporal field names are normalised to UPPERCASE.
 */

import { expect } from 'chai';
import {
  isTemporal,
  getTemporalFields,
  addTemporalConditions,
  generateTemporalTableDDL,
  generateTemporalView,
} from '../../src/features/temporal.js';
import { SnowflakeCredentials } from '../../src/config.js';

describe('Temporal Data Support', () => {
  const credentials: SnowflakeCredentials = {
    account: 'TEST',
    user: 'TEST_USER',
    database: 'TEST_DB',
    schema: 'TEST_SCHEMA',
    auth: 'jwt',
    jwt: { privateKey: 'dummy' },
  };

  describe('isTemporal', () => {
    it('should detect temporal entities', () => {
      const entity = {
        name: 'WorkAssignments',
        elements: {
          ID: { type: 'cds.UUID', key: true },
          validFrom: { type: 'cds.Timestamp', '@cds.valid.from': true },
          validTo: { type: 'cds.Timestamp', '@cds.valid.to': true },
        },
      };

      expect(isTemporal(entity)).to.be.true;
    });

    it('should return false for non-temporal entities', () => {
      const entity = {
        name: 'Books',
        elements: {
          ID: { type: 'cds.UUID', key: true },
          title: { type: 'cds.String' },
        },
      };

      expect(isTemporal(entity)).to.be.false;
    });

    it('should require both validFrom and validTo', () => {
      const entity = {
        name: 'Incomplete',
        elements: {
          ID: { type: 'cds.UUID', key: true },
          validFrom: { type: 'cds.Timestamp', '@cds.valid.from': true },
        },
      };

      expect(isTemporal(entity)).to.be.false;
    });

    it('should return false for null entity', () => {
      expect(isTemporal(null)).to.be.false;
      expect(isTemporal({})).to.be.false;
    });
  });

  describe('getTemporalFields', () => {
    it('should extract temporal field names', () => {
      const entity = {
        name: 'WorkAssignments',
        elements: {
          ID: { type: 'cds.UUID', key: true },
          startDate: { type: 'cds.Date', '@cds.valid.from': true },
          endDate: { type: 'cds.Date', '@cds.valid.to': true },
        },
      };

      const fields = getTemporalFields(entity);

      expect(fields).to.deep.equal({
        validFrom: 'startDate',
        validTo: 'endDate',
      });
    });

    it('should return null for non-temporal entities', () => {
      const entity = {
        name: 'Books',
        elements: {
          ID: { type: 'cds.UUID', key: true },
        },
      };

      const fields = getTemporalFields(entity);
      expect(fields).to.be.null;
    });
  });

  describe('addTemporalConditions', () => {
    const temporalFields = { validFrom: 'validFrom', validTo: 'validTo' };

    it('should add as-of-now conditions with UPPERCASE field names', () => {
      const result = addTemporalConditions('', temporalFields);

      // validFrom/validTo are normalised to UPPERCASE
      expect(result).to.include('VALIDFROM <= CURRENT_TIMESTAMP()');
      expect(result).to.include('CURRENT_TIMESTAMP() < VALIDTO');
    });

    it('should add point-in-time conditions', () => {
      const result = addTemporalConditions('', temporalFields, {
        asOf: new Date('2024-01-15T10:00:00Z'),
      });

      expect(result).to.include('VALIDFROM <=');
      expect(result).to.include('2024-01-15');
      expect(result).to.include('< VALIDTO');
    });

    it('should add range conditions', () => {
      const result = addTemporalConditions('', temporalFields, {
        from: '2024-01-01',
        to: '2024-12-31',
      });

      expect(result).to.include('VALIDTO >');
      expect(result).to.include('2024-01-01');
      expect(result).to.include('VALIDFROM <');
      expect(result).to.include('2024-12-31');
    });

    it('should combine with existing WHERE clause', () => {
      const result = addTemporalConditions('dept = ?', temporalFields);

      expect(result).to.include('(dept = ?)');
      expect(result).to.include('AND');
      expect(result).to.include('VALIDFROM <= CURRENT_TIMESTAMP()');
    });

    it('should handle custom field names', () => {
      const customFields = { validFrom: 'startDate', validTo: 'endDate' };
      const result = addTemporalConditions('', customFields);

      expect(result).to.include('STARTDATE <=');
      expect(result).to.include('< ENDDATE');
    });

    it('should handle string asOf value', () => {
      const result = addTemporalConditions('', temporalFields, {
        asOf: '2024-06-15T00:00:00Z',
      });

      expect(result).to.include('VALIDFROM <=');
      expect(result).to.include('2024-06-15');
    });
  });

  describe('generateTemporalTableDDL', () => {
    it('should generate DDL with composite primary key and UPPERCASE identifiers', () => {
      const entity = {
        name: 'WorkAssignments',
        elements: {
          ID: { type: 'cds.UUID', key: true },
          role: { type: 'cds.String', length: 50 },
          validFrom: { type: 'cds.Timestamp', '@cds.valid.from': true, notNull: true },
          validTo: { type: 'cds.Timestamp', '@cds.valid.to': true, notNull: true },
        },
      };

      const ddl = generateTemporalTableDDL(entity, credentials);

      expect(ddl).to.include('CREATE TABLE IF NOT EXISTS TEST_DB.TEST_SCHEMA.WORKASSIGNMENTS');
      expect(ddl).to.include('ID VARCHAR(36) NOT NULL');
      expect(ddl).to.include('VALIDFROM TIMESTAMP_NTZ NOT NULL');
      expect(ddl).to.include('VALIDTO TIMESTAMP_NTZ NOT NULL');
      expect(ddl).to.include('PRIMARY KEY (ID, VALIDFROM)');
    });

    it('should include non-key columns', () => {
      const entity = {
        name: 'Contracts',
        elements: {
          ID: { type: 'cds.UUID', key: true },
          description: { type: 'cds.String', length: 500 },
          validFrom: { type: 'cds.Timestamp', '@cds.valid.from': true },
          validTo: { type: 'cds.Timestamp', '@cds.valid.to': true },
        },
      };

      const ddl = generateTemporalTableDDL(entity, credentials);
      expect(ddl).to.include('DESCRIPTION VARCHAR(500)');
    });

    it('should throw for non-temporal entity', () => {
      const entity = {
        name: 'Books',
        elements: {
          ID: { type: 'cds.UUID', key: true },
          title: { type: 'cds.String' },
        },
      };

      expect(() => generateTemporalTableDDL(entity, credentials)).to.throw('Entity is not temporal');
    });
  });

  describe('generateTemporalView', () => {
    it('should generate current time slice view with UPPERCASE names', () => {
      const entity = {
        name: 'WorkAssignments',
        elements: {
          ID: { type: 'cds.UUID', key: true },
          validFrom: { type: 'cds.Timestamp', '@cds.valid.from': true },
          validTo: { type: 'cds.Timestamp', '@cds.valid.to': true },
        },
      };

      const view = generateTemporalView(entity, credentials);

      expect(view).to.include('CREATE OR REPLACE VIEW TEST_DB.TEST_SCHEMA.CURRENT_WORKASSIGNMENTS');
      expect(view).to.include('SELECT * FROM TEST_DB.TEST_SCHEMA.WORKASSIGNMENTS');
      expect(view).to.include('WHERE VALIDFROM <= CURRENT_TIMESTAMP()');
      expect(view).to.include('AND CURRENT_TIMESTAMP() < VALIDTO');
    });

    it('should throw for non-temporal entity', () => {
      const entity = {
        name: 'Books',
        elements: {
          ID: { type: 'cds.UUID', key: true },
        },
      };

      expect(() => generateTemporalView(entity, credentials)).to.throw('Entity is not temporal');
    });
  });
});
