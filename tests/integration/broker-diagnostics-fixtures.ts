/**
 * Purpose: Shared fixture setup for broker diagnostic-collection integration tests.
 * Responsibility: Bootstrap org/project/contract/run fixtures and wired broker.
 * Inputs/outputs: Test directory path; returns bootstrapped BrokerDiagnosticsFixture.
 * Excludes: Individual test assertions and per-test execution requests.
 */

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
import { PostgresAuditSink } from '../../src/adapters/postgres/postgres-audit-sink.js';
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
import { deleteOrganizationCascade } from '../support/db-cleanup.js';
import type {
  ContractId,
  ExecutionContractId,
  OrganizationId,
  ProjectId,
  RunAttemptId,
  RunId,
  Sha256Hash,
} from '../../src/core/types/identifiers.js';

/** Default bounded resource policy used across diagnostic-collection fixtures. */
export const defaultPolicy = {
  memory_bytes: 536870912,
  cpu_quota_micros: 100000,
  pids_limit: 64,
  wall_time_limit_ms: 60000,
  tmpfs_workspace_bytes: 67108864,
  tmpfs_outputs_bytes: 67108864,
  tmpfs_tmp_bytes: 33554432,
  tmpfs_home_bytes: 33554432,
};

/** Single required output declaration used across diagnostic-collection fixtures. */
export const testOutputDecls = [
  {
    declaration_name: 'result_txt',
    relative_path: 'result.txt',
    media_type: 'text/plain',
    required: true,
    max_bytes: 1024,
  },
];

/** Bootstrapped state shared across broker diagnostic-collection tests. */
export interface BrokerDiagnosticsFixture {
  readonly testDir: string;
  readonly pool: PostgresPool;
  readonly execRepo: PostgresExecutionRepository;
  readonly broker: ExecutionBroker;
  readonly orgId: OrganizationId;
  readonly projId: ProjectId;
  readonly contractId: ContractId;
  readonly execContractId: ExecutionContractId;
  readonly runId: RunId;
  readonly attemptId: RunAttemptId;
}

/**
 * Creates a fresh org/project/contract/run and wires an ExecutionBroker for it.
 * Returns a BrokerDiagnosticsFixture; call teardownBrokerFixture in afterAll.
 */
export async function setupBrokerFixture(
  testDirName: string,
): Promise<BrokerDiagnosticsFixture> {
  const testDir = path.resolve(process.cwd(), 'data', testDirName);
  fs.mkdirSync(testDir, { recursive: true });

  const pool = new PostgresPool();
  const storageRepo = new PostgresStorageRepository(pool);
  const execRepo = new PostgresExecutionRepository(pool);
  const auditSink = new PostgresAuditSink(pool);
  const artifactStore = new LocalArtifactStore(path.join(testDir, 'store'));
  const runtime = new RootlessPodmanRuntime({ maxConcurrency: 2 });

  const stager = new ArtifactStager(artifactStore, {
    stagingBaseDir: path.join(testDir, 'staging'),
  });
  const collector = new OutputCollector(runtime, artifactStore, storageRepo, execRepo);
  const broker = new ExecutionBroker(runtime, execRepo, auditSink, stager, collector);

  const org = await storageRepo.createOrganization({
    slug: `broker-diag-org-${Date.now()}`,
    display_name: 'Broker Diagnostics Org',
  });

  const proj = await storageRepo.createProject({
    organization_id: org.id,
    slug: 'broker-diag-proj',
    display_name: 'Broker Diagnostics Proj',
  });

  const crypto = await import('node:crypto');
  const contract = await storageRepo.createContract({
    id: crypto.randomUUID() as ContractId,
    organization_id: org.id,
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
    id: crypto.randomUUID() as ExecutionContractId,
    organization_id: org.id,
    project_id: proj.id,
    version: 1,
    input_declarations: [],
    output_declarations: testOutputDecls,
    resource_policy: defaultPolicy,
    status: 'FROZEN',
    contract_hash: '2'.repeat(64) as Sha256Hash,
    frozen_at: new Date().toISOString(),
  });

  const pRes = await pool.query<{ id: string }>(
    `INSERT INTO principals (organization_id, display_name)
     VALUES ($1, 'Broker Diagnostics Principal') RETURNING id`,
    [org.id],
  );
  const principalId = pRes.rows[0]?.id as string;

  const run = await storageRepo.createRun({
    organization_id: org.id,
    project_id: proj.id,
    contract_id: contract.id,
    requested_by: principalId,
    cutoff_at: '2026-08-21T00:00:00.000Z',
    resolve_after: '2026-08-22T00:00:00.000Z',
  });

  const attempt = await storageRepo.createRunAttempt({
    organization_id: org.id,
    run_id: run.id,
    attempt_number: 1,
    plan: {
      schema_version: 1,
      contract_hash: '1'.repeat(64) as Sha256Hash,
      executions: [],
    },
    plan_hash: '3'.repeat(64) as Sha256Hash,
  });

  return {
    testDir,
    pool,
    execRepo,
    broker,
    orgId: org.id,
    projId: proj.id,
    contractId: contract.id,
    execContractId: execContract.id,
    runId: run.id,
    attemptId: attempt.id,
  };
}

/**
 * Closes the database pool and removes the fixture's temporary directory.
 * Resolves once teardown completes.
 */
export async function teardownBrokerFixture(
  fixture: BrokerDiagnosticsFixture,
): Promise<void> {
  await deleteOrganizationCascade(fixture.pool, fixture.orgId);
  await fixture.pool.close();
  if (fs.existsSync(fixture.testDir)) {
    fs.rmSync(fixture.testDir, { recursive: true, force: true });
  }
}
