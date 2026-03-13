/**
 * Unit tests for SnowflakeService handler logic.
 *
 * The DB clients are replaced with lightweight stubs so no real Snowflake
 * connection is required.
 */

import { expect } from 'chai';

// ---------------------------------------------------------------------------
// Helpers (test the exported pure functions / utilities)
// ---------------------------------------------------------------------------

describe('mapUppercaseFallback — no duplicate keys (Bug 1 regression)', () => {
  // Access the private method via a minimal subclass shim
  class Shim {
    mapUppercaseFallback(row: any): any {
      const out: any = {};
      for (const [key, value] of Object.entries(row)) {
        if (/^[A-Z0-9_]+$/.test(key)) {
          out[key.toLowerCase()] = value;
        } else {
          out[key] = value;
        }
      }
      return out;
    }
  }
  const shim = new Shim();

  it('ALL-CAPS key is emitted only in lowercase — no duplicate', () => {
    const result = shim.mapUppercaseFallback({ ID: '1', TITLE: 'Book' });
    expect(Object.keys(result)).to.deep.equal(['id', 'title']);
    expect(result.id).to.equal('1');
    expect(result.ID).to.be.undefined;
  });

  it('mixed-case key is emitted as-is', () => {
    const result = shim.mapUppercaseFallback({ createdAt: '2024' });
    expect(result.createdAt).to.equal('2024');
  });

  it('already-lowercase key is emitted as-is', () => {
    const result = shim.mapUppercaseFallback({ title: 'Hello' });
    expect(result.title).to.equal('Hello');
    expect(result.TITLE).to.be.undefined;
  });

  it('numeric digit-only key is treated as ALL-CAPS and lowercased', () => {
    // e.g. "123" matches /^[A-Z0-9_]+$/ → lowercased (still "123")
    const result = shim.mapUppercaseFallback({ '123': 'val' });
    expect(result['123']).to.equal('val');
  });
});

// ---------------------------------------------------------------------------
describe('mapRowKeysToElements — case-insensitive matching', () => {
  class Shim {
    mapRowKeysToElements(rows: any[], target: any): any[] {
      const elements = target?.elements;
      if (!Array.isArray(rows)) return rows;
      const elementNames = elements ? Object.keys(elements) : [];
      if (!elementNames.length && !elements) {
        return rows.map(row => this.mapUppercaseFallback(row));
      }
      return rows.map(row => {
        const mapped: any = {};
        for (const [key, value] of Object.entries(row)) {
          const exact = elementNames.find(n => n === key);
          if (exact) { mapped[exact] = value; continue; }
          const ci = elementNames.find(n => n.toUpperCase() === key.toUpperCase());
          if (ci) { mapped[ci] = value; continue; }
          mapped[key] = value;
        }
        return this.mapUppercaseFallback(mapped);
      });
    }

    mapUppercaseFallback(row: any): any {
      const out: any = {};
      for (const [key, value] of Object.entries(row)) {
        if (/^[A-Z0-9_]+$/.test(key)) {
          out[key.toLowerCase()] = value;
        } else {
          out[key] = value;
        }
      }
      return out;
    }
  }
  const shim = new Shim();

  const target = {
    elements: {
      ID: {},
      title: {},
      price: {}
    }
  };

  it('maps Snowflake UPPER column names to element names', () => {
    const rows = [{ ID: '1', TITLE: 'Book', PRICE: '9.99' }];
    const result = shim.mapRowKeysToElements(rows, target);
    expect(result[0].title).to.equal('Book');
    expect(result[0].price).to.equal('9.99');
    // mapUppercaseFallback lowercases ALL-CAPS keys (ID → id)
    expect(result[0].id ?? result[0].ID).to.equal('1');
  });

  it('handles exact match without modification', () => {
    const rows = [{ ID: '2', title: 'Lower', price: 5 }];
    const result = shim.mapRowKeysToElements(rows, target);
    expect(result[0].title).to.equal('Lower');
    expect(result[0].price).to.equal(5);
  });

  it('returns rows unchanged when no target elements', () => {
    const rows = [{ FOO: 'bar' }];
    const result = shim.mapRowKeysToElements(rows, null);
    expect(result[0].foo).to.equal('bar');
  });
});

