/**
 * Purpose: Podman runtime adapter implementing SandboxRuntime port.
 * Responsibility: Manage rootless container provisioning, execution, and cleanup.
 * Inputs/outputs: Provision & Command requests; returns Handles, Results, and State.
 * Excludes: Core business logic and database entity persistence.
 */

import type {
  CollectedOutput,
  SandboxRuntime,
} from '../../core/ports/sandbox-runtime.port.js';
import type {
  CleanupResult,
  CommandRequest,
  CommandResult,
  ManagedContainerInfo,
  OutputDeclaration,
  ProvisionRequest,
  RuntimeHandle,
  RuntimeState,
  TerminationReason,
} from '../../core/types/execution.js';
import { assertImageAdmitted } from '../../execution/image-admission.js';
import { TwoSlotSemaphore } from '../../execution/semaphore.js';
import { ExecutionTimeoutError } from '../../core/errors/execution-timeout.error.js';
import { OomKilledError } from '../../core/errors/resource-limit.error.js';
import { runPodman } from './podman-process.js';
import { buildCreateArgs, buildExecArgs } from './podman-args.js';
import { inspectContainer, listBrokerContainers } from './podman-inspector.js';

/** Configuration options for the rootless Podman runtime adapter. */
export interface PodmanRuntimeConfig {
  readonly maxConcurrency?: number;
  readonly maxQueueCapacity?: number;
  readonly semaphoreTimeoutMs?: number;
}

/**
 * Rootless Podman implementation of the isolated SandboxRuntime port.
 */
export class RootlessPodmanRuntime implements SandboxRuntime {
  private readonly semaphore: TwoSlotSemaphore;
  private readonly leases = new Map<string, () => void>();

  /**
   * Initializes rootless Podman adapter with bounded concurrency semaphore.
   * Configures concurrency limits and acquisition timeouts.
   */
  constructor(config: PodmanRuntimeConfig = {}) {
    this.semaphore = new TwoSlotSemaphore({
      maxConcurrency: config.maxConcurrency ?? 2,
      maxQueueCapacity: config.maxQueueCapacity ?? 10,
      timeoutMs: config.semaphoreTimeoutMs ?? 30000,
    });
  }

  /**
   * Provisions a hardened rootless sandbox with read-only rootfs and tmpfs.
   * Returns RuntimeHandle ready for isolated command execution.
   */
  async provision(request: ProvisionRequest): Promise<RuntimeHandle> {
    assertImageAdmitted(request.runtime_digest);

    const release = await this.semaphore.acquire();
    const args = buildCreateArgs(request);

    try {
      const createRes = await runPodman({ argv: args });
      if (createRes.exitCode !== 0) {
        throw new Error(
          `Failed to create sandbox container: ${createRes.stderr.toString()}`,
        );
      }
      const containerId = createRes.stdout.toString().trim();
      this.leases.set(containerId, release);

      return {
        container_id: containerId,
        execution_id: request.execution_id,
      };
    } catch (err) {
      release();
      throw err;
    }
  }

  /**
   * Starts a provisioned container so commands can be executed inside it.
   * Resolves when container status transitions to running.
   */
  async start(handle: RuntimeHandle): Promise<void> {
    const res = await runPodman({ argv: ['start', handle.container_id] });
    if (res.exitCode !== 0) {
      throw new Error(`Failed to start sandbox container: ${res.stderr.toString()}`);
    }
  }

