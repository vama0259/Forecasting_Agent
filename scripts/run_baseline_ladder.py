"""Scores trivial baselines through the same M8 evaluate() the agent is graded by, giving agent numbers a floor."""

import argparse
import json
import sys
from collections.abc import Callable, Sequence
from datetime import UTC, date, datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

import numpy as np
from numpy.typing import NDArray

from forecasting_agent.data_server.server import fetch_ohlcv
from forecasting_agent.evaluation import EvalRequest, evaluate

# The NSE trading day, not the host's day -- a late-evening IST session is still the same
# trading date, and a UTC-based "today" would silently roll over mid-session.
IST = ZoneInfo("Asia/Kolkata")


def today_ist() -> date:
    # Takes nothing; returns the current calendar date in the exchange's own timezone.
    return datetime.now(tz=IST).date()


SYMBOLS = [
    "RELIANCE.NS",
    "TCS.NS",
    "HDFCBANK.NS",
    "INFY.NS",
    "ICICIBANK.NS",
    "HINDUNILVR.NS",
    "SBIN.NS",
    "BHARTIARTL.NS",
    "KOTAKBANK.NS",
    "LT.NS",
]

# A baseline takes the full returns series and emits (forecasts, calls), each entry computed
# strictly from returns[:i] so nothing peeks at the day it is predicting.
Baseline = Callable[[NDArray[np.float64]], tuple[NDArray[np.float64], NDArray[np.float64]]]


def _expanding_up_rate(returns: NDArray[np.float64], i: int) -> float:
    # Takes the returns series and an index; returns the share of positive days strictly before i.
    prior = returns[:i]
    return float(np.mean(prior > 0)) if len(prior) else 0.5


def zero_baseline(returns: NDArray[np.float64]) -> tuple[NDArray[np.float64], NDArray[np.float64]]:
    # Takes returns; returns an all-zero forecast and an uninformative 0.5 call for every day.
    n = len(returns)
    return np.zeros(n), np.full(n, 0.5)


def naive_baseline(returns: NDArray[np.float64]) -> tuple[NDArray[np.float64], NDArray[np.float64]]:
    # Takes returns; returns yesterday's return carried forward and a 0.5 call for every day.
    n = len(returns)
    forecasts = np.zeros(n)
    forecasts[1:] = returns[:-1]
    return forecasts, np.full(n, 0.5)


def drift_baseline(returns: NDArray[np.float64]) -> tuple[NDArray[np.float64], NDArray[np.float64]]:
    # Takes returns; returns the expanding mean of prior returns and the expanding up-day rate as the call.
    n = len(returns)
    forecasts = np.array([float(np.mean(returns[:i])) if i else 0.0 for i in range(n)])
    calls = np.array([_expanding_up_rate(returns, i) for i in range(n)])
    return forecasts, calls


def ewma_baseline(returns: NDArray[np.float64], alpha: float = 0.3) -> tuple[NDArray[np.float64], NDArray[np.float64]]:
    # Takes returns and a smoothing factor; returns exponentially smoothed prior returns and the expanding up-day rate.
    n = len(returns)
    forecasts = np.zeros(n)
    level = 0.0
    for i in range(n):
        forecasts[i] = level
        level = alpha * returns[i] + (1 - alpha) * level
    calls = np.array([_expanding_up_rate(returns, i) for i in range(n)])
    return forecasts, calls


BASELINES: dict[str, Baseline] = {
    "zero": zero_baseline,
    "naive": naive_baseline,
    "drift": drift_baseline,
    "ewma_0.3": ewma_baseline,
}


def load_returns(symbol: str, as_of: date, lookback_days: int) -> tuple[NDArray[np.float64], list[datetime]]:
    # Takes a symbol, as-of date, and lookback window; returns the close-to-close return series and its bar timestamps.
    start = (as_of - timedelta(days=lookback_days)).isoformat()
    response = fetch_ohlcv(symbol=symbol, market="NSE", start=start, end=as_of.isoformat(), as_of=as_of.isoformat())
    bars = response.bars
    if len(bars) < 31:
        raise ValueError(f"{symbol}: only {len(bars)} bars in window, need >= 31")
    closes = np.array([b.close for b in bars], dtype=np.float64)
    returns = np.diff(closes) / closes[:-1]
    timestamps = [datetime.fromisoformat(str(b.date)).replace(tzinfo=UTC) for b in bars[1:]]
    return returns, timestamps


