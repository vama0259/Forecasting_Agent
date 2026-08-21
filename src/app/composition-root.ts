/**
 * Purpose: Composition root wiring domain, storage, adapters, and execution.
 * Responsibility: Assemble dependencies, instantiate repositories, brokers, services.
 * Inputs/outputs: Application configuration; returns initialized AppContext.
 * Excludes: Direct SQL execution and business decision policies.
 */

import { PostgresPool } from '../adapters/postgres/postgres-pool.js';
import { PostgresMigrator } from '../adapters/postgres/postgres-migrator.js';
import {
  PostgresWriteBarrier,
  // barrier
} from '../adapters/postgres/postgres-write-barrier.js';
import {
  PostgresBrokerLock,
  type BrokerLockRelease,
} from '../adapters/postgres/postgres-broker-lock.js';
import {
  PostgresStorageRepository,
  // repo
} from '../adapters/postgres/postgres-storage-repo.js';
import {
  PostgresExecutionRepository,
  // repo
} from '../adapters/postgres/postgres-execution-repo.js';
import {
  PostgresOutcomeRepository,
  // repo
} from '../adapters/postgres/postgres-outcome-repo.js';
import {
  PostgresEvaluationRepository,
  // repo
} from '../adapters/postgres/postgres-evaluation-repo.js';
import { PostgresAuditSink } from '../adapters/postgres/postgres-audit-sink.js';
import { LocalArtifactStore } from '../adapters/storage/local-artifact-store.js';
import {
  RootlessPodmanRuntime,
  // runtime
} from '../adapters/podman/rootless-podman-runtime.js';
import { ArtifactStager } from '../execution/artifact-stager.js';
import { OutputCollector } from '../execution/output-collector.js';
import { StartupReconciler } from '../execution/startup-reconciler.js';
import { ExecutionBroker } from '../execution/execution-broker.js';
import { ReconstructionEngine } from './reconstruction-engine.js';
import { BackupService } from './backup-service.js';
import { RestoreService } from './restore-service.js';

/** Configuration options for initializing the application composition root. */
export interface AppConfig {
  readonly databaseUrl?: string;
  readonly artifactStoreDir: string;
  readonly stagingDir?: string;
}

/** Complete runtime application context containing all assembled subsystems. */
export interface AppContext {
  readonly pool: PostgresPool;
  readonly migrator: PostgresMigrator;
  readonly writeBarrier: PostgresWriteBarrier;
  readonly brokerLock: PostgresBrokerLock;
  readonly artifactStore: LocalArtifactStore;
  readonly storageRepo: PostgresStorageRepository;
  readonly executionRepo: PostgresExecutionRepository;
  readonly outcomeRepo: PostgresOutcomeRepository;
  readonly evaluationRepo: PostgresEvaluationRepository;
  readonly auditSink: PostgresAuditSink;
  readonly runtime: RootlessPodmanRuntime;
  readonly stager: ArtifactStager;
  readonly collector: OutputCollector;
  readonly reconciler: StartupReconciler;
  readonly broker: ExecutionBroker;
  readonly reconstructionEngine: ReconstructionEngine;
  readonly backupService: BackupService;
  readonly restoreService: RestoreService;
  readonly shutdown: () => Promise<void>;
}

/**
 * Initializes, migrates, locks, reconciles, and wires the entire application.
 * Returns fully assembled AppContext ready for workload execution.
 */
export async function createApp(config: AppConfig): Promise<AppContext> {
  const pool = new PostgresPool(
    config.databaseUrl ? { connectionString: config.databaseUrl } : {},
  );

  const migrator = new PostgresMigrator(pool);
  await migrator.runMigrations();

  const brokerLock = new PostgresBrokerLock(pool);
  const brokerRelease: BrokerLockRelease = await brokerLock.acquire();

  const writeBarrier = new PostgresWriteBarrier(pool);
  const artifactStore = new LocalArtifactStore(config.artifactStoreDir);

  const storageRepo = new PostgresStorageRepository(pool);
  const executionRepo = new PostgresExecutionRepository(pool);
  const outcomeRepo = new PostgresOutcomeRepository(pool);
  const evaluationRepo = new PostgresEvaluationRepository(pool);
  const auditSink = new PostgresAuditSink(pool);

  const runtime = new RootlessPodmanRuntime();
  const stager = new ArtifactStager(artifactStore, {
    stagingBaseDir: config.stagingDir,
  });
  const collector = new OutputCollector(
    runtime,
    artifactStore,
    storageRepo,
    executionRepo,
  );
  const reconciler = new StartupReconciler(executionRepo, runtime, auditSink);
  const broker = new ExecutionBroker(
    runtime,
    executionRepo,
    auditSink,
    stager,
    collector,
    reconciler,
  );

  await broker.reconcileStartup();

  const reconstructionEngine = new ReconstructionEngine(
    storageRepo,
    executionRepo,
    outcomeRepo,
    evaluationRepo,
    artifactStore,
    pool,
  );
  const backupService = new BackupService(writeBarrier, pool, config.artifactStoreDir);
  const restoreService = new RestoreService(pool, config.artifactStoreDir);

  let isShutdown = false;
  const shutdown = async (): Promise<void> => {
    if (isShutdown) return;
    isShutdown = true;
    try {
      await brokerRelease.release();
    } finally {
      await pool.close();
    }
  };

  return {
    pool,
    migrator,
    writeBarrier,
    brokerLock,
    artifactStore,
    storageRepo,
    executionRepo,
    outcomeRepo,
    evaluationRepo,
    auditSink,
    runtime,
    stager,
    collector,
    reconciler,
    broker,
    reconstructionEngine,
    backupService,
    restoreService,
    shutdown,
  };
}
