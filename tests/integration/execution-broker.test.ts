/**
 * Purpose: Integration tests for ExecutionBroker lifecycle orchestration.
 * Responsibility: Verify execution sequence, live output collection, cleanup.
 * Inputs/outputs: Orchestrated execution requests; assertions on database state.
 * Excludes: Top-level plan reconstruction graph resolution.
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
  PostgresAuditSink,
  // sink
} from '../../src/adapters/postgres/postgres-audit-sink.js';
import {
  LocalArtifactStore,
  // store
} from '../../src/adapters/storage/local-artifact-store.js';
import {
  RootlessPodmanRuntime,
  // runtime
} from '../../src/adapters/podman/rootless-podman-runtime.js';
import { ArtifactStager } from '../../src/execution/artifact-stager.js';
import { OutputCollector } from '../../src/execution/output-collector.js';
import { ExecutionBroker } from '../../src/execution/execution-broker.js';
import { sha256Hex } from '../../src/core/utils/crypto-hash.js';
import { deleteOrganizationCascade } from '../support/db-cleanup.js';
import type {
  ArtifactId,
  ContractId,
  ExecutionContractId,
  ExecutionId,
  OrganizationId,
  ProjectId,
  RunAttemptId,
  RunId,
  Sha256Hash,
} from '../../src/core/types/identifiers.js';
import type { AuthorizationPayload } from '../../src/core/types/execution.js';

describe('ExecutionBroker Integration Tests', () => {
  const testDir = path.resolve(process.cwd(), 'data', 'test-broker');
  let pool: PostgresPool;
  let storageRepo: PostgresStorageRepository;
  let execRepo: PostgresExecutionRepository;
  let auditSink: PostgresAuditSink;
  let artifactStore: LocalArtifactStore;
  let runtime: RootlessPodmanRuntime;
  let broker: ExecutionBroker;

  let orgId: OrganizationId;
  let projId: ProjectId;
  let contractId: ContractId;
  let execContractId: ExecutionContractId;
  let runId: RunId;
  let attemptId: RunAttemptId;
  let inputArtId: ArtifactId;

  const defaultPolicy = {
    memory_bytes: 536870912,
    cpu_quota_micros: 100000,
    pids_limit: 64,
    wall_time_limit_ms: 60000,
    tmpfs_workspace_bytes: 67108864,
    tmpfs_outputs_bytes: 67108864,
    tmpfs_tmp_bytes: 33554432,
    tmpfs_home_bytes: 33554432,
  };

  const testOutputDecls = [
    {
      declaration_name: 'result_txt',
      relative_path: 'result.txt',
      media_type: 'text/plain',
      required: true,
      max_bytes: 1024,
    },
  ];

  beforeAll(async () => {
    fs.mkdirSync(testDir, { recursive: true });
    pool = new PostgresPool();
    storageRepo = new PostgresStorageRepository(pool);
    execRepo = new PostgresExecutionRepository(pool);
    auditSink = new PostgresAuditSink(pool);
    artifactStore = new LocalArtifactStore(path.join(testDir, 'store'));
    runtime = new RootlessPodmanRuntime({ maxConcurrency: 2 });

    const stager = new ArtifactStager(artifactStore, {
      stagingBaseDir: path.join(testDir, 'staging'),
    });
    const collector = new OutputCollector(
      runtime,
      artifactStore,
      storageRepo,
      execRepo,
    );
    broker = new ExecutionBroker(runtime, execRepo, auditSink, stager, collector);

    const org = await storageRepo.createOrganization({
      slug: `broker-org-${Date.now()}`,
      display_name: 'Broker Org',
    });
    orgId = org.id;

    const proj = await storageRepo.createProject({
      organization_id: orgId,
      slug: 'broker-proj',
      display_name: 'Broker Proj',
    });
    projId = proj.id;

    const crypto = await import('node:crypto');
    const contract = await storageRepo.createContract({
      id: crypto.randomUUID() as ContractId,
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
      id: crypto.randomUUID() as ExecutionContractId,
      organization_id: orgId,
      project_id: projId,
      version: 1,
      input_declarations: [],
      output_declarations: testOutputDecls,
      resource_policy: defaultPolicy,
      status: 'FROZEN',
      contract_hash: '2'.repeat(64) as Sha256Hash,
      frozen_at: new Date().toISOString(),
    });
    execContractId = execContract.id;

    const pRes = await pool.query<{ id: string }>(
      `INSERT INTO principals (organization_id, display_name)
       VALUES ($1, 'Broker Principal') RETURNING id`,
      [orgId],
    );
    const principalId = pRes.rows[0]?.id as string;

    const inputArt = await storageRepo.createArtifact({
      organization_id: orgId,
      project_id: projId,
      kind: 'dataset',
      logical_name: 'test_input',
    });
    inputArtId = inputArt.id;

    const run = await storageRepo.createRun({
      organization_id: orgId,
      project_id: projId,
      contract_id: contractId,
      requested_by: principalId,
      cutoff_at: '2026-08-21T00:00:00.000Z',
      resolve_after: '2026-08-22T00:00:00.000Z',
    });
    runId = run.id;

    const attempt = await storageRepo.createRunAttempt({
      organization_id: orgId,
      run_id: runId,
      attempt_number: 1,
      plan: {
        schema_version: 1,
        contract_hash: '1'.repeat(64) as Sha256Hash,
        executions: [],
      },
      plan_hash: '3'.repeat(64) as Sha256Hash,
    });
    attemptId = attempt.id;
  });

  afterAll(async () => {
    await deleteOrganizationCascade(pool, orgId);
    await pool.close();
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  it('runs complete lifecycle: auth, stage, container, collect, cleanup', async () => {
    const authHash = 'a1'.repeat(32) as Sha256Hash;
    const expiresAt = new Date(Date.now() + 60000).toISOString();
    const execId = (await import('node:crypto')).randomUUID() as ExecutionId;

    const authPayload: AuthorizationPayload = {
      authorization_id: 'auth-exec-broker-1',
      organization_id: orgId,
      project_id: projId,
      run_id: runId,
      run_attempt_id: attemptId,
      execution_id: execId,
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
        id: execId,
        organization_id: orgId,
        run_attempt_id: attemptId,
        execution_kind: 'forecast_step',
        execution_contract_id: execContractId,
        authorization_hash: authHash,
        runtime_digest: 'alpine',
        platform_digest: 'linux/amd64',
      },
      authorization: {
        authorization_payload: authPayload,
        expires_at: expiresAt,
      },
    });

    const inputPayload = Buffer.from('historical-series-data');
    const inputHash = sha256Hex(inputPayload) as Sha256Hash;
    const inputStaged = await artifactStore.stage(
      (async function* () {
        yield inputPayload;
      })(),
      orgId,
      { sha256: inputHash, byteLength: inputPayload.length },
    );
    const inputCommitted = await artifactStore.commit(inputStaged);
    const inputVer = await storageRepo.createArtifactVersion({
      organization_id: orgId,
      artifact_id: inputArtId,
      version: 1,
      state: 'AVAILABLE',
      content_sha256: inputHash,
      content_bytes: inputPayload.length,
      media_type: 'text/plain',
      storage_key: inputCommitted.storage_key,
      available_from: '2026-08-20T00:00:00.000Z',
      observed_at: null,
      source_published_at: null,
      retrieved_at: '2026-08-20T00:00:00.000Z',
      produced_by_execution_id: null,
      metadata: {},
    });

    const completed = await broker.executeNode({
      executionId: execution.id,
      runAttemptId: attemptId,
      organizationId: orgId,
      projectId: projId,
      executionContractId: execContractId,
      authorizationHash: authHash,
      runtimeDigest: 'alpine',
      platformDigest: 'linux/amd64',
      resourcePolicy: defaultPolicy,
      inputs: [
        {
          artifactVersion: inputVer,
          targetPath: 'data.txt',
          cutoffAt: '2026-08-21T00:00:00.000Z',
        },
      ],
      commands: [
        {
          argv: ['/bin/sh', '-c', 'cat /inputs/data.txt > /outputs/result.txt'],
          working_directory: '/workspace',
          environment: {},
          timeout_ms: 10000,
        },
      ],
      outputDeclarations: testOutputDecls,
    });

    expect(completed.state).toBe('COMPLETED');
    expect(completed.exit_code).toBe(0);

    const events = await auditSink.getEventsForExecution(execution.id);
    expect(events.length).toBeGreaterThanOrEqual(2);
  });
});
