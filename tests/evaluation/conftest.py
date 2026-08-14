"""Shared seeded synthetic fixtures for the evaluation test suite — no network, no disk, no market data."""

from datetime import UTC, datetime, timedelta

import numpy as np
import pytest
from numpy.typing import NDArray

SEED = 7


@pytest.fixture
def seeded_returns() -> NDArray[np.float64]:
    """Takes nothing; returns the fixed 300-point seed-7 Gaussian daily return series the spec measured against."""
    return np.random.default_rng(SEED).normal(0.0, 0.01, 300)


@pytest.fixture
def seeded_train_test(seeded_returns: NDArray[np.float64]) -> tuple[NDArray[np.float64], NDArray[np.float64]]:
    """Takes the seeded series; returns its (train[:200], test[200:]) split used by the MASE fixtures."""
    return seeded_returns[:200], seeded_returns[200:]


@pytest.fixture
def aware_timestamps() -> list[datetime]:
    """Takes nothing; returns 300 consecutive timezone-aware daily timestamps starting 2025-01-01T00:00Z."""
    start = datetime(2025, 1, 1, tzinfo=UTC)
    return [start + timedelta(days=i) for i in range(300)]
