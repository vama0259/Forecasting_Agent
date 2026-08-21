/**
 * Purpose: Integration tests for PostgresAuditSink monotonic sequence order.
 * Responsibility: Verify increasing sequence IDs under concurrent insertion.
 * Inputs/outputs: Concurrent audit event inputs; sequence order assertions.
 * Excludes: Event consumer streaming.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PostgresPool } from '../../src/adapters/postgres/postgres-pool.js';
import {
  PostgresAuditSink,
  // sink
} from '../../src/adapters/postgres/postgres-audit-sink.js';
import {
  PostgresStorageRepository,
  // repo
} from '../../src/adapters/postgres/postgres-storage-repo.js';
import {
  PostgresExecutionRepository,
  // repo
} from '../../src/adapters/postgres/postgres-execution-repo.js';
import { deleteOrganizationCascade } from '../support/db-cleanup.js';
import type {
  ContractId,
  ExecutionContractId,
  ExecutionId,
  OrganizationId,
  Sha256Hash,
} from '../../src/core/types/identifiers.js';
import type {
  AuthorizationPayload,
  CanonicalPlan,
} from '../../src/core/types/execution.js';

describe('PostgresAuditSink Integration', () => {
  let pool: PostgresPool;
  let auditSink: PostgresAuditSink;
  let storageRepo: PostgresStorageRepository;
  let execRepo: PostgresExecutionRepository;
  let orgId: OrganizationId;
  let executionId: ExecutionId;

  beforeAll(async () => {
    pool = new PostgresPool();
    auditSink = new PostgresAuditSink(pool);
    storageRepo = new PostgresStorageRepository(pool);
    execRepo = new PostgresExecutionRepository(pool);

    const org = await storageRepo.createOrganization({
      slug: `audit-org-${Date.now()}`,
      display_name: 'Audit Org',
    });
    orgId = org.id;

    const proj = await storageRepo.createProject({
      organization_id: orgId,
      slug: 'audit-proj',
      display_name: 'Audit Proj',
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

    const authPayload: AuthorizationPayload = {
      authorization_id: 'auth-audit',
      organization_id: orgId,
      project_id: proj.id,
      run_id: run.id,
      run_attempt_id: attempt.id,
      execution_id: 'exec-audit' as ExecutionId,
      contract_id: contract.id,
      execution_contract_id: execContract.id,
      plan_hash: '3'.repeat(64) as Sha256Hash,
      command_set_hash: '5'.repeat(64) as Sha256Hash,
      runtime_digest: 'digest-1',
      platform_digest: 'linux/amd64',
      expires_at: new Date(Date.now() + 60000).toISOString(),
    };

    const exec = await execRepo.createExecutionWithAuthorization({
      execution: {
        organization_id: orgId,
        run_attempt_id: attempt.id,
        execution_kind: 'audit_test',
        execution_contract_id: execContract.id,
        authorization_hash: '4'.repeat(64) as Sha256Hash,
        runtime_digest: 'digest-1',
        platform_digest: 'linux/amd64',
      },
      authorization: {
        authorization_payload: authPayload,
        expires_at: authPayload.expires_at,
      },
    });
    executionId = exec.id;
  });

  afterAll(async () => {
    await deleteOrganizationCascade(pool, orgId);
    await pool.close();
  });

  it('generates increasing sequence numbers under concurrency', async () => {
    const count = 20;
    const promises = Array.from({ length: count }, (_, i) =>
      auditSink.appendEvent({
        organization_id: orgId,
        execution_id: executionId,
        event_type: 'STATE_CHANGED',
        details: { index: i, timestamp: Date.now() },
      }),
    );

    const results = await Promise.all(promises);
    expect(results).toHaveLength(count);

    const fetched = await auditSink.getEventsForExecution(executionId);
    expect(fetched).toHaveLength(count);

    for (let i = 1; i < fetched.length; i++) {
      const prev = fetched[i - 1]?.event_sequence ?? 0n;
      const curr = fetched[i]?.event_sequence ?? 0n;
      expect(curr).toBeGreaterThan(prev);
    }
  });
});
