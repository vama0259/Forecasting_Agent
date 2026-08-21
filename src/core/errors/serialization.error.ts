/**
 * Purpose: Error thrown when RFC 8785 canonical JSON serialization fails.
 * Responsibility: Capture unsupported types, cyclic references, or NaN values.
 * Inputs/outputs: Serialization context; structured domain error instance.
 * Excludes: Parsing or deseralization routines.
 */

import { DomainError } from './domain-error.js';

/** Error thrown when data cannot be canonically serialized to JSON. */
export class SerializationError extends DomainError {
  /**
   * Constructs a serialization error with failure details.
   * Assigns SERIALIZATION_ERROR stable error code.
   */
  constructor(
    message: string,
    context: {
      readonly valueType?: string;
      readonly reason?: string;
      readonly [key: string]: unknown;
    } = {},
  ) {
    super('SERIALIZATION_ERROR', message, context);
  }
}
