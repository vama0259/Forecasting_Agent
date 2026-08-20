import { CompositeBackend, StoreBackend } from 'deepagents';
import type { BaseSandbox } from 'deepagents';
import type { BaseStore } from '@langchain/langgraph-checkpoint';

export interface BuildAgentBackendParams {
  // BaseSandbox (not the concrete SandboxBackendAdapter) so callers can pass a TracingSandboxAdapter
  // wrapper -- CompositeBackend only needs the BaseSandbox interface, and the two adapters can't
  // structurally satisfy each other's concrete type (SandboxBackendAdapter's #manager is a private field).
  sandboxAdapter: BaseSandbox;
  store: BaseStore;
  agentName: string;
}

export function buildAgentBackend({ sandboxAdapter, store, agentName }: BuildAgentBackendParams): CompositeBackend {
  return new CompositeBackend(sandboxAdapter, {
    '/memories/': new StoreBackend({
      store,
      namespace: ['memories', agentName],
    }),
  });
}
