import { describe, it, expect } from 'vitest';
import { mockDebateSummary, samplePythonScripts } from '@/lib/debate/fixtures';
import type { DebateStreamEvent } from '@/lib/debate/types';

describe('Debate Domain Types & Fixtures', () => {
  it('correctly models 4-round debate summary with 4 participant agents', () => {
    expect(mockDebateSummary.symbol).toBe('SBIFUNDS.NS');
    expect(mockDebateSummary.consensusDirection).toBe('down');
    expect(mockDebateSummary.consensusProbability).toBe(0.6);
    expect(mockDebateSummary.deadlockStatus).toBe('RESOLVED');

    const r1 = mockDebateSummary.rounds.round1;
    expect(r1.price).toBeDefined();
    expect(r1.fii).toBeDefined();
    expect(r1.dii).toBeDefined();
    expect(r1.retail).toBeDefined();

    expect(r1.price.agentName).toBe('price');
    expect(r1.fii.agentName).toBe('fii');
    expect(r1.dii.agentName).toBe('dii');
    expect(r1.retail.agentName).toBe('retail');
  });

  it('contains valid Python script artifacts with code, stdout, and exit codes', () => {
    expect(samplePythonScripts.length).toBeGreaterThanOrEqual(4);
    const catboostScript = samplePythonScripts.find((s) => s.fileName === 'retail_features.py');
    expect(catboostScript).toBeDefined();
    expect(catboostScript?.code).toContain('CatBoostClassifier');
    expect(catboostScript?.exitCode).toBe(0);
    expect(catboostScript?.stdout).toContain('CatBoost P(up)');

    const kalmanScript = samplePythonScripts.find((s) => s.fileName === 'audit4_kalman.py');
    expect(kalmanScript).toBeDefined();
    expect(kalmanScript?.code).toContain('savgol_filter');
    expect(kalmanScript?.stdout).toContain('Latent Trend Velocity');
  });

  it('validates discriminated union narrowing for DebateStreamEvent', () => {
    const event: DebateStreamEvent = {
      type: 'consensus-resolved',
      direction: 'down',
      probability: 0.6,
      confidence: 0.236,
      dispersion: 0.0354,
      deadlockStatus: 'RESOLVED',
      healthFactor: 0.5,
    };

    if (event.type === 'consensus-resolved') {
      expect(event.direction).toBe('down');
      expect(event.deadlockStatus).toBe('RESOLVED');
    }
  });
});
