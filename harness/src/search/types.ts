// Types and error classes for the search capability, outcome payloads, and quota lifecycle.

import type { CapabilityProvider } from '../capabilities/types.js';

// A single search result item containing ranking, metadata, and extracted text content.
export interface SearchResult {
  rank: number;
  title: string;
  url: string | null;
  hostname: string | null;
  content: string;
}

// Outcome of a search invocation containing parsed results, source provenance, and degradation flag.
export interface SearchOutcome {
  results: SearchResult[];
  source: 'provider' | 'cache' | 'degraded';
  degraded: boolean;
}

// Agent-facing interface exposing search query execution without lifecycle control.
export interface SearchCapability extends CapabilityProvider {
  // Executes a search query for the given run ID, returning allowlist-filtered results and outcome metadata.
  search(runId: string, query: string): Promise<SearchOutcome>;
}

// Pipeline-facing interface for managing run-scoped search budget allocation and release.
export interface SearchRunLifecycle {
  // Claims initial search budget for a run, returning the granted unit count.
  beginRun(runId: string): Promise<number>;
  // Releases unused search budget for a run, returning the refunded unit count.
  endRun(runId: string): Promise<number>;
}

// Error thrown when an underlying search provider fails or returns an unhandled error.
export class SearchProviderError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'SearchProviderError';
  }
}

// Error thrown when a search provider request exceeds its allotted timeout deadline.
export class SearchProviderTimeoutError extends SearchProviderError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'SearchProviderTimeoutError';
  }
}

// Error thrown when a search provider returns a response body that cannot be parsed into results.
export class SearchResponseFormatError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'SearchResponseFormatError';
  }
}
