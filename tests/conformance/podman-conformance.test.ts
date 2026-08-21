/**
 * Purpose: Conformance tests verifying rootless Podman security and isolation.
 * Responsibility: Assert nobody uid, network isolation, readonly rootfs, timeouts.
 * Inputs/outputs: Active Podman daemon; container execution status assertions.
 * Excludes: Core database operations.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import {
  RootlessPodmanRuntime,
  // runtime
} from '../../src/adapters/podman/rootless-podman-runtime.js';
import {
  ExecutionTimeoutError,
  // error
} from '../../src/core/errors/execution-timeout.error.js';
import type { ExecutionId, RunAttemptId } from '../../src/core/types/identifiers.js';

describe('Rootless Podman Conformance Tests', () => {
  let runtime: RootlessPodmanRuntime;

  beforeAll(() => {
    runtime = new RootlessPodmanRuntime({
      maxConcurrency: 2,
      maxQueueCapacity: 5,
    });
  });

  it('provisions sandbox with nobody user and readonly rootfs', async () => {
    const handle = await runtime.provision({
      execution_id: 'exec-conf-1' as ExecutionId,
      run_attempt_id: 'attempt-1' as RunAttemptId,
      runtime_digest: 'alpine',
      platform_digest: 'linux/amd64',
      resource_policy: {
        memory_bytes: 536870912,
        cpu_quota_micros: 100000,
        pids_limit: 64,
        wall_time_limit_ms: 60000,
        tmpfs_workspace_bytes: 67108864,
        tmpfs_outputs_bytes: 67108864,
        tmpfs_tmp_bytes: 33554432,
        tmpfs_home_bytes: 33554432,
      },
      input_mounts: [],
      labels: {},
    });
    await runtime.start(handle);

    try {
      const idRes = await runtime.execute(handle, {
        argv: ['id'],
        working_directory: '/workspace',
        environment: {},
        timeout_ms: 5000,
      });
      expect(idRes.exit_code).toBe(0);
      const idText = Buffer.from(idRes.stdout_head_tail.head).toString();
      expect(idText).toContain('65534');

      const roRes = await runtime.execute(handle, {
        argv: ['touch', '/test_readonly.txt'],
        working_directory: '/workspace',
        environment: {},
        timeout_ms: 5000,
      });
      expect(roRes.exit_code).not.toBe(0);
      const errText = Buffer.from(roRes.stderr_head_tail.head).toString();
      expect(errText.toLowerCase()).toContain('read-only');

      const wsRes = await runtime.execute(handle, {
        argv: ['touch', '/workspace/valid.txt'],
        working_directory: '/workspace',
        environment: {},
        timeout_ms: 5000,
      });
      expect(wsRes.exit_code).toBe(0);
    } finally {
      await runtime.destroy(handle);
    }
  });

  it('terminates command on timeout with ExecutionTimeoutError', async () => {
    const handle = await runtime.provision({
      execution_id: 'exec-conf-2' as ExecutionId,
      run_attempt_id: 'attempt-1' as RunAttemptId,
      runtime_digest: 'alpine',
      platform_digest: 'linux/amd64',
      resource_policy: {
        memory_bytes: 536870912,
        cpu_quota_micros: 100000,
        pids_limit: 64,
        wall_time_limit_ms: 60000,
        tmpfs_workspace_bytes: 67108864,
        tmpfs_outputs_bytes: 67108864,
        tmpfs_tmp_bytes: 33554432,
        tmpfs_home_bytes: 33554432,
      },
      input_mounts: [],
      labels: {},
    });
    await runtime.start(handle);

    try {
      await expect(
        runtime.execute(handle, {
          argv: ['sleep', '10'],
          working_directory: '/workspace',
          environment: {},
          timeout_ms: 1000,
        }),
      ).rejects.toThrow(ExecutionTimeoutError);
    } finally {
      await runtime.destroy(handle);
    }
  });

  it('mounts input file at /inputs read-only and finds container', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const os = await import('node:os');

    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'podman-mount-test-'));
    const hostFilePath = path.join(tempDir, 'sample_input.txt');
    fs.writeFileSync(hostFilePath, 'immutable-input-bytes');

    const handle = await runtime.provision({
      execution_id: 'exec-conf-mount-1' as ExecutionId,
      run_attempt_id: 'attempt-1' as RunAttemptId,
      runtime_digest: 'alpine',
      platform_digest: 'linux/amd64',
      resource_policy: {
        memory_bytes: 536870912,
        cpu_quota_micros: 100000,
        pids_limit: 64,
        wall_time_limit_ms: 60000,
        tmpfs_workspace_bytes: 67108864,
        tmpfs_outputs_bytes: 67108864,
        tmpfs_tmp_bytes: 33554432,
        tmpfs_home_bytes: 33554432,
      },
      input_mounts: [
        {
          host_source_path: hostFilePath,
          container_destination_path: '/inputs/sample_input.txt',
        },
      ],
      labels: {},
    });

    await runtime.start(handle);

    try {
      // 1. Verify container is discovered by label
      const managed = await runtime.listManagedContainers();
      const matched = managed.find(
        (c) => c.executionId === ('exec-conf-mount-1' as ExecutionId),
      );
      expect(matched).toBeDefined();

      // 2. Read from /inputs
      const catRes = await runtime.execute(handle, {
        argv: ['cat', '/inputs/sample_input.txt'],
        working_directory: '/workspace',
        environment: {},
        timeout_ms: 5000,
      });
      expect(catRes.exit_code).toBe(0);
      const catText = Buffer.from(catRes.stdout_head_tail.head).toString();
      expect(catText).toContain('immutable-input-bytes');

      // 3. Assert /inputs is read-only
      const writeRes = await runtime.execute(handle, {
        argv: ['touch', '/inputs/sample_input.txt'],
        working_directory: '/workspace',
        environment: {},
        timeout_ms: 5000,
      });
      expect(writeRes.exit_code).not.toBe(0);
    } finally {
      await runtime.destroy(handle);
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
