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

export interface DebateRoundRecord {
  forecastId: string;
  symbol: string;
  asOf: string; // ISO 8601 string
  roundNumber: 1 | 2 | 3 | 4;
  agentName: 'price' | 'fii' | 'dii' | 'retail' | 'consensus';
  direction: 'up' | 'down';
  probability: number;
  confidence: number;
  degraded: boolean;
  payload: Record<string, unknown>;
}

export type PostgresStoreParam = PostgresStoreOptions | Pool;

export class PostgresStore extends BaseStore {
  private pool: Pool;

  constructor(options: PostgresStoreParam) {
    super();
    if (typeof options === 'object' && options !== null && 'pool' in options && options.pool) {
      this.pool = options.pool;
    } else {
      this.pool = options as Pool;
    }
  }

  async saveDebateRound(record: DebateRoundRecord): Promise<void> {
    const query = `
      INSERT INTO debate_rounds (
        forecast_id, symbol, as_of, round_number, agent_name, direction, probability, confidence, degraded, payload
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      ON CONFLICT (forecast_id, round_number, agent_name) DO UPDATE SET
        direction = EXCLUDED.direction,
        probability = EXCLUDED.probability,
        confidence = EXCLUDED.confidence,
        degraded = EXCLUDED.degraded,
        payload = EXCLUDED.payload;
    `;
    await this.pool.query(query, [
      record.forecastId,
      record.symbol,
      record.asOf,
      record.roundNumber,
      record.agentName,
      record.direction,
      record.probability,
      record.confidence,
      record.degraded,
      JSON.stringify(record.payload),
    ]);
  }

  async getDebateRounds(forecastId: string): Promise<DebateRoundRecord[]> {
    const query = `
      SELECT forecast_id, symbol, as_of, round_number, agent_name, direction, probability, confidence, degraded, payload
      FROM debate_rounds
      WHERE forecast_id = $1
      ORDER BY round_number ASC, created_at ASC;
    `;
    const result = await this.pool.query(query, [forecastId]);
    return result.rows.map((r) => ({
      forecastId: r.forecast_id,
      symbol: r.symbol,
      asOf: new Date(r.as_of).toISOString(),
      roundNumber: r.round_number,
      agentName: r.agent_name,
      direction: r.direction,
      probability: r.probability,
      confidence: r.confidence,
      degraded: r.degraded,
      payload: typeof r.payload === 'string' ? JSON.parse(r.payload) : r.payload,
    }));
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
