/**
 * Purpose: Error thrown when point-in-time cutoff policy is violated.
 * Responsibility: Capture cutoff timestamp, artifact timestamp, and eligibility state.
 * Inputs/outputs: Temporal violation details; structured domain error instance.
 * Excludes: Authorization logic and cryptographic verification.
 */

import { DomainError } from './domain-error.js';

/** Error thrown when evidence is ineligible for a run due to cutoff policy. */
export class PointInTimeViolationError extends DomainError {
  /**
   * Constructs point-in-time violation error with timestamps and artifact state.
   * Assigns POINT_IN_TIME_VIOLATION stable error code.
   */
  constructor(
    message: string,
    context: {
      readonly artifactAvailableFrom?: string;
      readonly runCutoffAt?: string;
      readonly artifactState?: string;
      readonly [key: string]: unknown;
    } = {},
  ) {
    super('POINT_IN_TIME_VIOLATION', message, context);
  }
}
