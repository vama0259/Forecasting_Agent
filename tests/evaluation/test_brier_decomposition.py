# Tests the Murphy Brier decomposition and directional hit rate, including the comprehension gate on resolution.

import numpy as np

from forecasting_agent.evaluation.brier import brier, brier_decomposition, direction_hit_rate

RNG = np.random.default_rng(20260819)


def _returns(n: int = 600) -> np.ndarray:
    # Takes a sample count; returns a synthetic daily return series with no exploitable serial structure.
    return RNG.normal(0.0, 0.012, size=n)


def test_decomposition_reconstructs_the_brier_score_exactly_without_within_bin_scatter():
    # Snapping forecasts to bin centres removes within-bin scatter, which is the only thing
    # standing between a 10-bin decomposition and an exact reconstruction.
    returns = _returns()
    raw = np.clip(0.5 + RNG.normal(0.0, 0.15, size=len(returns)), 0.0, 1.0)
    calls = np.clip((raw * 10).astype(int), 0, 9) / 10 + 0.05

    split = brier_decomposition(calls, returns)
    reconstructed = split.reliability - split.resolution + split.uncertainty

    assert abs(reconstructed - brier(calls, returns)) < 1e-12


def test_reconstruction_residual_stays_within_binning_error_for_continuous_forecasts():
    returns = _returns()
    calls = np.clip(0.5 + RNG.normal(0.0, 0.15, size=len(returns)), 0.0, 1.0)

    split = brier_decomposition(calls, returns)
    residual = abs((split.reliability - split.resolution + split.uncertainty) - brier(calls, returns))

    # Bounded by within-bin variance, which for 10 bins cannot exceed (0.1/2)^2 = 2.5e-3.
    assert residual < 2.5e-3


def test_uncertainty_is_the_base_rate_variance_not_a_hardcoded_quarter():
    # A series that rises on only 30% of days has a no-skill bar of 0.3*0.7 = 0.21, not 0.25.
    returns = np.array([0.01] * 30 + [-0.01] * 70, dtype=float)
    split = brier_decomposition(np.full(len(returns), 0.5), returns)

    assert split.base_rate == 0.30
    assert abs(split.uncertainty - 0.21) < 1e-12


def test_resolution_moves_when_the_forecast_actually_becomes_informative():
    """Comprehension gate: resolution must respond to the one input that should drive it."""
    returns = _returns()
    labels = returns > 0

    # Uninformative: probabilities uncorrelated with the outcome they are predicting.
    uninformative = np.clip(0.5 + RNG.normal(0.0, 0.15, size=len(returns)), 0.0, 1.0)
    # Informative: the same spread of probabilities, but pointed the right way.
    informative = np.where(labels, 0.9, 0.1)

    dumb = brier_decomposition(uninformative, returns)
    smart = brier_decomposition(informative, returns)

    assert dumb.resolution < 0.01, f"noise should carry no information, got {dumb.resolution}"
    assert smart.resolution > 0.20, f"a forecast that knows the answer must show it, got {smart.resolution}"
    # The output moves with the input by a factor of ~50x, not a rounding difference.
    assert smart.resolution > dumb.resolution * 20


def test_hit_rate_separates_a_perfect_caller_from_a_coin_flip():
    returns = _returns()
    labels = returns > 0

    perfect = direction_hit_rate(np.where(labels, 0.9, 0.1), returns)
    coin = direction_hit_rate(np.full(len(returns), 0.5), returns)

    assert perfect.rate == 1.0
    assert perfect.z_vs_coin > 20.0
    # calls of exactly 0.5 are never ">0.5", so this scores the share of down days -- the point is
    # only that a non-informative caller lands nowhere near the perfect caller's z.
    assert abs(coin.z_vs_coin) < perfect.z_vs_coin / 2


def test_abstentions_do_not_earn_a_trending_series_base_rate():
    """A forecaster that never commits must score no skill, even when the series trends hard."""
    # 70% down days: scoring calls of exactly 0.5 as "down" would hand this forecaster 0.70.
    returns = np.array([-0.01] * 70 + [0.01] * 30, dtype=float)
    RNG.shuffle(returns)

    abstaining = direction_hit_rate(np.full(len(returns), 0.5), returns)

    assert abstaining.n == 0, "abstentions must be excluded from the denominator"
    assert abstaining.z_vs_coin == 0.0, "an abstainer cannot be distinguishable from a coin"


def test_committed_calls_are_still_scored_when_mixed_with_abstentions():
    returns = np.array([0.01, -0.01, 0.01, -0.01, 0.01, -0.01], dtype=float)
    # Three committed and correct, three abstentions.
    calls = np.array([0.9, 0.1, 0.9, 0.5, 0.5, 0.5], dtype=float)

    result = direction_hit_rate(calls, returns)

    assert result.n == 3
    assert result.hits == 3
    assert result.rate == 1.0


def test_empty_inputs_do_not_raise():
    empty = np.array([], dtype=float)
    assert direction_hit_rate(empty, empty).n == 0
    assert brier_decomposition(empty, empty).resolution == 0.0
