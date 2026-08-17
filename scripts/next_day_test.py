"""Locks next-trading-day direction calls from the baselines and the agent, then scores them against the real close."""

import argparse
import json
import sys
from datetime import date, timedelta
from pathlib import Path

import numpy as np

from forecasting_agent.data_server.server import fetch_ohlcv
from scripts.run_baseline_ladder import (
    SYMBOLS,
    drift_baseline,
    ewma_baseline,
    naive_baseline,
    today_ist,
    zero_baseline,
)

PREDICTIONS_DIR = Path("predictions")

# Only the baselines whose next-day call is informative: zero and naive both sit at p=0.5 by
# construction, so they have no direction to be right or wrong about on a single day.
NEXT_DAY_BASELINES = {
    "drift": drift_baseline,
    "ewma_0.3": ewma_baseline,
    "naive": naive_baseline,
    "zero": zero_baseline,
}


def _closes(symbol: str, as_of: date, lookback_days: int = 120) -> tuple[list[str], np.ndarray]:
    # Takes a symbol, as-of date, and lookback; returns that symbol's bar dates and close prices up to as_of.
    start = (as_of - timedelta(days=lookback_days)).isoformat()
    response = fetch_ohlcv(symbol=symbol, market="NSE", start=start, end=as_of.isoformat(), as_of=as_of.isoformat())
    dates = [str(b.date) for b in response.bars]
    return dates, np.array([b.close for b in response.bars], dtype=np.float64)


def lock(as_of: date, symbols: list[str]) -> Path | None:
    # Takes an as-of date and symbol list; returns the written prediction file path, or None if nothing was locked.
    out = PREDICTIONS_DIR / f"{as_of.isoformat()}.json"
    # Merge rather than overwrite: the upstream feed rate-limits a different symbol on every sweep,
    # so a re-run must top up the misses instead of dropping whatever it happened to miss this time.
    entries: dict[str, dict[str, object]] = json.loads(out.read_text())["symbols"] if out.exists() else {}
    for symbol in symbols:
        if symbol in entries:
            print(f"{symbol}: already locked, leaving as-is", file=sys.stderr)
            continue
        try:
            # Fetch up to today, not up to as_of, so a bar *after* the lock date is visible here.
            # A forward test is only a forward test if the outcome is genuinely unknown when the
            # call is recorded; without this the tool will happily backfill a prediction for a day
            # it can already see, and the resulting file is indistinguishable from a real one.
            dates, closes = _closes(symbol, today_ist())
        except Exception as exc:
            print(f"{symbol}: SKIP ({type(exc).__name__}: {exc})", file=sys.stderr)
            continue
        if as_of.isoformat() not in dates:
            print(f"{symbol}: SKIP (no bar for as_of {as_of}; last is {dates[-1]})", file=sys.stderr)
            continue
        idx = dates.index(as_of.isoformat())
        if idx + 1 < len(dates):
            print(
                f"{symbol}: REFUSED -- {dates[idx + 1]} has already traded, so this would backfill "
                f"a prediction whose outcome is already known, not lock a forward one",
                file=sys.stderr,
            )
            continue
        dates, closes = dates[: idx + 1], closes[: idx + 1]

        returns = np.diff(closes) / closes[:-1]
        models: dict[str, object] = {}
        for name, baseline in NEXT_DAY_BASELINES.items():
            # Append a placeholder day so the causal baselines emit a forecast for the unseen day.
            extended = np.append(returns, 0.0)
            forecasts, calls = baseline(extended)
            expected = float(forecasts[-1])
            prob_up = float(calls[-1])
            models[name] = {
                "expected_return": expected,
                "prob_up": prob_up,
                # p=0.5 is a genuine abstention, not a hidden "up" -- record it as such.
                "direction": "flat" if prob_up == 0.5 else ("up" if prob_up > 0.5 else "down"),
            }
        entries[symbol] = {"last_close": float(closes[-1]), "last_bar": dates[-1], "models": models}
        print(f"{symbol}: locked from close {closes[-1]:.2f} on {dates[-1]}", file=sys.stderr)

    if not entries:
        # Nothing was locked (every symbol skipped or refused). Writing an empty file here would
        # leave behind something that looks like a real prediction record but settles to nothing.
        return None

    PREDICTIONS_DIR.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps({"as_of": as_of.isoformat(), "symbols": entries}, indent=2))
    return out


