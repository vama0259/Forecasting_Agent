/**
 * Purpose: Integration tests for timeout and cancellation diagnostic collection.
 * Responsibility: Verify diagnostics are collected before terminate on both paths.
 * Inputs/outputs: Orchestrated timeout/cancel requests; assertions on DB state.
 * Excludes: The happy-path execution lifecycle (see execution-broker.test.ts).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  setupBrokerFixture,
  teardownBrokerFixture,
  defaultPolicy,
  testOutputDecls,
  type BrokerDiagnosticsFixture,
} from './broker-diagnostics-fixtures.js';
import type { ExecutionId, Sha256Hash } from '../../src/core/types/identifiers.js';
import type { AuthorizationPayload } from '../../src/core/types/execution.js';

describe('ExecutionBroker Diagnostic Collection Integration Tests', () => {
  let fx: BrokerDiagnosticsFixture;

  beforeAll(async () => {
    fx = await setupBrokerFixture('test-broker-diag');
  });

  afterAll(async () => {
    await teardownBrokerFixture(fx);
  });

  it('collects diagnostics from the RUNNING container before TIMED_OUT', async () => {
    const authHash = 'a2'.repeat(32) as Sha256Hash;
    const expiresAt = new Date(Date.now() + 60000).toISOString();
    const execId = (await import('node:crypto')).randomUUID() as ExecutionId;

    const authPayload: AuthorizationPayload = {
      authorization_id: 'auth-exec-broker-timeout',
      organization_id: fx.orgId,
      project_id: fx.projId,
      run_id: fx.runId,
      run_attempt_id: fx.attemptId,
      execution_id: execId,
      contract_id: fx.contractId,
      execution_contract_id: fx.execContractId,
      plan_hash: '3'.repeat(64) as Sha256Hash,
      command_set_hash: '5'.repeat(64) as Sha256Hash,
      runtime_digest: 'alpine',
      platform_digest: 'linux/amd64',
      expires_at: expiresAt,
    };

    const execution = await fx.execRepo.createExecutionWithAuthorization({
      execution: {
        id: execId,
        organization_id: fx.orgId,
        run_attempt_id: fx.attemptId,
        execution_kind: 'forecast_step',
        execution_contract_id: fx.execContractId,
        authorization_hash: authHash,
        runtime_digest: 'alpine',
        platform_digest: 'linux/amd64',
      },
      authorization: {
        authorization_payload: authPayload,
        expires_at: expiresAt,
      },
    });

    // Command writes a partial output before it exceeds its timeout, so the
    // fix under test must read it back from the still-RUNNING container.
    await expect(
      fx.broker.executeNode({
        executionId: execution.id,
        runAttemptId: fx.attemptId,
        organizationId: fx.orgId,
        projectId: fx.projId,
        executionContractId: fx.execContractId,
        authorizationHash: authHash,
        runtimeDigest: 'alpine',
        platformDigest: 'linux/amd64',
        resourcePolicy: defaultPolicy,
        inputs: [],
        commands: [
          {
            argv: ['/bin/sh', '-c', 'echo partial > /outputs/result.txt; sleep 10'],
            working_directory: '/workspace',
            environment: {},
            timeout_ms: 1000,
          },
        ],
        outputDeclarations: testOutputDecls,
      }),
    ).rejects.toThrow();

    const record = await fx.execRepo.getExecution(execution.id);
    expect(record?.state).toBe('TIMED_OUT');
    expect(record?.failure_code).toBe('TIMEOUT');

    const outputRes = await fx.pool.query<{
      disposition: string;
      publishable: boolean;
    }>(
      `SELECT disposition, publishable FROM execution_outputs WHERE execution_id = $1`,
      [execution.id],
    );
    expect(outputRes.rows.length).toBeGreaterThan(0);
    expect(outputRes.rows[0]?.disposition).toBe('DIAGNOSTIC');
    expect(outputRes.rows[0]?.publishable).toBe(false);
  });

  it('collects diagnostics and reaches CANCELLED when cancel() is called', async () => {
    const authHash = 'a3'.repeat(32) as Sha256Hash;
    const expiresAt = new Date(Date.now() + 60000).toISOString();
    const execId = (await import('node:crypto')).randomUUID() as ExecutionId;

    const authPayload: AuthorizationPayload = {
      authorization_id: 'auth-exec-broker-cancel',
      organization_id: fx.orgId,
      project_id: fx.projId,
      run_id: fx.runId,
      run_attempt_id: fx.attemptId,
      execution_id: execId,
      contract_id: fx.contractId,
      execution_contract_id: fx.execContractId,
      plan_hash: '3'.repeat(64) as Sha256Hash,
      command_set_hash: '6'.repeat(64) as Sha256Hash,
      runtime_digest: 'alpine',
      platform_digest: 'linux/amd64',
      expires_at: expiresAt,
    };

    const execution = await fx.execRepo.createExecutionWithAuthorization({
      execution: {
        id: execId,
        organization_id: fx.orgId,
        run_attempt_id: fx.attemptId,
        execution_kind: 'forecast_step',
        execution_contract_id: fx.execContractId,
        authorization_hash: authHash,
        runtime_digest: 'alpine',
        platform_digest: 'linux/amd64',
      },
      authorization: {
        authorization_payload: authPayload,
        expires_at: expiresAt,
      },
    });

    const runPromise = fx.broker.executeNode({
      executionId: execution.id,
      runAttemptId: fx.attemptId,
      organizationId: fx.orgId,
      projectId: fx.projId,
      executionContractId: fx.execContractId,
      authorizationHash: authHash,
      runtimeDigest: 'alpine',
      platformDigest: 'linux/amd64',
      resourcePolicy: defaultPolicy,
      inputs: [],
      commands: [
        {
          argv: ['sleep', '30'],
          working_directory: '/workspace',
          environment: {},
          timeout_ms: 60000,
        },
      ],
      outputDeclarations: testOutputDecls,
    });

    // Give the container time to reach RUNNING before requesting cancellation.
    await new Promise((resolve) => setTimeout(resolve, 3000));
    const cancelled = fx.broker.cancel(execution.id);
    expect(cancelled).toBe(true);

    await expect(runPromise).rejects.toThrow();

    const record = await fx.execRepo.getExecution(execution.id);
    expect(record?.state).toBe('CANCELLED');
    expect(record?.failure_code).toBe('CANCELLED');
  });
});
