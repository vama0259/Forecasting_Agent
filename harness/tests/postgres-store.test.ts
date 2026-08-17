import { describe, it, expect, vi } from 'vitest';
import type { Pool } from 'pg';
import { PostgresStore } from '../src/storage/postgres-store.js';

describe('PostgresStore', () => {
  it('puts, gets, and deletes items via batch operations', async () => {
    const mockQuery = vi.fn().mockImplementation(async (sql: string, params: unknown[]) => {
      if (
        sql.startsWith(
          'SELECT namespace, key, value, created_at, updated_at FROM agent_memories WHERE namespace = $1 AND key = $2',
        )
      ) {
        return {
          rows: [
            {
              namespace: params[0],
              key: params[1],
              value: { observation: 'RSI test' },
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            },
          ],
        };
      }
      return { rows: [] };
    });

    const mockPool = { query: mockQuery } as unknown as Pool;
    const store = new PostgresStore({ pool: mockPool });

    await store.put(['memories', 'price'], 'TCS.NS.json', { observation: 'RSI test' });
    expect(mockQuery).toHaveBeenCalled();

    const item = await store.get(['memories', 'price'], 'TCS.NS.json');
    expect(item).toBeDefined();
    expect(item?.value['observation']).toBe('RSI test');

    await store.delete(['memories', 'price'], 'TCS.NS.json');
    expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining('DELETE FROM agent_memories'), [
      ['memories', 'price'],
      'TCS.NS.json',
    ]);
  });

  it('searches items within a namespace prefix', async () => {
    const mockQuery = vi.fn().mockImplementation(async (sql: string) => {
      if (sql.includes('namespace[1:$1] = $2')) {
        return {
          rows: [
            {
              namespace: ['memories', 'price'],
              key: 'TCS.NS.json',
              value: { observation: 'RSI test' },
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            },
          ],
        };
      }
      return { rows: [] };
    });

    const mockPool = { query: mockQuery } as unknown as Pool;
    const store = new PostgresStore({ pool: mockPool });

    const results = await store.search(['memories', 'price']);
    expect(results).toHaveLength(1);
    expect(results[0]?.key).toBe('TCS.NS.json');
    expect(results[0]?.value['observation']).toBe('RSI test');
  });

  it('lists distinct namespaces', async () => {
    const mockQuery = vi.fn().mockImplementation(async (sql: string) => {
      if (sql.includes('SELECT DISTINCT namespace FROM agent_memories')) {
        return {
          rows: [{ namespace: ['memories', 'price'] }, { namespace: ['memories', 'news'] }],
        };
      }
      return { rows: [] };
    });

    const mockPool = { query: mockQuery } as unknown as Pool;
    const store = new PostgresStore({ pool: mockPool });

    const namespaces = await store.listNamespaces();
    expect(namespaces).toEqual([
      ['memories', 'price'],
      ['memories', 'news'],
    ]);
  });
});
