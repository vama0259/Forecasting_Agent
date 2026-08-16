// Domain allowlist filter partitioning SearchResult items by publisher domain matches.

import type { SearchResult } from './types.js';

// Filters search results against a configured list of approved publisher domains using suffix matching.
export class DomainAllowlist {
  private readonly domains: readonly string[];

  constructor(domains: readonly string[]) {
    this.domains = domains.map((d) => (d.startsWith('.') ? d.slice(1) : d));
  }

  // Partitions an array of search results into allowed and rejected arrays based on hostname suffix matching.
  partition(results: SearchResult[]): { allowed: SearchResult[]; rejected: SearchResult[] } {
    const allowed: SearchResult[] = [];
    const rejected: SearchResult[] = [];

    for (const result of results) {
      const hostname = result.hostname;
      if (hostname !== null && this.domains.some((d) => hostname === d || hostname.endsWith('.' + d))) {
        allowed.push(result);
      } else {
        rejected.push(result);
      }
    }

    return { allowed, rejected };
  }
}
