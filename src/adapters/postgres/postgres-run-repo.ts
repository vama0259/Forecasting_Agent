/**
 * Purpose: PostgreSQL persistence adapter for organizations, projects, and runs.
 * Responsibility: Execute SQL queries for runs, attempts, and publication records.
 * Inputs/outputs: Run and attempt descriptors; returns persisted run records.
 * Excludes: Container runtime scheduling and direct filesystem manipulation.
 */

import type {
  OrganizationRecord,
  ProjectRecord,
  PublicationRecord,
  RunAttemptRecord,
  RunRecord,
} from '../../core/ports/storage-repository.port.js';
import type {
  ArtifactVersionId,
  ContractId,
  OrganizationId,
  ProjectId,
  PublicationId,
  RunAttemptId,
  RunId,
  Sha256Hash,
} from '../../core/types/identifiers.js';
import type { RunAttemptState, RunState } from '../../core/types/lifecycle.js';
import type { CanonicalPlan } from '../../core/types/execution.js';
import type { PostgresPool } from './postgres-pool.js';

/**
 * PostgreSQL repository for organizations, projects, runs, and publications.
 */
export class PostgresRunRepository {
  private readonly pool: PostgresPool;

  /**
   * Initializes run repository with PostgreSQL pool instance.
   * Sets local pool reference.
   */
  constructor(pool: PostgresPool) {
    this.pool = pool;
  }

  /**
   * Inserts a new organization record.
   * Returns created OrganizationRecord or throws on conflict.
   */
  async createOrganization(org: {
    readonly id?: OrganizationId;
    readonly slug: string;
    readonly display_name: string;
  }): Promise<OrganizationRecord> {
    const res = await this.pool.query<OrganizationRecord>(
      `INSERT INTO organizations (id, slug, display_name)
       VALUES (COALESCE($1, gen_random_uuid()), $2, $3)
       RETURNING id, slug, display_name, created_at::text`,
      [org.id ?? null, org.slug, org.display_name],
    );
    const row = res.rows[0];
    if (!row) throw new Error('Failed to insert organization');
    return row;
  }

  /**
   * Inserts a new project record scoped to an organization.
   * Returns created ProjectRecord or throws on conflict.
   */
  async createProject(project: {
    readonly id?: ProjectId;
    readonly organization_id: OrganizationId;
    readonly slug: string;
    readonly display_name: string;
  }): Promise<ProjectRecord> {
    const res = await this.pool.query<ProjectRecord>(
      `INSERT INTO projects (id, organization_id, slug, display_name)
       VALUES (COALESCE($1, gen_random_uuid()), $2, $3, $4)
       RETURNING id, organization_id, slug, display_name, created_at::text`,
      [project.id ?? null, project.organization_id, project.slug, project.display_name],
    );
    const row = res.rows[0];
    if (!row) throw new Error('Failed to insert project');
    return row;
  }

  /**
   * Inserts a new forecasting run record.
   * Returns created RunRecord in OPEN state.
   */
  async createRun(run: {
    readonly id?: RunId;
    readonly organization_id: OrganizationId;
    readonly project_id: ProjectId;
    readonly contract_id: ContractId;
    readonly requested_by: string;
    readonly cutoff_at: string;
    readonly resolve_after: string;
    readonly state?: RunState;
  }): Promise<RunRecord> {
    const res = await this.pool.query<RunRecord>(
      `INSERT INTO runs (
         id, organization_id, project_id, contract_id, requested_by,
         cutoff_at, resolve_after, state
       ) VALUES (
         COALESCE($1, gen_random_uuid()), $2, $3, $4, $5, $6, $7, $8
       )
       RETURNING id, organization_id, project_id, contract_id, requested_by,
                 cutoff_at::text, resolve_after::text, state, created_at::text`,
      [
        run.id ?? null,
        run.organization_id,
        run.project_id,
        run.contract_id,
        run.requested_by,
        run.cutoff_at,
        run.resolve_after,
        run.state ?? 'OPEN',
      ],
    );
    const row = res.rows[0];
    if (!row) throw new Error('Failed to insert run');
    return row;
  }

  /**
   * Retrieves a run record by its unique ID.
   * Returns RunRecord or null if not found.
   */
  async getRun(runId: RunId): Promise<RunRecord | null> {
    const res = await this.pool.query<RunRecord>(
      `SELECT id, organization_id, project_id, contract_id, requested_by,
              cutoff_at::text, resolve_after::text, state, created_at::text
       FROM runs WHERE id = $1`,
      [runId],
    );
    return res.rows[0] ?? null;
  }