def score(
    returns: NDArray[np.float64],
    timestamps: Sequence[datetime],
    forecasts: NDArray[np.float64],
    calls: NDArray[np.float64],
) -> dict[str, object]:
    # Takes a returns series with a baseline's forecasts and calls; returns that baseline's aggregated layer scores.
    trade_side = ["buy" if c > 0.5 else "hold" for c in calls]
    notional = [10000.0 if s == "buy" else 0.0 for s in trade_side]
    request = EvalRequest(
        returns=returns.tolist(),
        forecasts=forecasts.tolist(),
        calls=calls.tolist(),
        timestamps=list(timestamps),
        as_of=timestamps[-1],
        segment="EQUITY_DELIVERY",
        position_notional=notional,
        trade_side=trade_side,
        capital=100000.0,
    )
    result = evaluate(request)
    if result.verdict.status == "INVALID":
        return {"status": "INVALID", "reasons": list(result.verdict.reasons)}

    l1 = [s for s in result.layers if s.layer == 1]
    return {
        "status": "VALID",
        "l1_mase": float(np.mean([s.value for s in l1 if s.value is not None])),
        "l1_zero": float(np.mean([s.zero_forecast_mase for s in l1 if s.zero_forecast_mase is not None])),
        "l1_beats_zero": sum(1 for s in l1 if s.beats_zero),
        "l1_folds": len(l1),
        "l2_brier": result.layer_means[2].mean if 2 in result.layer_means else None,
        "l3_sortino": result.layer_means[3].mean if 3 in result.layer_means else None,
    }


def agent_row(run_dir: Path) -> dict[str, object] | None:
    # Takes a stored baseline run directory; returns the agent's pooled layer scores from its per-symbol JSONs.
    l1_agent, l1_zero, l2, l3 = [], [], [], []
    beats = folds = 0
    for path in sorted(run_dir.glob("*.json")):
        # A sweep leaves a zero-byte .json behind for every symbol whose run failed, so skip those
        # rather than crash mid-aggregation and lose the symbols that did succeed.
        if not path.stat().st_size:
            print(f"{path.name}: empty (run failed), skipping", file=sys.stderr)
            continue
        layers = json.loads(path.read_text())["evalResult"]["layers"]
        for s in layers:
            if s["layer"] == 1:
                l1_agent.append(s["value"])
                l1_zero.append(s["zero_forecast_mase"])
                beats += int(bool(s["beats_zero"]))
                folds += 1
            elif s["layer"] == 2:
                l2.append(s["value"])
            elif s["layer"] == 3 and s["value"] is not None:
                l3.append(s["value"])
    if not folds:
        return None
    return {
        "l1_mase": float(np.mean(l1_agent)),
        "l1_zero": float(np.mean(l1_zero)),
        "beats": f"{beats}/{folds}",
        "l2_brier": float(np.mean(l2)),
        "l3_sortino": float(np.mean(l3)) if l3 else float("nan"),
    }


