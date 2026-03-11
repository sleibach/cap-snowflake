import { expect } from 'chai';
import { SnowflakeSDKClient } from '../../src/client/sdk.js';
import { SnowflakeSQLAPIClient } from '../../src/client/sqlapi.js';
import { SnowflakeCredentials } from '../../src/config.js';

const credentials: SnowflakeCredentials = {
  account: 'ACC',
  host: 'acc.snowflakecomputing.com',
  user: 'USER',
  auth: 'jwt',
  jwt: { privateKey: 'dummy' }
};

describe('Streaming support', () => {
  it('streams rows from SDK client in batches', async () => {
    const client = new SnowflakeSDKClient(credentials);
    let call = 0;
    (client as any).execute = async () => {
      call += 1;
      if (call === 1) return { rows: [{ ID: 1 }, { ID: 2 }], rowCount: 2 };
      if (call === 2) return { rows: [{ ID: 3 }], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    };

    const rows: any[] = [];
    for await (const row of client.queryStream('SELECT * FROM T', [], { batchSize: 2 })) {
      rows.push(row);
    }

    expect(rows.map(r => r.ID)).to.deep.equal([1, 2, 3]);
    expect(call).to.equal(2);
  });

  it('streams rows from SQL API client in batches', async () => {
    const client = new SnowflakeSQLAPIClient(credentials);
    let call = 0;
    (client as any).execute = async () => {
      call += 1;
      if (call === 1) {
        return {
          resultSetMetaData: { rowType: [{ name: 'ID', type: 'FIXED', nullable: false }] },
          data: [[1], [2]],
          total: 2,
          returned: 2
        };
      }
      return {
        resultSetMetaData: { rowType: [{ name: 'ID', type: 'FIXED', nullable: false }] },
        data: [[3]],
        total: 1,
        returned: 1
      };
    };

    const rows: any[] = [];
    for await (const row of client.queryStream('SELECT * FROM T', [], { batchSize: 2 })) {
      rows.push(row);
      if (rows.length === 3) break;
    }

    expect(rows.map(r => r.ID)).to.deep.equal([1, 2, 3]);
    expect(call).to.equal(2);
  });
});