def record_agent(as_of: date, symbol: str, direction: str, prob_up: float, label: str) -> Path:
    # Takes an as-of date and one agent signal; returns the file path after filing that signal beside the baselines.
    out = PREDICTIONS_DIR / f"{as_of.isoformat()}.json"
    if not out.exists():
        raise FileNotFoundError(f"lock the baselines first: no {out}")
    locked = json.loads(out.read_text())
    if symbol not in locked["symbols"]:
        raise KeyError(f"{symbol} was never locked on {as_of} -- cannot score an agent call against no baseline")
    locked["symbols"][symbol]["models"][label] = {
        "expected_return": None,
        "prob_up": prob_up,
        "direction": direction,
    }
    out.write_text(json.dumps(locked, indent=2))
    return out


def score(as_of: date) -> int:
    # Takes the as-of date a prediction file was locked on; returns an exit code after printing the hit/miss table.
    path = PREDICTIONS_DIR / f"{as_of.isoformat()}.json"
    if not path.exists():
        print(f"no prediction file at {path}", file=sys.stderr)
        return 1
    locked = json.loads(path.read_text())

    tally: dict[str, list[int]] = {}
    rows = []
    for symbol, entry in locked["symbols"].items():
        dates, closes = _closes(symbol, today_ist())
        try:
            idx = dates.index(entry["last_bar"])
        except ValueError:
            print(f"{symbol}: locked bar {entry['last_bar']} missing from refetched series", file=sys.stderr)
            continue
        if idx + 1 >= len(dates):
            print(f"{symbol}: next trading day not published yet", file=sys.stderr)
            continue

        realised = (closes[idx + 1] - closes[idx]) / closes[idx]
        actual = "up" if realised > 0 else "down"
        for name, m in entry["models"].items():
            if m["direction"] == "flat":
                continue
            hit = int(m["direction"] == actual)
            tally.setdefault(name, []).append(hit)
            rows.append((symbol, dates[idx + 1], name, m["direction"], actual, realised, hit))

    print(f"\n{'symbol':<15}{'day':<12}{'model':<10}{'called':<8}{'actual':<8}{'return':>9}{'hit':>5}")
    print("-" * 67)
    for symbol, day, name, called, actual, realised, hit in rows:
        print(f"{symbol:<15}{day:<12}{name:<10}{called:<8}{actual:<8}{realised * 100:>8.2f}%{'Y' if hit else 'N':>5}")
    print("-" * 67)
    for name, hits in sorted(tally.items()):
        print(f"{name:<25}{sum(hits)}/{len(hits)} correct ({100 * sum(hits) / len(hits):.0f}%)")
    return 0


def main() -> int:
    # Takes no arguments (parses argv); returns a process exit code for the requested lock or score mode.
    parser = argparse.ArgumentParser(description="Lock and score next-trading-day direction predictions")
    parser.add_argument("mode", choices=["lock", "agent", "score"])
    parser.add_argument("--as-of", default=today_ist().isoformat(), help="the trading day predictions are made from")
    parser.add_argument("--symbols", nargs="*", default=SYMBOLS)
    parser.add_argument("--symbol", help="agent mode: the symbol this signal is for")
    parser.add_argument("--direction", choices=["up", "down"], help="agent mode: the called direction")
    parser.add_argument("--prob", type=float, help="agent mode: the called probability of up")
    parser.add_argument("--label", default="agent", help="agent mode: name to file the signal under")
    args = parser.parse_args()

    as_of = date.fromisoformat(args.as_of)
    if args.mode == "lock":
        written = lock(as_of, args.symbols)
        print(f"\nwrote {written}" if written else f"\nnothing locked for {as_of}; no file written")
        return 0 if written else 1
    if args.mode == "agent":
        if not (args.symbol and args.direction and args.prob is not None):
            parser.error("agent mode needs --symbol, --direction and --prob")
        path = record_agent(as_of, args.symbol, args.direction, args.prob, args.label)
        print(f"recorded {args.label} {args.direction} p={args.prob} for {args.symbol} -> {path}")
        return 0
    return score(as_of)


if __name__ == "__main__":
    sys.exit(main())
