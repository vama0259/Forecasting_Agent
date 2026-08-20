"""Historical Multi-Regime Datasets for DSPy Prompt Compilation (ADR-028)."""

import dspy


def get_price_anchor_examples() -> list[dspy.Example]:
    """Returns regime-partitioned training exemplars for the Price Anchor agent."""
    return [
        # Regime 1: Bearish Continuation (Heavy selling, broken 20 EMA, high volume down-bar)
        dspy.Example(
            symbol="TCS.NS",
            as_of="2026-08-17",
            ohlcv_summary=(
                "Closed 2313.20 (-2.02%), near session low 2310.60. Trailing 5d returns: -3.8%. "
                "Realized volatility: 1.45%/day. Broken 20 EMA support with below-average recovery volume."
            ),
            regime_context="Bearish Breakdown below key support",
            reasoning=(
                "Momentum is sharply negative with price closing near the absolute day's low. "
                "Mean-reversion probability is capped by heavy overhead supply."
            ),
            direction="down",
            probability=0.58,
            confidence=0.60,
            python_code="import numpy as np\n# Walk-forward fitting script\npass",
            target_direction="down",
        ).with_inputs("symbol", "as_of", "ohlcv_summary", "regime_context"),
        # Regime 2: Bullish Momentum (Consolidation breakout, strong RSI expansion)
        dspy.Example(
            symbol="RELIANCE.NS",
            as_of="2026-07-10",
            ohlcv_summary=(
                "Closed 2950.00 (+1.85%), breakout on 1.8x 20d average volume. RSI-14 crossed 62 upwards. "
                "Trailing 5d return: +3.2%. Volatility: 1.10%/day."
            ),
            regime_context="Bullish Breakout with Volume Expansion",
            reasoning=(
                "Strong institutional accumulation bar breaking above 20-day high with rising volume "
                "confirms trend continuation."
            ),
            direction="up",
            probability=0.62,
            confidence=0.65,
            python_code="import numpy as np\n# Walk-forward fitting script\npass",
            target_direction="up",
        ).with_inputs("symbol", "as_of", "ohlcv_summary", "regime_context"),
        # Regime 3: Rangebound / Neutral Mean-Reversion
        dspy.Example(
            symbol="HDFCBANK.NS",
            as_of="2026-06-15",
            ohlcv_summary=(
                "Closed 1620.00 (-0.12%), trading inside narrow 1610-1635 range for 8 consecutive sessions. "
                "Volume low at 0.7x 20d average."
            ),
            regime_context="Rangebound Compression",
            reasoning=(
                "Indecisive price action near the range midpoint with low volatility indicates "
                "near-equal probability distribution."
            ),
            direction="up",
            probability=0.51,
            confidence=0.30,
            python_code="import numpy as np\n# Walk-forward fitting script\npass",
            target_direction="up",
        ).with_inputs("symbol", "as_of", "ohlcv_summary", "regime_context"),
    ]


def get_fii_examples() -> list[dspy.Example]:
    """Returns regime-partitioned training exemplars for the FII agent."""
    return [
        dspy.Example(
            symbol="TCS.NS",
            as_of="2026-08-17",
            participant_oi="FII Index Futures L/S ratio = 0.1223 (25,299 long vs 206,886 short, net -181,587).",
            fii_flows="FII net cash sales: -₹2,140 Cr today, trailing 5-day net cash: -₹8,920 Cr.",
            reasoning=(
                "Severe institutional short positioning in index futures and persistent cash selling "
                "creates massive downward overhang."
            ),
            direction="down",
            probability=0.60,
            confidence=0.65,
            target_direction="down",
        ).with_inputs("symbol", "as_of", "participant_oi", "fii_flows"),
        dspy.Example(
            symbol="INFY.NS",
            as_of="2026-07-05",
            participant_oi="FII Index Futures L/S ratio = 1.45 (125,000 long vs 86,000 short, net +39,000).",
            fii_flows="FII net cash buying: +₹3,450 Cr today, trailing 5-day net cash: +₹12,100 Cr.",
            reasoning=(
                "Aggressive institutional long expansion across cash and derivative contracts indicates "
                "strong foreign risk-on positioning."
            ),
            direction="up",
            probability=0.63,
            confidence=0.68,
            target_direction="up",
        ).with_inputs("symbol", "as_of", "participant_oi", "fii_flows"),
    ]
