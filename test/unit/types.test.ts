/**
 * Unit tests for type mappings
 */

import { expect } from 'chai';
import { mapCDSType, mapSnowflakeTypeToCDS, convertValue } from '../../src/ddl/types.js';

describe('Type Mappings', () => {
  describe('mapCDSType', () => {
    it('should map string types', () => {
      expect(mapCDSType('String', 100)).to.equal('VARCHAR(100)');
      expect(mapCDSType('String')).to.equal('VARCHAR(5000)');
      expect(mapCDSType('LargeString')).to.equal('TEXT');
    });

    it('should map numeric types', () => {
      expect(mapCDSType('Integer')).to.equal('NUMBER(38,0)');
      expect(mapCDSType('Integer64')).to.equal('NUMBER(38,0)');
      expect(mapCDSType('Decimal', undefined, 10, 2)).to.equal('NUMBER(10,2)');
      expect(mapCDSType('Double')).to.equal('FLOAT');
    });

    it('should map boolean', () => {
      expect(mapCDSType('Boolean')).to.equal('BOOLEAN');
    });

    it('should map date/time types', () => {
      expect(mapCDSType('Date')).to.equal('DATE');
      expect(mapCDSType('Time')).to.equal('TIME');
      expect(mapCDSType('DateTime')).to.equal('TIMESTAMP_NTZ');
      expect(mapCDSType('Timestamp')).to.equal('TIMESTAMP_TZ');
    });

    it('should map UUID', () => {
      expect(mapCDSType('UUID')).to.equal('VARCHAR(36)');
    });

    it('should map binary types', () => {
      expect(mapCDSType('Binary', 100)).to.equal('BINARY(100)');
      expect(mapCDSType('LargeBinary')).to.equal('BINARY');
    });

    it('should map JSON and array types', () => {
      expect(mapCDSType('Json')).to.equal('VARIANT');
      expect(mapCDSType('Array')).to.equal('ARRAY');
    });
  });

  describe('mapSnowflakeTypeToCDS', () => {
    it('should map Snowflake types back to CDS', () => {
      expect(mapSnowflakeTypeToCDS('VARCHAR(100)')).to.equal('cds.String');
      expect(mapSnowflakeTypeToCDS('TEXT')).to.equal('cds.LargeString');
      expect(mapSnowflakeTypeToCDS('BOOLEAN')).to.equal('cds.Boolean');
      expect(mapSnowflakeTypeToCDS('NUMBER(38,0)')).to.equal('cds.Integer');
      expect(mapSnowflakeTypeToCDS('NUMBER(10,2)')).to.equal('cds.Decimal');
      expect(mapSnowflakeTypeToCDS('DATE')).to.equal('cds.Date');
      expect(mapSnowflakeTypeToCDS('TIMESTAMP_NTZ')).to.equal('cds.DateTime');
      expect(mapSnowflakeTypeToCDS('VARIANT')).to.equal('cds.Json');
    });
  });

  describe('convertValue', () => {
    it('should convert null/undefined', () => {
      expect(convertValue(null)).to.be.null;
      expect(convertValue(undefined)).to.be.null;
    });

    it('should convert boolean values', () => {
      expect(convertValue(true, 'Boolean')).to.be.true;
      expect(convertValue(false, 'Boolean')).to.be.false;
      expect(convertValue(1, 'Boolean')).to.be.true;
      expect(convertValue(0, 'Boolean')).to.be.false;
    });

    it('should convert date values', () => {
      const date = new Date('2024-01-15T10:30:00Z');
      expect(convertValue(date, 'Date')).to.equal('2024-01-15');
    });

    it('should convert datetime values', () => {
      const date = new Date('2024-01-15T10:30:00Z');
      expect(convertValue(date, 'DateTime')).to.equal('2024-01-15T10:30:00.000Z');
    });

    it('should convert JSON values', () => {
      const obj = { name: 'test', value: 123 };
      expect(convertValue(obj, 'Json')).to.equal(JSON.stringify(obj));
    });
  });
});

