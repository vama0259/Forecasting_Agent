"""Detects lookahead leakage in an agent-written forecasting script by scoring it on serially shuffled bars."""

import argparse
import json
import subprocess  # nosec B404
import sys
import tempfile
from datetime import UTC, datetime
from pathlib import Path

import numpy as np

from forecasting_agent.evaluation import EvalRequest, evaluate

# A model that only exploits genuine serial structure must collapse to chance once that structure is
# destroyed. A model that trains on its own test label keeps "predicting" it, because the leak travels
# with the shuffled bar rather than with the ordering. That asymmetry is the whole test.
IMAGE = "forecasting-sandbox:latest"


def shuffle_bars(bars: list[dict], seed: int) -> list[dict]:
    """Takes OHLCV bars and a seed; returns bars whose returns are permuted and price path rebuilt from them."""
    rng = np.random.default_rng(seed)
    close = np.array([b["close"] for b in bars], dtype=float)
    rets = close[1:] / close[:-1] - 1.0

    # Carry each bar's own intra-bar geometry and volume along with its return, so only the ORDER is
    # destroyed -- marginal distributions of returns, ranges and volume stay exactly as observed.
    shape = [
        (bars[i]["open"] / bars[i]["close"], bars[i]["high"] / bars[i]["close"], bars[i]["low"] / bars[i]["close"])
        for i in range(1, len(bars))
    ]
    volume = [bars[i]["volume"] for i in range(1, len(bars))]

    order = rng.permutation(len(rets))
    out = [dict(bars[0])]
    prev_close = float(close[0])
    for out_i, src_i in enumerate(order, start=1):
        new_close = prev_close * (1.0 + float(rets[src_i]))
        o_r, h_r, l_r = shape[src_i]
        out.append(
            {
                "date": bars[out_i]["date"],
                "open": new_close * o_r,
                "high": new_close * h_r,
                "low": new_close * l_r,
                "close": new_close,
                "volume": volume[src_i],
            }
        )
        prev_close = new_close
    return out


def score_payload(path: Path) -> dict[str, float] | None:
    """Takes a written eval payload path; returns its pooled MASE ratio, hit rate and resolution, or None if invalid."""
    with open(path) as fh:
        req = json.load(fh)
    ts = [datetime.fromisoformat(t).astimezone(UTC) for t in req["timestamps"]]
    result = evaluate(
        EvalRequest(
            returns=req["returns"],
            forecasts=req["forecasts"],
            calls=req["calls"],
            timestamps=ts,
            as_of=ts[-1],
            segment="EQUITY_DELIVERY",
            position_notional=req["position_notional"],
            trade_side=req["trade_side"],
            capital=req["capital"],
        )
    )
    if result.verdict.status == "INVALID":
        return None
    l1 = [s for s in result.layers if s.layer == 1]
    mase = float(np.mean([s.value for s in l1 if s.value is not None]))
    zero = float(np.mean([s.zero_forecast_mase for s in l1 if s.zero_forecast_mase is not None]))
    return {
        "ratio": mase / zero,
        "beats": sum(1 for s in l1 if s.beats_zero) / len(l1),
        "hit_rate": result.direction.rate if result.direction else float("nan"),
        "resolution": result.brier_split.resolution if result.brier_split else float("nan"),
    }


