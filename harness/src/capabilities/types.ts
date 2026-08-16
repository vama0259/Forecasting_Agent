// Type definitions for harness capability providers and registry mappings.

import type { CapabilityName } from '../config.js';
import type { SearchCapability } from '../search/types.js';

export type { CapabilityName };

// Base interface for all capability providers, optionally supporting health checks.
export interface CapabilityProvider {
  healthCheck?(signal: AbortSignal): Promise<void>;
}

// Provider interface for fetching market data and historical OHLCV series.
export interface MarketDataProvider extends CapabilityProvider {
  fetch_ohlcv(symbol: string, range: string): Promise<unknown[]>;
}

// Mapping of capability names to their corresponding typed provider interfaces.
export interface CapabilityMap {
  chat: CapabilityProvider;
  search: SearchCapability;
  sentiment: CapabilityProvider;
  market_data: MarketDataProvider;
}
