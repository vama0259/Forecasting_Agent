# Correct-by-construction walk-forward index generator, so agent scripts cannot hand-roll a leaky loop.

import math
from collections.abc import Iterator


def walk_forward_steps(n_bars: int, min_train: int = 45, feature_start: int = 0) -> Iterator[tuple[list[int], int]]:
    """Takes series length, minimum training rows and first usable feature row; yields (train_rows, predict_row)."""
    # The pairing this enforces: a training row j means the pair (features[j], target[j+1]), and the
    # prediction row t means (features[t], target[t+1]) -- the thing being forecast. So every training
    # pair must satisfy j + 1 < t + 1, i.e. j < t. Including j == t puts the exact row being predicted,
    # together with its own answer, into its own training set. That single row is enough to make a
    # backtest look strong and mean nothing: on real TCS data it moved the MASE ratio from 1.007 to
    # 0.933 and the fold win rate from 2/5 to 5/5. The exclusive bound below is the whole point of
    # this function -- do not reimplement it inline.
    for predict_row in range(feature_start, n_bars - 1):
        train_rows = [j for j in range(feature_start, predict_row) if j + 1 < n_bars]
        if len(train_rows) < min_train:
            continue
        yield train_rows, predict_row


def calculate_calibrated_probability(
    predicted_return: float,
    realized_volatility: float,
    min_prob: float = 0.05,
    max_prob: float = 0.95,
) -> float:
    """Computes a calibrated directional advance probability P(return > 0) via Gaussian CDF.

    P(R > 0) = Phi(mu / sigma) = 0.5 * (1 + erf(mu / (sigma * sqrt(2))))

    Prevents overconfidence on noisy 1-day financial returns while preserving directional conviction.
    """
    if realized_volatility <= 1e-6 or not math.isfinite(predicted_return) or not math.isfinite(realized_volatility):
        return 0.5
    z = predicted_return / (realized_volatility * math.sqrt(2.0))
    prob = 0.5 * (1.0 + math.erf(z))
    return max(min_prob, min(max_prob, prob))