def main() -> int:
    # Takes no arguments (parses argv); returns a process exit code after writing the baseline ladder report.
    parser = argparse.ArgumentParser(description="Score trivial baselines through M8 evaluate()")
    parser.add_argument("--as-of", default=today_ist().isoformat(), help="ISO date to fetch data up to")
    parser.add_argument("--lookback-days", type=int, default=120, help="calendar days of history to pull")
    parser.add_argument("--symbols", nargs="*", default=SYMBOLS, help="symbols to score")
    parser.add_argument("--out", default="baselines/ladder-latest.json", help="where to write the JSON report")
    parser.add_argument("--compare-run-dir", help="a stored agent run dir (baselines/<run>/runs) to rank alongside")
    args = parser.parse_args()

    as_of = date.fromisoformat(args.as_of)
    report: dict[str, dict[str, dict[str, object]]] = {}

    for symbol in args.symbols:
        try:
            returns, timestamps = load_returns(symbol, as_of, args.lookback_days)
        except Exception as exc:
            print(f"{symbol}: SKIP ({type(exc).__name__}: {exc})", file=sys.stderr)
            continue
        report[symbol] = {}
        for name, baseline in BASELINES.items():
            forecasts, calls = baseline(returns)
            report[symbol][name] = score(returns, timestamps, forecasts, calls)
        print(f"{symbol}: scored {len(returns)} returns across {len(BASELINES)} baselines", file=sys.stderr)

    out_path = Path(args.out)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps({"as_of": args.as_of, "results": report}, indent=2))

    table: list[tuple[str, dict[str, object]]] = []
    for name in BASELINES:
        rows = [report[s][name] for s in report if report[s][name].get("status") == "VALID"]
        if not rows:
            continue
        beats = sum(int(r["l1_beats_zero"]) for r in rows)  # type: ignore[arg-type]
        folds = sum(int(r["l1_folds"]) for r in rows)  # type: ignore[arg-type]
        sortinos = [r["l3_sortino"] for r in rows if r["l3_sortino"] is not None]
        table.append(
            (
                name,
                {
                    "l1_mase": float(np.mean([r["l1_mase"] for r in rows])),  # type: ignore[arg-type]
                    "l1_zero": float(np.mean([r["l1_zero"] for r in rows])),  # type: ignore[arg-type]
                    "beats": f"{beats}/{folds}",
                    "l2_brier": float(np.mean([r["l2_brier"] for r in rows])),  # type: ignore[arg-type]
                    "l3_sortino": float(np.mean(sortinos)) if sortinos else float("nan"),  # type: ignore[arg-type]
                },
            )
        )

    if args.compare_run_dir:
        row = agent_row(Path(args.compare_run_dir))
        if row:
            table.append(("AGENT", row))
            # Layer 1 scored a fixed naive baseline instead of the submitted forecast until
            # 79c27e8 (2026-08-17). Runs recorded before that carry a MASE that is identical for a
            # perfect and a catastrophic forecast, and nothing in the stored JSON distinguishes
            # them from a valid run -- so say so every time rather than print a number that lies.
            print(
                f"\nWARNING: {args.compare_run_dir}\n"
                "  The AGENT row's L1 MASE is only meaningful if that sweep ran after commit\n"
                "  79c27e8 (2026-08-17), which taught pipeline.py to read EvalRequest.forecasts.\n"
                "  Earlier sweeps scored a fixed baseline -- their MASE says nothing about the\n"
                "  agent. The Brier column is unaffected and valid either way.",
                file=sys.stderr,
            )

    # Rank by MASE relative to each row's own zero baseline, so runs measured on slightly different
    # windows stay comparable -- an absolute MASE would just reward whoever drew the calmer window.
    table.sort(key=lambda kv: kv[1]["l1_mase"] / kv[1]["l1_zero"])  # type: ignore[operator]

    print(f"\n{'model':<12}{'L1 MASE':>10}{'L1 zero':>10}{'ratio':>8}{'beats':>9}{'L2 Brier':>11}{'L3 Sortino':>12}")
    print("-" * 72)
    for name, r in table:
        ratio = r["l1_mase"] / r["l1_zero"]  # type: ignore[operator]
        print(
            f"{name:<12}{r['l1_mase']:>10.3f}{r['l1_zero']:>10.3f}{ratio:>8.2f}"  # type: ignore[str-format]
            f"{r['beats']:>9}{r['l2_brier']:>11.3f}{r['l3_sortino']:>12.3f}"  # type: ignore[str-format]
        )
    print("\nratio = own MASE / own zero-forecast MASE. >1.00 means worse than forecasting nothing.")
    print("L2 Brier: 0.250 is the coin-flip score at p=0.5; lower is better.")
    print(f"\nwrote {out_path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
