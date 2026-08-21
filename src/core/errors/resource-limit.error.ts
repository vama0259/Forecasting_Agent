/**
 * Purpose: Errors thrown when execution exceeds resource boundaries.
 * Responsibility: Capture resource limit violations for storage, memory, and pids.
 * Inputs/outputs: Resource usage metrics; structured domain error instances.
 * Excludes: Dynamic cgroup reconfiguration.
 */

import { DomainError } from './domain-error.js';

/** Base error for sandbox resource quota violations. */
export class ResourceLimitError extends DomainError {
  /**
   * Constructs a resource limit error.
   * Assigns RESOURCE_LIMIT_EXCEEDED stable error code.
   */
  constructor(code: string, message: string, context: Record<string, unknown> = {}) {
    super(code, message, context);
  }
}

/** Error thrown when container tmpfs quota is exhausted. */
export class StorageLimitError extends ResourceLimitError {
  /**
   * Constructs a storage limit error.
   * Assigns STORAGE_LIMIT stable error code.
   */
  constructor(
    message: string,
    context: {
      readonly mountPath?: string;
      readonly limitBytes?: number;
      readonly [key: string]: unknown;
    } = {},
  ) {
    super('STORAGE_LIMIT', message, context);
  }
}

/** Error thrown when container process is terminated by cgroup OOM killer. */
export class OomKilledError extends ResourceLimitError {
  /**
   * Constructs an OOM killed error.
   * Assigns OOM_KILLED stable error code.
   */
  constructor(
    message: string,
    context: {
      readonly memoryLimitBytes?: number;
      readonly [key: string]: unknown;
    } = {},
  ) {
    super('OOM_KILLED', message, context);
  }
}
