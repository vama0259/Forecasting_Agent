/**
 * Purpose: Point-in-time coordinated restore service.
 * Responsibility: Verify backup manifest and artifact integrity, restore tables.
 * Inputs/outputs: Backup directory; verifies integrity and restores database & store.
 * Excludes: Live streaming replication failover.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { PostgresPool } from '../adapters/postgres/postgres-pool.js';
import type { BackupManifest } from './backup-service.js';
import { sha256Hex } from '../core/utils/crypto-hash.js';
import { ArtifactCorruptedError } from '../core/errors/artifact-corrupted.error.js';

const INSERT_ORDER = [
  'organizations',
  'principals',
  'projects',
  'contracts',
  'execution_contracts',
  'runs',
  'run_attempts',
  'executions',
  'execution_authorizations',
  'execution_commands',
  'execution_events',
  'artifacts',
  'artifact_versions',
  'artifact_edges',
  'execution_inputs',
  'execution_outputs',
  'publications',
  'outcome_versions',
  'evaluation_runs',
] as const;

/**
 * Restores database state and artifact blobs from a verified point-in-time backup.
 */
export class RestoreService {
  private readonly pool: PostgresPool;
  private readonly artifactStoreBaseDir: string;

  /**
   * Initializes restore service with database pool and artifact store directory.
   * Configures local directory targets.
   */
  constructor(pool: PostgresPool, artifactStoreBaseDir: string) {
    this.pool = pool;
    this.artifactStoreBaseDir = artifactStoreBaseDir;
  }

  /**
   * Restores complete system state from backup directory after verifying all hashes.
   * Resolves on completion or throws error on corrupted artifact / mismatched hash.
   */
  async restore(backupDir: string): Promise<void> {
    const manifestPath = path.join(backupDir, 'manifest.json');
    if (!fs.existsSync(manifestPath)) {
      throw new Error(`Manifest not found at: ${manifestPath}`);
    }

    const manifest: BackupManifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

    // 1. Verify and copy artifacts
    const artifactsSourceDir = path.join(backupDir, 'artifacts');
    for (const art of manifest.artifacts) {
      const srcPath = path.join(artifactsSourceDir, art.storage_key);
      if (!fs.existsSync(srcPath)) {
        throw new Error(`Backup missing required artifact file: ${art.storage_key}`);
      }
      const data = fs.readFileSync(srcPath);
      const computedHash = sha256Hex(data);
      if (computedHash !== art.content_sha256) {
        throw new ArtifactCorruptedError(
          `Artifact ${art.storage_key} corrupted: ` +
            `expected ${art.content_sha256}, got ${computedHash}`,
        );
      }

      const destPath = path.isAbsolute(art.storage_key)
        ? art.storage_key
        : path.join(this.artifactStoreBaseDir, art.storage_key);

      fs.mkdirSync(path.dirname(destPath), { recursive: true });
      fs.copyFileSync(srcPath, destPath);
    }

    // 2. Verify and restore database dump
    const dbPath = path.join(backupDir, 'database.json');
    if (!fs.existsSync(dbPath)) {
      throw new Error(`Database dump not found at: ${dbPath}`);
    }

    const dbContent = fs.readFileSync(dbPath, 'utf8');
    const computedDbHash = sha256Hex(Buffer.from(dbContent));
    if (computedDbHash !== manifest.database_hash) {
      throw new Error(
        `Database dump hash mismatch: ` +
          `expected ${manifest.database_hash}, got ${computedDbHash}`,
      );
    }

    const dbDump = JSON.parse(dbContent) as Record<string, Record<string, unknown>[]>;

    await this.pool.withTransaction(async (client) => {
      for (const table of [...INSERT_ORDER].reverse()) {
        await client.query(`DELETE FROM ${table}`);
      }

      for (const table of INSERT_ORDER) {
        const rows = dbDump[table] ?? [];
        for (const row of rows) {
          const keys = Object.keys(row);
          if (keys.length === 0) continue;
          const values = keys.map((k) => {
            const v = row[k];
            if (v !== null && typeof v === 'object') {
              return JSON.stringify(v);
            }
            return v;
          });
          const cols = keys.map((k) => `"${k}"`).join(', ');
          const placeholders = keys.map((_, idx) => `$${idx + 1}`).join(', ');

          const overrideClause =
            table === 'execution_events' ? 'OVERRIDING SYSTEM VALUE ' : '';

          await client.query(
            `INSERT INTO ${table} (${cols}) ` +
              `${overrideClause}VALUES (${placeholders})`,
            values,
          );
        }
      }
    });
  }
}
