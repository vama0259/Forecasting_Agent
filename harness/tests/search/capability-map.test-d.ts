// Type-level pins for #21: CapabilityMap must expose search as a callable SearchCapability, and the
// agent-facing interface must not reach run lifecycle. Checked by `pnpm typecheck`, never executed.

import { CapabilityRegistry } from '../../src/capabilities/registry.js';
import type { SearchCapability, SearchRunLifecycle } from '../../src/search/types.js';

declare const registry: CapabilityRegistry;

// Fails with TS2339 until CapabilityMap.search is narrowed from CapabilityProvider to SearchCapability.
void registry.resolve('search').search('run-1', 'q');

declare const concrete: SearchCapability & SearchRunLifecycle;

const forAgent: SearchCapability = concrete;
void forAgent.search('run-1', 'q');

// @ts-expect-error -- Interface Segregation: run lifecycle must be unreachable through the agent-facing type.
void forAgent.beginRun('run-1');

const forPipeline: SearchRunLifecycle = concrete;
void forPipeline.beginRun('run-1');
void forPipeline.endRun('run-1');
