import type { Pool } from 'pg';
import { BaseStore } from '@langchain/langgraph-checkpoint';
import type {
  GetOperation,
  PutOperation,
  SearchOperation,
  SearchItem,
  Operation,
  OperationResults,
} from '@langchain/langgraph-checkpoint';

export interface PostgresStoreOptions {
  pool: Pool;
}

export class PostgresStore extends BaseStore {
  private pool: Pool;

  constructor(options: PostgresStoreOptions) {
    super();
    this.pool = options.pool;
  }

  async batch<Op extends Operation[]>(operations: Op): Promise<OperationResults<Op>> {
    const results: unknown[] = [];

    for (const op of operations) {
      if ('key' in op && !('value' in op)) {
        const getOp = op as GetOperation;
        const res = await this.pool.query(
          `SELECT namespace, key, value, created_at, updated_at FROM agent_memories WHERE namespace = $1 AND key = $2`,
          [getOp.namespace, getOp.key],
        );
        if (res.rows.length === 0) {
          results.push(undefined);
        } else {
          const row = res.rows[0];
          results.push({
            namespace: row.namespace,
            key: row.key,
            value: row.value,
            createdAt: new Date(row.created_at),
            updatedAt: new Date(row.updated_at),
          });
        }
      } else if ('value' in op) {
        const putOp = op as PutOperation;
        if (putOp.value === null) {
          await this.pool.query(`DELETE FROM agent_memories WHERE namespace = $1 AND key = $2`, [
            putOp.namespace,
            putOp.key,
          ]);
        } else {
          await this.pool.query(
            `INSERT INTO agent_memories (namespace, key, value, created_at, updated_at)
             VALUES ($1, $2, $3, NOW(), NOW())
             ON CONFLICT (namespace, key)
             DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
            [putOp.namespace, putOp.key, JSON.stringify(putOp.value)],
          );
        }
        results.push(undefined);
      } else if ('namespacePrefix' in op) {
        const searchOp = op as SearchOperation;
        const res = await this.pool.query(
          `SELECT namespace, key, value, created_at, updated_at FROM agent_memories WHERE namespace[1:$1] = $2 LIMIT $3 OFFSET $4`,
          [searchOp.namespacePrefix.length, searchOp.namespacePrefix, searchOp.limit ?? 10, searchOp.offset ?? 0],
        );
        const items: SearchItem[] = res.rows.map((row) => ({
          namespace: row.namespace,
          key: row.key,
          value: row.value,
          createdAt: new Date(row.created_at),
          updatedAt: new Date(row.updated_at),
        }));
        results.push(items);
      } else if ('matchConditions' in op || 'maxDepth' in op) {
        const res = await this.pool.query(`SELECT DISTINCT namespace FROM agent_memories`);
        results.push(res.rows.map((r: { namespace: string[] }) => r.namespace));
      } else {
        results.push(undefined);
      }
    }

    return results as OperationResults<Op>;
  }
}
