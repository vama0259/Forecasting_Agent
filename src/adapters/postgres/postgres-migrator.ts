/**
 * Purpose: PostgreSQL migration runner applying versioned SQL schema definitions.
 * Responsibility: Track applied migrations and execute pending SQL migration scripts.
 * Inputs/outputs: Database pool and migrations directory; returns applied script names.
 * Excludes: Dynamic SQL generation and ORM schema synchronization.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { PostgresPool } from './postgres-pool.js';

/**
 * Executes version-controlled SQL migration scripts against a PostgreSQL pool.
 */
export class PostgresMigrator {
  private readonly pool: PostgresPool;
  private readonly migrationsDir: string;

  /**
   * Initializes migrator with a PostgreSQL pool and migrations directory path.
   * Sets default migrations directory if omitted.
   */
  constructor(pool: PostgresPool, migrationsDir?: string) {
    this.pool = pool;
    this.migrationsDir = migrationsDir ?? path.resolve(process.cwd(), 'migrations');
  }

  /**
   * Ensures the schema_migrations tracking table exists.
   * Creates table if not present.
   */
  private async ensureMigrationTable(): Promise<void> {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version VARCHAR(255) PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
  }

  /**
   * Reads and executes all unapplied SQL migration files in lexicographical order.
   * Returns list of newly applied migration file names.
   */
  async runMigrations(): Promise<string[]> {
    await this.ensureMigrationTable();

    const appliedResult = await this.pool.query<{ version: string }>(
      'SELECT version FROM schema_migrations ORDER BY version ASC',
    );
    const appliedSet = new Set(appliedResult.rows.map((r) => r.version));

    if (!fs.existsSync(this.migrationsDir)) {
      return [];
    }

    const files = fs
      .readdirSync(this.migrationsDir)
      .filter((f) => f.endsWith('.sql'))
      .sort();

    const newlyApplied: string[] = [];

    for (const file of files) {
      if (appliedSet.has(file)) {
        continue;
      }
      const filePath = path.join(this.migrationsDir, file);
      const sql = fs.readFileSync(filePath, 'utf-8');

      await this.pool.withTransaction(async (client) => {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (version) VALUES ($1)', [
          file,
        ]);
      });

      newlyApplied.push(file);
    }

    return newlyApplied;
  }
}
