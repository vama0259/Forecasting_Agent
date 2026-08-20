"""DSPy Signatures defining typed prompt input-output contracts for participant agents (ADR-028)."""

import dspy


class PriceAnchorSignature(dspy.Signature):
    """Predict equity price direction and generate walk-forward model fitting code for Indian markets."""

    symbol: str = dspy.InputField(desc="NSE ticker symbol (e.g. TCS.NS, RELIANCE.NS)")
    as_of: str = dspy.InputField(desc="Cutoff observation date (YYYY-MM-DD)")
    ohlcv_summary: str = dspy.InputField(desc="Summary of trailing OHLCV bars, returns, and volatility")
    regime_context: str = dspy.InputField(desc="Market regime context (e.g. Bullish, Rangebound, High Volatility)")

    reasoning: str = dspy.OutputField(desc="Technical price-action and econometric model justification")
    direction: str = dspy.OutputField(desc="Forecasted directional price move ('up' or 'down')")
    probability: float = dspy.OutputField(desc="Calibrated directional advance probability in [0.05, 0.95]")
    confidence: float = dspy.OutputField(desc="Statistical confidence in [0.0, 1.0]")
    python_code: str = dspy.OutputField(desc="Walk-forward feature and model fitting script")


class FIISignature(dspy.Signature):
    """Analyze foreign institutional derivatives and cash flow positioning to forecast market bias."""

    symbol: str = dspy.InputField(desc="NSE ticker symbol")
    as_of: str = dspy.InputField(desc="Cutoff observation date (YYYY-MM-DD)")
    participant_oi: str = dspy.InputField(desc="NSE participant OI: FII Index/Stock Futures Long/Short ratio")
    fii_flows: str = dspy.InputField(desc="Trailing FII net cash/derivatives flow figures in INR crores")

    reasoning: str = dspy.OutputField(desc="FII institutional positioning and liquidity thesis")
    direction: str = dspy.OutputField(desc="Institutional bias direction ('up' or 'down')")
    probability: float = dspy.OutputField(desc="Calibrated probability in [0.05, 0.95]")
    confidence: float = dspy.OutputField(desc="Confidence score in [0.0, 1.0]")


class DIISignature(dspy.Signature):
    """Analyze domestic institutional liquidity and mutual fund SIP counter-cyclical absorption."""

    symbol: str = dspy.InputField(desc="NSE ticker symbol")
    as_of: str = dspy.InputField(desc="Cutoff observation date (YYYY-MM-DD)")
    participant_oi: str = dspy.InputField(desc="NSE participant OI: DII Index/Stock Futures positioning")
    dii_flows: str = dspy.InputField(desc="Trailing DII net buying figures in INR crores and SIP support floors")

    reasoning: str = dspy.OutputField(desc="DII absorption capacity and domestic liquidity thesis")
    direction: str = dspy.OutputField(desc="Domestic institutional bias ('up' or 'down')")
    probability: float = dspy.OutputField(desc="Calibrated probability in [0.05, 0.95]")
    confidence: float = dspy.OutputField(desc="Confidence score in [0.0, 1.0]")


class RetailSignature(dspy.Signature):
    """Analyze retail sentiment, delivery percentage, and search news momentum."""

    symbol: str = dspy.InputField(desc="NSE ticker symbol")
    as_of: str = dspy.InputField(desc="Cutoff observation date (YYYY-MM-DD)")
    delivery_positions: str = dspy.InputField(desc="NSE delivery volume percentage and accumulation signals")
    search_sentiment: str = dspy.InputField(desc="Financial news headlines, narrative sentiment, and query results")

    reasoning: str = dspy.OutputField(desc="Retail market sentiment and delivery accumulation thesis")
    direction: str = dspy.OutputField(desc="Retail positioning direction ('up' or 'down')")
    probability: float = dspy.OutputField(desc="Calibrated probability in [0.05, 0.95]")
    confidence: float = dspy.OutputField(desc="Confidence score in [0.0, 1.0]")
