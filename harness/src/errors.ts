export const REDACTED = '[REDACTED]';

export function redact(message: string, secrets: Iterable<string>): string {
  let output = message;
  for (const secret of secrets) {
    if (secret.length === 0) continue;
    output = output.split(secret).join(REDACTED);
  }
  return output;
}

export class ConfigValidationError extends Error {
  readonly issues: readonly string[];

  constructor(issues: readonly string[], secrets: Iterable<string> = []) {
    const safe = issues.map((issue) => redact(issue, secrets));
    super(safe.join('; '));
    this.name = 'ConfigValidationError';
    this.issues = safe;
  }
}

export class CapabilityHealthError extends Error {
  readonly failures: readonly string[];

  constructor(failures: readonly string[]) {
    super(failures.join('; '));
    this.name = 'CapabilityHealthError';
    this.failures = failures;
  }
}
