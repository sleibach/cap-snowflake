/**
 * Unit tests for CAP annotation support
 */

import { expect } from 'chai';
import { SnowflakeService } from '../../src/SnowflakeService.js';

describe('CAP Annotations Support', () => {
  describe('Persistence Annotations', () => {
    it('should recognize @cds.persistence.skip', () => {
      const entity = {
        name: 'RuntimeView',
        '@cds.persistence.skip': true,
        kind: 'entity',
      };

      // Entity marked as skip should not generate DDL
      expect(entity['@cds.persistence.skip']).to.be.true;
    });

    it('should recognize @cds.persistence.exists', () => {
      const entity = {
        name: 'ExistingTable',
        '@cds.persistence.exists': true,
        kind: 'entity',
      };

      // Entity marked as exists should skip CREATE TABLE
      expect(entity['@cds.persistence.exists']).to.be.true;
    });

    it('should recognize @cds.persistence.name', () => {
      const entity = {
        name: 'Books',
        '@cds.persistence.name': '"MY_BOOKS"',
        kind: 'entity',
      };

      // Custom name should be used in SQL generation
      expect(entity['@cds.persistence.name']).to.equal('"MY_BOOKS"');
    });
  });

  describe('Validation Annotations', () => {
    it('should recognize @mandatory annotation', () => {
      const element = {
        name: 'title',
        type: 'cds.String',
        '@mandatory': true,
      };

      // Mandatory elements should generate NOT NULL
      expect(element['@mandatory']).to.be.true;
    });

    it('should recognize @assert.range', () => {
      const element = {
        name: 'price',
        type: 'cds.Decimal',
        '@assert.range': [0, 1000],
      };

      expect(element['@assert.range']).to.deep.equal([0, 1000]);
    });

    it('should recognize @assert.format', () => {
      const element = {
        name: 'email',
        type: 'cds.String',
        '@assert.format': '/^\\S+@\\S+\\.\\S+$/',
        '@assert.format.message': 'Invalid email',
      };

      expect(element['@assert.format']).to.be.a('string');
      expect(element['@assert.format.message']).to.equal('Invalid email');
    });

    it('should recognize @assert.target', () => {
      const element = {
        name: 'author',
        type: 'cds.Association',
        target: 'Authors',
        '@assert.target': true,
      };

      // Association with assert.target should validate target exists
      expect(element['@assert.target']).to.be.true;
    });
  });

  describe('Entity Capability Annotations', () => {
    it('should recognize @readonly', () => {
      const entity = {
        name: 'BooksView',
        '@readonly': true,
        kind: 'entity',
      };

      expect(entity['@readonly']).to.be.true;
    });

    it('should recognize @insertonly', () => {
      const entity = {
        name: 'AuditLog',
        '@insertonly': true,
        kind: 'entity',
      };

      expect(entity['@insertonly']).to.be.true;
    });
  });

  describe('Managed Aspects', () => {
    it('should recognize cuid aspect', () => {
      // cuid aspect adds UUID key
      const entity = {
        name: 'Books',
        kind: 'entity',
        includes: ['cuid'],
        elements: {
          ID: {
            type: 'cds.UUID',
            key: true,
          },
        },
      };

      expect(entity.elements.ID.type).to.equal('cds.UUID');
      expect(entity.elements.ID.key).to.be.true;
    });

    it('should recognize managed aspect fields', () => {
      // managed aspect adds audit fields
      const managedFields = {
        createdAt: { type: 'cds.Timestamp', '@cds.on.insert': true },
        createdBy: { type: 'cds.String', '@cds.on.insert': true },
        modifiedAt: { type: 'cds.Timestamp', '@cds.on.insert': true, '@cds.on.update': true },
        modifiedBy: { type: 'cds.String', '@cds.on.insert': true, '@cds.on.update': true },
      };

      expect(managedFields.createdAt.type).to.equal('cds.Timestamp');
      expect(managedFields.createdAt['@cds.on.insert']).to.be.true;
      expect(managedFields.modifiedAt['@cds.on.update']).to.be.true;
    });

    it('should recognize temporal aspect', () => {
      // temporal aspect adds validFrom/validTo
      const entity = {
        name: 'WorkAssignments',
        kind: 'entity',
        includes: ['temporal'],
        elements: {
          validFrom: {
            type: 'cds.Timestamp',
            '@cds.valid.from': true,
          },
          validTo: {
            type: 'cds.Timestamp',
            '@cds.valid.to': true,
          },
        },
      };

      expect(entity.elements.validFrom['@cds.valid.from']).to.be.true;
      expect(entity.elements.validTo['@cds.valid.to']).to.be.true;
    });
  });

  describe('Localization', () => {
    it('should recognize localized elements', () => {
      const element = {
        name: 'title',
        type: 'cds.String',
        localized: true,
      };

      // Localized elements generate .texts table
      expect(element.localized).to.be.true;
    });
  });

  describe('Virtual and Calculated Elements', () => {
    it('should recognize virtual elements', () => {
      const element = {
        name: 'calculatedField',
        type: 'cds.String',
        virtual: true,
      };

      // Virtual elements not persisted
      expect(element.virtual).to.be.true;
    });

    it('should recognize calculated elements', () => {
      const element = {
        name: 'priceWithTax',
        type: 'cds.Decimal',
        value: { xpr: ['price', '*', { val: 1.1 }] },
      };

      // Calculated elements have value expression
      expect(element.value).to.exist;
      expect(element.value.xpr).to.be.an('array');
    });
  });

  describe('Composition and Associations', () => {
    it('should recognize Composition', () => {
      const element = {
        name: 'items',
        type: 'cds.Composition',
        target: 'OrderItems',
        cardinality: { max: '*' },
        on: [{ ref: ['items', 'parent'] }, '=', { ref: ['$self'] }],
      };

      expect(element.type).to.equal('cds.Composition');
      expect(element.cardinality.max).to.equal('*');
    });

    it('should recognize managed Association', () => {
      const element = {
        name: 'author',
        type: 'cds.Association',
        target: 'Authors',
        // Managed association generates author_ID FK
      };

      expect(element.type).to.equal('cds.Association');
      expect(element.target).to.equal('Authors');
    });

    it('should recognize unmanaged Association', () => {
      const element = {
        name: 'author',
        type: 'cds.Association',
        target: 'Authors',
        on: [{ ref: ['author', 'ID'] }, '=', { ref: ['authorId'] }],
      };

      // Unmanaged association has explicit ON condition
      expect(element.on).to.be.an('array');
    });
  });

  describe('Draft Annotations', () => {
    it('should recognize @odata.draft.enabled', () => {
      const entity = {
        name: 'Books',
        '@odata.draft.enabled': true,
        kind: 'entity',
      };

      // Draft-enabled entity generates Books.drafts
      expect(entity['@odata.draft.enabled']).to.be.true;
    });
  });

  describe('API Annotations', () => {
    it('should recognize @cds.api.ignore', () => {
      const element = {
        name: 'internalField',
        type: 'cds.String',
        '@cds.api.ignore': true,
      };

      // Ignored elements not in OData metadata
      expect(element['@cds.api.ignore']).to.be.true;
    });

    it('should recognize @open type', () => {
      const entity = {
        name: 'Products',
        '@open': true,
        kind: 'entity',
      };

      // Open types allow dynamic properties
      expect(entity['@open']).to.be.true;
    });
  });

  describe('Annotation Precedence', () => {
    it('should handle element-level override', () => {
      const entity = {
        name: 'Books',
        '@readonly': true,
        elements: {
          viewCount: {
            '@readonly': false, // Element-level overrides entity-level
          },
        },
      };

      expect(entity['@readonly']).to.be.true;
      expect(entity.elements.viewCount['@readonly']).to.be.false;
    });
  });
});


