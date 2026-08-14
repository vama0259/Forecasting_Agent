# sandbox/entrypoints/validate.py
"""Fixed validate-tier entrypoint: runs the submitted model script, feeds its output
through M8's evaluate(), and prints the result as a single delimited stdout line.
Never executes anything other than this fixed sequence -- the model script's content
is arbitrary, but this script's own control flow is not."""

import json
import os
import subprocess  # nosec B404
import sys

RESULT_PREFIX = "__EVAL_RESULT__"


def main() -> int:
    """Takes no arguments (reads MODEL_SCRIPT_PATH env var); returns process exit code."""
    model_script_path = os.environ.get("MODEL_SCRIPT_PATH", "/workspace/model.py")
    request_path = "/tmp/eval_request.json"  # noqa: S108 # nosec B108

    try:
        proc = subprocess.run(  # noqa: S603 # nosec B603
            [sys.executable, model_script_path],
            capture_output=True,
            text=True,
            timeout=30,
        )
        if proc.returncode != 0:
            raise RuntimeError(f"model script exited {proc.returncode}: {proc.stderr}")

        with open(request_path) as f:
            request_json = json.load(f)

        from forecasting_agent.evaluation import EvalRequest, evaluate  # type: ignore[import-untyped]

        request = EvalRequest.model_validate(request_json)
        result = evaluate(request)
        print(RESULT_PREFIX + result.model_dump_json())  # noqa: T201
        return 0
    except Exception as exc:
        payload = {"error": type(exc).__name__, "detail": str(exc)}
        print(RESULT_PREFIX + json.dumps(payload))  # noqa: T201
        return 1


if __name__ == "__main__":
    sys.exit(main())
