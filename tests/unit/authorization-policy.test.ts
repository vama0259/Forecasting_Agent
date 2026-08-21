/**
 * Purpose: Unit tests for execution authorization hashing and plan validation.
 * Responsibility: Verify deterministic canonical SHA-256 computation over payloads.
 * Inputs/outputs: Plain payload objects; SHA-256 hash assertions.
 * Excludes: Cryptographic signing and network transmission.
 */

import { describe, it, expect } from 'vitest';
import {
  computePlanHash,
  computeCommandSetHash,
  computeAuthorizationHash,
} from '../../src/core/policies/authorization-policy.js';
import type {
  AuthorizationPayload,
  CanonicalPlan,
  ExecutionCommandDeclaration,
} from '../../src/core/types/execution.js';
import type {
  ContractId,
  ExecutionContractId,
  ExecutionId,
  OrganizationId,
  ProjectId,
  RunAttemptId,
  RunId,
  Sha256Hash,
} from '../../src/core/types/identifiers.js';

describe('Authorization Policy', () => {
  const sampleCommands: readonly ExecutionCommandDeclaration[] = [
    {
      command_sequence: 1,
      argv: ['python3', '-m', 'forecast'],
      working_directory: '/workspace',
      environment: { LANG: 'C.UTF-8' },
      stdin_artifact_version_id: null,
      timeout_ms: 10000,
    },
  ];

  const samplePlan: CanonicalPlan = {
    schema_version: 1,
    contract_hash: 'c'.repeat(64) as Sha256Hash,
    executions: [
      {
        execution_id: 'e1' as ExecutionId,
        execution_kind: 'arima_forecast',
        execution_contract_hash: 'd'.repeat(64) as Sha256Hash,
        dependencies: [],
        required_inputs: ['historical_series'],
        required_outputs: ['forecast_result'],
      },
    ],
  };

  const samplePayload: AuthorizationPayload = {
    authorization_id: 'auth-1',
    organization_id: 'org-1' as OrganizationId,
    project_id: 'proj-1' as ProjectId,
    run_id: 'run-1' as RunId,
    run_attempt_id: 'att-1' as RunAttemptId,
    execution_id: 'exec-1' as ExecutionId,
    contract_id: 'c-1' as ContractId,
    execution_contract_id: 'ec-1' as ExecutionContractId,
    plan_hash: computePlanHash(samplePlan),
    command_set_hash: computeCommandSetHash(sampleCommands),
    runtime_digest: 'registry.local/sandbox@sha256:' + 'a'.repeat(64),
    platform_digest: 'linux/amd64',
    expires_at: '2026-08-21T12:00:00.000Z',
  };

  it('computes exact deterministic authorization hash', () => {
    const hash1 = computeAuthorizationHash(samplePayload);
    const hash2 = computeAuthorizationHash(samplePayload);
    expect(hash1).toBe(hash2);
    expect(hash1).toMatch(/^[0-9a-f]{64}$/);
  });

  it('detects changes in command argv or environment', () => {
    const hash1 = computeCommandSetHash(sampleCommands);
    const firstCmd = sampleCommands[0];
    expect(firstCmd).toBeDefined();
    if (!firstCmd) return;

    const modifiedCommands: readonly ExecutionCommandDeclaration[] = [
      {
        ...firstCmd,
        argv: ['python3', '-m', 'forecast_v2'],
      },
    ];
    const hash2 = computeCommandSetHash(modifiedCommands);
    expect(hash1).not.toBe(hash2);
  });
});
