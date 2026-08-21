/**
 * Purpose: Error thrown when an artifact fails cryptographic or byte verification.
 * Responsibility: Capture expected vs actual hash or size discrepancies.
 * Inputs/outputs: Mismatch context details; structured domain error instance.
 * Excludes: Filesystem repair algorithms or network re-download logic.
 */

import { DomainError } from './domain-error.js';

/** Error thrown when an artifact fails SHA-256 or size verification. */
export class ArtifactCorruptedError extends DomainError {
  /**
   * Constructs an artifact corruption error with hash or size discrepancy.
   * Assigns ARTIFACT_CORRUPTED stable error code.
   */
  constructor(
    message: string,
    context: {
      readonly expectedSha256?: string;
      readonly actualSha256?: string;
      readonly expectedBytes?: number;
      readonly actualBytes?: number;
      readonly storageKey?: string;
      readonly [key: string]: unknown;
    } = {},
  ) {
    super('ARTIFACT_CORRUPTED', message, context);
  }
}
