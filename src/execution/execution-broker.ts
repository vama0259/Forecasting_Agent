/**
 * Purpose: Central orchestrator managing isolated container execution lifecycle.
 * Responsibility: Coordinate staging, container run, live output collection, cleanup.
 * Inputs/outputs: Execution parameters; returns completed ExecutionRecord or throws.
 * Excludes: Low-level child process spawning and raw SQL construction.
 */

import type { SandboxRuntime } from '../core/ports/sandbox-runtime.port.js';
import type { ExecutionRepository } from '../core/ports/execution-repository.port.js';
import type { AuditSink } from '../core/ports/audit-sink.port.js';
import type { ArtifactStager, StageInputItem } from './artifact-stager.js';
import type { OutputCollector } from './output-collector.js';
import type { ReconcileResult, StartupReconciler } from './startup-reconciler.js';
import type {
  ExecutionContractId,
  ExecutionId,
  OrganizationId,
  ProjectId,
  RunAttemptId,
  Sha256Hash,
} from '../core/types/identifiers.js';
import type {
  CommandRequest,
  OutputDeclaration,
  RuntimeHandle,
} from '../core/types/execution.js';
import type { ResourcePolicyDeclaration } from '../core/types/contracts.js';
import type { ExecutionRecord } from '../core/ports/execution-repository.port.js';
import { ExecutionTimeoutError } from '../core/errors/execution-timeout.error.js';
import { OomKilledError } from '../core/errors/resource-limit.error.js';

/** Request parameters for executing an isolated container plan node. */
export interface ExecuteNodeRequest {
  readonly executionId: ExecutionId;
  readonly runAttemptId: RunAttemptId;
  readonly organizationId: OrganizationId;
  readonly projectId: ProjectId;
  readonly executionContractId: ExecutionContractId;
  readonly authorizationHash: Sha256Hash;
  readonly runtimeDigest: string;
  readonly platformDigest: string;
  readonly resourcePolicy: ResourcePolicyDeclaration;
  readonly inputs: readonly StageInputItem[];
  readonly commands: readonly CommandRequest[];
  readonly outputDeclarations: readonly OutputDeclaration[];
}

/**
 * Orchestrator coordinating container lifecycle, commands, and live collection.
 */
export class ExecutionBroker {
  private readonly runtime: SandboxRuntime;
  private readonly executionRepo: ExecutionRepository;
  private readonly auditSink: AuditSink;
  private readonly stager: ArtifactStager;
  private readonly collector: OutputCollector;
  private readonly reconciler?: StartupReconciler;

  /**
   * Initializes execution broker with required runtime and storage adapters.
   * Sets local references for lifecycle management.
   */
  constructor(
    runtime: SandboxRuntime,
    executionRepo: ExecutionRepository,
    auditSink: AuditSink,
    stager: ArtifactStager,
    collector: OutputCollector,
    reconciler?: StartupReconciler,
  ) {
    this.runtime = runtime;
    this.executionRepo = executionRepo;
    this.auditSink = auditSink;
    this.stager = stager;
    this.collector = collector;
    this.reconciler = reconciler;
  }

  /**
   * Runs startup crash reconciliation to restore state consistency before execution.
   * Returns list of reconciled execution results.
   */
  async reconcileStartup(): Promise<readonly ReconcileResult[]> {
    if (this.reconciler) {
      return this.reconciler.reconcileOrphanedExecutions();
    }
    return [];
  }

  /**
   * Executes a plan node through the complete isolated container lifecycle.
   * Returns final ExecutionRecord in terminal COMPLETED state or throws.
   */
  async executeNode(request: ExecuteNodeRequest): Promise<ExecutionRecord> {
    // 1. Redeem authorization
    await this.executionRepo.redeemAuthorization(
      request.executionId,
      request.authorizationHash,
    );

    await this.auditSink.appendEvent({
      organization_id: request.organizationId,
      execution_id: request.executionId,
      event_type: 'EXECUTION_PROVISIONING',
      details: { executionId: request.executionId },
    });

    let handle: RuntimeHandle | null = null;

    try {
      // 2. Stage inputs
      const inputMounts = await this.stager.stageInputs({
        executionId: request.executionId,
        runAttemptId: request.runAttemptId,
        inputs: request.inputs,
      });

      // 3. Provision container
      handle = await this.runtime.provision({
        execution_id: request.executionId,
        run_attempt_id: request.runAttemptId,
        runtime_digest: request.runtimeDigest,
        platform_digest: request.platformDigest,
        resource_policy: request.resourcePolicy,
        input_mounts: inputMounts,
        labels: { executionId: request.executionId },
      });

      await this.executionRepo.updateExecutionState(request.executionId, 'READY');

      // 4. Start container
      await this.runtime.start(handle);
      await this.executionRepo.updateExecutionState(request.executionId, 'RUNNING', {
        started_at: new Date().toISOString(),
      });

      // 5. Execute commands sequentially
      for (const cmd of request.commands) {
        const result = await this.runtime.execute(handle, cmd);
        await this.auditSink.appendEvent({
          organization_id: request.organizationId,
          execution_id: request.executionId,
          event_type: 'COMMAND_EXECUTED',
          details: {
            exit_code: result.exit_code,
            stdout_bytes: result.stdout_bytes,
            stderr_bytes: result.stderr_bytes,
          },
        });

        if (result.exit_code !== 0) {
          throw new Error(
            `Command failed with non-zero exit code: ${result.exit_code}`,
          );
        }
      }

      // 6. Collect outputs while container is still RUNNING
      await this.executionRepo.updateExecutionState(request.executionId, 'COLLECTING');

      await this.collector.collectOutputs({
        handle,
        organizationId: request.organizationId,
        projectId: request.projectId,
        executionId: request.executionId,
        declarations: request.outputDeclarations,
      });

      // 7. Complete execution
      const completed = await this.executionRepo.updateExecutionState(
        request.executionId,
        'COMPLETED',
        { ended_at: new Date().toISOString(), exit_code: 0 },
      );

      return completed;
    } catch (err) {
      const isTimeout = err instanceof ExecutionTimeoutError;
      const isOom = err instanceof OomKilledError;
      const finalState = isTimeout ? 'TIMED_OUT' : 'FAILED';

      await this.executionRepo.updateExecutionState(request.executionId, finalState, {
        failure_code: isTimeout ? 'TIMEOUT' : isOom ? 'OOM' : 'ERROR',
        failure_detail: String(err),
        ended_at: new Date().toISOString(),
      });
      throw err;
    } finally {
      // 8. Cleanup runtime and staging
      if (handle) {
        await this.runtime.destroy(handle);
      }
      await this.stager.cleanupStaging(request.executionId);
      await this.executionRepo.updateCleanupState(request.executionId, 'COMPLETED');
    }
  }
}
