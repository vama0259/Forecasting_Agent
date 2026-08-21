/**
 * Purpose: Point-in-time coordinated backup service.
 * Responsibility: Enforce write barrier, capture database dump, archive artifacts.
 * Inputs/outputs: Target directory; returns BackupManifest with cryptographic hashes.
 * Excludes: Remote S3 replication and cron scheduling.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { WriteBarrier } from '../core/ports/write-barrier.port.js';
import type { PostgresPool } from '../adapters/postgres/postgres-pool.js';
import type { Sha256Hash } from '../core/types/identifiers.js';
import { canonicalize } from '../core/utils/canonical-json.js';
import { sha256Hex } from '../core/utils/crypto-hash.js';
import { ArtifactCorruptedError } from '../core/errors/artifact-corrupted.error.js';

/** Artifact record included within a point-in-time backup manifest. */
export interface BackupArtifactEntry {
  readonly storage_key: string;
  readonly content_sha256: Sha256Hash;
  readonly content_bytes: number;
}

/** Signed manifest describing an atomic database and artifact backup. */
export interface BackupManifest {
  readonly schema_version: number;
  readonly created_at: string;
  readonly database_hash: Sha256Hash;
  readonly artifacts: readonly BackupArtifactEntry[];
}

const TABLES = [
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
 * Executes coordinated point-in-time backups across database and artifact store.
 */
export class BackupService {
  private readonly writeBarrier: WriteBarrier;
  private readonly pool: PostgresPool;
  private readonly artifactStoreBaseDir: string;

  /**
   * Initializes backup service with write barrier port and storage references.
   * Configures local directory locations.
   */
  constructor(
    writeBarrier: WriteBarrier,
    pool: PostgresPool,
    artifactStoreBaseDir: string,
  ) {
    this.writeBarrier = writeBarrier;
    this.pool = pool;
    this.artifactStoreBaseDir = artifactStoreBaseDir;
  }

  /**
   * Captures atomic database dump and artifact archive under write barrier lock.
   * Returns signed BackupManifest with SHA-256 integrity verification.
   */
  async createBackup(targetDir: string): Promise<BackupManifest> {
    const barrier = await this.writeBarrier.acquireExclusive();
    try {
      fs.mkdirSync(targetDir, { recursive: true });
      const artifactsTargetDir = path.join(targetDir, 'artifacts');
      fs.mkdirSync(artifactsTargetDir, { recursive: true });

      // 1. Dump database tables
      const dbDump: Record<string, unknown[]> = {};
      for (const table of TABLES) {
        const res = await this.pool.query<Record<string, unknown>>(
          `SELECT * FROM ${table} ORDER BY 1`,
        );
        dbDump[table] = res.rows;
      }

      const dbJson = canonicalize(dbDump);
      const dbHash = sha256Hex(Buffer.from(dbJson)) as Sha256Hash;
      fs.writeFileSync(path.join(targetDir, 'database.json'), dbJson, 'utf8');

      // 2. Archive artifacts referenced in database
      const versionsRes = await this.pool.query<{
        storage_key: string;
        content_sha256: string;
        content_bytes: number | string;
      }>(
        'SELECT storage_key, content_sha256, content_bytes ' + 'FROM artifact_versions',
      );

      const artifactEntries: BackupArtifactEntry[] = [];

      for (const row of versionsRes.rows) {
        const srcPath = path.isAbsolute(row.storage_key)
          ? row.storage_key
          : path.join(this.artifactStoreBaseDir, row.storage_key);

        if (!fs.existsSync(srcPath)) {
          throw new ArtifactCorruptedError(
            `Backup source artifact missing: ${row.storage_key}`,
            { storageKey: row.storage_key, expectedSha256: row.content_sha256 },
          );
        }

        const relKey = path.isAbsolute(row.storage_key)
          ? path.relative(this.artifactStoreBaseDir, row.storage_key)
          : row.storage_key;

        const destPath = path.join(artifactsTargetDir, relKey);
        fs.mkdirSync(path.dirname(destPath), { recursive: true });
        fs.copyFileSync(srcPath, destPath);

        // Verify the bytes actually copied match the DB's claimed hash, not
        // just that copyFileSync reported success. A backup certifies bytes
        // it has itself hashed, never a claim it trusted from the database.
        const copiedBytes = fs.readFileSync(destPath);
        const actualSha256 = sha256Hex(copiedBytes);
        if (actualSha256 !== row.content_sha256) {
          throw new ArtifactCorruptedError(
            `Backup artifact hash mismatch: ${row.storage_key}`,
            {
              storageKey: row.storage_key,
              expectedSha256: row.content_sha256,
              actualSha256,
            },
          );
        }

        artifactEntries.push({
          storage_key: relKey,
          content_sha256: row.content_sha256 as Sha256Hash,
          content_bytes: Number(row.content_bytes),
        });
      }

      // 3. Write manifest
      const manifest: BackupManifest = {
        schema_version: 1,
        created_at: new Date().toISOString(),
        database_hash: dbHash,
        artifacts: artifactEntries,
      };

      const manifestJson = canonicalize(manifest);
      fs.writeFileSync(path.join(targetDir, 'manifest.json'), manifestJson, 'utf8');

      return manifest;
    } finally {
      await barrier.release();
    }
  }
}
