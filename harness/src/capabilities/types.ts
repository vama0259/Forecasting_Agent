import type { CapabilityName } from '../config.js';

export type { CapabilityName };

export interface CapabilityProvider {
  healthCheck?(signal: AbortSignal): Promise<void>;
}

export interface MarketDataProvider extends CapabilityProvider {
  fetch_ohlcv(symbol: string, range: string): Promise<unknown[]>;
}

export interface CapabilityMap {
  chat: CapabilityProvider;
  search: CapabilityProvider;
  sentiment: CapabilityProvider;
  market_data: MarketDataProvider;
}
