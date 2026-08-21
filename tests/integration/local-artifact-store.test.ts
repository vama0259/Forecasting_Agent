/**
 * Purpose: Integration tests for content-addressed LocalArtifactStore.
 * Responsibility: Verify atomic fsync staging, canonical paths, and verified reads.
 * Inputs/outputs: Byte streams and corrupted files; verified files or error assertions.
 * Excludes: Remote S3 storage and network file systems.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { LocalArtifactStore } from '../../src/adapters/storage/local-artifact-store.js';
import {
  ArtifactCorruptedError,
  // error
} from '../../src/core/errors/artifact-corrupted.error.js';
import type {
  OrganizationId,
  // id
} from '../../src/core/types/identifiers.js';

describe('LocalArtifactStore Integration', () => {
  let tempBaseDir: string;
  let store: LocalArtifactStore;
  const testOrgId = 'org-12345' as OrganizationId;

  beforeEach(() => {
    tempBaseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'artifact-store-test-'));
    store = new LocalArtifactStore(tempBaseDir);
  });

  afterEach(() => {
    fs.rmSync(tempBaseDir, { recursive: true, force: true });
  });

  async function* createAsyncStream(chunks: Uint8Array[]): AsyncIterable<Uint8Array> {
    for (const chunk of chunks) {
      yield chunk;
    }
  }

  it('stages and commits a 1 MB payload to canonical path', async () => {
    const chunk = new Uint8Array(1024 * 1024);
    chunk.fill(65);

    const staged = await store.stage(createAsyncStream([chunk]), testOrgId);
    expect(staged.content_bytes).toBe(1024 * 1024);
    expect(staged.organization_id).toBe(testOrgId);
    expect(fs.existsSync(staged.stagingPath)).toBe(true);

    const committed = await store.commit(staged);
    expect(committed.content_bytes).toBe(1024 * 1024);
    expect(committed.content_sha256).toBe(staged.content_sha256);
    expect(committed.key.organization_id).toBe(testOrgId);

    const firstTwo = committed.content_sha256.slice(0, 2);
    const expectedDiskPath = path.join(
      tempBaseDir,
      'artifacts',
      testOrgId,
      'sha256',
      firstTwo,
      committed.content_sha256,
    );
    expect(fs.existsSync(expectedDiskPath)).toBe(true);

    const exists = await store.exists({
      organization_id: testOrgId,
      content_sha256: committed.content_sha256,
    });
    expect(exists).toBe(true);
  });

  it('isolates artifacts across different organizations', async () => {
    const orgA = 'org-alpha' as OrganizationId;
    const orgB = 'org-beta' as OrganizationId;
    const encoder = new TextEncoder();
    const data = encoder.encode('tenant-isolated-payload');

    const stagedA = await store.stage(createAsyncStream([data]), orgA);
    const committedA = await store.commit(stagedA);

    expect(
      await store.exists({
        organization_id: orgA,
        content_sha256: committedA.content_sha256,
      }),
    ).toBe(true);

    expect(
      await store.exists({
        organization_id: orgB,
        content_sha256: committedA.content_sha256,
      }),
    ).toBe(false);
  });

  it('detects tampering and removes incomplete file', async () => {
    const encoder = new TextEncoder();
    const data = encoder.encode('original authentic content');

    const staged = await store.stage(createAsyncStream([data]), testOrgId);
    const committed = await store.commit(staged);

    const firstTwo = committed.content_sha256.slice(0, 2);
    const diskPath = path.join(
      tempBaseDir,
      'artifacts',
      testOrgId,
      'sha256',
      firstTwo,
      committed.content_sha256,
    );

    fs.writeFileSync(diskPath, 'tampered malicious content');

    const destination = path.join(tempBaseDir, 'materialized.txt');
    await expect(
      store.materializeVerified(
        {
          organization_id: testOrgId,
          content_sha256: committed.content_sha256,
        },
        { sha256: committed.content_sha256, byteLength: data.byteLength },
        destination,
      ),
    ).rejects.toThrow(ArtifactCorruptedError);

    expect(fs.existsSync(destination)).toBe(false);
  });

  it('unlinks staging file if stream fails mid-write', async () => {
    async function* failingStream(): AsyncIterable<Uint8Array> {
      yield new Uint8Array([1, 2, 3]);
      throw new Error('Simulated network failure mid-stream');
    }

    await expect(store.stage(failingStream(), testOrgId)).rejects.toThrow(
      'Simulated network failure mid-stream',
    );

    const tmpDir = path.join(tempBaseDir, '.tmp');
    if (fs.existsSync(tmpDir)) {
      const files = fs.readdirSync(tmpDir);
      expect(files).toHaveLength(0);
    }
  });

  it('streams 5 MB payload with chunked backpressure', async () => {
    async function* multiChunkStream(): AsyncIterable<Uint8Array> {
      for (let i = 0; i < 5; i++) {
        const chunk = new Uint8Array(1024 * 1024);
        chunk.fill(66 + i);
        yield chunk;
      }
    }

    const staged = await store.stage(multiChunkStream(), testOrgId);
    expect(staged.content_bytes).toBe(5 * 1024 * 1024);
    const committed = await store.commit(staged);
    expect(committed.content_bytes).toBe(5 * 1024 * 1024);
  });
});
