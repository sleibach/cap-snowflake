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
      expect(cdsModel).to.include("@cds.persistence.name: 'BOOKS'");
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

// ---------------------------------------------------------------------------
describe('generateColumnDefinition — VECTOR type', () => {
  it('should map VECTOR(FLOAT, 1536) to Vector(1536) in generated CDS', () => {
    const schemaDefinition: SchemaDefinition = {
      tables: new Map([
        [
          'EMBEDDINGS',
          {
            info: { tableName: 'EMBEDDINGS', tableSchema: 'PUBLIC', tableType: 'BASE TABLE' },
            columns: [
              { columnName: 'ID', dataType: 'VARCHAR(36)', isNullable: false, isPrimaryKey: true },
              { columnName: 'EMBEDDING', dataType: 'VECTOR(FLOAT, 1536)', isNullable: true, isPrimaryKey: false },
            ],
            primaryKeys: ['ID'],
            foreignKeys: [],
          } as TableMetadata,
        ],
      ]),
    };

    const cdsModel = generateCDSModel(schemaDefinition, 'test');
    expect(cdsModel).to.include('embedding : Vector(1536)');
  });
});

// ---------------------------------------------------------------------------
describe('generateEntityDefinition — @cds.persistence.name', () => {
  it('should always emit @cds.persistence.name with original table name', () => {
    const schemaDefinition: SchemaDefinition = {
      tables: new Map([
        [
          'MY_CUSTOM_TABLE',
          {
            info: { tableName: 'MY_CUSTOM_TABLE', tableSchema: 'PUBLIC', tableType: 'BASE TABLE' },
            columns: [
              { columnName: 'ID', dataType: 'VARCHAR(36)', isNullable: false, isPrimaryKey: true },
            ],
            primaryKeys: ['ID'],
            foreignKeys: [],
          } as TableMetadata,
        ],
      ]),
    };

    const cdsModel = generateCDSModel(schemaDefinition, 'test');
    expect(cdsModel).to.include("@cds.persistence.name: 'MY_CUSTOM_TABLE'");
    expect(cdsModel).to.include('entity MyCustomTable {');
  });
});

// ---------------------------------------------------------------------------
describe('@Aggregation.default on FACT tables', () => {
  it('should annotate numeric columns on FACT tables with @Aggregation.default: #SUM', () => {
    const schemaDefinition: SchemaDefinition = {
      tables: new Map([
        [
          'SALES_FACT',
          {
            info: { tableName: 'SALES_FACT', tableSchema: 'PUBLIC', tableType: 'BASE TABLE' },
            columns: [
              { columnName: 'ID', dataType: 'VARCHAR(36)', isNullable: false, isPrimaryKey: true },
              { columnName: 'AMOUNT', dataType: 'NUMBER(15,2)', isNullable: true, isPrimaryKey: false, numericPrecision: 15, numericScale: 2 },
              { columnName: 'UNITS', dataType: 'NUMBER(10,0)', isNullable: true, isPrimaryKey: false, numericPrecision: 10, numericScale: 0 },
              { columnName: 'DESCRIPTION', dataType: 'VARCHAR(500)', isNullable: true, isPrimaryKey: false },
            ],
            primaryKeys: ['ID'],
            foreignKeys: [
              { constraintName: 'FK_DIM0', columnName: 'DIM0_ID', referencedTable: 'DIM0', referencedColumn: 'ID' },
              { constraintName: 'FK_DIM1', columnName: 'DIM1_ID', referencedTable: 'DIM1', referencedColumn: 'ID' },
              { constraintName: 'FK_DIM2', columnName: 'DIM2_ID', referencedTable: 'DIM2', referencedColumn: 'ID' },
            ],
          } as TableMetadata,
        ],
        ['DIM0', { info: { tableName: 'DIM0', tableSchema: 'PUBLIC', tableType: 'BASE TABLE' }, columns: [{ columnName: 'ID', dataType: 'VARCHAR(36)', isNullable: false, isPrimaryKey: true }], primaryKeys: ['ID'], foreignKeys: [] } as TableMetadata],
        ['DIM1', { info: { tableName: 'DIM1', tableSchema: 'PUBLIC', tableType: 'BASE TABLE' }, columns: [{ columnName: 'ID', dataType: 'VARCHAR(36)', isNullable: false, isPrimaryKey: true }], primaryKeys: ['ID'], foreignKeys: [] } as TableMetadata],
        ['DIM2', { info: { tableName: 'DIM2', tableSchema: 'PUBLIC', tableType: 'BASE TABLE' }, columns: [{ columnName: 'ID', dataType: 'VARCHAR(36)', isNullable: false, isPrimaryKey: true }], primaryKeys: ['ID'], foreignKeys: [] } as TableMetadata],
      ]),
    };

    const cdsModel = generateCDSModel(schemaDefinition, 'test');
    // Numeric measure columns should be annotated
    expect(cdsModel).to.include('@Aggregation.default: #SUM');
    // String column should NOT be annotated
    const descriptionIdx = cdsModel.indexOf('description : String');
    const aggregationIdx = cdsModel.lastIndexOf('@Aggregation.default: #SUM', descriptionIdx);
    // The annotation before description should be for amount or units, not description itself
    const descriptionLineHasAnnotation = cdsModel.includes('@Aggregation.default: #SUM\n  description');
    expect(descriptionLineHasAnnotation).to.equal(false);
  });

  it('should NOT annotate numeric columns on non-FACT tables', () => {
    const schemaDefinition: SchemaDefinition = {
      tables: new Map([
        [
          'PLAIN_TABLE',
          {
            info: { tableName: 'PLAIN_TABLE', tableSchema: 'PUBLIC', tableType: 'BASE TABLE' },
            columns: [
              { columnName: 'ID', dataType: 'VARCHAR(36)', isNullable: false, isPrimaryKey: true },
              { columnName: 'AMOUNT', dataType: 'NUMBER(15,2)', isNullable: true, isPrimaryKey: false, numericPrecision: 15, numericScale: 2 },
            ],
            primaryKeys: ['ID'],
            foreignKeys: [],
          } as TableMetadata,
        ],
      ]),
    };

    const cdsModel = generateCDSModel(schemaDefinition, 'test');
    expect(cdsModel).to.not.include('@Aggregation.default:');
  });
});

