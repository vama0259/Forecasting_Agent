/**
 * Purpose: Consumer-owned port interface for isolated OCI container execution runtimes.
 * Responsibility: Define lifecycle contracts for provisioning, execution, and cleanup.
 * Inputs/outputs: Provision / command requests; returns execution handles and results.
 * Excludes: Podman/Docker client libraries and Unix socket communication.
 */

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
} from '../types/execution.js';

/**
 * Descriptor for a collected output file stream from a container.
 */
export interface CollectedOutput {
  readonly declaration: OutputDeclaration;
  readonly stream: AsyncIterable<Uint8Array>;
}

/**
 * Interface defining operations for executing disposable OCI container sandboxes.
 */
export interface SandboxRuntime {
  /**
   * Provisions a fresh disposable container with hardened security profiles.
   * Returns RuntimeHandle referencing the newly created container.
   */
  provision(request: ProvisionRequest): Promise<RuntimeHandle>;

  /**
   * Starts a provisioned container.
   * Resolves when the container is in the RUNNING state.
   */
  start(handle: RuntimeHandle): Promise<void>;

  /**
   * Executes a command within a provisioned, running container.
   * Returns CommandResult containing exit code and captured stream slices.
   */
  execute(handle: RuntimeHandle, command: CommandRequest): Promise<CommandResult>;

  /**
   * Collects declared output file streams from a running container.
   * Returns array of output file descriptors and content streams.
   */
  collect(
    handle: RuntimeHandle,
    declarations: readonly OutputDeclaration[],
  ): Promise<readonly CollectedOutput[]>;

  /**
   * Sends termination signal to a running container with graceful timeout.
   * Resolves when container process has exited.
   */
  terminate(handle: RuntimeHandle, reason: TerminationReason): Promise<void>;

  /**
   * Destroys container and removes associated ephemeral runtime resources.
   * Returns CleanupResult indicating successful teardown.
   */
  destroy(handle: RuntimeHandle): Promise<CleanupResult>;

  /**
   * Inspects current lifecycle state and exit status of a container.
   * Returns RuntimeState descriptor.
   */
  inspect(handle: RuntimeHandle): Promise<RuntimeState>;

  /**
   * Lists active or exited containers labeled as managed by the runtime broker.
   * Returns array of discovered ManagedContainerInfo records.
   */
  listManagedContainers?(): Promise<readonly ManagedContainerInfo[]>;
}
