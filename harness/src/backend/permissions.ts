import type { FilesystemPermission } from 'deepagents';

export function buildAgentPermissions(allowedWritePaths: string[]): FilesystemPermission[] {
  return [
    {
      operations: ['write'],
      paths: allowedWritePaths,
      mode: 'allow',
    },
    {
      operations: ['write'],
      paths: ['/**'],
      mode: 'deny',
    },
    {
      operations: ['read'],
      paths: ['/**'],
      mode: 'allow',
    },
  ];
}
