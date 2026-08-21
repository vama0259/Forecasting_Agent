/**
 * Purpose: Error thrown when an in-flight execution is explicitly cancelled.
 * Responsibility: Distinguish caller-requested cancellation from other failures.
 * Inputs/outputs: Execution cancellation context; structured domain error instance.
 * Excludes: Timeout detection and resource-limit enforcement.
 */

import { DomainError } from './domain-error.js';

/** Error thrown when a caller explicitly cancels a running execution. */
export class ExecutionCancelledError extends DomainError {
  /**
   * Constructs an execution cancellation error.
   * Assigns CANCELLED stable error code.
   */
  constructor(
    message: string,
    context: {
      readonly executionId?: string;
      readonly [key: string]: unknown;
    } = {},
  ) {
    super('CANCELLED', message, context);
  }
}
