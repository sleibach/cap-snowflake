/**
 * Unit tests for schema introspection
 */

import { expect } from 'chai';
import { generateCDSModel, SchemaDefinition, TableMetadata } from '../../src/introspect/schema.js';

describe('Schema Introspection', () => {
  describe('generateCDSModel', () => {
    it('should generate CDS model from schema definition', () => {
      const schemaDefinition: SchemaDefinition = {
        tables: new Map([
          [
            'BOOKS',
            {
              info: {
                tableName: 'BOOKS',
                tableSchema: 'PUBLIC',
                tableType: 'BASE TABLE',
                comment: 'Books catalog',
              },
              columns: [
                {
                  columnName: 'ID',
                  dataType: 'VARCHAR(36)',
                  isNullable: false,
                  isPrimaryKey: true,
                },
                {
                  columnName: 'TITLE',
                  dataType: 'VARCHAR(100)',
                  isNullable: false,
                  isPrimaryKey: false,
                  characterMaximumLength: 100,
                },
                {
                  columnName: 'PRICE',
                  dataType: 'NUMBER(10,2)',
                  isNullable: true,
                  isPrimaryKey: false,
                  numericPrecision: 10,
                  numericScale: 2,
                },
              ],
              primaryKeys: ['ID'],
              foreignKeys: [],
            } as TableMetadata,
          ],
        ]),
      };

      const cdsModel = generateCDSModel(schemaDefinition, 'test');

      expect(cdsModel).to.include('namespace test;');
      expect(cdsModel).to.include('entity Books {');
      expect(cdsModel).to.include('key id : String');
      expect(cdsModel).to.include('title : String(100) @mandatory');
      expect(cdsModel).to.include('price : Decimal(10, 2)');
    });

    it('should handle views with @readonly', () => {
      const schemaDefinition: SchemaDefinition = {
        tables: new Map([
          [
            'BOOK_VIEW',
            {
              info: {
                tableName: 'BOOK_VIEW',
                tableSchema: 'PUBLIC',
                tableType: 'VIEW',
              },
              columns: [
                {
                  columnName: 'ID',
                  dataType: 'VARCHAR(36)',
                  isNullable: false,
                  isPrimaryKey: false,
                },
              ],
              primaryKeys: [],
              foreignKeys: [],
            } as TableMetadata,
          ],
        ]),
      };

      const cdsModel = generateCDSModel(schemaDefinition, 'test');

      expect(cdsModel).to.include('@readonly');
      expect(cdsModel).to.include('entity BookView {');
    });

    it('should convert SNAKE_CASE to PascalCase and camelCase', () => {
      const schemaDefinition: SchemaDefinition = {
        tables: new Map([
          [
            'USER_PROFILES',
            {
              info: {
                tableName: 'USER_PROFILES',
                tableSchema: 'PUBLIC',
                tableType: 'BASE TABLE',
              },
              columns: [
                {
                  columnName: 'USER_ID',
                  dataType: 'VARCHAR(36)',
                  isNullable: false,
                  isPrimaryKey: true,
                },
                {
                  columnName: 'FULL_NAME',
                  dataType: 'VARCHAR(100)',
                  isNullable: false,
                  isPrimaryKey: false,
                },
              ],
              primaryKeys: ['USER_ID'],
              foreignKeys: [],
            } as TableMetadata,
          ],
        ]),
      };

      const cdsModel = generateCDSModel(schemaDefinition, 'test');

      expect(cdsModel).to.include('entity UserProfiles {');
      expect(cdsModel).to.include('key userId : String');
      expect(cdsModel).to.include('fullName : String');
    });

    it('should generate associations for foreign keys', () => {
      const schemaDefinition: SchemaDefinition = {
        tables: new Map([
          [
            'ORDERS',
            {
              info: {
                tableName: 'ORDERS',
                tableSchema: 'PUBLIC',
                tableType: 'BASE TABLE',
              },
              columns: [
                {
                  columnName: 'ID',
                  dataType: 'VARCHAR(36)',
                  isNullable: false,
                  isPrimaryKey: true,
                },
                {
                  columnName: 'CUSTOMER_ID',
                  dataType: 'VARCHAR(36)',
                  isNullable: false,
                  isPrimaryKey: false,
                },
              ],
              primaryKeys: ['ID'],
              foreignKeys: [
                {
                  constraintName: 'FK_CUSTOMER',
                  columnName: 'CUSTOMER_ID',
                  referencedTable: 'CUSTOMERS',
                  referencedColumn: 'ID',
                },
              ],
            } as TableMetadata,
          ],
        ]),
      };

      const cdsModel = generateCDSModel(schemaDefinition, 'test');

      expect(cdsModel).to.include('customerId : Association to Customers');
    });

    it('should handle various data types', () => {
      const schemaDefinition: SchemaDefinition = {
        tables: new Map([
          [
            'DATA_TYPES',
            {
              info: {
                tableName: 'DATA_TYPES',
                tableSchema: 'PUBLIC',
                tableType: 'BASE TABLE',
              },
              columns: [
                { columnName: 'TEXT_COL', dataType: 'TEXT', isNullable: true, isPrimaryKey: false },
                { columnName: 'BOOL_COL', dataType: 'BOOLEAN', isNullable: true, isPrimaryKey: false },
                { columnName: 'DATE_COL', dataType: 'DATE', isNullable: true, isPrimaryKey: false },
                { columnName: 'TIME_COL', dataType: 'TIME', isNullable: true, isPrimaryKey: false },
                { columnName: 'TIMESTAMP_COL', dataType: 'TIMESTAMP_NTZ', isNullable: true, isPrimaryKey: false },
                { columnName: 'JSON_COL', dataType: 'VARIANT', isNullable: true, isPrimaryKey: false },
                { columnName: 'ARRAY_COL', dataType: 'ARRAY', isNullable: true, isPrimaryKey: false },
              ],
              primaryKeys: [],
              foreignKeys: [],
            } as TableMetadata,
          ],
        ]),
      };

      const cdsModel = generateCDSModel(schemaDefinition, 'test');

      expect(cdsModel).to.include('textCol : LargeString');
      expect(cdsModel).to.include('boolCol : Boolean');
      expect(cdsModel).to.include('dateCol : Date');
      expect(cdsModel).to.include('timeCol : Time');
      expect(cdsModel).to.include('timestampCol : DateTime');
      expect(cdsModel).to.include('jsonCol : Json');
      expect(cdsModel).to.include('arrayCol : Array');
    });
  });
});

