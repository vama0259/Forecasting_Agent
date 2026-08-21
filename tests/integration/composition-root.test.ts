/**
 * Purpose: Integration test for application composition root wiring and lifecycle.
 * Responsibility: Verify bootstrap, singleton lock acquisition, and clean shutdown.
 * Inputs/outputs: AppConfig; assertions on initialized AppContext and clean shutdown.
 * Excludes: External network RPC calls.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { createApp, type AppContext } from '../../src/app/composition-root.js';

describe('Composition Root Integration Tests', () => {
  let tempBaseDir: string;
  let app: AppContext | null = null;

  beforeEach(() => {
    tempBaseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'app-comp-test-'));
  });

  afterEach(async () => {
    if (app) {
      await app.shutdown();
      app = null;
    }
    if (fs.existsSync(tempBaseDir)) {
      fs.rmSync(tempBaseDir, { recursive: true, force: true });
    }
  });

  it('initializes, reconciles, and cleanly shuts down application', async () => {
    app = await createApp({
      artifactStoreDir: path.join(tempBaseDir, 'store'),
      stagingDir: path.join(tempBaseDir, 'staging'),
    });

    expect(app.pool).toBeDefined();
    expect(app.broker).toBeDefined();
    expect(app.artifactStore).toBeDefined();
    expect(app.storageRepo).toBeDefined();
    expect(app.executionRepo).toBeDefined();
    expect(app.reconstructionEngine).toBeDefined();
    expect(app.backupService).toBeDefined();

    // Verify broker singleton lock is held (second acquire should fail)
    await expect(app.brokerLock.acquire()).rejects.toThrow(
      /Failed to acquire BROKER_SINGLETON advisory lock/,
    );
  });
});
