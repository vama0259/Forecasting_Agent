/**
 * Purpose: Inspect and discover Podman containers and their runtime statuses.
 * Responsibility: Parse container inspect and listing output for broker containers.
 * Inputs/outputs: Container IDs or filter labels; returns RuntimeState or ManagedInfo.
 * Excludes: Container provisioning and argument construction.
 */

import type { ManagedContainerInfo, RuntimeState } from '../../core/types/execution.js';
import type { ExecutionId, RunAttemptId } from '../../core/types/identifiers.js';
import { runPodman } from './podman-process.js';

interface ContainerInspectState {
  readonly Running: boolean;
  readonly OOMKilled: boolean;
  readonly ExitCode: number;
  readonly Status: string;
  readonly StartedAt?: string;
  readonly FinishedAt?: string;
}

interface ContainerInspectData {
  readonly State: ContainerInspectState;
}

/**
 * Inspects lifecycle state and exit status of a Podman container.
 * Returns normalized RuntimeState descriptor.
 */
export async function inspectContainer(containerId: string): Promise<RuntimeState> {
  const res = await runPodman({
    argv: ['inspect', containerId],
    timeoutMs: 10000,
  });

  if (res.exitCode !== 0) {
    return {
      state: 'FAILED',
      exit_code: null,
      started_at: null,
      finished_at: null,
    };
  }

  try {
    const data = JSON.parse(res.stdout.toString()) as ContainerInspectData[];
    const first = data[0];
    if (!first) {
      return {
        state: 'FAILED',
        exit_code: null,
        started_at: null,
        finished_at: null,
      };
    }
    return {
      state: first.State.Running
        ? 'RUNNING'
        : first.State.ExitCode === 0
          ? 'COMPLETED'
          : 'FAILED',
      exit_code: first.State.ExitCode,
      started_at: first.State.StartedAt ?? null,
      finished_at: first.State.FinishedAt ?? null,
    };
  } catch {
    return {
      state: 'FAILED',
      exit_code: null,
      started_at: null,
      finished_at: null,
    };
  }
}

/**
 * Lists all Podman containers labeled as managed by the broker.
 * Returns array of discovered ManagedContainerInfo records.
 */
export async function listBrokerContainers(): Promise<readonly ManagedContainerInfo[]> {
  const res = await runPodman({
    argv: [
      'ps',
      '-a',
      '--filter',
      'label=io.forecasting.foundation.managed-by=broker',
      '--format',
      'json',
    ],
    timeoutMs: 15000,
  });

  if (res.exitCode !== 0 || !res.stdout.length) {
    return [];
  }

  try {
    const raw = JSON.parse(res.stdout.toString());
    const items = Array.isArray(raw) ? raw : [raw];
    return items.map(
      (item: { Id?: string; ID?: string; Labels?: Record<string, string> }) => {
        const labels = item.Labels ?? {};
        const execId = labels['io.forecasting.foundation.execution-id'] as
          ExecutionId | undefined;
        const runAttemptId = labels['io.forecasting.foundation.run-attempt-id'] as
          RunAttemptId | undefined;

        return {
          containerId: item.Id ?? item.ID ?? '',
          executionId: execId,
          runAttemptId,
          labels,
        };
      },
    );
  } catch {
    return [];
  }
}
