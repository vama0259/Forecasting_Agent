import type { CapabilityProvider, MarketDataProvider } from '../src/capabilities/types.js';

export function createMockProvider(
  behaviour: 'ok' | 'fail' | 'skip' | 'rude' = 'ok',
  message = 'ECONNREFUSED',
): CapabilityProvider {
  if (behaviour === 'skip') return {};
  if (behaviour === 'fail')
    return {
      healthCheck: async () => {
        throw new Error(message);
      },
    };
  if (behaviour === 'rude') {
    return {
      healthCheck: () =>
        new Promise<void>((resolve) => {
          setTimeout(resolve, 3_000_000);
        }),
    };
  }
  return { healthCheck: async () => {} };
}

export function createMockMarketData(): MarketDataProvider {
  return { healthCheck: async () => {}, fetch_ohlcv: async () => [] };
}
