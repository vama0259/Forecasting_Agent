/**
 * Purpose: Bidirectional crash recovery reconciler restoring state integrity.
 * Responsibility: Reconcile runtime containers with database execution states.
 * Inputs/outputs: Database repository, runtime port; returns reconciled records.
 * Excludes: Routine execution scheduling and real-time container log streaming.
 */

import type { ExecutionRepository } from '../core/ports/execution-repository.port.js';
import type { SandboxRuntime } from '../core/ports/sandbox-runtime.port.js';
import type { AuditSink } from '../core/ports/audit-sink.port.js';
import type { ExecutionId } from '../core/types/identifiers.js';
import type { ExecutionState } from '../core/types/lifecycle.js';

/** Summary of a crash-reconciled execution record. */
export interface ReconcileResult {
  readonly executionId: ExecutionId;
  readonly direction: 'RUNTIME_TO_STATE' | 'STATE_TO_RUNTIME';
  readonly previousState: string;
  readonly targetState: ExecutionState;
  readonly cleaned: boolean;
}

const TERMINAL_STATES: ReadonlySet<ExecutionState> = new Set([
  'COMPLETED',
  'FAILED',
  'CANCELLED',
  'TIMED_OUT',
  'COLLECTION_FAILED',
  'QUARANTINED',
  'REJECTED',
]);

/**
 * Bidirectional reconciler recovering consistency between runtime and database.
 */
export class StartupReconciler {
  private readonly executionRepo: ExecutionRepository;
  private readonly runtime: SandboxRuntime;
  private readonly auditSink: AuditSink;

  /**
   * Initializes startup reconciler with repository and container runtime ports.
   * Sets local port references.
   */
  constructor(
    executionRepo: ExecutionRepository,
    runtime: SandboxRuntime,
    auditSink: AuditSink,
  ) {
    this.executionRepo = executionRepo;
    this.runtime = runtime;
    this.auditSink = auditSink;
  }

  /**
   * Executes Sweep 1 (Runtime -> DB): inspects managed containers and cleans orphans.
   * Returns list of reconciled execution results.
   */
  async reconcileRuntimeToState(): Promise<readonly ReconcileResult[]> {
    const results: ReconcileResult[] = [];
    if (!this.runtime.listManagedContainers) return results;

    const managedContainers = await this.runtime.listManagedContainers();
    const UUID_FORMAT =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

    for (const container of managedContainers) {
      const execId = container.executionId;
      if (!execId || !UUID_FORMAT.test(execId)) {
        await this.runtime.destroy({
          container_id: container.containerId,
          execution_id: (execId ?? '') as ExecutionId,
        });
        continue;
      }

      const exec = await this.executionRepo.getExecution(execId);
      if (!exec) {
        await this.runtime.destroy({
          container_id: container.containerId,
          execution_id: execId,
        });
        continue;
      }

      if (TERMINAL_STATES.has(exec.state)) {
        const destroyRes = await this.runtime.destroy({
          container_id: container.containerId,
          execution_id: execId,
        });
        await this.executionRepo.updateCleanupState(
          execId,
          destroyRes.destroyed ? 'COMPLETED' : 'FAILED',
        );
        continue;
      }

      const targetState: ExecutionState =
        exec.state === 'COLLECTING' ? 'COLLECTION_FAILED' : 'FAILED';

      await this.executionRepo.updateExecutionState(execId, targetState, {
        failure_stage: 'CRASH_RECONCILIATION',
        failure_code: 'BROKER_CRASHED',
        failure_detail: 'Interrupted by daemon restart during execution',
        ended_at: new Date().toISOString(),
      });

      const destroyRes = await this.runtime.destroy({
        container_id: container.containerId,
        execution_id: execId,
      });

      await this.executionRepo.updateCleanupState(
        execId,
        destroyRes.destroyed ? 'COMPLETED' : 'FAILED',
      );

      await this.auditSink.appendEvent({
        organization_id: exec.organization_id,
        execution_id: execId,
        event_type: 'EXECUTION_RECONCILED',
        details: {
          direction: 'RUNTIME_TO_STATE',
          previousState: exec.state,
          targetState,
          cleaned: destroyRes.destroyed,
        },
      });

      results.push({
        executionId: execId,
        direction: 'RUNTIME_TO_STATE',
        previousState: exec.state,
        targetState,
        cleaned: destroyRes.destroyed,
      });
    }

    return results;
  }

  /**
   * Executes Sweep 2 (DB -> Runtime): checks active executions against runtime.
   * Returns list of reconciled execution results.
   */
  async reconcileStateToRuntime(): Promise<readonly ReconcileResult[]> {
    const activeExecutions = await this.executionRepo.getActiveExecutions();
    const results: ReconcileResult[] = [];
    const now = new Date().getTime();

    for (const exec of activeExecutions) {
      const inspectRes = await this.runtime.inspect({
        container_id: `sandbox-${exec.id}`,
        execution_id: exec.id,
      });

      const containerMissing = inspectRes.state === 'FAILED' && !inspectRes.started_at;
      const deadlinePassed =
        !exec.provisioning_deadline ||
        now >= new Date(exec.provisioning_deadline).getTime();

      if (containerMissing && deadlinePassed) {
        const targetState: ExecutionState =
          exec.state === 'COLLECTING' ? 'COLLECTION_FAILED' : 'FAILED';

        await this.executionRepo.updateExecutionState(exec.id, targetState, {
          failure_stage: 'CRASH_RECONCILIATION',
          failure_code: 'RUNTIME_MISSING',
          failure_detail: 'No matching container found after provisioning deadline',
          ended_at: new Date().toISOString(),
        });

        await this.executionRepo.updateCleanupState(exec.id, 'COMPLETED');

        await this.auditSink.appendEvent({
          organization_id: exec.organization_id,
          execution_id: exec.id,
          event_type: 'RUNTIME_MISSING',
          details: {
            direction: 'STATE_TO_RUNTIME',
            previousState: exec.state,
            targetState,
          },
        });

        results.push({
          executionId: exec.id,
          direction: 'STATE_TO_RUNTIME',
          previousState: exec.state,
          targetState,
          cleaned: true,
        });
      }
    }

    return results;
  }

  /**
   * Runs both reconciliation sweeps restoring bidirectional state consistency.
   * Returns combined array of ReconcileResult records.
   */
  async reconcileOrphanedExecutions(): Promise<readonly ReconcileResult[]> {
    const sweep1 = await this.reconcileRuntimeToState();
    const sweep2 = await this.reconcileStateToRuntime();
    return [...sweep1, ...sweep2];
  }
}
