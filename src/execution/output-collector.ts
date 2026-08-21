/**
 * Purpose: Output collection coordinator streaming artifacts from live containers.
 * Responsibility: Enforce live-container collection invariant, persist outputs.
 * Inputs/outputs: Runtime handle, output declarations; returns ArtifactVersionRecords.
 * Excludes: Top-level plan sequencing and command dispatching.
 */

import type {
  CollectedOutput,
  SandboxRuntime,
} from '../core/ports/sandbox-runtime.port.js';
import type { ArtifactStore } from '../core/ports/artifact-store.port.js';
import type { StorageRepository } from '../core/ports/storage-repository.port.js';
import type { ExecutionRepository } from '../core/ports/execution-repository.port.js';
import type {
  ExecutionId,
  OrganizationId,
  ProjectId,
  Sha256Hash,
} from '../core/types/identifiers.js';
import type { OutputDeclaration, RuntimeHandle } from '../core/types/execution.js';
import type { ArtifactVersionRecord } from '../core/types/artifacts.js';
import { sha256Hex } from '../core/utils/crypto-hash.js';

/** Parameters for collecting and persisting declared execution outputs. */
export interface CollectOutputsParams {
  readonly handle: RuntimeHandle;
  readonly organizationId: OrganizationId;
  readonly projectId: ProjectId;
  readonly executionId: ExecutionId;
  readonly declarations: readonly OutputDeclaration[];
}

/**
 * Collects and persists declared output artifacts from running sandbox containers.
 */
export class OutputCollector {
  private readonly runtime: SandboxRuntime;
  private readonly artifactStore: ArtifactStore;
  private readonly storageRepo: StorageRepository;
  private readonly executionRepo: ExecutionRepository;

  /**
   * Initializes OutputCollector with runtime, store, and database repositories.
   * Sets local port references.
   */
  constructor(
    runtime: SandboxRuntime,
    artifactStore: ArtifactStore,
    storageRepo: StorageRepository,
    executionRepo: ExecutionRepository,
  ) {
    this.runtime = runtime;
    this.artifactStore = artifactStore;
    this.storageRepo = storageRepo;
    this.executionRepo = executionRepo;
  }

  /**
   * Collects all declared outputs from a running container, enforcing active state.
   * Returns list of created ArtifactVersionRecords.
   */
  async collectOutputs(
    params: CollectOutputsParams,
  ): Promise<readonly ArtifactVersionRecord[]> {
    const inspectState = await this.runtime.inspect(params.handle);
    if (inspectState.state !== 'RUNNING') {
      throw new Error(
        `Output collection violated live-container invariant: ` +
          `container state is "${inspectState.state}"`,
      );
    }

    const collectedOutputs = await this.runtime.collect(
      params.handle,
      params.declarations,
    );

    return this.persistCollected(params, collectedOutputs, {
      disposition: 'DECLARED',
      publishable: true,
    });
  }

  /**
   * Best-effort collects bounded logs and readable outputs from a terminating
   * container before it is stopped, tolerating a container that already exited.
   * Returns partial diagnostic ArtifactVersionRecords; never throws on missing
   * or unreadable outputs and never requires the container to still be RUNNING.
   */
  async collectDiagnostics(
    params: CollectOutputsParams,
  ): Promise<readonly ArtifactVersionRecord[]> {
    let inspectState;
    try {
      inspectState = await this.runtime.inspect(params.handle);
    } catch {
      return [];
    }

    if (inspectState.state !== 'RUNNING') {
      return [];
    }

    let collectedOutputs;
    try {
      collectedOutputs = await this.runtime.collect(params.handle, params.declarations);
    } catch {
      return [];
    }

    return this.persistCollected(params, collectedOutputs, {
      disposition: 'DIAGNOSTIC',
      publishable: false,
      tolerateFailures: true,
    });
  }

  /**
   * Streams, hashes, stages, and persists collected output descriptors.
   * Returns created ArtifactVersionRecords; skips entries that fail when
   * tolerateFailures is set, otherwise propagates the first error.
   */
  private async persistCollected(
    params: CollectOutputsParams,
    collectedOutputs: readonly CollectedOutput[],
    disposition: {
      readonly disposition: 'DECLARED' | 'DIAGNOSTIC';
      readonly publishable: boolean;
      readonly tolerateFailures?: boolean;
    },
  ): Promise<readonly ArtifactVersionRecord[]> {
    const versionRecords: ArtifactVersionRecord[] = [];

    for (const collected of collectedOutputs) {
      try {
        const chunks: Uint8Array[] = [];
        for await (const chunk of collected.stream) {
          chunks.push(chunk);
        }
        const fullBuffer = Buffer.concat(chunks);
        const hash = sha256Hex(fullBuffer) as Sha256Hash;
        const bytes = fullBuffer.length;

        async function* streamFromBuffer(): AsyncIterable<Uint8Array> {
          yield fullBuffer;
        }

        const staged = await this.artifactStore.stage(
          streamFromBuffer(),
          params.organizationId,
          { sha256: hash, byteLength: bytes },
        );

        const committed = await this.artifactStore.commit(staged);

        const artifact = await this.storageRepo.createArtifact({
          organization_id: params.organizationId,
          project_id: params.projectId,
          kind: 'output',
          logical_name: collected.declaration.declaration_name,
        });

        const version = await this.storageRepo.createArtifactVersion({
          organization_id: params.organizationId,
          artifact_id: artifact.id,
          version: 1,
          state: 'AVAILABLE',
          content_sha256: hash,
          content_bytes: bytes,
          media_type: collected.declaration.media_type,
          storage_key: committed.storage_key,
          available_from: new Date().toISOString(),
          retrieved_at: new Date().toISOString(),
          produced_by_execution_id: params.executionId,
        });

        await this.executionRepo.recordOutput({
          organization_id: params.organizationId,
          execution_id: params.executionId,
          artifact_version_id: version.id,
          disposition: disposition.disposition,
          declaration_name: collected.declaration.declaration_name,
          publishable: disposition.publishable,
        });

        versionRecords.push(version);
      } catch (err) {
        if (!disposition.tolerateFailures) throw err;
      }
    }

    return versionRecords;
  }
}
