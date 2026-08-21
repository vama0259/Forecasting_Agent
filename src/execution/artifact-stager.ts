/**
 * Purpose: Staging coordinator preparing input artifacts for sandbox container mounts.
 * Responsibility: Verify evidence cutoff, materialize verified files, build mounts.
 * Inputs/outputs: Input artifact records and cutoff; returns SandboxInputMounts.
 * Excludes: Container provisioning and process execution.
 */

import * as path from 'node:path';
import * as fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import type { ArtifactStore } from '../core/ports/artifact-store.port.js';
import type { ArtifactKey, ArtifactVersionRecord } from '../core/types/artifacts.js';
import type { ExecutionId, RunAttemptId } from '../core/types/identifiers.js';
import type { SandboxInputMount } from '../core/types/execution.js';
import { assertEvidenceEligible } from '../core/policies/cutoff-policy.js';

/** Input artifact descriptor for staging into the sandbox container. */
export interface StageInputItem {
  readonly artifactVersion: ArtifactVersionRecord;
  readonly targetPath: string;
  readonly cutoffAt: string;
}

/** Configuration options for the ArtifactStager service. */
export interface ArtifactStagerConfig {
  readonly stagingBaseDir?: string;
}

/**
 * Stages and validates input artifacts for sandbox execution runs.
 */
export class ArtifactStager {
  private readonly artifactStore: ArtifactStore;
  private readonly stagingBaseDir: string;

  /**
   * Initializes artifact stager with store port and local staging directory.
   * Sets default staging root in workspace directory if omitted.
   */
  constructor(artifactStore: ArtifactStore, config: ArtifactStagerConfig = {}) {
    this.artifactStore = artifactStore;
    this.stagingBaseDir =
      config.stagingBaseDir ?? path.resolve(process.cwd(), 'data', 'staging');
  }

  /**
   * Stages multiple input artifacts, verifying point-in-time cutoff and integrity.
   * Returns list of host-to-container mount configurations.
   */
  async stageInputs(params: {
    readonly executionId: ExecutionId;
    readonly runAttemptId: RunAttemptId;
    readonly inputs: readonly StageInputItem[];
  }): Promise<readonly SandboxInputMount[]> {
    const execStagingDir = path.join(this.stagingBaseDir, params.executionId);
    fs.mkdirSync(execStagingDir, { recursive: true });

    // Apply Fedora SELinux private container relabel to staging directory
    try {
      execFileSync('chcon', ['-Rt', 'container_file_t', execStagingDir], {
        stdio: 'ignore',
      });
    } catch {
      // Ignored if chcon is not available on non-SELinux environments
    }

    const mounts: SandboxInputMount[] = [];

    for (const item of params.inputs) {
      assertEvidenceEligible(
        item.artifactVersion.available_from,
        item.cutoffAt,
        item.artifactVersion.state,
      );

      const hostDestPath = path.join(execStagingDir, item.targetPath);
      const hostDestDir = path.dirname(hostDestPath);
      fs.mkdirSync(hostDestDir, { recursive: true });

      const artifactKey: ArtifactKey = {
        organization_id: item.artifactVersion.organization_id,
        content_sha256: item.artifactVersion.content_sha256,
      };

      await this.artifactStore.materializeVerified(
        artifactKey,
        {
          sha256: item.artifactVersion.content_sha256,
          byteLength: item.artifactVersion.content_bytes,
        },
        hostDestPath,
      );

      fs.chmodSync(hostDestPath, 0o444);

      mounts.push({
        host_source_path: hostDestPath,
        container_destination_path: path.posix.join('/inputs', item.targetPath),
      });
    }

    return mounts;
  }

  /**
   * Cleans up ephemeral staging files created for an execution.
   * Resolves when staging directory is recursively removed.
   */
  async cleanupStaging(executionId: ExecutionId): Promise<void> {
    const execStagingDir = path.join(this.stagingBaseDir, executionId);
    if (fs.existsSync(execStagingDir)) {
      fs.rmSync(execStagingDir, { recursive: true, force: true });
    }
  }
}