def run_model(model: Path, bars_path: Path, out_path: Path, workdir: Path, *, workspace_mode: bool) -> bool:
    """Takes a model script, IO paths and the calling convention; returns whether the run produced a payload."""
    if workspace_mode:
        # The real agent convention: the script reads a hardcoded /workspace/bars.json and emits a
        # self-contained /workspace/model.py, which in turn writes /tmp/eval_request.json. Mount the
        # work dir AS /workspace so those literal paths resolve, then copy the payload back out.
        script = (
            f"cd /workspace && python /workspace/{model.name} >/dev/null 2>&1 "
            f"&& python /workspace/model.py >/dev/null 2>&1 "
            f"&& cp /tmp/eval_request.json /workspace/{out_path.name}"
        )
        cmd = ["docker", "run", "--rm", "-v", f"{workdir}:/workspace", IMAGE, "sh", "-c", script]
    else:
        cmd = [
            "docker", "run", "--rm", "-v", f"{workdir}:/w", IMAGE,
            "python", f"/w/{model.name}", f"/w/{bars_path.name}", f"/w/{out_path.name}",
        ]  # fmt: skip
    proc = subprocess.run(cmd, capture_output=True, text=True, timeout=900)  # noqa: S603 # nosec B603
    if proc.returncode != 0:
        print(f"    run failed: {proc.stderr[-300:]}", file=sys.stderr)
    return out_path.exists()


def uses_workspace_convention(model: Path) -> bool:
    """Takes a model script path; returns whether it reads the agent's hardcoded /workspace paths."""
    text = model.read_text(errors="replace")
    return "/workspace/bars.json" in text and "sys.argv" not in text


def main() -> int:
    """Takes no arguments (parses argv); returns an exit code after reporting the shuffled-data verdict."""
    parser = argparse.ArgumentParser(description="Probe an agent-written model script for lookahead leakage")
    parser.add_argument("model", help="model script taking <bars.json> <out.json>")
    parser.add_argument("bars", help="real bars.json to derive shuffled series from")
    parser.add_argument("--shuffles", type=int, default=3, help="number of independent permutations")
    parser.add_argument("--seed", type=int, default=0)
    args = parser.parse_args()

    model, bars_file = Path(args.model).resolve(), Path(args.bars).resolve()
    with open(bars_file) as fh:
        bars = json.load(fh)["bars"]
    workspace_mode = uses_workspace_convention(model)
    convention = "agent /workspace convention" if workspace_mode else "argv convention"
    print(f"probing {model.name} on {len(bars)} bars, {args.shuffles} shuffles ({convention})")

    with tempfile.TemporaryDirectory() as tmp:
        workdir = Path(tmp)
        (workdir / model.name).write_bytes(model.read_bytes())
        rows = []
        for k in range(args.shuffles):
            # In workspace mode the script only ever reads the fixed name, so each shuffle overwrites it.
            bars_path = workdir / ("bars.json" if workspace_mode else f"shuf_{k}.json")
            out_path = workdir / f"out_{k}.json"
            with open(bars_path, "w") as fh:
                json.dump({"symbol": "SHUFFLED", "bars": shuffle_bars(bars, args.seed + k)}, fh)
            print(f"  shuffle {k}...", flush=True)
            if not run_model(model, bars_path, out_path, workdir, workspace_mode=workspace_mode):
                continue
            scored = score_payload(out_path)
            if scored:
                rows.append(scored)

    if not rows:
        print("no valid runs -- cannot judge", file=sys.stderr)
        return 2

    ratio = float(np.mean([r["ratio"] for r in rows]))
    beats = float(np.mean([r["beats"] for r in rows]))
    hit = float(np.mean([r["hit_rate"] for r in rows]))
    res = float(np.mean([r["resolution"] for r in rows]))
    print(f"\n  MASE ratio   {ratio:.3f}   (expect ~1.00 on structureless data)")
    print(f"  beats zero   {beats:.0%}     (expect the same low rate the trivial baselines get)")
    print(f"  hit rate     {hit:.3f}   (expect ~0.50)")
    print(f"  resolution   {res:.4f}  (expect ~0.000)")

    # Shuffled bars contain no exploitable structure, so anything that still looks skilled is
    # scoring itself on information it should not have.
    leaking = ratio < 0.98 or res > 0.02
    print(f"\n  VERDICT: {'LEAK SUSPECTED' if leaking else 'no leakage signal'}")
    if leaking:
        print("  This script scores better than chance on data with no predictable structure.")
    return 1 if leaking else 0


if __name__ == "__main__":
    sys.exit(main())
