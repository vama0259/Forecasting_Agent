import fs from 'node:fs/promises';
import path from 'node:path';
import type { Pool } from 'pg';

export async function runMigrations(pool: Pool, migrationsDir: string): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name text PRIMARY KEY,
      applied_at timestamptz DEFAULT now()
    )
  `);

  const resolvedDir = path.isAbsolute(migrationsDir) ? migrationsDir : path.resolve(process.cwd(), migrationsDir);

  const entries = await fs.readdir(resolvedDir);
  const sqlFiles = entries.filter((file) => file.endsWith('.sql')).sort();

  const appliedResult = await pool.query<{ name: string }>('SELECT name FROM schema_migrations');
  const appliedSet = new Set(appliedResult.rows.map((row) => row.name));

  for (const file of sqlFiles) {
    if (appliedSet.has(file)) {
      continue;
    }

    const filePath = path.join(resolvedDir, file);
    const sql = await fs.readFile(filePath, 'utf8');

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}
