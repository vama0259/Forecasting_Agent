/**
 * Purpose: Integration tests for ArtifactStager service.
 * Responsibility: Verify evidence cutoff gating and verified file materialization.
 * Inputs/outputs: Staged artifact inputs; assertions on filesystem permissions.
 * Excludes: Container runtime process execution.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  LocalArtifactStore,
  // store
} from '../../src/adapters/storage/local-artifact-store.js';
import {
  ArtifactStager,
  // stager
} from '../../src/execution/artifact-stager.js';
import {
  PointInTimeViolationError,
  // error
} from '../../src/core/errors/point-in-time.error.js';
import { sha256Hex } from '../../src/core/utils/crypto-hash.js';
import type {
  ArtifactId,
  ArtifactVersionId,
  ExecutionId,
  OrganizationId,
  RunAttemptId,
  Sha256Hash,
} from '../../src/core/types/identifiers.js';
import type { ArtifactVersionRecord } from '../../src/core/types/artifacts.js';

describe('ArtifactStager Integration Tests', () => {
  const testDir = path.resolve(process.cwd(), 'data', 'test-stager');
  let store: LocalArtifactStore;
  let stager: ArtifactStager;

  beforeAll(() => {
    fs.mkdirSync(testDir, { recursive: true });
    store = new LocalArtifactStore(path.join(testDir, 'store'));
    stager = new ArtifactStager(store, {
      stagingBaseDir: path.join(testDir, 'staging'),
    });
  });

  afterAll(() => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  it('rejects artifact staging if available_from is after cutoff', async () => {
    const payload = Buffer.from('future-data');
    const hash = sha256Hex(payload) as Sha256Hash;
    const orgId = 'org-1' as OrganizationId;
    const staged = await store.stage(
      (async function* () {
        yield payload;
      })(),
      orgId,
      { sha256: hash, byteLength: payload.length },
    );
    const committed = await store.commit(staged);

    const version: ArtifactVersionRecord = {
      id: 'ver-future' as ArtifactVersionId,
      organization_id: orgId,
      artifact_id: 'art-1' as ArtifactId,
      version: 1,
      state: 'AVAILABLE',
      content_sha256: hash,
      content_bytes: payload.length,
      media_type: 'text/plain',
      storage_key: committed.storage_key,
      available_from: '2026-08-22T00:00:00.000Z',
      observed_at: null,
      source_published_at: null,
      retrieved_at: '2026-08-22T00:00:00.000Z',
      produced_by_execution_id: null,
      metadata: {},
      created_at: '2026-08-22T00:00:00.000Z',
    };

    await expect(
      stager.stageInputs({
        executionId: 'exec-1' as ExecutionId,
        runAttemptId: 'attempt-1' as RunAttemptId,
        inputs: [
          {
            artifactVersion: version,
            targetPath: 'data.txt',
            cutoffAt: '2026-08-21T00:00:00.000Z',
          },
        ],
      }),
    ).rejects.toThrow(PointInTimeViolationError);
  });

  it('stages valid artifact and sets read-only permissions', async () => {
    const payload = Buffer.from('valid-historical-data');
    const hash = sha256Hex(payload) as Sha256Hash;
    const orgId = 'org-1' as OrganizationId;
    const staged = await store.stage(
      (async function* () {
        yield payload;
      })(),
      orgId,
      { sha256: hash, byteLength: payload.length },
    );
    const committed = await store.commit(staged);

    const version: ArtifactVersionRecord = {
      id: 'ver-past' as ArtifactVersionId,
      organization_id: orgId,
      artifact_id: 'art-1' as ArtifactId,
      version: 1,
      state: 'AVAILABLE',
      content_sha256: hash,
      content_bytes: payload.length,
      media_type: 'text/plain',
      storage_key: committed.storage_key,
      available_from: '2026-08-20T00:00:00.000Z',
      observed_at: null,
      source_published_at: null,
      retrieved_at: '2026-08-20T00:00:00.000Z',
      produced_by_execution_id: null,
      metadata: {},
      created_at: '2026-08-20T00:00:00.000Z',
    };

    const mounts = await stager.stageInputs({
      executionId: 'exec-2' as ExecutionId,
      runAttemptId: 'attempt-1' as RunAttemptId,
      inputs: [
        {
          artifactVersion: version,
          targetPath: 'history.txt',
          cutoffAt: '2026-08-21T00:00:00.000Z',
        },
      ],
    });

    expect(mounts).toHaveLength(1);
    const mount = mounts[0];
    expect(mount?.container_destination_path).toBe('/inputs/history.txt');
    expect(fs.existsSync(mount?.host_source_path ?? '')).toBe(true);

    const stat = fs.statSync(mount?.host_source_path ?? '');
    expect(stat.mode & 0o222).toBe(0);

    await stager.cleanupStaging('exec-2' as ExecutionId);
    expect(fs.existsSync(mount?.host_source_path ?? '')).toBe(false);
  });
});
