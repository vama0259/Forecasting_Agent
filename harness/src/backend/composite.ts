import { CompositeBackend, StoreBackend } from 'deepagents';
import type { BaseStore } from '@langchain/langgraph-checkpoint';
import type { SandboxBackendAdapter } from '../sandbox/deepagents-adapter.js';

export interface BuildAgentBackendParams {
  sandboxAdapter: SandboxBackendAdapter;
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