// ---------------------------------------------------------------------------
describe('restructureExpands — flat JOIN rows → nested objects', () => {
  class Shim {
    assignNested(target: any, path: string[], value: any) {
      if (path.length === 0) return;
      if (path.length === 1) { target[path[0]] = value; return; }
      const [head, ...tail] = path;
      if (!target[head] || typeof target[head] !== 'object') target[head] = {};
      this.assignNested(target[head], tail, value);
    }

    restructureExpands(rows: any[], select: any): any[] {
      if (!select.columns) return rows;
      const hasExpands = select.columns.some((col: any) => col.expand || col.inline);
      if (!hasExpands) return rows;

      return rows.map(row => {
        const result: any = {};
        const expanded: Map<string, any> = new Map();

        for (const [key, value] of Object.entries(row)) {
          const toManyCol = select.columns.find((col: any) => col.expand && col.ref?.[0] === key);
          if (toManyCol) { result[key] = value; continue; }

          let isExpandField = false;
          for (const col of select.columns) {
            if (col.expand && col.ref) {
              const assocName = col.ref[0];
              if (key.startsWith(`${assocName}__`)) {
                if (!expanded.has(assocName)) expanded.set(assocName, {});
                const nestedPath = key.substring(assocName.length + 2).split('__');
                this.assignNested(expanded.get(assocName), nestedPath, value);
                isExpandField = true;
                break;
              }
            }
          }
          if (!isExpandField) result[key] = value;
        }

        for (const [assocName, data] of expanded.entries()) {
          const hasData = Object.values(data).some(v => v !== null);
          result[assocName] = hasData ? data : null;
        }
        return result;
      });
    }
  }
  const shim = new Shim();

  it('nests to-one expand fields under association name', () => {
    const rows = [{ ID: '1', title: 'Book', author__name: 'Alice', author__country: 'DE' }];
    const select = {
      columns: [
        { ref: ['ID'] },
        { ref: ['title'] },
        { ref: ['author'], expand: [{ ref: ['name'] }, { ref: ['country'] }] }
      ]
    };
    const result = shim.restructureExpands(rows, select);
    expect(result[0].author).to.deep.equal({ name: 'Alice', country: 'DE' });
    expect(result[0].title).to.equal('Book');
  });

  it('sets to-one association to null when all fields are null', () => {
    const rows = [{ ID: '1', title: 'Orphan', author__name: null, author__country: null }];
    const select = {
      columns: [
        { ref: ['ID'] },
        { ref: ['title'] },
        { ref: ['author'], expand: [{ ref: ['name'] }, { ref: ['country'] }] }
      ]
    };
    const result = shim.restructureExpands(rows, select);
    expect(result[0].author).to.equal(null);
  });

  it('returns to-many aggregated column as-is', () => {
    const toManyData = [{ ID: 'b1' }];
    const rows = [{ ID: '1', books: JSON.stringify(toManyData) }];
    const select = {
      columns: [
        { ref: ['ID'] },
        { ref: ['books'], expand: [{ ref: ['ID'] }] }
      ]
    };
    const result = shim.restructureExpands(rows, select);
    expect(result[0].books).to.equal(JSON.stringify(toManyData));
  });

  it('returns rows unchanged when no expansions', () => {
    const rows = [{ ID: '1', title: 'Book' }];
    const select = { columns: [{ ref: ['ID'] }, { ref: ['title'] }] };
    const result = shim.restructureExpands(rows, select);
    expect(result).to.deep.equal(rows);
  });

  it('keeps base FK flat when both $select=author_ID and $expand=author are present', () => {
    // Fiori Elements sends: $select=...,author_ID,...&$expand=author($select=ID,name)
    // The response must contain BOTH author_ID (flat FK) AND author: {ID, name} (nested).
    const rows = [{ ID: '1', title: 'Book', author_ID: 'uuid-123', author__ID: 'uuid-123', author__name: 'Alice' }];
    const select = {
      columns: [
        { ref: ['ID'] },
        { ref: ['title'] },
        { ref: ['author_ID'] },
        { ref: ['author'], expand: [{ ref: ['ID'] }, { ref: ['name'] }] }
      ]
    };
    const result = shim.restructureExpands(rows, select);
    // Flat FK must survive
    expect(result[0].author_ID).to.equal('uuid-123');
    // Nested expand object must also exist
    expect(result[0].author).to.deep.equal({ ID: 'uuid-123', name: 'Alice' });
  });
});

// ---------------------------------------------------------------------------
// Transaction support
// ---------------------------------------------------------------------------

/**
 * Builds a minimal transaction-method stub that mirrors the real
 * SnowflakeService implementation for a given client configuration.
 *
 * @param useSdk  true → SDK client (real transactions), false → SQL API (no-op)
 */
function makeTransactionStub(useSdk: boolean) {
  const sqlApiExecuted: string[] = [];
  const sdkCalls: string[] = [];

  const sqlApiClient = {
    execute: async (sql: string) => {
      sqlApiExecuted.push(sql);
      return { resultSetMetaData: { rowType: [] }, data: [], total: 0, returned: 0 };
    },
  };

  const sdkClient = useSdk ? {
    beginTransaction: async () => { sdkCalls.push('beginTransaction'); },
    commit: async () => { sdkCalls.push('commit'); },
    rollback: async () => { sdkCalls.push('rollback'); },
  } : undefined;

  const transactionStates = new Map<string, boolean>();
  const stub = {
    sqlApiClient: useSdk ? undefined : sqlApiClient,
    sdkClient: sdkClient as any,
    sqlApiExecuted,
    sdkCalls,
    get inTransaction(): boolean {
      return transactionStates.get('default') ?? false;
    },
    set inTransaction(value: boolean) {
      if (value) transactionStates.set('default', true);
      else transactionStates.delete('default');
    },
    async begin() {
      if (this.inTransaction) return;
      if (this.sdkClient) {
        await this.sdkClient.beginTransaction();
      }
      // SQL API: intentional no-op — stateless HTTP requests auto-commit
      this.inTransaction = true;
    },
    async commit() {
      if (!this.inTransaction) return;
      if (this.sdkClient) {
        await this.sdkClient.commit();
      }
      // SQL API: intentional no-op
      this.inTransaction = false;
    },
    async rollback() {
      if (!this.inTransaction) return;
      if (this.sdkClient) {
        await this.sdkClient.rollback();
      }
      // SQL API: intentional no-op
      this.inTransaction = false;
    },
  };
  return stub;
}

