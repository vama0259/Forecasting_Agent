import { describe, it, expect, vi } from 'vitest';
import { buildAgentPermissions } from '../src/backend/permissions.js';
import { buildAgentBackend } from '../src/backend/composite.js';
import { CompositeBackend } from 'deepagents';
import type { SandboxBackendAdapter } from '../src/sandbox/deepagents-adapter.js';
import type { BaseStore } from '@langchain/langgraph-checkpoint';

describe('Permissions Builder', () => {
  it('generates correct FilesystemPermission rules', () => {
    const allowed = ['/workspace/code/features/price/**', '/workspace/bars.json', '/memories/**'];
    const perms = buildAgentPermissions(allowed);
    expect(perms).toHaveLength(3);
    expect(perms[0]).toEqual({ operations: ['write'], paths: allowed, mode: 'allow' });
    expect(perms[1]).toEqual({ operations: ['write'], paths: ['/**'], mode: 'deny' });
    expect(perms[2]).toEqual({ operations: ['read'], paths: ['/**'], mode: 'allow' });
  });
});

describe('CompositeBackend Builder', () => {
  it('constructs CompositeBackend with default sandbox and memories store route', () => {
    const mockSandbox = { execute: vi.fn(), id: 'test-run' } as unknown as SandboxBackendAdapter;
    const mockStore = { get: vi.fn(), put: vi.fn(), search: vi.fn(), batch: vi.fn() } as unknown as BaseStore;

    const backend = buildAgentBackend({
      sandboxAdapter: mockSandbox,
      store: mockStore,
      agentName: 'price',
    });

    expect(backend).toBeInstanceOf(CompositeBackend);
    expect(backend.routePrefixes).toContain('/memories/');
  });
});
