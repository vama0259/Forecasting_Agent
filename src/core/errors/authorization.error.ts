/**
 * Purpose: Error thrown when authorization validation or redemption fails.
 * Responsibility: Capture authorization expiration, hash mismatch, or reuse errors.
 * Inputs/outputs: Authorization failure context; structured domain error instance.
 * Excludes: Cryptographic signature algorithms.
 */

import { DomainError } from './domain-error.js';

/** Error thrown when execution authorization is invalid, expired, or tampered. */
export class AuthorizationError extends DomainError {
  /**
   * Constructs an authorization failure error with context details.
   * Assigns AUTHORIZATION_FAILED stable error code.
   */
  constructor(
    message: string,
    context: {
      readonly authorizationId?: string;
      readonly executionId?: string;
      readonly reason?: string;
      readonly [key: string]: unknown;
    } = {},
  ) {
    super('AUTHORIZATION_FAILED', message, context);
  }
}
