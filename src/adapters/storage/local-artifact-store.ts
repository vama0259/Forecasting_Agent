/**
 * Purpose: Local filesystem adapter implementing content-addressed ArtifactStore.
 * Responsibility: Provide atomic staging, fsync commits, and verified materialization.
 * Inputs/outputs: Stream chunks and artifact keys; returns staged/committed handles.
 * Excludes: Cloud object stores and database metadata synchronization.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { ArtifactStore } from '../../core/ports/artifact-store.port.js';
import type {
  ArtifactKey,
  CommittedObject,
  ExpectedContent,
  StagedObject,
  VerifiedFile,
} from '../../core/types/artifacts.js';
import type { OrganizationId, Sha256Hash } from '../../core/types/identifiers.js';
import { createSha256Stream } from '../../core/utils/crypto-hash.js';
import { ArtifactCorruptedError } from '../../core/errors/artifact-corrupted.error.js';

/**
 * Local filesystem implementation of content-addressed immutable artifact storage.
 */
export class LocalArtifactStore implements ArtifactStore {
  private readonly baseDir: string;
  private readonly tmpDir: string;

  /**
   * Initializes local artifact store rooted at the specified base directory.
   * Ensures base and tmp staging directories exist.
   */
  constructor(baseDir: string) {
    this.baseDir = path.resolve(baseDir);
    this.tmpDir = path.join(this.baseDir, '.tmp');
    fs.mkdirSync(this.tmpDir, { recursive: true });
  }

  /**
   * Resolves canonical filesystem path for organization and SHA-256 hash.
   * Returns path in format data/artifacts/<org-id>/sha256/<first-2>/<sha256>.
   */
  private getCanonicalPath(orgId: string, sha256: string): string {
    const prefix = sha256.slice(0, 2);
    return path.join(this.baseDir, 'artifacts', orgId, 'sha256', prefix, sha256);
  }

  /**
   * Stages an incoming byte stream to a temporary location and verifies SHA-256.
   * Returns StagedObject descriptor or throws ArtifactCorruptedError on mismatch.
   */
  async stage(
    input: AsyncIterable<Uint8Array>,
    organization_id: OrganizationId,
    expected?: ExpectedContent,
  ): Promise<StagedObject> {
    const stagingFileName = `${randomUUID()}.staging`;
    const stagingPath = path.join(this.tmpDir, stagingFileName);
    const fileHandle = await fs.promises.open(stagingPath, 'w');
    const digester = createSha256Stream();

    try {
      for await (const chunk of input) {
        digester.write(chunk);
        await fileHandle.write(chunk);
      }
      await fileHandle.sync();
    } catch (err) {
      await fileHandle.close();
      if (fs.existsSync(stagingPath)) {
        await fs.promises.unlink(stagingPath);
      }
      throw err;
    }

    await fileHandle.close();

    const actualSha256 = digester.digestHex();
    const actualBytes = digester.byteCount();

    if (expected?.sha256 && expected.sha256 !== actualSha256) {
      await fs.promises.unlink(stagingPath);
      throw new ArtifactCorruptedError('Staged artifact SHA-256 mismatch', {
        expectedSha256: expected.sha256,
        actualSha256,
      });
    }

    if (expected?.byteLength !== undefined && expected.byteLength !== actualBytes) {
      await fs.promises.unlink(stagingPath);
      throw new ArtifactCorruptedError('Staged artifact byte length mismatch', {
        expectedBytes: expected.byteLength,
        actualBytes,
      });
    }

    return {
      stagingPath,
      organization_id,
      content_sha256: actualSha256,
      content_bytes: actualBytes,
    };
  }

  /**
   * Atomically commits a staged object into content-addressed immutable storage.
   * Returns CommittedObject descriptor with canonical storage key.
   */
  async commit(staged: StagedObject): Promise<CommittedObject> {
    const targetPath = this.getCanonicalPath(
      staged.organization_id,
      staged.content_sha256,
    );
    const targetDir = path.dirname(targetPath);
    await fs.promises.mkdir(targetDir, { recursive: true });

    await fs.promises.rename(staged.stagingPath, targetPath);

    return {
      key: {
        organization_id: staged.organization_id,
        content_sha256: staged.content_sha256,
      },
      content_sha256: staged.content_sha256,
      content_bytes: staged.content_bytes,
      storage_key: targetPath,
    };
  }

  /**
   * Streams and cryptographically verifies an artifact into a target destination.
   * Returns VerifiedFile on success or throws ArtifactCorruptedError on mismatch.
   */
  async materializeVerified(
    key: ArtifactKey,
    expected: ExpectedContent,
    destinationPath: string,
  ): Promise<VerifiedFile> {
    const sourcePath = this.getCanonicalPath(key.organization_id, key.content_sha256);
    if (!fs.existsSync(sourcePath)) {
      throw new ArtifactCorruptedError('Source artifact not found in store', {
        expectedSha256: key.content_sha256,
        storageKey: sourcePath,
      });
    }

    const destDir = path.dirname(destinationPath);
    await fs.promises.mkdir(destDir, { recursive: true });

    const tempDest = `${destinationPath}.tmp.${randomUUID()}`;
    const readStream = fs.createReadStream(sourcePath);
    const writeHandle = await fs.promises.open(tempDest, 'w');
    const digester = createSha256Stream();

    try {
      for await (const chunk of readStream) {
        const buffer = chunk instanceof Uint8Array ? chunk : Buffer.from(chunk);
        digester.write(buffer);
        await writeHandle.write(buffer);
      }
      await writeHandle.sync();
    } catch (err) {
      await writeHandle.close();
      if (fs.existsSync(tempDest)) {
        await fs.promises.unlink(tempDest);
      }
      throw err;
    }

    await writeHandle.close();

    const actualSha256 = digester.digestHex();
    const actualBytes = digester.byteCount();

    if (actualSha256 !== key.content_sha256) {
      await fs.promises.unlink(tempDest);
      throw new ArtifactCorruptedError('Materialized file failed SHA-256', {
        expectedSha256: key.content_sha256,
        actualSha256,
      });
    }

    if (expected.byteLength !== undefined && expected.byteLength !== actualBytes) {
      await fs.promises.unlink(tempDest);
      throw new ArtifactCorruptedError('Materialized file size mismatch', {
        expectedBytes: expected.byteLength,
        actualBytes,
      });
    }

    await fs.promises.rename(tempDest, destinationPath);

    return {
      destinationPath,
      content_sha256: actualSha256 as Sha256Hash,
      content_bytes: actualBytes,
    };
  }

  /**
   * Checks whether an artifact with the given key exists in immutable storage.
   * Returns true if present on disk, false otherwise.
   */
  async exists(key: ArtifactKey): Promise<boolean> {
    const targetPath = this.getCanonicalPath(key.organization_id, key.content_sha256);
    try {
      await fs.promises.access(targetPath, fs.constants.F_OK);
      return true;
    } catch {
      return false;
    }
  }
}
