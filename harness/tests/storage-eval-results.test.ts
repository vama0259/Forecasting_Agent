// Regression coverage for the saveEvalResults bug: the old callers cast the sandbox's real
// {verdict, layers, layer_means} EvalResult straight into saveEvalResult's flat metric_name/
// metric_value row, silently discarding every real MASE/Brier/Sortino into a blank/zero row.
import { describe, it, expect, vi } from 'vitest';
import type { Pool } from 'pg';
import { saveEvalResults } from '../src/storage/repository.js';

describe('saveEvalResults', () => {
  it('inserts one row per layer mean, named mase/brier/sortino, with the real values', async () => {
    const mockQuery = vi.fn().mockResolvedValue({ rows: [] });
    const pool = { query: mockQuery } as unknown as Pool;

    const evalResult = {
      verdict: { status: 'VALID', reasons: [], folds: [], skipped: [] },
      layers: [],
      layer_means: {
        '1': { mean: 1.1183, n_folds: 4 },
        '2': { mean: 0.2361, n_folds: 4 },
        '3': { mean: 0.512, n_folds: 4 },
      },
    };

    await saveEvalResults(pool, 'run-abc', evalResult);

    expect(mockQuery).toHaveBeenCalledTimes(3);
    const inserted = mockQuery.mock.calls.map((call) => call[1] as unknown[]);
    expect(inserted).toContainEqual(expect.arrayContaining(['run-abc', 'mase', 1.1183]));
    expect(inserted).toContainEqual(expect.arrayContaining(['run-abc', 'brier', 0.2361]));
    expect(inserted).toContainEqual(expect.arrayContaining(['run-abc', 'sortino', 0.512]));
  });

  it('inserts nothing for an empty layer_means (e.g. an INVALID gate short-circuit)', async () => {
    const mockQuery = vi.fn().mockResolvedValue({ rows: [] });
    const pool = { query: mockQuery } as unknown as Pool;

    await saveEvalResults(pool, 'run-abc', {
      verdict: { status: 'INVALID', reasons: ['no data'], folds: [], skipped: [] },
      layers: [],
      layer_means: {},
    });

    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('does not throw when evalResult has no layer_means field at all', async () => {
    const mockQuery = vi.fn().mockResolvedValue({ rows: [] });
    const pool = { query: mockQuery } as unknown as Pool;

    await expect(saveEvalResults(pool, 'run-abc', {})).resolves.toBeUndefined();
    expect(mockQuery).not.toHaveBeenCalled();
  });
});
