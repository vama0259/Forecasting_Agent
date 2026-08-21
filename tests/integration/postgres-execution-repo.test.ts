/**
 * Purpose: Integration tests for PostgresExecutionRepository.
 * Responsibility: Verify execution creation, one-time authorization, redemption.
 * Inputs/outputs: Database pool; assertions on execution lifecycle transitions.
 * Excludes: Container runtime process execution.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PostgresPool } from '../../src/adapters/postgres/postgres-pool.js';
import {
  PostgresStorageRepository,
  // repo
} from '../../src/adapters/postgres/postgres-storage-repo.js';
import {
  PostgresExecutionRepository,
  // repo
} from '../../src/adapters/postgres/postgres-execution-repo.js';
import { AuthorizationError } from '../../src/core/errors/authorization.error.js';
import { deleteOrganizationCascade } from '../support/db-cleanup.js';
import type {
  ContractId,
  ExecutionContractId,
  ExecutionId,
  OrganizationId,
  ProjectId,
  RunAttemptId,
  RunId,
  Sha256Hash,
} from '../../src/core/types/identifiers.js';
import type {
  AuthorizationPayload,
  CanonicalPlan,
} from '../../src/core/types/execution.js';

describe('PostgresExecutionRepository Integration', () => {
  let pool: PostgresPool;
  let storageRepo: PostgresStorageRepository;
  let execRepo: PostgresExecutionRepository;
  let orgId: OrganizationId;
  let runAttemptId: RunAttemptId;
  let execContractId: ExecutionContractId;

  beforeAll(async () => {
    pool = new PostgresPool();
    storageRepo = new PostgresStorageRepository(pool);
    execRepo = new PostgresExecutionRepository(pool);

    const org = await storageRepo.createOrganization({
      slug: `exec-test-org-${Date.now()}`,
      display_name: 'Exec Test Org',
    });
    orgId = org.id;

    const proj = await storageRepo.createProject({
      organization_id: orgId,
      slug: 'exec-proj',
      display_name: 'Exec Proj',
    });

    const contract = await storageRepo.createContract({
      id: undefined as unknown as ContractId,
      organization_id: orgId,
      project_id: proj.id,
      version: 1,
      input_schema: {},
      output_schema: {},
      cutoff_policy: {},
      resolution_policy: {},
      evaluation_policy: {},
      status: 'FROZEN',
      contract_hash: '1'.repeat(64) as Sha256Hash,
      frozen_at: new Date().toISOString(),
    });

    const execContract = await storageRepo.createExecutionContract({
      id: undefined as unknown as ExecutionContractId,
      organization_id: orgId,
      project_id: proj.id,
      version: 1,
      input_declarations: [],
      output_declarations: [],
      resource_policy: {
        memory_bytes: 3221225472,
        cpu_quota_micros: 100000,
        pids_limit: 64,
        wall_time_limit_ms: 60000,
        tmpfs_workspace_bytes: 536870912,
        tmpfs_outputs_bytes: 268435456,
        tmpfs_tmp_bytes: 134217728,
        tmpfs_home_bytes: 67108864,
      },
      status: 'FROZEN',
      contract_hash: '2'.repeat(64) as Sha256Hash,
      frozen_at: new Date().toISOString(),
    });
    execContractId = execContract.id;

    const principalRes = await pool.query<{ id: string }>(
      `INSERT INTO principals (organization_id, display_name)
       VALUES ($1, 'Principal') RETURNING id`,
      [orgId],
    );
    const principalId = principalRes.rows[0]?.id as string;

    const run = await storageRepo.createRun({
      organization_id: orgId,
      project_id: proj.id,
      contract_id: contract.id,
      requested_by: principalId,
      cutoff_at: '2026-08-21T00:00:00.000Z',
      resolve_after: '2026-08-22T00:00:00.000Z',
    });

    const plan: CanonicalPlan = {
      schema_version: 1,
      contract_hash: '1'.repeat(64) as Sha256Hash,
      executions: [],
    };

    const attempt = await storageRepo.createRunAttempt({
      organization_id: orgId,
      run_id: run.id,
      attempt_number: 1,
      plan,
      plan_hash: '3'.repeat(64) as Sha256Hash,
    });
    runAttemptId = attempt.id;
  });

  afterAll(async () => {
    await deleteOrganizationCascade(pool, orgId);
    await pool.close();
  });

  it('creates execution with authorization and redeems once', async () => {
    const authHash = '4'.repeat(64) as Sha256Hash;
    const expiresAt = new Date(Date.now() + 60000).toISOString();

    const authPayload: AuthorizationPayload = {
      authorization_id: 'auth-1',
      organization_id: orgId,
      project_id: 'p1' as ProjectId,
      run_id: 'r1' as RunId,
      run_attempt_id: runAttemptId,
      execution_id: 'e1' as ExecutionId,
      contract_id: 'c1' as ContractId,
      execution_contract_id: execContractId,
      plan_hash: '3'.repeat(64) as Sha256Hash,
      command_set_hash: '5'.repeat(64) as Sha256Hash,
      runtime_digest: 'digest-1',
      platform_digest: 'linux/amd64',
      expires_at: expiresAt,
    };

    const execution = await execRepo.createExecutionWithAuthorization({
      execution: {
        organization_id: orgId,
        run_attempt_id: runAttemptId,
        execution_kind: 'statistical_forecast',
        execution_contract_id: execContractId,
        authorization_hash: authHash,
        runtime_digest: 'digest-1',
        platform_digest: 'linux/amd64',
      },
      authorization: {
        authorization_payload: authPayload,
        expires_at: expiresAt,
      },
    });

    expect(execution.state).toBe('AUTHORIZED');

    const redeemed = await execRepo.redeemAuthorization(execution.id, authHash);
    expect(redeemed.state).toBe('PROVISIONING');

    await expect(execRepo.redeemAuthorization(execution.id, authHash)).rejects.toThrow(
      AuthorizationError,
    );
  });
});
