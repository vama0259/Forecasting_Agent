/**
 * Purpose: Test fixture helpers for the End-to-End foundation integration suite.
 * Responsibility: Provide contract, entity creation, and staging setup utilities.
 * Inputs/outputs: Storage repositories and store; returns seeded fixture entities.
 * Excludes: Top-level Vitest test execution.
 */

import type { PostgresPool } from '../../src/adapters/postgres/postgres-pool.js';
import type {
  PostgresStorageRepository,
  // repo
} from '../../src/adapters/postgres/postgres-storage-repo.js';
import type {
  LocalArtifactStore,
  // store
} from '../../src/adapters/storage/local-artifact-store.js';
import type { ArtifactVersionRecord } from '../../src/core/types/artifacts.js';
import type {
  ContractDeclaration,
  ExecutionContractDeclaration,
} from '../../src/core/types/contracts.js';
import type {
  ContractId,
  ExecutionContractId,
  OrganizationId,
  ProjectId,
  Sha256Hash,
} from '../../src/core/types/identifiers.js';
import { sha256Hex } from '../../src/core/utils/crypto-hash.js';

/** Seeded database entities and artifacts prepared for E2E testing. */
export interface SeededE2EEntities {
  readonly orgId: OrganizationId;
  readonly projId: ProjectId;
  readonly principalId: string;
  readonly contract: ContractDeclaration;
  readonly execContract: ExecutionContractDeclaration;
  readonly inputVersion: ArtifactVersionRecord;
}

/**
 * Seeds initial org, project, contracts, and historical dataset for E2E testing.
 * Returns seeded entity records.
 */
export async function seedE2EEntities(
  pool: PostgresPool,
  storageRepo: PostgresStorageRepository,
  artifactStore: LocalArtifactStore,
): Promise<SeededE2EEntities> {
  const org = await storageRepo.createOrganization({
    slug: `e2e-org-${Date.now()}`,
    display_name: 'E2E Organization',
  });

  const proj = await storageRepo.createProject({
    organization_id: org.id,
    slug: 'e2e-proj',
    display_name: 'E2E Project',
  });

  const principalRes = await pool.query<{ id: string }>(
    `INSERT INTO principals (organization_id, display_name)
     VALUES ($1, 'E2E Principal') RETURNING id`,
    [org.id],
  );
  const principalId = principalRes.rows[0]?.id as string;

  const contract = await storageRepo.createContract({
    id: undefined as unknown as ContractId,
    organization_id: org.id,
    project_id: proj.id,
    version: 1,
    input_schema: { type: 'object' },
    output_schema: { type: 'object' },
    cutoff_policy: { strict_point_in_time: true },
    resolution_policy: { source: 'verified_publication' },
    evaluation_policy: { metric: 'brier_score' },
    status: 'FROZEN',
    contract_hash: 'c1'.repeat(32) as Sha256Hash,
    frozen_at: new Date().toISOString(),
  });

  const execContract = await storageRepo.createExecutionContract({
    id: undefined as unknown as ExecutionContractId,
    organization_id: org.id,
    project_id: proj.id,
    version: 1,
    input_declarations: [
      {
        declaration_name: 'history_csv',
        relative_path: 'inputs/history.csv',
        media_type: 'text/csv',
        required: true,
      },
    ],
    output_declarations: [
      {
        declaration_name: 'forecast_csv',
        relative_path: 'forecast.csv',
        media_type: 'text/csv',
        required: true,
        max_bytes: 1048576,
      },
    ],
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
    contract_hash: 'c2'.repeat(32) as Sha256Hash,
    frozen_at: new Date().toISOString(),
  });

  const inputContent = Buffer.from('date,close\n2026-08-19,100\n2026-08-20,105\n');
  const inputHash = sha256Hex(inputContent) as Sha256Hash;
  const inputStaged = await artifactStore.stage(
    (async function* () {
      yield inputContent;
    })(),
    org.id,
    { sha256: inputHash, byteLength: inputContent.length },
  );
  const inputCommitted = await artifactStore.commit(inputStaged);

  const inputArt = await storageRepo.createArtifact({
    organization_id: org.id,
    project_id: proj.id,
    kind: 'dataset',
    logical_name: 'historical_prices',
  });

  const inputVersion = await storageRepo.createArtifactVersion({
    organization_id: org.id,
    artifact_id: inputArt.id,
    version: 1,
    state: 'AVAILABLE',
    content_sha256: inputHash,
    content_bytes: inputContent.length,
    media_type: 'text/csv',
    storage_key: inputCommitted.storage_key,
    available_from: '2026-08-20T12:00:00.000Z',
    retrieved_at: '2026-08-20T12:00:00.000Z',
    produced_by_execution_id: null,
  });

  return {
    orgId: org.id,
    projId: proj.id,
    principalId,
    contract,
    execContract,
    inputVersion,
  };
}