  /**
   * Inserts a new run attempt record with canonical plan and plan hash.
   * Returns created RunAttemptRecord.
   */
  async createRunAttempt(attempt: {
    readonly id?: RunAttemptId;
    readonly organization_id: OrganizationId;
    readonly run_id: RunId;
    readonly attempt_number: number;
    readonly plan: CanonicalPlan;
    readonly plan_hash: Sha256Hash;
    readonly state?: RunAttemptState;
  }): Promise<RunAttemptRecord> {
    const res = await this.pool.query<RunAttemptRecord>(
      `INSERT INTO run_attempts (
         id, organization_id, run_id, attempt_number, plan, plan_hash, state
       ) VALUES (
         COALESCE($1, gen_random_uuid()), $2, $3, $4, $5, $6, $7
       )
       RETURNING id, organization_id, run_id, attempt_number, plan, plan_hash,
                 state, failure_code, failure_detail, started_at::text,
                 ended_at::text, created_at::text`,
      [
        attempt.id ?? null,
        attempt.organization_id,
        attempt.run_id,
        attempt.attempt_number,
        JSON.stringify(attempt.plan),
        attempt.plan_hash,
        attempt.state ?? 'PENDING',
      ],
    );
    const row = res.rows[0];
    if (!row) throw new Error('Failed to insert run attempt');
    return row;
  }

  /**
   * Updates state, timestamps, and failure details for a run attempt.
   * Returns updated RunAttemptRecord.
   */
  async updateRunAttemptState(
    id: RunAttemptId,
    state: RunAttemptState,
    failureCode?: string | null,
    failureDetail?: string | null,
  ): Promise<RunAttemptRecord> {
    const res = await this.pool.query<RunAttemptRecord>(
      `UPDATE run_attempts
       SET state = $2, failure_code = $3, failure_detail = $4,
           ended_at = CASE WHEN $2 IN ('SUCCEEDED', 'FAILED', 'ABANDONED')
                           THEN NOW() ELSE ended_at END
       WHERE id = $1
       RETURNING id, organization_id, run_id, attempt_number, plan, plan_hash,
                 state, failure_code, failure_detail, started_at::text,
                 ended_at::text, created_at::text`,
      [id, state, failureCode ?? null, failureDetail ?? null],
    );
    const row = res.rows[0];
    if (!row) throw new Error(`Run attempt not found: ${id}`);
    return row;
  }

  /**
   * Inserts a publication record, enforcing run_id uniqueness.
   * Returns created PublicationRecord or throws on unique constraint violation.
   */
  async createPublication(publication: {
    readonly id?: PublicationId;
    readonly organization_id: OrganizationId;
    readonly run_id: RunId;
    readonly run_attempt_id: RunAttemptId;
    readonly contract_hash: Sha256Hash;
    readonly payload: Record<string, unknown>;
    readonly payload_hash: Sha256Hash;
    readonly reconstruction_manifest_version_id: ArtifactVersionId;
  }): Promise<PublicationRecord> {
    const res = await this.pool.query<PublicationRecord>(
      `INSERT INTO publications (
         id, organization_id, run_id, run_attempt_id, contract_hash, payload,
         payload_hash, reconstruction_manifest_version_id
       ) VALUES (
         COALESCE($1, gen_random_uuid()), $2, $3, $4, $5, $6, $7, $8
       )
       RETURNING id, organization_id, run_id, run_attempt_id, contract_hash,
                 payload, payload_hash, reconstruction_manifest_version_id,
                 published_at::text`,
      [
        publication.id ?? null,
        publication.organization_id,
        publication.run_id,
        publication.run_attempt_id,
        publication.contract_hash,
        JSON.stringify(publication.payload),
        publication.payload_hash,
        publication.reconstruction_manifest_version_id,
      ],
    );
    const row = res.rows[0];
    if (!row) throw new Error('Failed to insert publication');
    return row;
  }

  /**
   * Retrieves a publication record associated with a run ID.
   * Returns PublicationRecord or null if unpublished.
   */
  async getPublicationByRunId(runId: RunId): Promise<PublicationRecord | null> {
    const res = await this.pool.query<PublicationRecord>(
      `SELECT id, organization_id, run_id, run_attempt_id, contract_hash,
              payload, payload_hash, reconstruction_manifest_version_id,
              published_at::text
       FROM publications WHERE run_id = $1`,
      [runId],
    );
    return res.rows[0] ?? null;
  }
}
