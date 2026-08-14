import { afterEach, describe, expect, it, vi } from 'vitest';
import { CapabilityRegistry, createCapabilityAccessor } from '../src/capabilities/registry.js';
import { CapabilityHealthError } from '../src/errors.js';
import { createMockMarketData, createMockProvider } from './helpers.js';

function fullyRegistered(): CapabilityRegistry {
  const registry = new CapabilityRegistry();
  registry.register('chat', createMockProvider('ok'));
  registry.register('search', createMockProvider('ok'));
  registry.register('sentiment', createMockProvider('skip'));
  registry.register('market_data', createMockMarketData());
  return registry;
}

afterEach(() => {
  vi.useRealTimers();
});

describe('resolve', () => {
  it('returns the registered provider instance', () => {
    const provider = createMockMarketData();
    const registry = new CapabilityRegistry();
    registry.register('market_data', provider);
    expect(registry.resolve('market_data')).toBe(provider);
  });

  it('throws for a capability that was never registered', () => {
    expect(() => new CapabilityRegistry().resolve('chat')).toThrow(/chat/);
  });

  it('exposes market_data methods without a cast at the call site', async () => {
    const registry = fullyRegistered();
    const cap = createCapabilityAccessor(registry);
    await expect(cap('market_data').fetch_ohlcv('RELIANCE', '1d')).resolves.toEqual([]);
  });

  it('rejects wrongly typed capabilities at compile time', () => {
    const cap = createCapabilityAccessor(fullyRegistered());
    // @ts-expect-error chat is a bare CapabilityProvider and has no fetch_ohlcv
    expect(() => cap('chat').fetch_ohlcv('RELIANCE', '1d')).toThrow();
    // @ts-expect-error 'nonexistent' is not a CapabilityName
    expect(() => cap('nonexistent')).toThrow();
  });
});

describe('register', () => {
  it('throws on duplicate registration', () => {
    const registry = new CapabilityRegistry();
    registry.register('chat', createMockProvider('ok'));
    expect(() => registry.register('chat', createMockProvider('ok'))).toThrow(/chat/);
  });

  it('throws after the registry is sealed by validateAll', async () => {
    const registry = fullyRegistered();
    await registry.validateAll();
    expect(registry.sealed).toBe(true);
    expect(() => registry.register('chat', createMockProvider('ok'))).toThrow(/sealed/i);
  });
});

describe('validateAll', () => {
  it('reports capabilities skipped because they implement no healthCheck', async () => {
    const result = await fullyRegistered().validateAll();
    expect(result.skipped).toEqual(['sentiment']);
  });

  it('aggregates every failure into one CapabilityHealthError', async () => {
    const registry = new CapabilityRegistry();
    registry.register('chat', createMockProvider('fail', 'ECONNREFUSED'));
    registry.register('search', createMockProvider('ok'));
    registry.register('sentiment', createMockProvider('fail', 'ETIMEDOUT'));
    registry.register('market_data', createMockMarketData());
    const error = await registry.validateAll().then(
      () => undefined,
      (e: unknown) => e as CapabilityHealthError,
    );
    expect(error).toBeInstanceOf(CapabilityHealthError);
    expect(error?.message).toContain('chat: ECONNREFUSED');
    expect(error?.message).toContain('sentiment: ETIMEDOUT');
  });

  it('seals the registry even when validation fails', async () => {
    const registry = new CapabilityRegistry();
    registry.register('chat', createMockProvider('fail'));
    await registry.validateAll().catch(() => undefined);
    expect(registry.sealed).toBe(true);
  });

  it('bounds a provider that ignores its abort signal', async () => {
    const registry = new CapabilityRegistry();
    registry.register('market_data', { ...createMockMarketData(), ...createMockProvider('rude') } as never);
    const started = Date.now();
    const error = await registry.validateAll({ timeoutMs: 200 }).then(
      () => undefined,
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(CapabilityHealthError);
    expect(Date.now() - started).toBeLessThan(1500);
  });

  it('prefixes the capability name exactly once on a timeout', async () => {
    const registry = new CapabilityRegistry();
    registry.register('market_data', { ...createMockMarketData(), ...createMockProvider('rude') } as never);
    const error = await registry.validateAll({ timeoutMs: 50 }).then(
      () => undefined,
      (e: unknown) => e as Error,
    );
    expect(error?.message).toBe('market_data: probe timeout');
  });

  it('passes an AbortSignal that is aborted when the probe budget expires', async () => {
    let observed: AbortSignal | undefined;
    const registry = new CapabilityRegistry();
    registry.register('chat', {
      healthCheck: (signal: AbortSignal) => {
        observed = signal;
        return new Promise<void>((resolve) => {
          setTimeout(resolve, 3_000_000);
        });
      },
    });
    await registry.validateAll({ timeoutMs: 50 }).catch(() => undefined);
    expect(observed?.aborted).toBe(true);
  });

  it('leaves no pending timer on the success path', async () => {
    vi.useFakeTimers();
    const registry = fullyRegistered();
    await registry.validateAll({ timeoutMs: 5000 });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('leaves no pending timer on the failure path', async () => {
    vi.useFakeTimers();
    const registry = new CapabilityRegistry();
    registry.register('chat', createMockProvider('fail'));
    await registry.validateAll({ timeoutMs: 5000 }).catch(() => undefined);
    expect(vi.getTimerCount()).toBe(0);
  });
});
