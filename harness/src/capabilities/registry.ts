import { CapabilityHealthError } from '../errors.js';
import type { CapabilityMap, CapabilityName, CapabilityProvider } from './types.js';

export interface ValidateAllOptions {
  timeoutMs?: number;
}

export interface ValidateAllResult {
  skipped: CapabilityName[];
}

export class CapabilityRegistry {
  readonly #providers = new Map<CapabilityName, CapabilityProvider>();
  #sealed = false;

  get sealed(): boolean {
    return this.#sealed;
  }

  register<K extends CapabilityName>(name: K, provider: CapabilityMap[K]): void {
    if (this.#sealed) throw new Error(`registry is sealed; cannot register "${name}"`);
    if (this.#providers.has(name)) throw new Error(`capability "${name}" is already registered`);
    this.#providers.set(name, provider);
  }

  resolve<K extends CapabilityName>(name: K): CapabilityMap[K] {
    const provider = this.#providers.get(name);
    if (provider === undefined) throw new Error(`capability "${name}" is not registered`);
    return provider as CapabilityMap[K];
  }

  async validateAll({ timeoutMs = 5000 }: ValidateAllOptions = {}): Promise<ValidateAllResult> {
    const skipped: CapabilityName[] = [];
    const probes: Promise<void>[] = [];
    const names: CapabilityName[] = [];

    for (const [name, provider] of this.#providers) {
      if (typeof provider.healthCheck !== 'function') {
        skipped.push(name);
        continue;
      }
      names.push(name);
      probes.push(this.#probe(provider, timeoutMs));
    }

    const outcomes = await Promise.allSettled(probes);
    this.#sealed = true;

    const failures = outcomes.flatMap((outcome, index) =>
      outcome.status === 'rejected' ? [`${names[index]}: ${(outcome.reason as Error).message}`] : [],
    );
    if (failures.length > 0) throw new CapabilityHealthError(failures);

    return { skipped };
  }

  async #probe(provider: CapabilityProvider, timeoutMs: number): Promise<void> {
    const controller = new AbortController();
    let timer: NodeJS.Timeout | undefined;
    try {
      const expiry = new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new Error('probe timeout'));
        }, timeoutMs);
      });
      await Promise.race([provider.healthCheck!(controller.signal), expiry]);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }
}

export function createCapabilityAccessor(
  registry: CapabilityRegistry,
): <K extends CapabilityName>(name: K) => CapabilityMap[K] {
  return (name) => registry.resolve(name);
}
