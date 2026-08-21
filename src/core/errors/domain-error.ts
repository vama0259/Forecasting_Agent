/**
 * Purpose: Base class for all typed domain errors in the forecasting foundation.
 * Responsibility: Maintain consistent error codes, HTTP-neutral context, and cause.
 * Inputs/outputs: Error code, message, optional context object, optional cause.
 * Excludes: Protocol-specific status codes and presentation formatting.
 */

/** Base error for all structured domain exceptions. */
export class DomainError extends Error {
  readonly code: string;
  readonly context: Readonly<Record<string, unknown>>;

  /**
   * Initializes a domain error with a stable code, message, and context.
   * Sets prototype explicitly and captures stack trace if available.
   */
  constructor(
    code: string,
    message: string,
    context: Record<string, unknown> = {},
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = this.constructor.name;
    this.code = code;
    this.context = Object.freeze({ ...context });
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
