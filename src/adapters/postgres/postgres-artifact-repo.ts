/**
 * Purpose: PostgreSQL persistence adapter for artifacts and immutable versions.
 * Responsibility: Execute SQL inserts and lookups for artifact metadata records.
 * Inputs/outputs: Artifact descriptors; returns persisted ArtifactVersionRecords.
 * Excludes: Filesystem byte storage and authorization verification.
 */

import type {
  ArtifactRecord,
  ArtifactVersionMetadata,
  ArtifactVersionRecord,
} from '../../core/types/artifacts.js';
import type {
  ArtifactId,
  ArtifactVersionId,
  ExecutionId,
  OrganizationId,
  ProjectId,
  Sha256Hash,
} from '../../core/types/identifiers.js';
import type { ArtifactVersionState } from '../../core/types/lifecycle.js';
import type { PostgresPool } from './postgres-pool.js';

interface RawArtifactVersionRow {
  readonly id: ArtifactVersionId;
  readonly organization_id: OrganizationId;
  readonly artifact_id: ArtifactId;
  readonly version: number;
  readonly state: ArtifactVersionState;
  readonly content_sha256: Sha256Hash;
  readonly content_bytes: string | number;
  readonly media_type: string;
  readonly storage_key: string;
  readonly available_from: string;
  readonly observed_at: string | null;
  readonly source_published_at: string | null;
  readonly retrieved_at: string;
  readonly produced_by_execution_id: ExecutionId | null;
  readonly metadata: ArtifactVersionMetadata;
  readonly created_at: string;
}

/**
 * PostgreSQL repository for artifact metadata and version records.
 */
export class PostgresArtifactRepository {
  private readonly pool: PostgresPool;

  /**
   * Initializes artifact repository with PostgreSQL pool instance.
   * Sets local pool reference.
   */
  constructor(pool: PostgresPool) {
    this.pool = pool;
  }

  /**
   * Maps raw database artifact version row to typed ArtifactVersionRecord.
   * Ensures content_bytes is converted to numeric number.
   */
  private mapVersionRow(row: RawArtifactVersionRow): ArtifactVersionRecord {
    return {
      ...row,
      content_bytes: Number(row.content_bytes),
    };
  }

  /**
   * Inserts a new logical artifact record.
   * Returns created ArtifactRecord.
   */
  async createArtifact(artifact: {
    readonly id?: ArtifactId;
    readonly organization_id: OrganizationId;
    readonly project_id: ProjectId;
    readonly kind: string;
    readonly logical_name: string;
    readonly sensitivity?: string;
  }): Promise<ArtifactRecord> {
    const res = await this.pool.query<ArtifactRecord>(
      `INSERT INTO artifacts (
         id, organization_id, project_id, kind, logical_name, sensitivity
       ) VALUES (
         COALESCE($1, gen_random_uuid()), $2, $3, $4, $5, $6
       )
       RETURNING id, organization_id, project_id, kind, logical_name,
                 sensitivity, created_at::text`,
      [
        artifact.id ?? null,
        artifact.organization_id,
        artifact.project_id,
        artifact.kind,
        artifact.logical_name,
        artifact.sensitivity ?? 'STANDARD',
      ],
    );
    const row = res.rows[0];
    if (!row) throw new Error('Failed to insert artifact');
    return row;
  }

  /**
   * Inserts an immutable artifact version with content hash and size.
   * Returns created ArtifactVersionRecord.
   */
  async createArtifactVersion(version: {
    readonly id?: ArtifactVersionId;
    readonly organization_id: OrganizationId;
    readonly artifact_id: ArtifactId;
    readonly version: number;
    readonly state: ArtifactVersionState;
    readonly content_sha256: Sha256Hash;
    readonly content_bytes: number;
    readonly media_type: string;
    readonly storage_key: string;
    readonly available_from: string;
    readonly observed_at?: string | null;
    readonly source_published_at?: string | null;
    readonly retrieved_at: string;
    readonly produced_by_execution_id?: string | null;
    readonly metadata?: ArtifactVersionMetadata;
  }): Promise<ArtifactVersionRecord> {
    const res = await this.pool.query<RawArtifactVersionRow>(
      `INSERT INTO artifact_versions (
         id, organization_id, artifact_id, version, state, content_sha256,
         content_bytes, media_type, storage_key, available_from, observed_at,
         source_published_at, retrieved_at, produced_by_execution_id, metadata
       ) VALUES (
         COALESCE($1, gen_random_uuid()), $2, $3, $4, $5, $6, $7, $8, $9, $10,
         $11, $12, $13, $14, $15
       )
       RETURNING id, organization_id, artifact_id, version, state, content_sha256,
                 content_bytes::text, media_type, storage_key,
                 available_from::text, observed_at::text,
                 source_published_at::text, retrieved_at::text,
                 produced_by_execution_id, metadata, created_at::text`,
      [
        version.id ?? null,
        version.organization_id,
        version.artifact_id,
        version.version,
        version.state,
        version.content_sha256,
        version.content_bytes,
        version.media_type,
        version.storage_key,
        version.available_from,
        version.observed_at ?? null,
        version.source_published_at ?? null,
        version.retrieved_at,
        version.produced_by_execution_id ?? null,
        JSON.stringify(version.metadata ?? {}),
      ],
    );
    const row = res.rows[0];
    if (!row) throw new Error('Failed to insert artifact version');
    return this.mapVersionRow(row);
  }

  /**
   * Retrieves an immutable artifact version by ID.
   * Returns ArtifactVersionRecord or null if not found.
   */
  async getArtifactVersion(
    id: ArtifactVersionId,
  ): Promise<ArtifactVersionRecord | null> {
    const res = await this.pool.query<RawArtifactVersionRow>(
      `SELECT id, organization_id, artifact_id, version, state, content_sha256,
              content_bytes::text, media_type, storage_key, available_from::text,
              observed_at::text, source_published_at::text, retrieved_at::text,
              produced_by_execution_id, metadata, created_at::text
       FROM artifact_versions WHERE id = $1`,
      [id],
    );
    const row = res.rows[0];
    return row ? this.mapVersionRow(row) : null;
  }

  /**
   * Retrieves the artifact version IDs an execution declared as inputs.
   * Returns array of ArtifactVersionId for reconstruction and lineage.
   */
  async getExecutionInputs(
    executionId: string,
  ): Promise<readonly { artifact_version_id: ArtifactVersionId }[]> {
    const res = await this.pool.query<{ artifact_version_id: ArtifactVersionId }>(
      `SELECT artifact_version_id FROM execution_inputs WHERE execution_id = $1`,
      [executionId],
    );
    return res.rows;
  }

  /**
   * Retrieves lineage edges where the given version is the child.
   * Returns array of parent ArtifactVersionId and relation pairs.
   */
  async getArtifactEdgesForVersion(
    childVersionId: ArtifactVersionId,
  ): Promise<readonly { parent_version_id: ArtifactVersionId; relation: string }[]> {
    const res = await this.pool.query<{
      parent_version_id: ArtifactVersionId;
      relation: string;
    }>(
      `SELECT parent_version_id, relation
       FROM artifact_edges WHERE child_version_id = $1`,
      [childVersionId],
    );
    return res.rows;
  }
}
