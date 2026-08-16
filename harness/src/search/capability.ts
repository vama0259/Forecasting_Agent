// Orchestrates search caching, budget ledger metering, allowlist filtering, and observation persistence.

import type { CapabilityProvider } from '../capabilities/types.js';
import type { SearchObservation } from '../storage/types.js';
import type { DomainAllowlist } from './allowlist.js';
import type { SearchBudgetLedger } from './budget.js';
import type { RunScopedSearchCache } from './cache.js';
import type { AnySearchProvider } from './provider.js';
import type { SearchCapability, SearchOutcome, SearchRunLifecycle } from './types.js';

// Dependencies required to construct and operate an AnySearchCapability orchestrator.
export interface AnySearchCapabilityDeps {
  provider: AnySearchProvider;
  allowlist: DomainAllowlist;
  ledger: SearchBudgetLedger;
  cache: RunScopedSearchCache;
  saveObservations: (rows: SearchObservation[]) => Promise<void>;
  initialBudget: number;
}

// Coordinates search provider calls with run-scoped caching, quota budgeting, allowlist rules, and storage.
export class AnySearchCapability implements SearchCapability, SearchRunLifecycle, CapabilityProvider {
  private readonly deps: AnySearchCapabilityDeps;
  readonly #localDegraded = new Set<string>();

  constructor(deps: AnySearchCapabilityDeps) {
    this.deps = deps;
  }

  // Checks whether the specified run is marked as degraded in Redis or in the process-local set.
  async #isDegraded(runId: string): Promise<boolean> {
    const redisDegraded = await this.deps.ledger.isDegraded(runId);
    return redisDegraded || this.#localDegraded.has(runId);
  }

  // Claims the initial search quota allocation for a run, returning the number of granted units.
  async beginRun(runId: string): Promise<number> {
    const res = await this.deps.ledger.claim(runId, this.deps.initialBudget);
    return res.granted;
  }

  // Releases unused budget allocation for a run and clears the local degradation tracking flag.
  async endRun(runId: string): Promise<number> {
    const refunded = await this.deps.ledger.release(runId);
    this.#localDegraded.delete(runId);
    return refunded;
  }

  // Delegates health check execution directly to the underlying search provider.
  async healthCheck(signal?: AbortSignal): Promise<void> {
    await this.deps.provider.healthCheck(signal);
  }

  // Executes a search query with caching, budget deduction, domain allowlist filtering, and DB persistence.
  async search(runId: string, query: string): Promise<SearchOutcome> {
    const normalised = this.deps.cache.normalise(query);
    const cached = await this.deps.cache.get(runId, normalised);
    if (cached !== null) {
      return {
        results: cached,
        source: 'cache',
        degraded: await this.#isDegraded(runId),
      };
    }

    const spent = await this.deps.ledger.spend(runId, 1);
    if (spent !== 1) {
      await this.deps.ledger.markDegraded(runId);
      this.#localDegraded.add(runId);
      return {
        results: [],
        source: 'degraded',
        degraded: true,
      };
    }

    const parsed = await this.deps.provider.search(query);
    const { allowed, rejected } = this.deps.allowlist.partition(parsed);
    const now = new Date();

    const observationRows: SearchObservation[] = [
      ...allowed.map((r) => ({
        forecast_run_id: runId,
        query,
        normalized_query: normalised,
        provider: 'anysearch',
        result_rank: r.rank,
        title: r.title,
        url: r.url,
        hostname: r.hostname,
        allowed: true,
        content: r.content,
        retrieved_at: now,
      })),
      ...rejected.map((r) => ({
        forecast_run_id: runId,
        query,
        normalized_query: normalised,
        provider: 'anysearch',
        result_rank: r.rank,
        title: r.title,
        url: r.url,
        hostname: r.hostname,
        allowed: false,
        content: r.content,
        retrieved_at: now,
      })),
    ];

    await this.deps.saveObservations(observationRows);
    await this.deps.cache.set(runId, normalised, allowed);

    return {
      results: allowed,
      source: 'provider',
      degraded: await this.#isDegraded(runId),
    };
  }
}
