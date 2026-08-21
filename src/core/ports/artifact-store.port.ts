/**
 * Purpose: Consumer-owned port interface for immutable artifact storage.
 * Responsibility: Define contracts for streaming staging, commit, and verified reading.
 * Inputs/outputs: Readable streams and expected content descriptors; committed handles.
 * Excludes: Filesystem paths, directory manipulation, and cloud SDK calls.
 */

import type {
  ArtifactKey,
  CommittedObject,
  ExpectedContent,
  StagedObject,
  VerifiedFile,
} from '../types/artifacts.js';
import type { OrganizationId } from '../types/identifiers.js';

/**
 * Interface defining content-addressed immutable artifact storage operations.
 */
export interface ArtifactStore {
  /**
   * Stages an incoming byte stream to a temporary location and computes SHA-256.
   * Returns StagedObject descriptor or throws ArtifactCorruptedError on mismatch.
   */
  stage(
    input: AsyncIterable<Uint8Array>,
    organization_id: OrganizationId,
    expected?: ExpectedContent,
  ): Promise<StagedObject>;

  /**
   * Atomically commits a staged object into content-addressed immutable storage.
   * Returns CommittedObject descriptor with canonical storage key.
   */
  commit(staged: StagedObject): Promise<CommittedObject>;

  /**
   * Streams and cryptographically verifies an artifact into a target destination.
   * Returns VerifiedFile on success or throws ArtifactCorruptedError on mismatch.
   */
  materializeVerified(
    key: ArtifactKey,
    expected: ExpectedContent,
    destinationPath: string,
  ): Promise<VerifiedFile>;

  /**
   * Checks whether an artifact with the given key exists in immutable storage.
   * Returns true if present on disk/storage, false otherwise.
   */
  exists(key: ArtifactKey): Promise<boolean>;
}