// ---------------------------------------------------------------------------
describe('Star schema annotations (Part B5)', () => {
  function makeTable(name: string, fkCount: number): TableMetadata {
    const foreignKeys = Array.from({ length: fkCount }, (_, i) => ({
      constraintName: `FK_${i}`,
      columnName: `FK_${i}_ID`,
      referencedTable: `DIM_TABLE_${i}`,
      referencedColumn: 'ID',
    }));
    return {
      info: { tableName: name, tableSchema: 'PUBLIC', tableType: 'BASE TABLE' },
      columns: [{ columnName: 'ID', dataType: 'VARCHAR(36)', isNullable: false, isPrimaryKey: true }],
      primaryKeys: ['ID'],
      foreignKeys,
    } as TableMetadata;
  }

  it('entity with ≥ 3 FKs is annotated as FACT', () => {
    const schema: SchemaDefinition = {
      tables: new Map([
        ['SALES_FACTS', makeTable('SALES_FACTS', 3)],
        ['DIM_TABLE_0', makeTable('DIM_TABLE_0', 0)],
        ['DIM_TABLE_1', makeTable('DIM_TABLE_1', 0)],
        ['DIM_TABLE_2', makeTable('DIM_TABLE_2', 0)],
      ]),
    };
    const model = generateCDSModel(schema, 'test');
    expect(model).to.include('@Analytics.dataCategory: #FACT');
    // The FACT annotation must appear before the SalesFacts entity
    const factIdx = model.indexOf('@Analytics.dataCategory: #FACT');
    const entityIdx = model.indexOf('entity SalesFacts');
    expect(factIdx).to.be.lessThan(entityIdx);
  });

  it('entity with 0 FKs referenced by a FACT is annotated as DIMENSION', () => {
    const schema: SchemaDefinition = {
      tables: new Map([
        ['ORDERS_FACT', makeTable('ORDERS_FACT', 3)],
        ['DIM_TABLE_0', makeTable('DIM_TABLE_0', 0)],
        ['DIM_TABLE_1', makeTable('DIM_TABLE_1', 0)],
        ['DIM_TABLE_2', makeTable('DIM_TABLE_2', 0)],
      ]),
    };
    const model = generateCDSModel(schema, 'test');
    expect(model).to.include('@Analytics.dataCategory: #DIMENSION');
  });

  it('entity with ≤ 2 FKs not referenced by any FACT gets no annotation', () => {
    const schema: SchemaDefinition = {
      tables: new Map([
        ['PLAIN_TABLE', makeTable('PLAIN_TABLE', 2)],
      ]),
    };
    const model = generateCDSModel(schema, 'test');
    expect(model).to.not.include('@Analytics.dataCategory:');
  });
});

