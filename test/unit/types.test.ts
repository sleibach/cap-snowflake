/**
 * Unit tests for type mappings
 */

import { expect } from 'chai';
import { mapCDSType, mapSnowflakeTypeToCDS, convertValue } from '../../src/ddl/types.js';

describe('Type Mappings', () => {
  describe('mapCDSType (CDS → Snowflake)', () => {
    it('should map string types', () => {
      expect(mapCDSType('String', 100)).to.equal('VARCHAR(100)');
      expect(mapCDSType('String')).to.equal('VARCHAR(5000)');
      expect(mapCDSType('LargeString')).to.equal('TEXT');
      expect(mapCDSType('cds.String', 50)).to.equal('VARCHAR(50)');
      expect(mapCDSType('cds.LargeString')).to.equal('TEXT');
    });

    it('should map numeric types', () => {
      expect(mapCDSType('Integer')).to.equal('NUMBER(38,0)');
      expect(mapCDSType('Integer64')).to.equal('NUMBER(38,0)');
      expect(mapCDSType('Decimal', undefined, 10, 2)).to.equal('NUMBER(10,2)');
      expect(mapCDSType('Decimal', undefined, 15)).to.equal('NUMBER(15)');
      expect(mapCDSType('Decimal')).to.equal('NUMBER(15,2)');
      expect(mapCDSType('Number')).to.equal('NUMBER(15,2)');
      expect(mapCDSType('Double')).to.equal('FLOAT');
      expect(mapCDSType('Float')).to.equal('FLOAT');
    });

    it('should map boolean', () => {
      expect(mapCDSType('Boolean')).to.equal('BOOLEAN');
      expect(mapCDSType('cds.Boolean')).to.equal('BOOLEAN');
    });

    it('should map date/time types', () => {
      expect(mapCDSType('Date')).to.equal('DATE');
      expect(mapCDSType('Time')).to.equal('TIME');
      expect(mapCDSType('DateTime')).to.equal('TIMESTAMP_NTZ');
      expect(mapCDSType('Timestamp')).to.equal('TIMESTAMP_TZ');
    });

    it('should map UUID', () => {
      expect(mapCDSType('UUID')).to.equal('VARCHAR(36)');
      expect(mapCDSType('cds.UUID')).to.equal('VARCHAR(36)');
    });

    it('should map binary types', () => {
      expect(mapCDSType('Binary', 100)).to.equal('BINARY(100)');
      expect(mapCDSType('LargeBinary')).to.equal('BINARY');
      expect(mapCDSType('Binary')).to.equal('BINARY');
    });

    it('should map JSON and array types', () => {
      expect(mapCDSType('Json')).to.equal('VARIANT');
      expect(mapCDSType('Object')).to.equal('VARIANT');
      expect(mapCDSType('Array')).to.equal('ARRAY');
    });

    it('should fallback to VARCHAR for unknown types', () => {
      expect(mapCDSType('UnknownType')).to.equal('VARCHAR(5000)');
      expect(mapCDSType('')).to.equal('VARCHAR(5000)');
    });

    it('should handle case-insensitive type names', () => {
      expect(mapCDSType('string', 100)).to.equal('VARCHAR(100)');
      expect(mapCDSType('INTEGER')).to.equal('NUMBER(38,0)');
      expect(mapCDSType('BOOLEAN')).to.equal('BOOLEAN');
    });
  });

  describe('mapSnowflakeTypeToCDS (Snowflake → CDS)', () => {
    it('should map string types', () => {
      expect(mapSnowflakeTypeToCDS('VARCHAR(100)')).to.equal('cds.String');
      expect(mapSnowflakeTypeToCDS('CHAR(10)')).to.equal('cds.String');
      expect(mapSnowflakeTypeToCDS('TEXT')).to.equal('cds.LargeString');
    });

    it('should map boolean', () => {
      expect(mapSnowflakeTypeToCDS('BOOLEAN')).to.equal('cds.Boolean');
    });

    it('should map numeric types', () => {
      expect(mapSnowflakeTypeToCDS('NUMBER(38,0)')).to.equal('cds.Integer');
      expect(mapSnowflakeTypeToCDS('NUMBER(10,2)')).to.equal('cds.Decimal');
      expect(mapSnowflakeTypeToCDS('NUMBER(15)')).to.equal('cds.Integer');
      expect(mapSnowflakeTypeToCDS('NUMBER(38)')).to.equal('cds.Integer64');
      expect(mapSnowflakeTypeToCDS('NUMBER')).to.equal('cds.Integer');
      expect(mapSnowflakeTypeToCDS('FLOAT')).to.equal('cds.Double');
      expect(mapSnowflakeTypeToCDS('DOUBLE')).to.equal('cds.Double');
    });

    it('should map VECTOR type with and without dimension', () => {
      expect(mapSnowflakeTypeToCDS('VECTOR(FLOAT, 1536)')).to.equal('cds.Vector(1536)');
      expect(mapSnowflakeTypeToCDS('VECTOR(FLOAT, 768)')).to.equal('cds.Vector(768)');
      expect(mapSnowflakeTypeToCDS('VECTOR')).to.equal('cds.Vector');
    });

    it('should map date/time types', () => {
      expect(mapSnowflakeTypeToCDS('DATE')).to.equal('cds.Date');
      expect(mapSnowflakeTypeToCDS('TIME')).to.equal('cds.Time');
      expect(mapSnowflakeTypeToCDS('TIMESTAMP_NTZ')).to.equal('cds.DateTime');
      expect(mapSnowflakeTypeToCDS('TIMESTAMP_TZ')).to.equal('cds.Timestamp');
      expect(mapSnowflakeTypeToCDS('TIMESTAMP_LTZ')).to.equal('cds.Timestamp');
    });

    it('should map binary types', () => {
      expect(mapSnowflakeTypeToCDS('BINARY')).to.equal('cds.Binary');
      expect(mapSnowflakeTypeToCDS('BINARY(100)')).to.equal('cds.Binary');
    });

    it('should map semi-structured types', () => {
      expect(mapSnowflakeTypeToCDS('VARIANT')).to.equal('cds.Json');
      expect(mapSnowflakeTypeToCDS('OBJECT')).to.equal('cds.Json');
      expect(mapSnowflakeTypeToCDS('ARRAY')).to.equal('cds.Array');
    });

    it('should fallback to String for unknown types', () => {
      expect(mapSnowflakeTypeToCDS('UNKNOWN_TYPE')).to.equal('cds.String');
    });
  });

  describe('convertValue', () => {
    it('should convert null/undefined to null', () => {
      expect(convertValue(null)).to.be.null;
      expect(convertValue(undefined)).to.be.null;
    });

    it('should return value unchanged when no type specified', () => {
      expect(convertValue('hello')).to.equal('hello');
      expect(convertValue(42)).to.equal(42);
      expect(convertValue(true)).to.be.true;
    });

    it('should convert boolean values', () => {
      expect(convertValue(true, 'Boolean')).to.be.true;
      expect(convertValue(false, 'Boolean')).to.be.false;
      expect(convertValue(1, 'Boolean')).to.be.true;
      expect(convertValue(0, 'Boolean')).to.be.false;
      expect(convertValue('yes', 'Boolean')).to.be.true;
    });

    it('should convert Date objects to ISO date string for Date type', () => {
      const date = new Date('2024-01-15T10:30:00Z');
      expect(convertValue(date, 'Date')).to.equal('2024-01-15');
    });

    it('should pass through string dates for Date type', () => {
      expect(convertValue('2024-01-15', 'Date')).to.equal('2024-01-15');
    });

    it('should convert Date to ISO string for DateTime type', () => {
      const date = new Date('2024-01-15T10:30:00Z');
      expect(convertValue(date, 'DateTime')).to.equal('2024-01-15T10:30:00.000Z');
    });

    it('should convert Date to ISO string for Timestamp type', () => {
      const date = new Date('2024-06-01T12:00:00Z');
      expect(convertValue(date, 'Timestamp')).to.equal('2024-06-01T12:00:00.000Z');
    });

    it('should stringify objects for JSON type', () => {
      const obj = { name: 'test', value: 123 };
      expect(convertValue(obj, 'Json')).to.equal(JSON.stringify(obj));
    });

    it('should pass through string JSON', () => {
      const jsonStr = '{"key":"value"}';
      expect(convertValue(jsonStr, 'Json')).to.equal(jsonStr);
    });

    it('should pass through numeric values unchanged for other types', () => {
      expect(convertValue(42, 'Integer')).to.equal(42);
      expect(convertValue(3.14, 'Decimal')).to.equal(3.14);
    });
  });
});
