/**
 * Unit tests for temporal data support
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

    it('should add as-of-now conditions', () => {
      const result = addTemporalConditions('', temporalFields);

      expect(result).to.include('validFrom <= CURRENT_TIMESTAMP()');
      expect(result).to.include('CURRENT_TIMESTAMP() < validTo');
    });

    it('should add point-in-time conditions', () => {
      const result = addTemporalConditions('', temporalFields, {
        asOf: new Date('2024-01-15T10:00:00Z'),
      });

      expect(result).to.include('validFrom <=');
      expect(result).to.include('2024-01-15');
      expect(result).to.include('< validTo');
    });

    it('should add range conditions', () => {
      const result = addTemporalConditions('', temporalFields, {
        from: '2024-01-01',
        to: '2024-12-31',
      });

      expect(result).to.include('validTo >');
      expect(result).to.include('2024-01-01');
      expect(result).to.include('validFrom <');
      expect(result).to.include('2024-12-31');
    });

    it('should combine with existing WHERE clause', () => {
      const result = addTemporalConditions('dept = ?', temporalFields);

      expect(result).to.include('(dept = ?)');
      expect(result).to.include('AND');
      expect(result).to.include('validFrom <= CURRENT_TIMESTAMP()');
    });
  });

  describe('generateTemporalTableDDL', () => {
    it('should generate DDL with composite primary key', () => {
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

      expect(ddl).to.include('CREATE TABLE TEST_DB.TEST_SCHEMA.WorkAssignments');
      expect(ddl).to.include('ID VARCHAR(36) NOT NULL');
      expect(ddl).to.include('validFrom TIMESTAMP_NTZ NOT NULL');
      expect(ddl).to.include('validTo TIMESTAMP_NTZ NOT NULL');
      expect(ddl).to.include('PRIMARY KEY (ID, validFrom)');
    });
  });

  describe('generateTemporalView', () => {
    it('should generate current time slice view', () => {
      const entity = {
        name: 'WorkAssignments',
        elements: {
          ID: { type: 'cds.UUID', key: true },
          validFrom: { type: 'cds.Timestamp', '@cds.valid.from': true },
          validTo: { type: 'cds.Timestamp', '@cds.valid.to': true },
        },
      };

      const view = generateTemporalView(entity, credentials);

      expect(view).to.include('CREATE VIEW TEST_DB.TEST_SCHEMA.current_WorkAssignments');
      expect(view).to.include('SELECT * FROM TEST_DB.TEST_SCHEMA.WorkAssignments');
      expect(view).to.include('WHERE validFrom <= CURRENT_TIMESTAMP()');
      expect(view).to.include('AND CURRENT_TIMESTAMP() < validTo');
    });
  });
});


