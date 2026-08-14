# sandbox/tests/test_validate_entrypoint.py
import json
import subprocess
import sys
import textwrap
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
ENTRYPOINT = REPO_ROOT / "sandbox" / "entrypoints" / "validate.py"

VALID_MODEL_SCRIPT = textwrap.dedent(
    """
    import json
    request = {
        "returns": [0.01, -0.02, 0.015, 0.005, -0.01, 0.02, 0.01, -0.005, 0.015, 0.0],
        "forecasts": [0.01, -0.02, 0.015, 0.005, -0.01, 0.02, 0.01, -0.005, 0.015, 0.0],
        "calls": [0.6, 0.4, 0.6, 0.55, 0.4, 0.65, 0.6, 0.45, 0.6, 0.5],
        "timestamps": [f"2024-01-{i+1:02d}T00:00:00+00:00" for i in range(10)],
        "as_of": "2024-01-11T00:00:00+00:00",
        "segment": "EQUITY_DELIVERY",
        "position_notional": [1000.0] * 10,
        "trade_side": ["buy"] * 10,
        "capital": 100000.0,
    }
    with open("/tmp/eval_request.json", "w") as f:
        json.dump(request, f)
    """
)

CRASHING_MODEL_SCRIPT = "raise RuntimeError('boom')"


def run_entrypoint(model_script_body: str, tmp_path: Path) -> subprocess.CompletedProcess[str]:
    model_path = tmp_path / "model.py"
    model_path.write_text(model_script_body)
    env = {"PYTHONPATH": str(REPO_ROOT / "src"), "MODEL_SCRIPT_PATH": str(model_path)}
    return subprocess.run(  # noqa: S603
        [sys.executable, str(ENTRYPOINT)],
        capture_output=True,
        text=True,
        env=env,
        timeout=60,
    )


def test_valid_model_produces_eval_result(tmp_path: Path) -> None:
    result = run_entrypoint(VALID_MODEL_SCRIPT, tmp_path)
    assert result.returncode == 0, result.stderr
    line = [ln for ln in result.stdout.splitlines() if ln.startswith("__EVAL_RESULT__")][-1]
    payload = json.loads(line[len("__EVAL_RESULT__") :])
    assert "verdict" in payload
    assert "layers" in payload


def test_crashing_model_exits_nonzero_with_error_payload(tmp_path: Path) -> None:
    result = run_entrypoint(CRASHING_MODEL_SCRIPT, tmp_path)
    assert result.returncode != 0
    line = [ln for ln in result.stdout.splitlines() if ln.startswith("__EVAL_RESULT__")][-1]
    payload = json.loads(line[len("__EVAL_RESULT__") :])
    assert "error" in payload
    assert "boom" in payload["detail"]
