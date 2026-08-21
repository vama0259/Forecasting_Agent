/**
 * Purpose: Integration tests for StartupReconciler crash recovery mechanism.
 * Responsibility: Assert that orphaned executions transition to FAILED and cleanup.
 * Inputs/outputs: Active database pool; assertions on reconciled execution records.
 * Excludes: Live process polling.
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
import {
  PostgresAuditSink,
  // sink
} from '../../src/adapters/postgres/postgres-audit-sink.js';
import { StartupReconciler } from '../../src/execution/startup-reconciler.js';
import type { SandboxRuntime } from '../../src/core/ports/sandbox-runtime.port.js';
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

describe('StartupReconciler Integration Tests', () => {
  let pool: PostgresPool;
  let storageRepo: PostgresStorageRepository;
  let execRepo: PostgresExecutionRepository;
  let auditSink: PostgresAuditSink;
  let reconciler: StartupReconciler;
  let destroyedContainerIds: string[] = [];

  let orgId: OrganizationId;
  let projId: ProjectId;
  let contractId: ContractId;
  let execContractId: ExecutionContractId;
  let runId: RunId;
  let attemptId: RunAttemptId;

  beforeAll(async () => {
    pool = new PostgresPool();
    storageRepo = new PostgresStorageRepository(pool);
    execRepo = new PostgresExecutionRepository(pool);
    auditSink = new PostgresAuditSink(pool);

    const mockRuntime: SandboxRuntime = {
      destroy: async (handle) => {
        destroyedContainerIds.push(handle.container_id);
        return { destroyed: true };
      },
      inspect: async () => ({
        state: 'FAILED',
        exit_code: null,
        started_at: null,
        finished_at: null,
      }),
      provision: async () => {
        throw new Error('Not implemented');
      },
      start: async () => {},
      execute: async () => {
        throw new Error('Not implemented');
      },
      collect: async () => [],
      terminate: async () => {},
      listManagedContainers: async () => [
        {
          containerId: 'sandbox-orphan-1',
          executionId: 'e-orphan-1' as ExecutionId,
          runAttemptId: 'attempt-1' as RunAttemptId,
          labels: { 'io.forecasting.foundation.managed-by': 'broker' },
        },
      ],
    };

    reconciler = new StartupReconciler(execRepo, mockRuntime, auditSink);

    const org = await storageRepo.createOrganization({
      slug: `reconcile-org-${Date.now()}`,
      display_name: 'Reconcile Org',
    });
    orgId = org.id;

    const proj = await storageRepo.createProject({
      organization_id: orgId,
      slug: 'reconcile-proj',
      display_name: 'Reconcile Proj',
    });
    projId = proj.id;

    const contract = await storageRepo.createContract({
      id: undefined as unknown as ContractId,
      organization_id: orgId,
      project_id: projId,
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
    contractId = contract.id;

    const execContract = await storageRepo.createExecutionContract({
      id: undefined as unknown as ExecutionContractId,
      organization_id: orgId,
      project_id: projId,
      version: 1,
      input_declarations: [],
      output_declarations: [],
      resource_policy: {
        memory_bytes: 536870912,
        cpu_quota_micros: 100000,
        pids_limit: 64,
        wall_time_limit_ms: 60000,
        tmpfs_workspace_bytes: 67108864,
        tmpfs_outputs_bytes: 67108864,
        tmpfs_tmp_bytes: 33554432,
        tmpfs_home_bytes: 33554432,
      },
      status: 'FROZEN',
      contract_hash: '2'.repeat(64) as Sha256Hash,
      frozen_at: new Date().toISOString(),
    });
    execContractId = execContract.id;

    const principalRes = await pool.query<{ id: string }>(
      `INSERT INTO principals (organization_id, display_name)
       VALUES ($1, 'Reconcile Principal') RETURNING id`,
      [orgId],
    );
    const principalId = principalRes.rows[0]?.id as string;

    const run = await storageRepo.createRun({
      organization_id: orgId,
      project_id: projId,
      contract_id: contractId,
      requested_by: principalId,
      cutoff_at: '2026-08-21T00:00:00.000Z',
      resolve_after: '2026-08-22T00:00:00.000Z',
    });
    runId = run.id;

    const plan: CanonicalPlan = {
      schema_version: 1,
      contract_hash: '1'.repeat(64) as Sha256Hash,
      executions: [],
    };

    const attempt = await storageRepo.createRunAttempt({
      organization_id: orgId,
      run_id: runId,
      attempt_number: 1,
      plan,
      plan_hash: '3'.repeat(64) as Sha256Hash,
    });
    attemptId = attempt.id;
  });

  afterAll(async () => {
    await pool.close();
  });

  it('reconciles orphaned RUNNING executions on startup via Sweep 2', async () => {
    const authHash = 'b1'.repeat(32) as Sha256Hash;
    const expiresAt = new Date(Date.now() + 60000).toISOString();

    const testExecId = (await import('node:crypto')).randomUUID() as ExecutionId;

    const authPayload: AuthorizationPayload = {
      authorization_id: 'auth-reconcile-1',
      organization_id: orgId,
      project_id: projId,
      run_id: runId,
      run_attempt_id: attemptId,
      execution_id: testExecId,
      contract_id: contractId,
      execution_contract_id: execContractId,
      plan_hash: '3'.repeat(64) as Sha256Hash,
      command_set_hash: '4'.repeat(64) as Sha256Hash,
      runtime_digest: 'alpine',
      platform_digest: 'linux/amd64',
      expires_at: expiresAt,
    };

    const execution = await execRepo.createExecutionWithAuthorization({
      execution: {
        id: testExecId,
        organization_id: orgId,
        run_attempt_id: attemptId,
        execution_kind: 'orphaned_job',
        execution_contract_id: execContractId,
        authorization_hash: authHash,
        runtime_digest: 'alpine',
        platform_digest: 'linux/amd64',
        provisioning_deadline: new Date(Date.now() - 1000).toISOString(),
      },
      authorization: {
        authorization_payload: authPayload,
        expires_at: expiresAt,
      },
    });

    // Simulate an execution that was left in RUNNING state prior to crash
    await execRepo.redeemAuthorization(execution.id, authHash);
    await execRepo.updateExecutionState(execution.id, 'RUNNING');

    const results = await reconciler.reconcileOrphanedExecutions();
    const matched = results.find((r) => r.executionId === execution.id);

    expect(matched).toBeDefined();
    expect(matched?.direction).toBe('STATE_TO_RUNTIME');
    expect(matched?.previousState).toBe('RUNNING');
    expect(matched?.cleaned).toBe(true);

    const updated = await execRepo.getExecution(execution.id);
    expect(updated?.state).toBe('FAILED');
    expect(updated?.failure_stage).toBe('CRASH_RECONCILIATION');
    expect(updated?.failure_code).toBe('RUNTIME_MISSING');
    expect(updated?.cleanup_state).toBe('COMPLETED');
  });
});
