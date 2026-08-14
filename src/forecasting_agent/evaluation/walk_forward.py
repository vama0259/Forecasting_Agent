"""Layer 4a purged walk-forward cross-validation splitter with embargo."""

from collections.abc import Iterator

import numpy as np
from numpy.typing import NDArray
from sklearn.model_selection import TimeSeriesSplit


class PurgedWalkForward:
    """Purged walk-forward time-series cross-validation splitter enforcing embargo constraints."""

    def __init__(
        self,
        *,
        n_splits: int = 5,
        gap: int | None = None,
        horizon: int = 1,
        min_train_size: int = 3,
    ) -> None:
        """Takes split configuration parameters; initializes and validates purged walk-forward splitter."""
        effective_gap = horizon if gap is None else gap
        if min_train_size < 3:
            raise ValueError(f"min_train_size must be >= 3, got {min_train_size}")
        if n_splits < 2:
            raise ValueError(f"n_splits must be >= 2, got {n_splits}")
        if horizon < 1:
            raise ValueError(f"horizon must be >= 1, got {horizon}")
        if effective_gap < horizon:
            raise ValueError(f"gap must be >= horizon ({horizon}), got {effective_gap}")
        if horizon > 1:
            raise NotImplementedError(f"horizon {horizon} > 1 requires purging which is not implemented")

        self.n_splits = n_splits
        self.gap = effective_gap
        self.horizon = horizon
        self.min_train_size = min_train_size

    def split(self, X: NDArray[np.float64]) -> Iterator[tuple[NDArray[np.intp], NDArray[np.intp]]]:  # noqa: N803
        """Takes input feature/return array; yields train and test index array pairs."""
        splitter = TimeSeriesSplit(n_splits=self.n_splits, gap=self.gap)
        yield from splitter.split(X)

    def get_n_splits(self) -> int:
        """Takes nothing; returns configured number of walk-forward splits."""
        return self.n_splits
