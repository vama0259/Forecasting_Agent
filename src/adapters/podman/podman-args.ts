/**
 * Purpose: Builder functions for Podman CLI arguments with hardening options.
 * Responsibility: Generate command-line arguments for create, exec, and inspect.
 * Inputs/outputs: Provision and command requests; returns argv string arrays.
 * Excludes: Child process spawning and container status polling.
 */

import type { CommandRequest, ProvisionRequest } from '../../core/types/execution.js';

/**
 * Builds the hardened argument array for the podman create subcommand.
 * Returns array of CLI arguments enforcing non-root, read-only rootfs, and tmpfs.
 */
export function buildCreateArgs(request: ProvisionRequest): string[] {
  const containerName = `sandbox-${request.execution_id}`;
  const policy = request.resource_policy;

  const wsBytes = policy.tmpfs_workspace_bytes;
  const outBytes = policy.tmpfs_outputs_bytes;
  const tmpBytes = policy.tmpfs_tmp_bytes;
  const homeBytes = policy.tmpfs_home_bytes;
  const memBytes = policy.memory_bytes;
  const pidsLimit = policy.pids_limit;

  const args: string[] = [
    'create',
    '--name',
    containerName,
    '--label',
    'io.forecasting.foundation.managed-by=broker',
    '--label',
    `io.forecasting.foundation.execution-id=${request.execution_id}`,
    '--label',
    `io.forecasting.foundation.run-attempt-id=${request.run_attempt_id}`,
    '--label',
    `io.forecasting.foundation.created-at=${new Date().toISOString()}`,
    '--network',
    'none',
    '--cap-drop',
    'ALL',
    '--security-opt',
    'no-new-privileges:true',
    '--read-only',
    '--user',
    '65534:65534',
    '--tmpfs',
    `/workspace:rw,noexec,nosuid,nodev,size=${wsBytes}`,
    '--tmpfs',
    `/outputs:rw,noexec,nosuid,nodev,size=${outBytes}`,
    '--tmpfs',
    `/tmp:rw,noexec,nosuid,nodev,size=${tmpBytes}`,
    '--tmpfs',
    `/home/sandbox:rw,noexec,nosuid,nodev,size=${homeBytes}`,
    '--workdir',
    '/workspace',
    '--memory',
    `${memBytes}b`,
    '--memory-swap',
    `${memBytes}b`,
    '--pids-limit',
    `${pidsLimit}`,
  ];

  if (request.input_mounts) {
    for (const mount of request.input_mounts) {
      args.push(
        '-v',
        `${mount.host_source_path}:${mount.container_destination_path}:ro,Z`,
      );
    }
  }

  args.push(request.runtime_digest, 'sleep', 'infinity');
  return args;
}

/**
 * Builds the argument array for the podman exec subcommand.
 * Returns array of CLI arguments configured with workdir and environment variables.
 */
export function buildExecArgs(containerId: string, command: CommandRequest): string[] {
  const envArgs: string[] = [];
  if (command.environment) {
    for (const [k, v] of Object.entries(command.environment)) {
      envArgs.push('-e', `${k}=${v}`);
    }
  }

  const workdir = command.working_directory || '/workspace';
  return ['exec', '--workdir', workdir, ...envArgs, containerId, ...command.argv];
}
