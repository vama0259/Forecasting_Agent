import { describe, it, expect } from 'vitest';
import { buildEvidenceValidationMiddleware } from '../src/middleware/evidence-validation.js';
import { AGENT_CONFIGS } from '../src/agents/types.js';
import type { Capability } from '../src/agents/schema.js';

describe('EvidenceValidationMiddleware Capability Fencing', () => {
  const getMiddlewareForAgent = (agentName: string) => {
    const config = AGENT_CONFIGS.find((c) => c.name === agentName);
    if (!config) {
      throw new Error(`Agent config for '${agentName}' not found`);
    }
    return buildEvidenceValidationMiddleware(config.name, config.allowedCapabilities, config.primaryCapability);
  };

  describe('retail agent capability fencing', () => {
    it('marks signal degraded when citing unapproved "flows" capability', async () => {
      const mw = getMiddlewareForAgent('retail');
      const state = {
        structuredResponse: {
          agent_name: 'retail',
          direction: 'up',
          probability: 0.6,
          confidence: 0.8,
          horizon_days: 1,
          evidence: [
            {
              claim: 'FII flow surge indicates retail tailwinds',
              source_capability: 'flows' as Capability,
              value: 1200,
              explicit_absence: false,
            },
          ],
          degraded: false,
        },
      };

      await (mw.afterModel as (s: unknown) => Promise<unknown>)(state);
      expect(state.structuredResponse.degraded).toBe(true);
    });

    it('marks signal degraded when citing unapproved "macro" capability', async () => {
      const mw = getMiddlewareForAgent('retail');
      const state = {
        structuredResponse: {
          agent_name: 'retail',
          direction: 'down',
          probability: 0.55,
          confidence: 0.7,
          horizon_days: 1,
          evidence: [
            {
              claim: 'Crude oil surge dampens sentiment',
              source_capability: 'macro' as Capability,
              value: 85.5,
              explicit_absence: false,
            },
          ],
          degraded: false,
        },
      };

      await (mw.afterModel as (s: unknown) => Promise<unknown>)(state);
      expect(state.structuredResponse.degraded).toBe(true);
    });

    it('keeps degraded false when citing approved capabilities (microstructure, sentiment, market_data)', async () => {
      const mw = getMiddlewareForAgent('retail');
      const state = {
        structuredResponse: {
          agent_name: 'retail',
          direction: 'up',
          probability: 0.65,
          confidence: 0.8,
          horizon_days: 1,
          evidence: [
            {
              claim: 'Delivery volume percentage surged to 65%',
              source_capability: 'microstructure' as Capability,
              value: 0.65,
              explicit_absence: false,
            },
            {
              claim: 'Social sentiment froth ratio at extreme greed',
              source_capability: 'sentiment' as Capability,
              value: 0.82,
              explicit_absence: false,
            },
            {
              claim: 'Price trading above 20 EMA',
              source_capability: 'market_data' as Capability,
              value: 2450,
              explicit_absence: false,
            },
          ],
          degraded: false,
        },
      };

      await (mw.afterModel as (s: unknown) => Promise<unknown>)(state);
      expect(state.structuredResponse.degraded).toBe(false);
    });
  });

  describe('fii agent capability fencing', () => {
    it('marks signal degraded when citing unapproved "microstructure" capability', async () => {
      const mw = getMiddlewareForAgent('fii');
      const state = {
        structuredResponse: {
          agent_name: 'fii',
          direction: 'up',
          probability: 0.7,
          confidence: 0.85,
          horizon_days: 1,
          evidence: [
            {
              claim: 'Block deal volume spike observed',
              source_capability: 'microstructure' as Capability,
              value: 500000,
              explicit_absence: false,
            },
          ],
          degraded: false,
        },
      };

      await (mw.afterModel as (s: unknown) => Promise<unknown>)(state);
      expect(state.structuredResponse.degraded).toBe(true);
    });

    it('marks signal degraded when citing unapproved "sentiment" capability', async () => {
      const mw = getMiddlewareForAgent('fii');
      const state = {
        structuredResponse: {
          agent_name: 'fii',
          direction: 'down',
          probability: 0.6,
          confidence: 0.7,
          horizon_days: 1,
          evidence: [
            {
              claim: 'Retail social media chatter is bearish',
              source_capability: 'sentiment' as Capability,
              value: 0.2,
              explicit_absence: false,
            },
          ],
          degraded: false,
        },
      };

      await (mw.afterModel as (s: unknown) => Promise<unknown>)(state);
      expect(state.structuredResponse.degraded).toBe(true);
    });

    it('keeps degraded false when citing approved capabilities (flows, macro, market_data)', async () => {
      const mw = getMiddlewareForAgent('fii');
      const state = {
        structuredResponse: {
          agent_name: 'fii',
          direction: 'up',
          probability: 0.75,
          confidence: 0.9,
          horizon_days: 1,
          evidence: [
            {
              claim: 'FII Index Futures Long/Short ratio expanded to 1.85',
              source_capability: 'flows' as Capability,
              value: 1.85,
              explicit_absence: false,
            },
            {
              claim: 'US 10Y Treasury yield softened to 4.15%',
              source_capability: 'macro' as Capability,
              value: 4.15,
              explicit_absence: false,
            },
            {
              claim: 'Nifty 50 broke above 50-day SMA',
              source_capability: 'market_data' as Capability,
              value: 24600,
              explicit_absence: false,
            },
          ],
          degraded: false,
        },
      };

      await (mw.afterModel as (s: unknown) => Promise<unknown>)(state);
      expect(state.structuredResponse.degraded).toBe(false);
    });
  });

  describe('dii agent capability fencing', () => {
    it('marks signal degraded when citing unapproved "microstructure" capability', async () => {
      const mw = getMiddlewareForAgent('dii');
      const state = {
        structuredResponse: {
          agent_name: 'dii',
          direction: 'up',
          probability: 0.6,
          confidence: 0.75,
          horizon_days: 1,
          evidence: [
            {
              claim: 'Security delivery percentage above 70%',
              source_capability: 'microstructure' as Capability,
              value: 0.72,
              explicit_absence: false,
            },
          ],
          degraded: false,
        },
      };

      await (mw.afterModel as (s: unknown) => Promise<unknown>)(state);
      expect(state.structuredResponse.degraded).toBe(true);
    });

    it('keeps degraded false when citing approved capabilities (flows, macro, market_data)', async () => {
      const mw = getMiddlewareForAgent('dii');
      const state = {
        structuredResponse: {
          agent_name: 'dii',
          direction: 'up',
          probability: 0.68,
          confidence: 0.8,
          horizon_days: 1,
          evidence: [
            {
              claim: 'Domestic mutual fund net cash buying absorbed selling',
              source_capability: 'flows' as Capability,
              value: 3500,
              explicit_absence: false,
            },
            {
              claim: 'USDINR stability provides domestic macro anchor',
              source_capability: 'macro' as Capability,
              value: 83.9,
              explicit_absence: false,
            },
          ],
          degraded: false,
        },
      };

      await (mw.afterModel as (s: unknown) => Promise<unknown>)(state);
      expect(state.structuredResponse.degraded).toBe(false);
    });
  });

  describe('price agent capability fencing', () => {
    it('marks signal degraded when citing unapproved "flows" capability', async () => {
      const mw = getMiddlewareForAgent('price');
      const state = {
        structuredResponse: {
          agent_name: 'price',
          direction: 'up',
          probability: 0.7,
          confidence: 0.8,
          horizon_days: 1,
          evidence: [
            {
              claim: 'FII institutional buying detected',
              source_capability: 'flows' as Capability,
              value: 2000,
              explicit_absence: false,
            },
          ],
          degraded: false,
        },
      };

      await (mw.afterModel as (s: unknown) => Promise<unknown>)(state);
      expect(state.structuredResponse.degraded).toBe(true);
    });

    it('keeps degraded false when citing approved capabilities (market_data, macro)', async () => {
      const mw = getMiddlewareForAgent('price');
      const state = {
        structuredResponse: {
          agent_name: 'price',
          direction: 'up',
          probability: 0.7,
          confidence: 0.8,
          horizon_days: 1,
          evidence: [
            {
              claim: '200 EMA breakout on daily chart',
              source_capability: 'market_data' as Capability,
              value: 2500,
              explicit_absence: false,
            },
            {
              claim: 'Brent crude cooling down',
              source_capability: 'macro' as Capability,
              value: 78.5,
              explicit_absence: false,
            },
          ],
          degraded: false,
        },
      };

      await (mw.afterModel as (s: unknown) => Promise<unknown>)(state);
      expect(state.structuredResponse.degraded).toBe(false);
    });
  });

  describe('middleware edge cases', () => {
    it('handles state without structuredResponse cleanly', async () => {
      const mw = buildEvidenceValidationMiddleware('price', ['market_data']);
      const state = {};
      const result = await (mw.afterModel as (s: unknown) => Promise<unknown>)(state);
      expect(result).toBe(state);
    });

    it('handles empty evidence array without marking degraded', async () => {
      const mw = buildEvidenceValidationMiddleware('price', ['market_data']);
      const state = {
        structuredResponse: {
          agent_name: 'price',
          evidence: [],
          degraded: false,
        },
      };
      await (mw.afterModel as (s: unknown) => Promise<unknown>)(state);
      expect(state.structuredResponse.degraded).toBe(false);
    });

    it('marks degraded when evidence contains null or invalid item', async () => {
      const mw = buildEvidenceValidationMiddleware('price', ['market_data']);
      const state = {
        structuredResponse: {
          agent_name: 'price',
          evidence: [null],
          degraded: false,
        },
      };
      await (mw.afterModel as (s: unknown) => Promise<unknown>)(state);
      expect(state.structuredResponse.degraded).toBe(true);
    });
  });

  describe('primary capability absence', () => {
    it('marks fii degraded with a stated reason when flows is explicitly absent', async () => {
      const mw = getMiddlewareForAgent('fii');
      const state = {
        structuredResponse: {
          agent_name: 'fii',
          direction: 'down',
          probability: 0.6,
          confidence: 0.5,
          horizon_days: 1,
          evidence: [
            {
              claim: 'No participant OI data published for this date',
              source_capability: 'flows' as Capability,
              value: null,
              explicit_absence: true,
            },
          ],
          degraded: false,
          degraded_reason: undefined as string | undefined,
        },
      };

      await (mw.afterModel as (s: unknown) => Promise<unknown>)(state);
      expect(state.structuredResponse.degraded).toBe(true);
      expect(state.structuredResponse.degraded_reason).toContain('flows');
    });

    it('does not synthesize a reason when the model already provided one', async () => {
      const mw = getMiddlewareForAgent('retail');
      const state = {
        structuredResponse: {
          agent_name: 'retail',
          direction: 'up',
          probability: 0.55,
          confidence: 0.4,
          horizon_days: 1,
          evidence: [
            {
              claim: 'No delivery data published for this date',
              source_capability: 'microstructure' as Capability,
              value: null,
              explicit_absence: true,
            },
          ],
          degraded: true,
          degraded_reason: 'model-provided explanation',
        },
      };

      await (mw.afterModel as (s: unknown) => Promise<unknown>)(state);
      expect(state.structuredResponse.degraded_reason).toBe('model-provided explanation');
    });

    it('does not mark degraded when the primary capability has real (non-absent) data', async () => {
      const mw = getMiddlewareForAgent('dii');
      const state = {
        structuredResponse: {
          agent_name: 'dii',
          direction: 'down',
          probability: 0.6,
          confidence: 0.5,
          horizon_days: 1,
          evidence: [
            {
              claim: 'DII net long/short ratio is 0.6',
              source_capability: 'flows' as Capability,
              value: 0.6,
              explicit_absence: false,
            },
          ],
          degraded: false,
          degraded_reason: undefined as string | undefined,
        },
      };

      await (mw.afterModel as (s: unknown) => Promise<unknown>)(state);
      expect(state.structuredResponse.degraded).toBe(false);
      expect(state.structuredResponse.degraded_reason).toBeUndefined();
    });
  });
});
