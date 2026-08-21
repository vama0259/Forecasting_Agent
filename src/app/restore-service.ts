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
   * Verification runs entirely against the read-only backup source; the live
   * database and artifact store are mutated only after every hash has been
   * proven and the database transaction has committed, so a corrupt backup
   * never leaves partially-applied state.
   */
  async restore(backupDir: string): Promise<void> {
    const manifestPath = path.join(backupDir, 'manifest.json');
    if (!fs.existsSync(manifestPath)) {
      throw new Error(`Manifest not found at: ${manifestPath}`);
    }

    const manifest: BackupManifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

    // 1. Verify every artifact against the read-only backup source without
    // touching the live artifact store yet.
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
    }

    // 2. Verify the database dump hash before parsing or applying it.
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

    // 3. Apply the verified dump inside one transaction; nothing here can
    // fail on integrity, only on the database rejecting a row.
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

    // 4. Only after the transaction has committed does verified data reach
    // the live artifact store, so a failed transaction leaves it untouched.
    const artifactsRoot = path.join(this.artifactStoreBaseDir, 'artifacts');
    const restoredRelKeys = new Set<string>();
    for (const art of manifest.artifacts) {
      const srcPath = path.join(artifactsSourceDir, art.storage_key);
      const destPath = path.isAbsolute(art.storage_key)
        ? art.storage_key
        : path.join(this.artifactStoreBaseDir, art.storage_key);

      fs.mkdirSync(path.dirname(destPath), { recursive: true });
      fs.copyFileSync(srcPath, destPath);
      restoredRelKeys.add(path.relative(artifactsRoot, destPath));
    }

    // 5. Prune any file the artifact store held that the backup does not
    // account for, so stale bytes from before the restore cannot survive.
    // Scoped to the content-addressed "artifacts" subtree only; other
    // directories under the store root (e.g. in-flight staging) are untouched.
    this.pruneUnlistedFiles(artifactsRoot, restoredRelKeys);
  }

  /**
   * Recursively removes files under root whose relative path is not in kept,
   * then removes any directory left empty by that removal.
   * Resolves once pruning completes; no-ops if root does not exist.
   */
  private pruneUnlistedFiles(root: string, kept: ReadonlySet<string>): void {
    if (!fs.existsSync(root)) return;

    const walk = (dir: string): void => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(fullPath);
          if (fs.readdirSync(fullPath).length === 0) {
            fs.rmdirSync(fullPath);
          }
          continue;
        }
        const relKey = path.relative(root, fullPath);
        if (!kept.has(relKey)) {
          fs.unlinkSync(fullPath);
        }
      }
    };

    walk(root);
  }
}