  /**
   * Executes a command within the running sandbox with timeout and demuxing.
   * Returns CommandResult or throws on timeout / OOM kill.
   */
  async execute(
    handle: RuntimeHandle,
    command: CommandRequest,
  ): Promise<CommandResult> {
    const args = buildExecArgs(handle.container_id, command);

    const result = await runPodman({
      argv: args,
      timeoutMs: command.timeout_ms,
    });

    if (result.timedOut) {
      throw new ExecutionTimeoutError(
        `Command timed out after ${command.timeout_ms}ms`,
        { timeoutMs: command.timeout_ms },
      );
    }

    const inspectState = await runPodman({
      argv: ['inspect', handle.container_id],
      timeoutMs: 10000,
    });

    if (inspectState.exitCode === 0) {
      try {
        const data = JSON.parse(inspectState.stdout.toString()) as readonly {
          readonly State?: { readonly OOMKilled?: boolean };
        }[];
        if (data[0]?.State?.OOMKilled) {
          throw new OomKilledError('Command killed by OOM');
        }
      } catch (err) {
        if (err instanceof OomKilledError) throw err;
      }
    }

    const headLen = Math.min(1024, result.stdout.length);
    const tailLen = Math.min(1024, result.stdout.length);
    const errHeadLen = Math.min(1024, result.stderr.length);
    const errTailLen = Math.min(1024, result.stderr.length);

    return {
      exit_code: result.exitCode,
      stdout_bytes: result.stdout.length,
      stderr_bytes: result.stderr.length,
      stdout_head_tail: {
        head: result.stdout.subarray(0, headLen),
        tail: result.stdout.subarray(result.stdout.length - tailLen),
      },
      stderr_head_tail: {
        head: result.stderr.subarray(0, errHeadLen),
        tail: result.stderr.subarray(result.stderr.length - errTailLen),
      },
    };
  }

  /**
   * Collects declared output files from the sandbox container before it terminates.
   * Returns array of output file descriptors and content streams.
   */
  async collect(
    handle: RuntimeHandle,
    declarations: readonly OutputDeclaration[],
  ): Promise<readonly CollectedOutput[]> {
    const collected: CollectedOutput[] = [];

    for (const decl of declarations) {
      const containerFilePath = `/outputs/${decl.relative_path}`;
      const readRes = await runPodman({
        argv: ['exec', handle.container_id, 'cat', containerFilePath],
        timeoutMs: 30000,
      });

      if (readRes.exitCode !== 0 && decl.required) {
        throw new Error(
          `Required output "${decl.declaration_name}" not found at ` +
            `"${containerFilePath}": ${readRes.stderr.toString()}`,
        );
      }

      const outputBuffer = readRes.stdout;
      async function* createStream(): AsyncIterable<Uint8Array> {
        yield outputBuffer;
      }

      collected.push({
        declaration: decl,
        stream: createStream(),
      });
    }

    return collected;
  }

  /**
   * Gracefully terminates a running sandbox container.
   * Resolves when container is stopped.
   */
  async terminate(handle: RuntimeHandle, _reason: TerminationReason): Promise<void> {
    await runPodman({
      argv: ['stop', '-t', '5', handle.container_id],
      timeoutMs: 15000,
    });
  }

  /**
   * Forcibly stops and destroys sandbox container, releasing semaphore lease.
   * Returns CleanupResult confirming disposal.
   */
  async destroy(handle: RuntimeHandle): Promise<CleanupResult> {
    try {
      await runPodman({
        argv: ['rm', '-f', handle.container_id],
        timeoutMs: 15000,
      });
      return { destroyed: true };
    } catch (err) {
      return { destroyed: false, error: String(err) };
    } finally {
      const release = this.leases.get(handle.container_id);
      if (release) {
        this.leases.delete(handle.container_id);
        release();
      }
    }
  }

  /**
   * Queries the lifecycle state and OOM status of the sandbox container.
   * Returns current RuntimeState.
   */
  async inspect(handle: RuntimeHandle): Promise<RuntimeState> {
    return inspectContainer(handle.container_id);
  }

  /**
   * Discovers and enumerates all containers labeled as managed by the broker.
   * Returns array of discovered ManagedContainerInfo records.
   */
  async listManagedContainers(): Promise<readonly ManagedContainerInfo[]> {
    return listBrokerContainers();
  }
}
