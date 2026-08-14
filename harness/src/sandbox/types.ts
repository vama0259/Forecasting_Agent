// harness/src/sandbox/types.ts
// Zod schemas, inferred types, and error classes for the sandbox module's public boundary.

import { z } from 'zod';

// Validates the shape of any call into SandboxManager.runExplore/runValidate.
export const ExecutionRequestSchema = z.object({
  runId: z.string().min(1),
  tier: z.enum(['explore', 'validate']),
  code: z.string().optional(),
  workspacePath: z.string().optional(),
  modelScriptPath: z.string().optional(),
});
export type SandboxTier = z.infer<typeof ExecutionRequestSchema>['tier'];
export type ExecutionRequest = z.infer<typeof ExecutionRequestSchema>;

// Validates the top-level shape of M8's EvalResult JSON echoed from validate.py's stdout.
export const EvalResultSchema = z.object({
  verdict: z.unknown(),
  layers: z.array(z.unknown()),
  layer_means: z.record(z.string(), z.unknown()),
});
export type EvalResult = z.infer<typeof EvalResultSchema>;

export interface ExecutionResult {
  stdout: string;
  stderr: string;
  stdoutTruncated: boolean;
  stderrTruncated: boolean;
  exitCode: number;
  durationMs: number;
  evalResult?: EvalResult | undefined;
}

export interface SandboxConfig {
  concurrency?: number;
  timeoutMs?: number;
  stdioBufferBytes?: number;
  idleReaperMs?: number;
  memoryLimitBytes?: number;
  cpuLimit?: number;
}

// Thrown when a container exec exceeds the configured hard timeout.
export class SandboxTimeoutError extends Error {}

// Thrown when the validate tier's model/M8 pipeline fails on its own terms (not an infra failure).
export class ValidationFailedError extends Error {
  readonly detail: string;
  constructor(message: string, detail: string) {
    super(message);
    this.detail = detail;
  }
}

// Thrown for generic Docker/infra failures (daemon unreachable, OOM kill, etc.).
export class SandboxError extends Error {
  readonly exitCode?: number | undefined;
  constructor(message: string, exitCode?: number | undefined) {
    super(message);
    this.exitCode = exitCode;
  }
}
