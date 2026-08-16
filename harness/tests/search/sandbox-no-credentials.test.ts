// Tests ensuring sandbox containers never receive AnySearch API credentials in their environment.

import { describe, it, expect, beforeAll } from 'vitest';
import Dockerode from 'dockerode';
import { SandboxManager } from '../../src/sandbox/manager.js';

let dockerAvailable = false;
beforeAll(async () => {
  try {
    const d = new Dockerode();
    await d.ping();
    dockerAvailable = true;
  } catch {
    dockerAvailable = false;
  }
});

describe('Sandbox container credential isolation', () => {
  it('creates warm container with no ANYSEARCH_* environment variables', async (ctx) => {
    if (!dockerAvailable) {
      ctx.skip();
      return;
    }

    const runId = `test-creds-${Date.now()}`;
    const mgr = new SandboxManager();
    const docker = new Dockerode();

    try {
      await mgr.runExplore({ runId, code: 'echo isolation-check', tier: 'explore' });

      const containers = await docker.listContainers({
        all: true,
        filters: { label: [`sandbox.run_id=${runId}`] },
      });

      expect(containers.length).toBeGreaterThan(0);
      const containerInfo = await docker.getContainer(containers[0]!.Id).inspect();
      const envVars = containerInfo.Config.Env ?? [];

      const anySearchEnvVars = envVars.filter((v: string) => v.startsWith('ANYSEARCH_'));
      expect(anySearchEnvVars).toEqual([]);
    } finally {
      await mgr.disposeRun(runId);
      await mgr.shutdown();
    }
  });
});
