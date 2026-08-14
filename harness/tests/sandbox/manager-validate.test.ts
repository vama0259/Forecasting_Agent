// harness/tests/sandbox/manager-validate.test.ts
import { describe, it, expect, beforeAll } from 'vitest';
import { writeFileSync, mkdtempSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

// Docker Desktop's VM-based daemon (WSL2 backend) cannot see host paths under
// the native WSL filesystem (os.tmpdir() -> /tmp) as bind-mount sources -- they
// resolve to an empty directory inside the container instead of the real file.
// Paths under the repo (Windows-visible via /mnt/c) work correctly, so scratch
// files for Docker-mounted tests must live there instead of os.tmpdir().
const DOCKER_VISIBLE_TMP = join(process.cwd(), '.sandbox-test-tmp');
mkdirSync(DOCKER_VISIBLE_TMP, { recursive: true });
import Dockerode from 'dockerode';
import { SandboxManager } from '../../src/sandbox/manager.js';
import { ValidationFailedError } from '../../src/sandbox/types.js';

let dockerAvailable = false;
beforeAll(async () => {
  try {
    const d = new Dockerode();
    await d.ping();
    dockerAvailable = true;
  } catch {
    dockerAvailable = false;
  }
});

const VALID_MODEL_SCRIPT = `
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
`;

const UNAPPROVED_IMPORT_SCRIPT = `
import neuralforecast  # not in the pinned image, and no network to pip install it
`;

describe('SandboxManager.runValidate (requires Docker)', () => {
  it('runs a valid model script and returns a matching EvalResult', async (ctx) => {
    if (!dockerAvailable) {
      ctx.skip();
      return;
    }
    const mgr = new SandboxManager();
    const dir = mkdtempSync(join(DOCKER_VISIBLE_TMP, 'sandbox-validate-'));
    const modelPath = join(dir, 'model.py');
    writeFileSync(modelPath, VALID_MODEL_SCRIPT);

    const result = await mgr.runValidate({
      runId: 'validate-run-1',
      tier: 'validate',
      modelScriptPath: modelPath,
    });

    expect(result.evalResult).toBeDefined();
    expect(result.evalResult?.verdict).toBeDefined();
    await mgr.shutdown();
  });

  it('rejects a script importing an unapproved package as ValidationFailedError', async (ctx) => {
    if (!dockerAvailable) {
      ctx.skip();
      return;
    }
    const mgr = new SandboxManager();
    const dir = mkdtempSync(join(DOCKER_VISIBLE_TMP, 'sandbox-validate-'));
    const modelPath = join(dir, 'model.py');
    writeFileSync(modelPath, UNAPPROVED_IMPORT_SCRIPT);

    await expect(
      mgr.runValidate({ runId: 'validate-run-2', tier: 'validate', modelScriptPath: modelPath }),
    ).rejects.toThrow(ValidationFailedError);
    await mgr.shutdown();
  });
});
