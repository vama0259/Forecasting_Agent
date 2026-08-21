/**
 * Purpose: Integration tests for OutputCollector service.
 * Responsibility: Verify live-container invariant and output persistence to store.
 * Inputs/outputs: Runtime handles and output declarations; assertions on store records.
 * Excludes: Container runtime scheduling.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
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
  LocalArtifactStore,
  // store
} from '../../src/adapters/storage/local-artifact-store.js';
import {
  OutputCollector,
  // collector
} from '../../src/execution/output-collector.js';
import type { SandboxRuntime } from '../../src/core/ports/sandbox-runtime.port.js';
import type {
  ContractId,
  ExecutionContractId,
  ExecutionId,
  OrganizationId,
  ProjectId,
  Sha256Hash,
} from '../../src/core/types/identifiers.js';
import type { ArtifactKey } from '../../src/core/types/artifacts.js';

describe('OutputCollector Integration Tests', () => {
  const testDir = path.resolve(process.cwd(), 'data', 'test-collector');
  let pool: PostgresPool;
  let storageRepo: PostgresStorageRepository;
  let executionRepo: PostgresExecutionRepository;
  let artifactStore: LocalArtifactStore;
  let orgId: OrganizationId;
  let projId: ProjectId;
  let executionId: ExecutionId;

  beforeAll(async () => {
    fs.mkdirSync(testDir, { recursive: true });
    pool = new PostgresPool();
    storageRepo = new PostgresStorageRepository(pool);
    executionRepo = new PostgresExecutionRepository(pool);
    artifactStore = new LocalArtifactStore(path.join(testDir, 'store'));

    const org = await storageRepo.createOrganization({
      slug: `col-org-${Date.now()}`,
      display_name: 'Collector Org',
    });
    orgId = org.id;

    const proj = await storageRepo.createProject({
      organization_id: orgId,
      slug: 'col-proj',
      display_name: 'Collector Proj',
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

    const principalRes = await pool.query<{ id: string }>(
      `INSERT INTO principals (organization_id, display_name)
       VALUES ($1, 'Collector Principal') RETURNING id`,
      [orgId],
    );
    const principalId = principalRes.rows[0]?.id as string;

    const run = await storageRepo.createRun({
      organization_id: orgId,
      project_id: projId,
      contract_id: contract.id,
      requested_by: principalId,
      cutoff_at: '2026-08-21T00:00:00.000Z',
      resolve_after: '2026-08-22T00:00:00.000Z',
    });

    const attempt = await storageRepo.createRunAttempt({
      organization_id: orgId,
      run_id: run.id,
      attempt_number: 1,
      plan: {
        schema_version: 1,
        contract_hash: '1'.repeat(64) as Sha256Hash,
        executions: [],
      },
      plan_hash: '3'.repeat(64) as Sha256Hash,
    });

    const authHash = 'c1'.repeat(32) as Sha256Hash;
    const expiresAt = new Date(Date.now() + 60000).toISOString();

    const createdExec = await executionRepo.createExecutionWithAuthorization({
      execution: {
        organization_id: orgId,
        run_attempt_id: attempt.id,
        execution_kind: 'collector_test',
        execution_contract_id: execContract.id,
        authorization_hash: authHash,
        runtime_digest: 'alpine',
        platform_digest: 'linux/amd64',
      },
      authorization: {
        authorization_payload: {
          authorization_id: 'auth-col-1',
          organization_id: orgId,
          project_id: projId,
          run_id: run.id,
          run_attempt_id: attempt.id,
          execution_id: 'e-placeholder' as ExecutionId,
          contract_id: contract.id,
          execution_contract_id: execContract.id,
          plan_hash: '3'.repeat(64) as Sha256Hash,
          command_set_hash: '4'.repeat(64) as Sha256Hash,
          runtime_digest: 'alpine',
          platform_digest: 'linux/amd64',
          expires_at: expiresAt,
        },
        expires_at: expiresAt,
      },
    });
    executionId = createdExec.id;
  });

  afterAll(async () => {
    await pool.close();
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  it('rejects output collection if container is not in RUNNING state', async () => {
    const mockRuntime: SandboxRuntime = {
      inspect: async () => ({
        state: 'COMPLETED',
        exit_code: 0,
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
      destroy: async () => ({ destroyed: true }),
    };

    const collector = new OutputCollector(
      mockRuntime,
      artifactStore,
      storageRepo,
      executionRepo,
    );

    await expect(
      collector.collectOutputs({
        handle: {
          container_id: 'c1',
          execution_id: executionId,
        },
        organizationId: orgId,
        projectId: projId,
        executionId: executionId,
        declarations: [
          {
            declaration_name: 'forecast_csv',
            relative_path: 'forecast.csv',
            media_type: 'text/csv',
            required: true,
            max_bytes: 1024,
          },
        ],
      }),
    ).rejects.toThrow('Output collection violated live-container invariant');
  });

  it('collects and stores output when container is RUNNING', async () => {
    const outputContent = Buffer.from('date,value\n2026-08-21,42\n');

    const mockRuntime: SandboxRuntime = {
      inspect: async () => ({
        state: 'RUNNING',
        exit_code: null,
        started_at: new Date().toISOString(),
        finished_at: null,
      }),
      collect: async (_handle, decls) => {
        return decls.map((d) => ({
          declaration: d,
          stream: (async function* () {
            yield outputContent;
          })(),
        }));
      },
      provision: async () => {
        throw new Error('Not implemented');
      },
      start: async () => {},
      execute: async () => {
        throw new Error('Not implemented');
      },
      terminate: async () => {},
      destroy: async () => ({ destroyed: true }),
    };

    const collector = new OutputCollector(
      mockRuntime,
      artifactStore,
      storageRepo,
      executionRepo,
    );

    const results = await collector.collectOutputs({
      handle: {
        container_id: 'c2',
        execution_id: executionId,
      },
      organizationId: orgId,
      projectId: projId,
      executionId: executionId,
      declarations: [
        {
          declaration_name: 'forecast_csv',
          relative_path: 'forecast.csv',
          media_type: 'text/csv',
          required: true,
          max_bytes: 1024,
        },
      ],
    });

    expect(results).toHaveLength(1);
    const version = results[0];
    if (!version) throw new Error('Expected output version');

    expect(version.content_bytes).toBe(outputContent.length);

    const key: ArtifactKey = {
      organization_id: orgId,
      content_sha256: version.content_sha256,
    };
    const exists = await artifactStore.exists(key);
    expect(exists).toBe(true);
  });
});