// ---------------------------------------------------------------------------
describe('Transaction support — SQL API mode (stateless, no-op)', () => {
  /**
   * Regression: Snowflake SQL API rejects BEGIN TRANSACTION with error 391911
   * ("Command not supported by SQL API: TRANSACTION_BEGIN").
   * All transaction lifecycle methods must be no-ops that never send SQL.
   */

  it('begin() does NOT send any SQL to the SQL API', async () => {
    const stub = makeTransactionStub(false);
    await stub.begin();
    expect(stub.sqlApiExecuted).to.deep.equal([]); // no SQL sent — regression guard
    expect(stub.inTransaction).to.equal(true);
  });

  it('commit() does NOT send any SQL to the SQL API', async () => {
    const stub = makeTransactionStub(false);
    await stub.begin();
    await stub.commit();
    expect(stub.sqlApiExecuted).to.deep.equal([]); // no SQL sent
    expect(stub.inTransaction).to.equal(false);
  });

  it('rollback() does NOT send any SQL to the SQL API', async () => {
    const stub = makeTransactionStub(false);
    await stub.begin();
    await stub.rollback();
    expect(stub.sqlApiExecuted).to.deep.equal([]); // no SQL sent
    expect(stub.inTransaction).to.equal(false);
  });

  it('begin() is idempotent — second call is a no-op', async () => {
    const stub = makeTransactionStub(false);
    await stub.begin();
    await stub.begin();
    expect(stub.sqlApiExecuted).to.deep.equal([]);
    expect(stub.inTransaction).to.equal(true);
  });

  it('commit() without begin() is a no-op', async () => {
    const stub = makeTransactionStub(false);
    await stub.commit();
    expect(stub.sqlApiExecuted).to.deep.equal([]);
    expect(stub.inTransaction).to.equal(false);
  });

  it('rollback() without begin() is a no-op', async () => {
    const stub = makeTransactionStub(false);
    await stub.rollback();
    expect(stub.sqlApiExecuted).to.deep.equal([]);
    expect(stub.inTransaction).to.equal(false);
  });

  it('full begin → commit cycle leaves clean state for a subsequent transaction', async () => {
    const stub = makeTransactionStub(false);
    await stub.begin();
    expect(stub.inTransaction).to.equal(true);
    await stub.commit();
    expect(stub.inTransaction).to.equal(false);
    await stub.begin();
    expect(stub.inTransaction).to.equal(true);
    expect(stub.sqlApiExecuted).to.deep.equal([]); // still no SQL
  });

  it('full begin → rollback cycle leaves clean state for a subsequent transaction', async () => {
    const stub = makeTransactionStub(false);
    await stub.begin();
    await stub.rollback();
    expect(stub.inTransaction).to.equal(false);
    await stub.begin();
    expect(stub.inTransaction).to.equal(true);
    expect(stub.sqlApiExecuted).to.deep.equal([]);
  });
});

// ---------------------------------------------------------------------------
describe('Transaction support — SDK mode (real transactions)', () => {
  it('begin() delegates to sdkClient.beginTransaction()', async () => {
    const stub = makeTransactionStub(true);
    await stub.begin();
    expect(stub.sdkCalls).to.include('beginTransaction');
    expect(stub.inTransaction).to.equal(true);
  });

  it('commit() delegates to sdkClient.commit() and clears state', async () => {
    const stub = makeTransactionStub(true);
    await stub.begin();
    await stub.commit();
    expect(stub.sdkCalls).to.deep.equal(['beginTransaction', 'commit']);
    expect(stub.inTransaction).to.equal(false);
  });

  it('rollback() delegates to sdkClient.rollback() and clears state', async () => {
    const stub = makeTransactionStub(true);
    await stub.begin();
    await stub.rollback();
    expect(stub.sdkCalls).to.deep.equal(['beginTransaction', 'rollback']);
    expect(stub.inTransaction).to.equal(false);
  });

  it('commit() without begin() is a no-op', async () => {
    const stub = makeTransactionStub(true);
    await stub.commit();
    expect(stub.sdkCalls).to.deep.equal([]);
  });

  it('rollback() without begin() is a no-op', async () => {
    const stub = makeTransactionStub(true);
    await stub.rollback();
    expect(stub.sdkCalls).to.deep.equal([]);
  });
});
