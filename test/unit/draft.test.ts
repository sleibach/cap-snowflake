/**
 * Unit tests for draft DDL handling in buildDeployStatements.
 *
 * Verifies that cds.compile.for.sql(model) draft entity definitions
 * are correctly transformed into CREATE TABLE statements.
 */

import { expect } from 'chai';
import { buildDeployStatements } from '../../src/ddl/deploy.js';

const MOCK_CREDENTIALS = {
  account: 'testaccount',
  user: 'testuser',
  auth: 'sdk' as const,
  password: 'testpass',
  database: 'DB',
  schema: 'APP'
};

// Minimal synthetic CSN that mirrors what cds.compile.for.sql would produce
// for a draft-enabled entity.
const DRAFT_MODEL = {
  definitions: {
    // The base entity
    'MyService.Books': {
      kind: 'entity',
      elements: {
        ID: { type: 'cds.UUID', key: true },
        title: { type: 'cds.String', length: 120 }
      }
    },
    // Draft table — same columns + draft admin FK + boolean flags
    'MyService.Books.drafts': {
      kind: 'entity',
      '@cds.persistence.name': 'MYSERVICE_BOOKS_DRAFTS',
      elements: {
        ID: { type: 'cds.UUID', key: true },
        title: { type: 'cds.String', length: 120 },
        IsActiveEntity: { type: 'cds.Boolean' },
        HasActiveEntity: { type: 'cds.Boolean' },
        HasDraftEntity: { type: 'cds.Boolean' },
        DraftAdministrativeData_DraftUUID: { type: 'cds.String', length: 36 },
        // Association to draft admin — should be skipped by toEntityDefinition
        DraftAdministrativeData: { target: 'DRAFT.DraftAdministrativeData', isAssociation: true }
      }
    },
    // Shared draft admin table
    'DRAFT.DraftAdministrativeData': {
      kind: 'entity',
      '@cds.persistence.name': 'DRAFT_DRAFTADMINISTRATIVEDATA',
      elements: {
        DraftUUID: { type: 'cds.UUID', key: true },
        CreationDateTime: { type: 'cds.Timestamp' },
        CreatedByUser: { type: 'cds.String', length: 256 },
        DraftIsCreatedByMe: { type: 'cds.Boolean' },
        LastChangeDateTime: { type: 'cds.Timestamp' },
        LastChangedByUser: { type: 'cds.String', length: 256 },
        InProcessByUser: { type: 'cds.String', length: 256 },
        DraftIsProcessedByMe: { type: 'cds.Boolean' }
      }
    },
    // Projection — must be skipped
    'MyService.DraftAdministrativeData': {
      kind: 'entity',
      projection: { from: { ref: ['DRAFT.DraftAdministrativeData'] } },
      elements: {
        DraftUUID: { type: 'cds.UUID', key: true }
      }
    },
    // Non-draft entity — should NOT produce a _DRAFTS table
    'MyService.Authors': {
      kind: 'entity',
      elements: {
        ID: { type: 'cds.UUID', key: true },
        name: { type: 'cds.String', length: 100 }
      }
    }
  }
};

describe('buildDeployStatements — draft DDL', () => {
  let statements: string[];

  before(() => {
    statements = buildDeployStatements(DRAFT_MODEL as any, MOCK_CREDENTIALS);
  });

  it('emits a CREATE TABLE for DRAFT_DRAFTADMINISTRATIVEDATA', () => {
    const found = statements.some(s =>
      s.toUpperCase().includes('DRAFT_DRAFTADMINISTRATIVEDATA')
    );
    expect(found, 'Missing DRAFT_DRAFTADMINISTRATIVEDATA table').to.be.true;
  });

  it('emits a CREATE TABLE for the _DRAFTS table', () => {
    const found = statements.some(s =>
      s.toUpperCase().includes('MYSERVICE_BOOKS_DRAFTS') ||
      s.toUpperCase().includes('_DRAFTS')
    );
    expect(found, 'Missing _DRAFTS table').to.be.true;
  });

  it('_DRAFTS table contains draft columns (ISACTIVEENTITY, DRAFTADMINISTRATIVEDATA_DRAFTUUID)', () => {
    const draftsStmt = statements.find(s =>
      s.toUpperCase().includes('DRAFTS') && s.toUpperCase().startsWith('CREATE')
    );
    expect(draftsStmt).to.exist;
    expect(draftsStmt!.toUpperCase()).to.include('ISACTIVEENTITY');
    expect(draftsStmt!.toUpperCase()).to.include('DRAFTADMINISTRATIVEDATA_DRAFTUUID');
  });

  it('ISACTIVEENTITY column on draft table has DEFAULT FALSE (regression: lean-draft PATCH 404)', () => {
    // CAP marks IsActiveEntity as virtual in the runtime Draft mixin, so INSERT never
    // explicitly sets it.  Without DEFAULT FALSE the column stores NULL and the
    // lean-draft PATCH handler (SELECT WHERE IsActiveEntity = false) returns no rows → 404.
    const draftsStmt = statements.find(s =>
      s.toUpperCase().includes('MYSERVICE_BOOKS_DRAFTS') && s.toUpperCase().startsWith('CREATE')
    );
    expect(draftsStmt).to.exist;
    expect(draftsStmt).to.match(/ISACTIVEENTITY\s+BOOLEAN\s+DEFAULT\s+FALSE/i);
  });

  it('HASDRAFTENTITY column on draft table has DEFAULT FALSE', () => {
    const draftsStmt = statements.find(s =>
      s.toUpperCase().includes('MYSERVICE_BOOKS_DRAFTS') && s.toUpperCase().startsWith('CREATE')
    );
    expect(draftsStmt).to.exist;
    expect(draftsStmt).to.match(/HASDRAFTENTITY\s+BOOLEAN\s+DEFAULT\s+FALSE/i);
  });

  it('HASACTIVEENTITY column on draft table has NO default (it is written explicitly)', () => {
    // HasActiveEntity is NOT virtual — draftEdit sets it to true before INSERT.
    // No default needed (and setting one could mask bugs).
    const draftsStmt = statements.find(s =>
      s.toUpperCase().includes('MYSERVICE_BOOKS_DRAFTS') && s.toUpperCase().startsWith('CREATE')
    );
    expect(draftsStmt).to.exist;
    // Must contain the column name
    expect(draftsStmt!.toUpperCase()).to.include('HASACTIVEENTITY');
    // Must NOT have a default on HasActiveEntity
    expect(draftsStmt).to.not.match(/HASACTIVEENTITY\s+BOOLEAN\s+DEFAULT/i);
  });

  it('non-draft entity (Authors) does NOT produce a _DRAFTS table', () => {
    const authorDrafts = statements.filter(s =>
      s.toUpperCase().includes('AUTHORS_DRAFTS') || s.toUpperCase().includes('AUTHORS.DRAFTS')
    );
    expect(authorDrafts).to.have.lengthOf(0);
  });

  it('projection (MyService.DraftAdministrativeData) is skipped — no CREATE TABLE AS SELECT', () => {
    const projectionStmt = statements.find(s =>
      s.toUpperCase().includes('AS SELECT') &&
      s.toUpperCase().includes('DRAFTADMINISTRATIVEDATA')
    );
    expect(projectionStmt).to.be.undefined;
  });
});
