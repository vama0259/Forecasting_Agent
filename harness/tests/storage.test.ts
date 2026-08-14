import { describe, it, expect } from 'vitest';
import { Pool } from 'pg';
import { runMigrations } from '../src/storage/migrator.js';

const TEST_DB_URL = process.env.TEST_DATABASE_URL ?? 'postgres://localhost:5432/harness_test';

describe('migrator', () => {
  it('applies 001_initial.sql and records it in schema_migrations', async () => {
    const pool = new Pool({ connectionString: TEST_DB_URL });
    await runMigrations(pool, 'src/storage/migrations');
    const applied = await pool.query('SELECT name FROM schema_migrations ORDER BY name');
    expect(applied.rows.map((r) => r.name)).toContain('001_initial.sql');
    const tables = await pool.query(`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`);
    const names = tables.rows.map((r) => r.table_name);
    expect(names).toEqual(
      expect.arrayContaining([
        'forecasts',
        'debate_traces',
        'evaluation_results',
        'agent_signals',
        'debate_checkpoints',
      ]),
    );
    await pool.end();
  });

  it('re-running migrations is a no-op, not a re-apply', async () => {
    const pool = new Pool({ connectionString: TEST_DB_URL });
    await runMigrations(pool, 'src/storage/migrations');
    const before = await pool.query('SELECT count(*) FROM schema_migrations');
    await runMigrations(pool, 'src/storage/migrations');
    const after = await pool.query('SELECT count(*) FROM schema_migrations');
    expect(after.rows[0].count).toBe(before.rows[0].count);
    await pool.end();
  });
});
