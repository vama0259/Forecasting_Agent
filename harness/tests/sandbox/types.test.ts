// harness/tests/sandbox/types.test.ts
import { describe, it, expect } from 'vitest';
import {
  ExecutionRequestSchema,
  EvalResultSchema,
  SandboxTimeoutError,
  ValidationFailedError,
  SandboxError,
} from '../../src/sandbox/types.js';

describe('ExecutionRequestSchema', () => {
  it('accepts a valid explore request', () => {
    const parsed = ExecutionRequestSchema.parse({
      runId: 'run-1',
      tier: 'explore',
      code: 'print(1)',
    });
    expect(parsed.tier).toBe('explore');
  });

  it('accepts a valid validate request', () => {
    const parsed = ExecutionRequestSchema.parse({
      runId: 'run-1',
      tier: 'validate',
      modelScriptPath: '/tmp/model.py',
    });
    expect(parsed.tier).toBe('validate');
  });

  it('rejects a request with an invalid tier', () => {
    expect(() => ExecutionRequestSchema.parse({ runId: 'run-1', tier: 'bogus' })).toThrow();
  });

  it('rejects a request missing runId', () => {
    expect(() => ExecutionRequestSchema.parse({ tier: 'explore', code: 'x' })).toThrow();
  });
});

describe('EvalResultSchema', () => {
  it('accepts a well-formed EvalResult shape', () => {
    const parsed = EvalResultSchema.parse({
      verdict: { status: 'VALID' },
      layers: [{ layer: 1, fold_number: 0, value: 0.5 }],
      layer_means: { '1': { mean: 0.5, n_folds: 2 } },
    });
    expect(parsed.layers).toHaveLength(1);
  });

  it('rejects a shape missing required top-level keys', () => {
    expect(() => EvalResultSchema.parse({ verdict: {} })).toThrow();
  });
});

describe('error classes', () => {
  it('SandboxTimeoutError is a distinct Error subclass', () => {
    const e = new SandboxTimeoutError('timed out');
    expect(e).toBeInstanceOf(Error);
    expect(e.message).toBe('timed out');
  });

  it('ValidationFailedError carries a detail string separate from message', () => {
    const e = new ValidationFailedError('model failed', 'ImportError: no module neuralforecast');
    expect(e.detail).toContain('ImportError');
  });

  it('SandboxError optionally carries the container exit code', () => {
    const e = new SandboxError('OOM killed', 137);
    expect(e.exitCode).toBe(137);
  });
});
