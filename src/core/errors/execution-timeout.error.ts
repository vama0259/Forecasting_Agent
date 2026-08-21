/**
 * Purpose: Error thrown when a command or execution exceeds its allocated timeout.
 * Responsibility: Capture allocated timeout duration and execution state.
 * Inputs/outputs: Execution timeout context; structured domain error instance.
 * Excludes: POSIX signal transmission logic.
 */

import { DomainError } from './domain-error.js';

/** Error thrown when a sandbox execution or command times out. */
export class ExecutionTimeoutError extends DomainError {
  /**
   * Constructs an execution timeout error.
   * Assigns TIMED_OUT stable error code.
   */
  constructor(
    message: string,
    context: {
      readonly executionId?: string;
      readonly timeoutMs?: number;
      readonly elapsedMs?: number;
      readonly [key: string]: unknown;
    } = {},
  ) {
    super('TIMED_OUT', message, context);
  }
}
