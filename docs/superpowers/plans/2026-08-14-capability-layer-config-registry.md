# Capability Layer & Config Registry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: this plan is built for `superpowers:gemini-plan-implementation` — Gemini 3.7 Flash (High) implements each task via `run_agy`, a Haiku validator subagent gates it (escalating to Sonnet on failure). Steps use checkbox (`- [ ]`) syntax for tracking. Do **not** run this through the plain `subagent-driven-development` Claude-implementer loop; every task below already carries its Gemini prompt and validator brief.

**Goal:** Ship the TypeScript capability registry and Zod-validated config loader for GitHub issue #4 (Story 1), plus the toolchain wiring that makes `make check` and CI actually check the new TypeScript.

**Architecture:** A new `harness/` package (Node 24, pnpm, strict ESM, Zod 4) sitting beside the existing Python `src/`. `config.ts` holds schemas only; `config-loader.ts` owns file I/O and does YAML-parse-then-interpolate; `errors.ts` owns the two error types and secret redaction; `capabilities/registry.ts` wraps a private `Map` behind a mapped-type `resolve<K>()` that makes `cap('market_data').fetch_ohlcv()` typecheck castless. `validateAll()` probes every provider with an owned `AbortController`, aggregates failures via `Promise.allSettled`, then seals the registry.

**Tech Stack:** Node 24 · pnpm 11 (via corepack) · TypeScript 5.9 (strict, `NodeNext`, `verbatimModuleSyntax`) · Zod ^4 (`4.4.3`) · `yaml` ^2 (`2.9.0`) · Vitest ^4 (`4.1.10`) · ESLint 9 flat config + typescript-eslint 8 + Prettier 3.

**Spec:** `docs/superpowers/specs/2026-08-14-capability-layer-config-registry-design.md` (cleared `reviewing-specs`, `APPROVED` at R5 after 4 rounds of measured findings). Executors read both documents. Every "why is it like this" question below is answered in that spec's Decisions section — the answers are measured, not stylistic. Do not redesign.

**Branch:** `feat/issue-4-capability-layer` (already created; the spec is committed there).

---

## Global Constraints

Every task's requirements implicitly include this section. Each line traces to a measured defect from the spec's Review Log — a task that "simplifies" one of these re-introduces a real, demonstrated bug.

1. **Parse YAML FIRST, then interpolate `${VAR}` into string values only.** Never do text-level substitution on the raw file before parsing — a secret value can then inject config structure (demonstrated, R1). Interpolation walks the *parsed* tree and only rewrites `string` leaves.
2. **`resolve<K extends CapabilityName>(name: K): CapabilityMap[K]`** — the mapped return type is the story's acceptance criterion. `cap('market_data').fetch_ohlcv(...)` must typecheck with **no cast at the call site**; `cap('chat').fetch_ohlcv(...)` and `cap('nonexistent')` must be **compile errors**.
3. **Health probes own their `AbortController`.** Per probe: construct an `AbortController`, `setTimeout` to `abort()` it and reject, `Promise.race` the provider's `healthCheck(signal)` against that rejection, and `clearTimeout` in a `finally`. Do **not** use `AbortSignal.timeout()` and do **not** leave a bare race timer — both are ref'd and hold the event loop open, producing a measured 5s hang on the **success** path while `validateAll()` returned in 2ms (R3).
4. **`healthCheck` is OPTIONAL** (`healthCheck?(signal: AbortSignal): Promise<void>`). `validateAll()` returns `{ skipped: CapabilityName[] }` listing the capabilities that implement no probe, so a pass never overstates what was checked.
5. **`validateAll()` aggregates via `Promise.allSettled`** and reports every failure in one error, then **seals** the registry — on both the success and the failure path. Post-seal `register()` throws; duplicate `register()` throws.
6. **Exactly ONE layer attaches the capability name to an error message** — the per-probe catch prefixes `` `${name}: ` ``. The abort reason must therefore be **bare**: `new Error('probe timeout')`, never `` `${name}: probe timeout` ``, or messages read `market_data: market_data: probe timeout` (R4).
7. **Two error types, never merged.** `ConfigValidationError` (malformed config — a developer fixes a file) and `CapabilityHealthError` (a provider is unreachable — an operator checks infra).
8. **Secrets are redacted at the error boundary.** Zod echoes offending values; `llm.api_key` must never reach a log, an error message, or CI output.
9. **`z.record` needs BOTH arguments under Zod 4**: `z.record(z.string(), z.unknown())`. Single-arg is a compile error, proven by `tsc` (R1).
10. **`harness/.npmrc` must set `engine-strict=true`.** Without it `engines.node` is advisory only — measured: default install with an impossible range emits `npm warn EBADENGINE` and then *succeeds*.
11. **Do NOT add `nunjucks` or `@langchain/langgraph`.** Deferred to Stories #9/#11; this story imports neither. Do not add `@modelcontextprotocol/sdk` either.
12. **Config failure throws; it never calls `process.exit`.** Story #10's CLI catches, prints, and exits. This keeps the loader testable.
13. **Code style:** no comments unless the WHY is non-obvious. OOP / SOLID / Clean Architecture. `capabilities/` has zero framework imports. Prettier: `printWidth: 120`, `singleQuote: true`, `trailingComma: "all"`, `semi: true`. All Node commands run through `pnpm` from inside `harness/`; all Python commands through `uv run` from the repo root.

### Out of scope — do not build, do not add tasks for

Live MCP client wiring · plugin auto-discovery · the CLI entrypoint (Story #10) · full `sandbox`/`eval` schemas (Stories #7/#6) · required-vs-optional capabilities (spec decision 10, deferred).

**The integration test with a real mock MCP server moved to Story #5.** This story's suite must **not** claim to satisfy that criterion and no unit test may be relabelled to cover it.

### Verification already performed by the plan author

Do not re-litigate these; they were run, not assumed.

- Node `v24.19.0` local; `pnpm 11.21.0` available via `corepack enable pnpm`.
- Installed `zod@4.4.3`, `yaml@2.9.0`, `vitest@4.1.10`, `typescript@5.9.3` and confirmed the exact versions resolve.
- **Every failing test in this plan was run red** against an empty `src/` — all three files failed with `Cannot find module '../src/...'`, i.e. missing implementation, not a typo.
- A reference implementation was then written and the full suite run green: **32/32 tests pass, `tsc --noEmit` clean, `eslint .` clean, `prettier --check` clean.**
- **The two `@ts-expect-error` directives are load-bearing.** Stripping them makes `tsc` emit exactly the two errors the spec's AC demands:
  `tests/registry.test.ts(40,30): error TS2339: Property 'fetch_ohlcv' does not exist on type 'CapabilityProvider'.`
  `tests/registry.test.ts(42,22): error TS2345: Argument of type '"nonexistent"' is not assignable to parameter of type '"chat" | "search" | "sentiment" | "market_data"'.`
  This is why they must stay: if the types regress and those lines stop being errors, `tsc` fails on the now-unused directives. The negative cases are enforced by the build.
- ESLint is deliberately configured with `tseslint.configs.recommended`, **not** `recommendedTypeChecked`. The type-checked preset was tried and rejected: it flags the deliberate `@ts-expect-error` lines (`no-unsafe-call`, `no-unsafe-return`) and the intentionally-await-less mock stubs (`require-await`), which would force either rule-disable noise or weakening the tests.

---

## File Structure

**Created (all new):**

| Path | Responsibility | Task |
|---|---|---|
| `harness/package.json` | pnpm manifest, scripts, `engines.node >= 24` | 1 |
| `harness/.npmrc` | `engine-strict=true` — makes `engines` binding | 1 |
| `harness/tsconfig.json` | strict ESM `NodeNext` compiler config | 1 |
| `harness/eslint.config.js` | ESLint 9 flat config | 1 |
| `harness/.prettierrc.json` | 120 cols, single quotes | 1 |
| `harness/harness_config.yaml` | example runtime config | 1 |
| `harness/.env.example` | documents `LLM_API_KEY` | 1 |
| `harness/pnpm-lock.yaml` | generated by `pnpm install` | 1 |
| `harness/src/errors.ts` | `redact()`, `ConfigValidationError`, `CapabilityHealthError` | 2 |
| `harness/src/config.ts` | Zod schemas + derived types (schema only, no I/O) | 2 |
| `harness/tests/errors.test.ts` | error-type and redaction tests | 2 |
| `harness/src/config-loader.ts` | `loadConfig()` — file I/O, interpolation, referential check | 3 |
| `harness/tests/config.test.ts` | loader tests incl. YAML-injection regressions | 3 |
| `harness/src/capabilities/types.ts` | `CapabilityProvider`, `MarketDataProvider`, `CapabilityMap` | 4 |
| `harness/src/capabilities/registry.ts` | `CapabilityRegistry`, `createCapabilityAccessor` | 4 |
| `harness/tests/helpers.ts` | `createMockProvider()`, `createMockMarketData()` | 4 |
| `harness/tests/registry.test.ts` | registry, probe-timeout and timer-leak tests | 4 |

**Modified:**

| Path | Change | Task |
|---|---|---|
| `.github/workflows/ci.yml` | add a `harness` job (pnpm install/lint/typecheck/test) | 5 |
| `Makefile` | `lint`/`test`/`check` cover both stacks | 5 |
| `.pre-commit-config.yaml` | ESLint + Prettier hooks scoped to `harness/` | 5 |

`.gitignore` already covers `/node_modules`, `/dist`, `pnpm-debug.log*` — verified, **no work needed**.

---

## Dependency Ordering & Parallel Dispatch

```
Task 1  (scaffold)              ── sequential, blocks everything
   │
Task 2  (errors.ts + config.ts) ── sequential, shared contract for 3 and 4
   │
   ├── Task 3 (config-loader)   ─┐
   ├── Task 4 (registry)        ─┼── dispatch these THREE in parallel,
   └── Task 5 (toolchain)       ─┘   each in its own worktree
```

**Independence check** — one row per pair of tasks in the parallel wave. Overlap means "not safe to parallelize".

| Pair | Shared files | Shared interfaces | Safe to parallelize |
|---|---|---|---|
| Task 3 × Task 4 | none — `src/config-loader.ts` + `tests/config.test.ts` vs `src/capabilities/*` + `tests/registry.test.ts`, `tests/helpers.ts` | both *import* Task 2's `errors.ts`/`config.ts` read-only; neither modifies them | **Yes** |
| Task 3 × Task 5 | none — `harness/**` vs repo-root `ci.yml`, `Makefile`, `.pre-commit-config.yaml` | none | **Yes** |
| Task 4 × Task 5 | none — `harness/src/capabilities/**` vs repo-root config files | none | **Yes** |
| Task 1 × Task 2 | `harness/` tree exists only after Task 1 | Task 2 needs `tsconfig.json`, `package.json`, installed `node_modules` | **No — sequence** |
| Task 2 × Tasks 3,4 | none | Tasks 3 and 4 both consume `ConfigValidationError`, `CapabilityHealthError`, `redact`, `CapabilityName`, `HarnessConfigSchema` | **No — sequence** |

**Constraint for the dispatcher:** Task 5 changes `Makefile`'s `check` target to also run the harness suite. If Task 5 merges before Tasks 3 and 4, `make check` will fail on the missing implementations. Merge order: Tasks 3 and 4 first, Task 5 last — or run Task 5's validator with the harness gate scoped to `pnpm lint && pnpm typecheck` only.

---

## Task 1: Harness package scaffold

**Seam note.** This task's interface is the `harness/` package boundary itself: a directory that answers `pnpm install`, `pnpm lint`, `pnpm typecheck`, `pnpm test` and nothing else. It hides the entire Node toolchain choice (which bundler, which test runner, which lint preset) behind four script names, so Task 5 can wire CI and the Makefile against those four names without knowing anything about TypeScript, and so swapping Vitest for something else later touches one file. It is a real boundary because the Python side of this repo consumes it purely as those four commands.

**Files:**
- Create: `harness/package.json`
- Create: `harness/.npmrc`
- Create: `harness/tsconfig.json`
- Create: `harness/eslint.config.js`
- Create: `harness/.prettierrc.json`
- Create: `harness/harness_config.yaml`
- Create: `harness/.env.example`
- Generated: `harness/pnpm-lock.yaml`

**Interfaces:**
- Consumes: nothing.
- Produces: the four pnpm scripts `lint`, `format`, `typecheck`, `test` (Task 5 wires exactly these names); a `tsconfig.json` with `strict`, `NodeNext` module resolution and `verbatimModuleSyntax` (Tasks 2–4 write code against it — note `verbatimModuleSyntax` requires `import type` for type-only imports and `.js` extensions on all relative imports); the dependency set `zod@^4.4.3`, `yaml@^2.9.0`, `vitest@^4.1.10`, `typescript@^5.9.3`, `@types/node@^24.7.0`.

**Failing test.** This task's gate is not a Vitest file — it is the scaffold answering its own four commands. The executable check is:

```bash
cd harness && corepack enable pnpm && pnpm install --frozen-lockfile=false && pnpm typecheck && node -e "
const pkg = require('./package.json');
const assert = require('node:assert');
assert.strictEqual(pkg.type, 'module', 'package must be ESM');
assert.strictEqual(pkg.engines.node, '>=24');
for (const s of ['lint','format','typecheck','test']) assert.ok(pkg.scripts[s], 'missing script: ' + s);
for (const d of ['nunjucks','@langchain/langgraph','@modelcontextprotocol/sdk'])
  assert.ok(!pkg.dependencies?.[d] && !pkg.devDependencies?.[d], 'forbidden dependency: ' + d);
assert.ok(require('fs').readFileSync('.npmrc','utf8').includes('engine-strict=true'), '.npmrc must set engine-strict=true');
console.log('SCAFFOLD OK');
"
```

Run before implementation: fails with `cd: harness: No such file or directory`. That is the correct red — the package does not exist.

- [ ] **Step 1: Run the scaffold check to verify it fails**

Run: `cd /mnt/c/Users/vama0/Desktop/Forecasting_Agent && cd harness`
Expected: FAIL — `no such file or directory: harness`

- [ ] **Step 2: Create `harness/package.json`**

```json
{
  "name": "@forecasting-agent/harness",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "engines": {
    "node": ">=24"
  },
  "packageManager": "pnpm@11.21.0",
  "scripts": {
    "lint": "eslint . && prettier --check \"src/**/*.ts\" \"tests/**/*.ts\"",
    "format": "eslint . --fix && prettier --write \"src/**/*.ts\" \"tests/**/*.ts\"",
    "typecheck": "tsc --noEmit",
    "test": "vitest run"
  },
  "dependencies": {
    "yaml": "^2.9.0",
    "zod": "^4.4.3"
  },
  "devDependencies": {
    "@eslint/js": "^9.0.0",
    "@types/node": "^24.7.0",
    "eslint": "^9.0.0",
    "eslint-config-prettier": "^10.0.0",
    "prettier": "^3.0.0",
    "typescript": "^5.9.3",
    "typescript-eslint": "^8.0.0",
    "vitest": "^4.1.10"
  }
}
```

- [ ] **Step 3: Create `harness/.npmrc`**

```ini
engine-strict=true
```

Without this line `engines.node` is advisory only — measured: an impossible range emits `npm warn EBADENGINE` and installs anyway.

- [ ] **Step 4: Create `harness/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2023",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "noEmit": true,
    "skipLibCheck": true,
    "verbatimModuleSyntax": true,
    "types": ["node"]
  },
  "include": ["src/**/*.ts", "tests/**/*.ts"]
}
```

- [ ] **Step 5: Create `harness/eslint.config.js`**

```js
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  { ignores: ['node_modules/**', 'dist/**', 'coverage/**', 'eslint.config.js'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  prettier,
);
```

Use `tseslint.configs.recommended`, **not** `recommendedTypeChecked` — the type-checked preset was tried and rejected because it flags the deliberate `@ts-expect-error` lines and the intentionally-await-less mock stubs in Task 4.

- [ ] **Step 6: Create `harness/.prettierrc.json`**

```json
{
  "printWidth": 120,
  "singleQuote": true,
  "trailingComma": "all",
  "semi": true
}
```

- [ ] **Step 7: Create `harness/harness_config.yaml`**

```yaml
llm:
  provider: anthropic
  model: claude-sonnet-4
  api_key: ${LLM_API_KEY}

mcp_servers:
  market:
    command: node
    args: ["./servers/market-data/index.js"]
  web:
    command: node
    args: ["./servers/web-search/index.js"]

capabilities:
  chat: llm
  search: web
  sentiment: llm
  market_data: market

sandbox: {}
eval: {}
```

`sandbox` and `eval` are deliberate placeholders — Stories #7 and #6 tighten their own sections.

- [ ] **Step 8: Create `harness/.env.example`**

```bash
# Copy to .env and fill in. .env is gitignored; never commit real values.
LLM_API_KEY=
```

- [ ] **Step 9: Install and verify the scaffold check passes**

```bash
cd harness
corepack enable pnpm
pnpm install
pnpm typecheck
```

Expected: install succeeds, `pnpm typecheck` succeeds (no source files yet, so it is trivially clean), and the Step-1 `node -e` assertions print `SCAFFOLD OK`.

- [ ] **Step 10: Commit**

```bash
git add harness/
git commit -m "chore(harness): scaffold Node 24 + pnpm + TypeScript package for capability layer"
```

**Gemini delegation prompt.**

> `run_agy --mode write --add-dir /mnt/c/Users/vama0/Desktop/Forecasting_Agent`
>
> You are scaffolding a new Node package inside an existing Python repository at `/mnt/c/Users/vama0/Desktop/Forecasting_Agent`. Create a new directory `harness/` at the repo root. Do not touch anything outside `harness/`.
>
> Create exactly these files with exactly this content:
>
> `harness/package.json`:
> ```json
> {
>   "name": "@forecasting-agent/harness",
>   "version": "0.1.0",
>   "private": true,
>   "type": "module",
>   "engines": { "node": ">=24" },
>   "packageManager": "pnpm@11.21.0",
>   "scripts": {
>     "lint": "eslint . && prettier --check \"src/**/*.ts\" \"tests/**/*.ts\"",
>     "format": "eslint . --fix && prettier --write \"src/**/*.ts\" \"tests/**/*.ts\"",
>     "typecheck": "tsc --noEmit",
>     "test": "vitest run"
>   },
>   "dependencies": { "yaml": "^2.9.0", "zod": "^4.4.3" },
>   "devDependencies": {
>     "@eslint/js": "^9.0.0",
>     "@types/node": "^24.7.0",
>     "eslint": "^9.0.0",
>     "eslint-config-prettier": "^10.0.0",
>     "prettier": "^3.0.0",
>     "typescript": "^5.9.3",
>     "typescript-eslint": "^8.0.0",
>     "vitest": "^4.1.10"
>   }
> }
> ```
>
> `harness/.npmrc` — a single line `engine-strict=true`. This is mandatory: without it `engines.node` is advisory only (measured — an impossible range emits `npm warn EBADENGINE` and installs anyway). Do not omit it and do not add other settings.
>
> `harness/tsconfig.json`:
> ```json
> {
>   "compilerOptions": {
>     "target": "ES2023",
>     "module": "NodeNext",
>     "moduleResolution": "NodeNext",
>     "strict": true,
>     "noUncheckedIndexedAccess": true,
>     "exactOptionalPropertyTypes": true,
>     "noEmit": true,
>     "skipLibCheck": true,
>     "verbatimModuleSyntax": true,
>     "types": ["node"]
>   },
>   "include": ["src/**/*.ts", "tests/**/*.ts"]
> }
> ```
>
> `harness/eslint.config.js`:
> ```js
> import js from '@eslint/js';
> import tseslint from 'typescript-eslint';
> import prettier from 'eslint-config-prettier';
>
> export default tseslint.config(
>   { ignores: ['node_modules/**', 'dist/**', 'coverage/**', 'eslint.config.js'] },
>   js.configs.recommended,
>   ...tseslint.configs.recommended,
>   prettier,
> );
> ```
> Use `tseslint.configs.recommended`. Do NOT substitute `recommendedTypeChecked` — it was tried and rejected because it flags deliberate `@ts-expect-error` lines and intentionally-await-less test stubs added in a later task.
>
> `harness/.prettierrc.json`:
> ```json
> { "printWidth": 120, "singleQuote": true, "trailingComma": "all", "semi": true }
> ```
>
> `harness/harness_config.yaml`:
> ```yaml
> llm:
>   provider: anthropic
>   model: claude-sonnet-4
>   api_key: ${LLM_API_KEY}
>
> mcp_servers:
>   market:
>     command: node
>     args: ["./servers/market-data/index.js"]
>   web:
>     command: node
>     args: ["./servers/web-search/index.js"]
>
> capabilities:
>   chat: llm
>   search: web
>   sentiment: llm
>   market_data: market
>
> sandbox: {}
> eval: {}
> ```
>
> `harness/.env.example`:
> ```
> # Copy to .env and fill in. .env is gitignored; never commit real values.
> LLM_API_KEY=
> ```
>
> Then run, from inside `harness/`: `corepack enable pnpm && pnpm install && pnpm typecheck`. `pnpm install` must generate `harness/pnpm-lock.yaml`; leave that file in place.
>
> ACCEPTANCE CRITERION — this exact command must print `SCAFFOLD OK` and exit 0:
> ```bash
> cd harness && pnpm install && pnpm typecheck && node -e "
> const pkg = require('./package.json');
> const assert = require('node:assert');
> assert.strictEqual(pkg.type, 'module', 'package must be ESM');
> assert.strictEqual(pkg.engines.node, '>=24');
> for (const s of ['lint','format','typecheck','test']) assert.ok(pkg.scripts[s], 'missing script: ' + s);
> for (const d of ['nunjucks','@langchain/langgraph','@modelcontextprotocol/sdk'])
>   assert.ok(!pkg.dependencies?.[d] && !pkg.devDependencies?.[d], 'forbidden dependency: ' + d);
> assert.ok(require('fs').readFileSync('.npmrc','utf8').includes('engine-strict=true'), '.npmrc must set engine-strict=true');
> console.log('SCAFFOLD OK');
> "
> ```
>
> BOUNDARIES — do not violate:
> - Do NOT add `nunjucks`, `@langchain/langgraph`, or `@modelcontextprotocol/sdk`. They are deferred to other stories and their presence fails the acceptance check.
> - Do NOT create any `.ts` source files. A later task owns `src/` and `tests/`.
> - Do NOT modify any file outside `harness/` — not `Makefile`, not `.github/workflows/ci.yml`, not `.pre-commit-config.yaml`, not `.gitignore` (it already covers `/node_modules`, `/dist`, `pnpm-debug.log*` — verified).
> - Do NOT add a `vitest.config.ts`; the defaults are sufficient and an extra config file is unnecessary surface.
> - Do NOT add comments to config files beyond the one already specified in `.env.example`.
> - This repo's standards: Node commands run through `pnpm` from inside `harness/`; Python commands through `uv run` from the repo root. No comments unless the WHY is non-obvious.

**Validator brief.**

> You are validating an implementation produced by an external agent. It is unverified until you say otherwise. You have NO edit authority — report findings only, do not fix anything.
>
> Worktree: `<WORKTREE_PATH>`. Task: scaffold the `harness/` Node package.
>
> Run each gate verbatim from the worktree root and report PASS/FAIL for each, with the actual output on failure:
> 1. `cd harness && corepack enable pnpm && pnpm install` — must succeed and produce `harness/pnpm-lock.yaml`.
> 2. `cd harness && pnpm typecheck` — must exit 0.
> 3. The scaffold assertion (must print `SCAFFOLD OK`):
>    ```bash
>    cd harness && node -e "
>    const pkg = require('./package.json');
>    const assert = require('node:assert');
>    assert.strictEqual(pkg.type, 'module');
>    assert.strictEqual(pkg.engines.node, '>=24');
>    for (const s of ['lint','format','typecheck','test']) assert.ok(pkg.scripts[s], 'missing script: ' + s);
>    for (const d of ['nunjucks','@langchain/langgraph','@modelcontextprotocol/sdk'])
>      assert.ok(!pkg.dependencies?.[d] && !pkg.devDependencies?.[d], 'forbidden dependency: ' + d);
>    assert.ok(require('fs').readFileSync('.npmrc','utf8').includes('engine-strict=true'));
>    console.log('SCAFFOLD OK');"
>    ```
> 4. `uv run ruff check . && uv run bandit -r src/ -c pyproject.toml -ll && uv run pytest tests/ -v` from the repo root — the existing Python suite must be unaffected.
> 5. `git status --porcelain` — confirm nothing outside `harness/` was modified.
>
> Then give a correctness read, not just "gates green". Check specifically:
> - `harness/.npmrc` contains `engine-strict=true`. Without it the Node 24 pin is decorative — this is a hard requirement, flag its absence as a FAIL even if every command passed.
> - `eslint.config.js` uses `tseslint.configs.recommended`, NOT `recommendedTypeChecked`. The type-checked preset was deliberately rejected; if the implementer "upgraded" it, that is a FAIL.
> - `tsconfig.json` has all of `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `verbatimModuleSyntax`, and `module`/`moduleResolution` set to `NodeNext`.
> - No `.ts` source files were created — `src/` and `tests/` belong to later tasks.
> - `package.json` declares all four scripts `lint`, `format`, `typecheck`, `test`, since a later task wires CI and the Makefile against exactly those names.
>
> Report format: one line per gate (`GATE n: PASS|FAIL`), then a short correctness section, then an overall `VERDICT: PASS|FAIL`.

---

## Task 2: Error types and config schemas

**Seam note.** This task's interface is the shared vocabulary both downstream tasks compile against: two error classes that encode *who fixes the problem* (a developer edits a file vs an operator checks infra), a `redact()` function that is the single trust boundary where secret values are stripped, and the Zod schemas from which `CapabilityName` is derived. It hides the schema shape from the loader (the loader never hand-writes field names) and hides redaction mechanics from every caller that constructs an error. It is a real boundary because Tasks 3 and 4 consume it without either knowing the other exists.

**Files:**
- Create: `harness/src/errors.ts`
- Create: `harness/src/config.ts`
- Test: `harness/tests/errors.test.ts`

**Interfaces:**
- Consumes: Task 1's `tsconfig.json` (`verbatimModuleSyntax` — type-only imports must use `import type`, and every relative import must carry a `.js` extension), `zod@^4.4.3`.
- Produces, consumed by Tasks 3 and 4:
  - `export const REDACTED = '[REDACTED]'`
  - `export function redact(message: string, secrets: Iterable<string>): string`
  - `export class ConfigValidationError extends Error` with `constructor(issues: readonly string[], secrets?: Iterable<string>)` and `readonly issues: readonly string[]`; `name === 'ConfigValidationError'`; `message` is the redacted issues joined with `'; '`
  - `export class CapabilityHealthError extends Error` with `constructor(failures: readonly string[])` and `readonly failures: readonly string[]`; `name === 'CapabilityHealthError'`; `message` is `failures.join('; ')`
  - `export const CapabilitiesSchema` — `z.object` with required string keys `chat`, `search`, `sentiment`, `market_data`
  - `export const McpServerSchema`, `export const HarnessConfigSchema`
  - `export type HarnessConfig = z.infer<typeof HarnessConfigSchema>`
  - `export type CapabilityName = keyof z.infer<typeof CapabilitiesSchema>` — i.e. `'chat' | 'search' | 'sentiment' | 'market_data'`
  - `export const LLM_TARGET = 'llm'`

- [ ] **Step 1: Write the failing test**

Create `harness/tests/errors.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { CapabilityHealthError, ConfigValidationError, redact } from '../src/errors.js';

describe('redact', () => {
  it('replaces every occurrence of each secret', () => {
    expect(redact('key=sk-live-123 and again sk-live-123', ['sk-live-123'])).toBe(
      'key=[REDACTED] and again [REDACTED]',
    );
  });

  it('is a no-op when there are no secrets', () => {
    expect(redact('plain message', [])).toBe('plain message');
  });

  it('ignores empty-string secrets so the message is not shredded', () => {
    expect(redact('plain message', [''])).toBe('plain message');
  });
});

describe('error types', () => {
  it('ConfigValidationError and CapabilityHealthError are distinct types', () => {
    const cfg = new ConfigValidationError(['llm.model: expected string'], []);
    const health = new CapabilityHealthError(['chat: ECONNREFUSED']);
    expect(cfg).toBeInstanceOf(ConfigValidationError);
    expect(cfg).not.toBeInstanceOf(CapabilityHealthError);
    expect(health).toBeInstanceOf(CapabilityHealthError);
    expect(health).not.toBeInstanceOf(ConfigValidationError);
    expect(cfg.name).toBe('ConfigValidationError');
    expect(health.name).toBe('CapabilityHealthError');
  });

  it('ConfigValidationError joins issues and redacts secret values', () => {
    const err = new ConfigValidationError(['llm.api_key: invalid value "sk-live-123"'], ['sk-live-123']);
    expect(err.message).toContain('llm.api_key');
    expect(err.message).not.toContain('sk-live-123');
    expect(err.issues).toEqual(['llm.api_key: invalid value "sk-live-123"'.replace('sk-live-123', '[REDACTED]')]);
  });

  it('CapabilityHealthError joins failures with "; "', () => {
    const err = new CapabilityHealthError(['chat: ECONNREFUSED', 'market_data: probe timeout']);
    expect(err.message).toBe('chat: ECONNREFUSED; market_data: probe timeout');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd harness && pnpm vitest run tests/errors.test.ts`
Expected: FAIL — `Error: Cannot find module '../src/errors.js' imported from .../tests/errors.test.ts`

- [ ] **Step 3: Write `harness/src/errors.ts`**

```ts
export const REDACTED = '[REDACTED]';

export function redact(message: string, secrets: Iterable<string>): string {
  let output = message;
  for (const secret of secrets) {
    if (secret.length === 0) continue;
    output = output.split(secret).join(REDACTED);
  }
  return output;
}

export class ConfigValidationError extends Error {
  readonly issues: readonly string[];

  constructor(issues: readonly string[], secrets: Iterable<string> = []) {
    const safe = issues.map((issue) => redact(issue, secrets));
    super(safe.join('; '));
    this.name = 'ConfigValidationError';
    this.issues = safe;
  }
}

export class CapabilityHealthError extends Error {
  readonly failures: readonly string[];

  constructor(failures: readonly string[]) {
    super(failures.join('; '));
    this.name = 'CapabilityHealthError';
    this.failures = failures;
  }
}
```

The empty-string guard in `redact` is not decoration: `''.split('')` would shred the message into characters and rejoin them with `[REDACTED]` between every one. An unset optional secret is a realistic input.

- [ ] **Step 4: Write `harness/src/config.ts`**

```ts
import { z } from 'zod';

export const CapabilitiesSchema = z.object({
  chat: z.string().min(1),
  search: z.string().min(1),
  sentiment: z.string().min(1),
  market_data: z.string().min(1),
});

export const McpServerSchema = z.object({
  command: z.string().min(1),
  args: z.array(z.string()).default([]),
});

export const HarnessConfigSchema = z.object({
  llm: z.object({
    provider: z.string().min(1),
    model: z.string().min(1),
    api_key: z.string().min(1),
  }),
  mcp_servers: z.record(z.string(), McpServerSchema).default({}),
  capabilities: CapabilitiesSchema,
  sandbox: z.record(z.string(), z.unknown()).default({}),
  eval: z.record(z.string(), z.unknown()).default({}),
});

export type HarnessConfig = z.infer<typeof HarnessConfigSchema>;
export type CapabilityName = keyof z.infer<typeof CapabilitiesSchema>;
export const LLM_TARGET = 'llm';
```

`z.record` takes **both** a key schema and a value schema under Zod 4. `z.record(z.unknown())` is a compile error, proven by `tsc`. `config.ts` contains schemas only — no file I/O, no `fs` import.

- [ ] **Step 5: Run tests, typecheck and lint to verify they pass**

```bash
cd harness && pnpm test && pnpm typecheck && pnpm lint
```
Expected: `tests/errors.test.ts` passes all 7 assertions; `tsc --noEmit` exits 0; ESLint and Prettier clean.

- [ ] **Step 6: Commit**

```bash
git add harness/src/errors.ts harness/src/config.ts harness/tests/errors.test.ts
git commit -m "feat(harness): add config schemas and redacting error types"
```

**Gemini delegation prompt.**

> `run_agy --mode write --add-dir /mnt/c/Users/vama0/Desktop/Forecasting_Agent/harness`
>
> You are implementing two source files in an existing TypeScript package at `harness/` (Node 24, strict ESM, `module: NodeNext`, `verbatimModuleSyntax: true`, Zod 4.4.3). The package scaffold, `tsconfig.json`, ESLint and Prettier configs already exist — do not modify them.
>
> Because `verbatimModuleSyntax` is on: every relative import must end in `.js` (even though the source files are `.ts`), and type-only imports must use `import type`.
>
> ACCEPTANCE CRITERION — the following test file already exists at `harness/tests/errors.test.ts` and currently fails. It must pass unmodified. Do not edit it, do not weaken it, do not add `.skip`:
>
> ```ts
> import { describe, expect, it } from 'vitest';
> import { CapabilityHealthError, ConfigValidationError, redact } from '../src/errors.js';
>
> describe('redact', () => {
>   it('replaces every occurrence of each secret', () => {
>     expect(redact('key=sk-live-123 and again sk-live-123', ['sk-live-123'])).toBe(
>       'key=[REDACTED] and again [REDACTED]',
>     );
>   });
>
>   it('is a no-op when there are no secrets', () => {
>     expect(redact('plain message', [])).toBe('plain message');
>   });
>
>   it('ignores empty-string secrets so the message is not shredded', () => {
>     expect(redact('plain message', [''])).toBe('plain message');
>   });
> });
>
> describe('error types', () => {
>   it('ConfigValidationError and CapabilityHealthError are distinct types', () => {
>     const cfg = new ConfigValidationError(['llm.model: expected string'], []);
>     const health = new CapabilityHealthError(['chat: ECONNREFUSED']);
>     expect(cfg).toBeInstanceOf(ConfigValidationError);
>     expect(cfg).not.toBeInstanceOf(CapabilityHealthError);
>     expect(health).toBeInstanceOf(CapabilityHealthError);
>     expect(health).not.toBeInstanceOf(ConfigValidationError);
>     expect(cfg.name).toBe('ConfigValidationError');
>     expect(health.name).toBe('CapabilityHealthError');
>   });
>
>   it('ConfigValidationError joins issues and redacts secret values', () => {
>     const err = new ConfigValidationError(['llm.api_key: invalid value "sk-live-123"'], ['sk-live-123']);
>     expect(err.message).toContain('llm.api_key');
>     expect(err.message).not.toContain('sk-live-123');
>     expect(err.issues).toEqual(['llm.api_key: invalid value "sk-live-123"'.replace('sk-live-123', '[REDACTED]')]);
>   });
>
>   it('CapabilityHealthError joins failures with "; "', () => {
>     const err = new CapabilityHealthError(['chat: ECONNREFUSED', 'market_data: probe timeout']);
>     expect(err.message).toBe('chat: ECONNREFUSED; market_data: probe timeout');
>   });
> });
> ```
>
> CREATE `harness/src/errors.ts` exporting exactly:
> - `export const REDACTED = '[REDACTED]';`
> - `export function redact(message: string, secrets: Iterable<string>): string` — replaces every occurrence of every secret with `REDACTED`. It MUST skip zero-length secrets: `''.split('')` shreds the message into characters, and an unset optional secret is a realistic input.
> - `export class ConfigValidationError extends Error` — `constructor(issues: readonly string[], secrets: Iterable<string> = [])`. Redact every issue with `secrets`, set `super(redactedIssues.join('; '))`, set `this.name = 'ConfigValidationError'`, and expose `readonly issues: readonly string[]` holding the REDACTED issues (not the raw ones).
> - `export class CapabilityHealthError extends Error` — `constructor(failures: readonly string[])`. `super(failures.join('; '))`, `this.name = 'CapabilityHealthError'`, expose `readonly failures: readonly string[]`.
>
> These two error classes must stay distinct types and must NOT share a base class beyond `Error`, and must NOT be merged into one class with a discriminant field. They mean different things: `ConfigValidationError` means a developer must fix a config file; `CapabilityHealthError` means an operator must check infrastructure.
>
> CREATE `harness/src/config.ts` — Zod schemas ONLY. No `fs` import, no file I/O, no functions that read anything:
> ```ts
> import { z } from 'zod';
>
> export const CapabilitiesSchema = z.object({
>   chat: z.string().min(1),
>   search: z.string().min(1),
>   sentiment: z.string().min(1),
>   market_data: z.string().min(1),
> });
>
> export const McpServerSchema = z.object({
>   command: z.string().min(1),
>   args: z.array(z.string()).default([]),
> });
>
> export const HarnessConfigSchema = z.object({
>   llm: z.object({
>     provider: z.string().min(1),
>     model: z.string().min(1),
>     api_key: z.string().min(1),
>   }),
>   mcp_servers: z.record(z.string(), McpServerSchema).default({}),
>   capabilities: CapabilitiesSchema,
>   sandbox: z.record(z.string(), z.unknown()).default({}),
>   eval: z.record(z.string(), z.unknown()).default({}),
> });
>
> export type HarnessConfig = z.infer<typeof HarnessConfigSchema>;
> export type CapabilityName = keyof z.infer<typeof CapabilitiesSchema>;
> export const LLM_TARGET = 'llm';
> ```
> `z.record` requires BOTH a key schema and a value schema under Zod 4. Single-argument `z.record(z.unknown())` is a compile error — do not "simplify" it. `sandbox` and `eval` are deliberate placeholders owned by other stories; do not give them real shapes. All four capability keys are required; do not make any of them `.optional()`.
>
> VERIFY before you finish, from inside `harness/`:
> ```bash
> pnpm test && pnpm typecheck && pnpm lint
> ```
> All three must exit 0.
>
> BOUNDARIES:
> - Create ONLY `harness/src/errors.ts` and `harness/src/config.ts`. Do not create `config-loader.ts`, do not create anything under `harness/src/capabilities/`, do not create other test files — later tasks own those.
> - Do not modify `harness/tests/errors.test.ts`, `package.json`, `tsconfig.json`, `eslint.config.js`, or `.prettierrc.json`.
> - Do not add any dependency. Do not import `nunjucks`, `@langchain/langgraph`, or `@modelcontextprotocol/sdk`.
> - Repo standards: OOP/SOLID/Clean Architecture; no comments unless the WHY is non-obvious; Prettier at 120 columns with single quotes.

**Validator brief.**

> You are validating an implementation produced by an external agent. It is unverified until you say otherwise. You have NO edit authority — report findings only, do not fix anything.
>
> Worktree: `<WORKTREE_PATH>`. Task: implement `harness/src/errors.ts` and `harness/src/config.ts`.
> Failing test now expected to pass: `harness/tests/errors.test.ts`.
>
> Run each gate verbatim and report PASS/FAIL with actual output on failure:
> 1. `cd harness && pnpm install && pnpm test` — all tests in `tests/errors.test.ts` pass.
> 2. `cd harness && pnpm typecheck` — exit 0.
> 3. `cd harness && pnpm lint` — ESLint and Prettier both clean, exit 0.
> 4. `cd <repo root> && uv run ruff check . && uv run bandit -r src/ -c pyproject.toml -ll && uv run pytest tests/ -v` — the Python side must be unaffected.
> 5. `git diff --stat` — confirm only `harness/src/errors.ts` and `harness/src/config.ts` were added and `harness/tests/errors.test.ts` is unchanged.
>
> Then give a correctness read, not just "tests green". Check specifically:
> - `redact()` guards against zero-length secrets. If the guard is missing the tests may still pass by luck of ordering — read the code, not just the result.
> - `ConfigValidationError.issues` holds the REDACTED issues, not the raw ones. A leaked raw value on a property is still a leak even though `message` is clean.
> - `ConfigValidationError` and `CapabilityHealthError` are genuinely distinct classes with no shared base beyond `Error`, and were not merged into one class with a discriminant.
> - `config.ts` imports nothing but `zod` — no `fs`, no file I/O, no loader logic leaked into the schema file.
> - Every `z.record(...)` call passes TWO arguments. Single-arg `z.record` does not compile under Zod 4; if it appears, `typecheck` should have failed — flag any attempt to work around this with `as any` or a `@ts-ignore`.
> - All four capability keys (`chat`, `search`, `sentiment`, `market_data`) are required, none made `.optional()`.
> - `sandbox` and `eval` remain `z.record(z.string(), z.unknown())` placeholders — if the implementer gave them real shapes, that is out of scope and a FAIL.
> - No `@ts-ignore`, `@ts-nocheck`, `as any`, or eslint-disable comments were introduced to get gates passing.
>
> Report format: one line per gate (`GATE n: PASS|FAIL`), then a correctness section, then `VERDICT: PASS|FAIL`.

---

## Task 3: Config loader

**Seam note.** `loadConfig(path, env)` is the interface: a path in, a fully validated `HarnessConfig` out, every failure mode collapsed into one `ConfigValidationError`. It hides four separate concerns from every caller — file reading, YAML parsing, `${VAR}` expansion, and the referential check that a capability points at something that exists — so callers never see a partially-validated config and never have to know that interpolation happens after parsing. It is a real boundary because it is the repo's entire trust boundary for untrusted config text plus environment secrets; the ordering inside it is a security property, not an implementation detail.

**Files:**
- Create: `harness/src/config-loader.ts`
- Test: `harness/tests/config.test.ts`

**Interfaces:**
- Consumes from Task 2: `HarnessConfigSchema`, `LLM_TARGET`, `type HarnessConfig` from `./config.js`; `ConfigValidationError` from `./errors.js`. Plus `yaml`'s `parse` and `node:fs`'s `readFileSync`.
- Produces: `export function loadConfig(path: string, env: NodeJS.ProcessEnv = process.env): HarnessConfig` — throws `ConfigValidationError` on any failure, never calls `process.exit`.

- [ ] **Step 1: Write the failing test**

Create `harness/tests/config.test.ts`:

```ts
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../src/config-loader.js';
import { ConfigValidationError } from '../src/errors.js';

let dir: string;

function writeConfig(body: string): string {
  const path = join(dir, 'harness_config.yaml');
  writeFileSync(path, body, 'utf8');
  return path;
}

const VALID = `
llm:
  provider: anthropic
  model: claude-sonnet-4
  api_key: \${LLM_API_KEY}
mcp_servers:
  market:
    command: node
    args: ["server.js"]
  web:
    command: node
    args: []
capabilities:
  chat: llm
  search: web
  sentiment: llm
  market_data: market
`;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'harness-cfg-'));
  vi.stubEnv('LLM_API_KEY', 'sk-live-123');
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('loadConfig', () => {
  it('accepts a valid config and interpolates ${VAR} from the environment', () => {
    const config = loadConfig(writeConfig(VALID));
    expect(config.llm.api_key).toBe('sk-live-123');
    expect(config.capabilities.market_data).toBe('market');
    expect(config.mcp_servers['market']?.command).toBe('node');
  });

  it('defaults the placeholder sandbox and eval sections to empty records', () => {
    const config = loadConfig(writeConfig(VALID));
    expect(config.sandbox).toEqual({});
    expect(config.eval).toEqual({});
  });

  it('rejects a wrong-typed field with a ConfigValidationError naming the Zod path', () => {
    const bad = VALID.replace('model: claude-sonnet-4', 'model: 42');
    expect(() => loadConfig(writeConfig(bad))).toThrow(ConfigValidationError);
    expect(() => loadConfig(writeConfig(bad))).toThrow(/llm\.model/);
  });

  it('rejects a missing capability binding', () => {
    const bad = VALID.replace('  sentiment: llm\n', '');
    expect(() => loadConfig(writeConfig(bad))).toThrow(ConfigValidationError);
    expect(() => loadConfig(writeConfig(bad))).toThrow(/capabilities\.sentiment/);
  });

  it('throws when a referenced environment variable is unset', () => {
    vi.stubEnv('LLM_API_KEY', undefined);
    expect(() => loadConfig(writeConfig(VALID))).toThrow(ConfigValidationError);
    expect(() => loadConfig(writeConfig(VALID))).toThrow(/LLM_API_KEY/);
  });

  it('rejects a capability pointing at a provider that does not exist', () => {
    const bad = VALID.replace('market_data: market', 'market_data: ghost');
    expect(() => loadConfig(writeConfig(bad))).toThrow(ConfigValidationError);
    expect(() => loadConfig(writeConfig(bad))).toThrow(/market_data.*ghost/);
  });

  it('accepts "llm" as a capability target without an mcp_servers entry', () => {
    expect(() => loadConfig(writeConfig(VALID))).not.toThrow();
  });

  it('treats a secret containing a newline as inert text, not config structure', () => {
    vi.stubEnv('LLM_API_KEY', 'sk-live\nmcp_servers:\n  evil:\n    command: /bin/sh');
    const config = loadConfig(writeConfig(VALID));
    expect(config.llm.api_key).toBe('sk-live\nmcp_servers:\n  evil:\n    command: /bin/sh');
    expect(Object.keys(config.mcp_servers).sort()).toEqual(['market', 'web']);
  });

  it('treats a secret containing ": " as inert text, not a mapping key', () => {
    vi.stubEnv('LLM_API_KEY', 'injected: value');
    const config = loadConfig(writeConfig(VALID));
    expect(config.llm.api_key).toBe('injected: value');
    expect(config.llm.provider).toBe('anthropic');
  });

  it('redacts a secret value that would otherwise be echoed in an error message', () => {
    vi.stubEnv('LLM_API_KEY', 'sk-live-supersecret');
    const bad = VALID.replace('market_data: market', 'market_data: ${LLM_API_KEY}');
    let message = '';
    try {
      loadConfig(writeConfig(bad));
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).not.toBe('');
    expect(message).not.toContain('sk-live-supersecret');
    expect(message).toContain('[REDACTED]');
  });

  it('never leaks a secret value on the schema-failure path', () => {
    vi.stubEnv('LLM_API_KEY', 'sk-live-supersecret');
    const bad = VALID.replace('provider: anthropic', 'provider: 42');
    let message = '';
    try {
      loadConfig(writeConfig(bad));
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain('llm.provider');
    expect(message).not.toContain('sk-live-supersecret');
  });

  it('interpolates only inside string values, leaving non-string leaves untouched', () => {
    vi.stubEnv('ARG_ONE', 'server.js');
    const withArg = VALID.replace('args: ["server.js"]', 'args: ["${ARG_ONE}"]');
    const config = loadConfig(writeConfig(withArg));
    expect(config.mcp_servers['market']?.args).toEqual(['server.js']);
  });
});
```

The two injection tests are the regression gate for spec decision 1. They pass only if parsing precedes interpolation: with text-first substitution, the newline secret adds an `evil` key to `mcp_servers` and the `": "` secret rewrites the mapping.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd harness && pnpm vitest run tests/config.test.ts`
Expected: FAIL — `Error: Cannot find module '../src/config-loader.js' imported from .../tests/config.test.ts`

- [ ] **Step 3: Write `harness/src/config-loader.ts`**

```ts
import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import { HarnessConfigSchema, LLM_TARGET, type HarnessConfig } from './config.js';
import { ConfigValidationError } from './errors.js';

const VAR_PATTERN = /\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g;

class Interpolator {
  readonly used = new Set<string>();
  readonly missing = new Set<string>();

  constructor(private readonly env: NodeJS.ProcessEnv) {}

  apply(node: unknown): unknown {
    if (typeof node === 'string') return this.expand(node);
    if (Array.isArray(node)) return node.map((item) => this.apply(item));
    if (node !== null && typeof node === 'object') {
      return Object.fromEntries(Object.entries(node).map(([key, value]) => [key, this.apply(value)]));
    }
    return node;
  }

  private expand(value: string): string {
    return value.replace(VAR_PATTERN, (_match, name: string) => {
      const resolved = this.env[name];
      if (resolved === undefined) {
        this.missing.add(name);
        return '';
      }
      this.used.add(resolved);
      return resolved;
    });
  }
}

function formatIssues(error: unknown): string[] {
  const zodError = error as { issues?: { path: PropertyKey[]; message: string }[] };
  return (zodError.issues ?? []).map((issue) => `${issue.path.join('.')}: ${issue.message}`);
}

export function loadConfig(path: string, env: NodeJS.ProcessEnv = process.env): HarnessConfig {
  const raw: unknown = parse(readFileSync(path, 'utf8'));
  const interpolator = new Interpolator(env);
  const interpolated = interpolator.apply(raw);
  const secrets = interpolator.used;

  if (interpolator.missing.size > 0) {
    throw new ConfigValidationError(
      [...interpolator.missing].map((name) => `environment variable ${name} is not set`),
      secrets,
    );
  }

  const result = HarnessConfigSchema.safeParse(interpolated);
  if (!result.success) throw new ConfigValidationError(formatIssues(result.error), secrets);

  const config = result.data;
  const dangling = Object.entries(config.capabilities)
    .filter(([, target]) => target !== LLM_TARGET && !(target in config.mcp_servers))
    .map(([name, target]) => `capabilities.${name}: "${target}" is not defined in mcp_servers`);
  if (dangling.length > 0) throw new ConfigValidationError(dangling, secrets);

  return config;
}
```

The order in `loadConfig` is the security property: `parse` → `apply` (walking the parsed tree, rewriting string leaves only) → `safeParse` → referential check. Every interpolated value lands in `interpolator.used` and is passed as the secret set to every error constructed afterwards, which is how decision 9 is honoured on all three throw paths.

- [ ] **Step 4: Run tests, typecheck and lint to verify they pass**

```bash
cd harness && pnpm test && pnpm typecheck && pnpm lint
```
Expected: all 13 tests in `tests/config.test.ts` pass; `tsc --noEmit` exits 0; ESLint and Prettier clean.

- [ ] **Step 5: Commit**

```bash
git add harness/src/config-loader.ts harness/tests/config.test.ts
git commit -m "feat(harness): add config loader with parse-first interpolation and secret redaction"
```

**Gemini delegation prompt.**

> `run_agy --mode write --add-dir /mnt/c/Users/vama0/Desktop/Forecasting_Agent/harness`
>
> You are implementing ONE file, `harness/src/config-loader.ts`, in an existing TypeScript package (Node 24, strict ESM, `module: NodeNext`, `verbatimModuleSyntax: true`, Zod 4.4.3, `yaml` 2.9.0). Because `verbatimModuleSyntax` is on, every relative import must end in `.js` and type-only imports must use `import type`.
>
> These already exist and you must NOT modify them:
> - `harness/src/config.ts` exports `HarnessConfigSchema` (a `z.object` with `llm: {provider, model, api_key}`, `mcp_servers: z.record(z.string(), McpServerSchema).default({})`, `capabilities: {chat, search, sentiment, market_data}` all required strings, `sandbox` and `eval` as `z.record(z.string(), z.unknown()).default({})`), `type HarnessConfig = z.infer<typeof HarnessConfigSchema>`, and `const LLM_TARGET = 'llm'`.
> - `harness/src/errors.ts` exports `class ConfigValidationError extends Error` with `constructor(issues: readonly string[], secrets: Iterable<string> = [])` — it redacts each issue using `secrets` and joins them with `'; '`.
>
> IMPLEMENT: `export function loadConfig(path: string, env: NodeJS.ProcessEnv = process.env): HarnessConfig`
>
> It must do these steps IN THIS EXACT ORDER:
> 1. `readFileSync(path, 'utf8')` then `parse(...)` from the `yaml` package — **parse the YAML FIRST**.
> 2. Walk the PARSED tree and interpolate `${VAR}` **only inside `string` leaf values**, reading from `env`. Recurse through arrays and plain objects; leave numbers, booleans and nulls untouched. The variable pattern is `/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g`.
> 3. Collect every substituted value into a `Set<string>` of secrets, and every referenced-but-unset variable name into a separate set. If any variable was unset, throw `ConfigValidationError` with one issue per missing name, in the form `environment variable NAME is not set`, passing the secret set.
> 4. `HarnessConfigSchema.safeParse(...)` the interpolated tree. On failure, map each Zod issue to `` `${issue.path.join('.')}: ${issue.message}` `` and throw `ConfigValidationError(issues, secrets)`.
> 5. Referential check: for each entry of `config.capabilities`, the target must be either the literal `LLM_TARGET` (`'llm'`) or a key present in `config.mcp_servers`. Collect ALL violations, format each as `` `capabilities.${name}: "${target}" is not defined in mcp_servers` ``, and throw `ConfigValidationError(dangling, secrets)`.
> 6. Return the parsed config.
>
> CRITICAL — do NOT reorder step 1 and step 2. Interpolating into the raw file text before parsing lets a secret's value inject config structure. This is a demonstrated vulnerability, not a hypothetical: a secret containing a newline adds entire new keys to the config, and one containing `": "` rewrites a mapping. Two tests in the acceptance suite exist specifically to catch this. Text-level `String.replace` on the file contents is FORBIDDEN.
>
> CRITICAL — pass the collected secret set to EVERY `ConfigValidationError` you construct, on all three throw paths. Zod echoes offending values, and `llm.api_key` must never reach a log or CI output.
>
> CRITICAL — throw on failure. NEVER call `process.exit()`. A different story owns the CLI that catches these and exits.
>
> ACCEPTANCE CRITERION — the test file `harness/tests/config.test.ts` already exists and currently fails. It must pass unmodified. Do not edit it, weaken it, or skip any case. Here it is verbatim:
>
> ```ts
> import { mkdtempSync, writeFileSync } from 'node:fs';
> import { tmpdir } from 'node:os';
> import { join } from 'node:path';
> import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
> import { loadConfig } from '../src/config-loader.js';
> import { ConfigValidationError } from '../src/errors.js';
>
> let dir: string;
>
> function writeConfig(body: string): string {
>   const path = join(dir, 'harness_config.yaml');
>   writeFileSync(path, body, 'utf8');
>   return path;
> }
>
> const VALID = `
> llm:
>   provider: anthropic
>   model: claude-sonnet-4
>   api_key: \${LLM_API_KEY}
> mcp_servers:
>   market:
>     command: node
>     args: ["server.js"]
>   web:
>     command: node
>     args: []
> capabilities:
>   chat: llm
>   search: web
>   sentiment: llm
>   market_data: market
> `;
>
> beforeEach(() => {
>   dir = mkdtempSync(join(tmpdir(), 'harness-cfg-'));
>   vi.stubEnv('LLM_API_KEY', 'sk-live-123');
> });
>
> afterEach(() => {
>   vi.unstubAllEnvs();
> });
>
> describe('loadConfig', () => {
>   it('accepts a valid config and interpolates ${VAR} from the environment', () => {
>     const config = loadConfig(writeConfig(VALID));
>     expect(config.llm.api_key).toBe('sk-live-123');
>     expect(config.capabilities.market_data).toBe('market');
>     expect(config.mcp_servers['market']?.command).toBe('node');
>   });
>
>   it('defaults the placeholder sandbox and eval sections to empty records', () => {
>     const config = loadConfig(writeConfig(VALID));
>     expect(config.sandbox).toEqual({});
>     expect(config.eval).toEqual({});
>   });
>
>   it('rejects a wrong-typed field with a ConfigValidationError naming the Zod path', () => {
>     const bad = VALID.replace('model: claude-sonnet-4', 'model: 42');
>     expect(() => loadConfig(writeConfig(bad))).toThrow(ConfigValidationError);
>     expect(() => loadConfig(writeConfig(bad))).toThrow(/llm\.model/);
>   });
>
>   it('rejects a missing capability binding', () => {
>     const bad = VALID.replace('  sentiment: llm\n', '');
>     expect(() => loadConfig(writeConfig(bad))).toThrow(ConfigValidationError);
>     expect(() => loadConfig(writeConfig(bad))).toThrow(/capabilities\.sentiment/);
>   });
>
>   it('throws when a referenced environment variable is unset', () => {
>     vi.stubEnv('LLM_API_KEY', undefined);
>     expect(() => loadConfig(writeConfig(VALID))).toThrow(ConfigValidationError);
>     expect(() => loadConfig(writeConfig(VALID))).toThrow(/LLM_API_KEY/);
>   });
>
>   it('rejects a capability pointing at a provider that does not exist', () => {
>     const bad = VALID.replace('market_data: market', 'market_data: ghost');
>     expect(() => loadConfig(writeConfig(bad))).toThrow(ConfigValidationError);
>     expect(() => loadConfig(writeConfig(bad))).toThrow(/market_data.*ghost/);
>   });
>
>   it('accepts "llm" as a capability target without an mcp_servers entry', () => {
>     expect(() => loadConfig(writeConfig(VALID))).not.toThrow();
>   });
>
>   it('treats a secret containing a newline as inert text, not config structure', () => {
>     vi.stubEnv('LLM_API_KEY', 'sk-live\nmcp_servers:\n  evil:\n    command: /bin/sh');
>     const config = loadConfig(writeConfig(VALID));
>     expect(config.llm.api_key).toBe('sk-live\nmcp_servers:\n  evil:\n    command: /bin/sh');
>     expect(Object.keys(config.mcp_servers).sort()).toEqual(['market', 'web']);
>   });
>
>   it('treats a secret containing ": " as inert text, not a mapping key', () => {
>     vi.stubEnv('LLM_API_KEY', 'injected: value');
>     const config = loadConfig(writeConfig(VALID));
>     expect(config.llm.api_key).toBe('injected: value');
>     expect(config.llm.provider).toBe('anthropic');
>   });
>
>   it('redacts a secret value that would otherwise be echoed in an error message', () => {
>     vi.stubEnv('LLM_API_KEY', 'sk-live-supersecret');
>     const bad = VALID.replace('market_data: market', 'market_data: ${LLM_API_KEY}');
>     let message = '';
>     try {
>       loadConfig(writeConfig(bad));
>     } catch (error) {
>       message = (error as Error).message;
>     }
>     expect(message).not.toBe('');
>     expect(message).not.toContain('sk-live-supersecret');
>     expect(message).toContain('[REDACTED]');
>   });
>
>   it('never leaks a secret value on the schema-failure path', () => {
>     vi.stubEnv('LLM_API_KEY', 'sk-live-supersecret');
>     const bad = VALID.replace('provider: anthropic', 'provider: 42');
>     let message = '';
>     try {
>       loadConfig(writeConfig(bad));
>     } catch (error) {
>       message = (error as Error).message;
>     }
>     expect(message).toContain('llm.provider');
>     expect(message).not.toContain('sk-live-supersecret');
>   });
>
>   it('interpolates only inside string values, leaving non-string leaves untouched', () => {
>     vi.stubEnv('ARG_ONE', 'server.js');
>     const withArg = VALID.replace('args: ["server.js"]', 'args: ["${ARG_ONE}"]');
>     const config = loadConfig(writeConfig(withArg));
>     expect(config.mcp_servers['market']?.args).toEqual(['server.js']);
>   });
> });
> ```
>
> Note the test reads `env` through `process.env` by default (it uses `vi.stubEnv`), so the `env` parameter must default to `process.env` and must be read at call time, not captured at module load.
>
> VERIFY before you finish, from inside `harness/`: `pnpm test && pnpm typecheck && pnpm lint` — all three exit 0.
>
> BOUNDARIES:
> - Create ONLY `harness/src/config-loader.ts`. Do not create or modify anything under `harness/src/capabilities/` — a different task owns the registry and is running in parallel.
> - Do not modify `harness/src/config.ts`, `harness/src/errors.ts`, `harness/tests/config.test.ts`, or any config file.
> - Do not add dependencies. Do not import `nunjucks`, `@langchain/langgraph`, or `@modelcontextprotocol/sdk`.
> - Do not implement MCP client construction, plugin discovery, or a CLI entrypoint — all out of scope for this story.
> - Repo standards: OOP/SOLID/Clean Architecture (this file owns I/O; `config.ts` stays schema-only). No comments unless the WHY is non-obvious. Prettier at 120 columns, single quotes.

**Validator brief.**

> You are validating an implementation produced by an external agent. It is unverified until you say otherwise. You have NO edit authority — report findings only, do not fix anything.
>
> Worktree: `<WORKTREE_PATH>`. Task: implement `harness/src/config-loader.ts`.
> Failing test now expected to pass: `harness/tests/config.test.ts` (13 cases).
>
> Run each gate verbatim and report PASS/FAIL with actual output on failure:
> 1. `cd harness && pnpm install && pnpm test` — every case in `tests/config.test.ts` passes.
> 2. `cd harness && pnpm typecheck` — exit 0.
> 3. `cd harness && pnpm lint` — exit 0.
> 4. `cd <repo root> && uv run ruff check . && uv run bandit -r src/ -c pyproject.toml -ll && uv run pytest tests/ -v` — Python side unaffected.
> 5. `git diff --stat` — only `harness/src/config-loader.ts` added; `harness/tests/config.test.ts` unchanged.
>
> Then give a correctness read, not just "tests green". Check specifically, by reading the source:
> - **Ordering.** `loadConfig` must parse the YAML BEFORE interpolating, and interpolation must walk the PARSED object tree. If you see any `String.replace` / regex substitution applied to the raw file text before `parse()`, that is a security defect and an immediate FAIL — even if all 13 tests somehow pass. Interpolating pre-parse lets a secret's value inject config structure (demonstrated).
> - **String-leaf-only.** Interpolation must only rewrite values whose `typeof` is `'string'`. Numbers, booleans and nulls untouched. Keys must not be interpolated.
> - **Redaction on every path.** All three `throw new ConfigValidationError(...)` sites must pass the collected secret set. A path that omits it leaks `llm.api_key` into logs. Count the throw sites and check each one.
> - **Aggregation.** The referential check must collect ALL dangling capability references, not throw on the first one.
> - **No `process.exit`** anywhere in the file.
> - **`env` is read at call time**, defaulting to `process.env` — not captured into a module-level constant, which would break `vi.stubEnv`.
> - No `@ts-ignore`, `@ts-nocheck`, `as any`, or eslint-disable comments introduced to get gates passing.
> - No new dependency added to `package.json`; no import of `nunjucks`, `@langchain/langgraph`, or `@modelcontextprotocol/sdk`.
>
> Report format: one line per gate (`GATE n: PASS|FAIL`), then a correctness section, then `VERDICT: PASS|FAIL`.

---

## Task 4: Capability registry

**Seam note.** `CapabilityRegistry` is the interface: `register`, `resolve`, `validateAll`, `sealed`. It hides a private `Map` behind a mapped-type `resolve<K>(name: K): CapabilityMap[K]`, so callers get a precisely-typed provider with no cast at the call site and never touch the store. It also hides the entire probe lifecycle — controller, timer, race, cleanup — behind one `validateAll()` call, which is what makes the leaked-timer bug fixable in one place. It is a real boundary because the registry depends only on the `CapabilityProvider` interface and never on any concrete provider (dependency inversion); everything downstream in this project resolves capabilities through it.

**Files:**
- Create: `harness/src/capabilities/types.ts`
- Create: `harness/src/capabilities/registry.ts`
- Create: `harness/tests/helpers.ts`
- Test: `harness/tests/registry.test.ts`

**Interfaces:**
- Consumes from Task 2: `type CapabilityName` from `../config.js`; `CapabilityHealthError` from `../errors.js`.
- Produces:
  - `types.ts`: `export interface CapabilityProvider { healthCheck?(signal: AbortSignal): Promise<void> }`; `export interface MarketDataProvider extends CapabilityProvider { fetch_ohlcv(symbol: string, range: string): Promise<unknown[]> }`; `export interface CapabilityMap { chat: CapabilityProvider; search: CapabilityProvider; sentiment: CapabilityProvider; market_data: MarketDataProvider }`; re-exports `CapabilityName`.
  - `registry.ts`: `export interface ValidateAllOptions { timeoutMs?: number }`; `export interface ValidateAllResult { skipped: CapabilityName[] }`; `export class CapabilityRegistry` with `get sealed(): boolean`, `register<K extends CapabilityName>(name: K, provider: CapabilityMap[K]): void`, `resolve<K extends CapabilityName>(name: K): CapabilityMap[K]`, `validateAll(options?: ValidateAllOptions): Promise<ValidateAllResult>`; `export function createCapabilityAccessor(registry: CapabilityRegistry): <K extends CapabilityName>(name: K) => CapabilityMap[K]`.
  - `tests/helpers.ts`: `createMockProvider(behaviour?, message?)`, `createMockMarketData()`.

- [ ] **Step 1: Write the failing test helpers**

Create `harness/tests/helpers.ts`:

```ts
import type { CapabilityProvider, MarketDataProvider } from '../src/capabilities/types.js';

export function createMockProvider(
  behaviour: 'ok' | 'fail' | 'skip' | 'rude' = 'ok',
  message = 'ECONNREFUSED',
): CapabilityProvider {
  if (behaviour === 'skip') return {};
  if (behaviour === 'fail')
    return {
      healthCheck: async () => {
        throw new Error(message);
      },
    };
  if (behaviour === 'rude') {
    return {
      healthCheck: () =>
        new Promise<void>((resolve) => {
          setTimeout(resolve, 3_000_000);
        }),
    };
  }
  return { healthCheck: async () => {} };
}

export function createMockMarketData(): MarketDataProvider {
  return { healthCheck: async () => {}, fetch_ohlcv: async () => [] };
}
```

`'skip'` returns `{}` — a provider with no `healthCheck` at all, which is what makes the optional-probe path testable. `'rude'` deliberately ignores its signal, which is what makes the race mandatory.

- [ ] **Step 2: Write the failing test**

Create `harness/tests/registry.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CapabilityRegistry, createCapabilityAccessor } from '../src/capabilities/registry.js';
import { CapabilityHealthError } from '../src/errors.js';
import { createMockMarketData, createMockProvider } from './helpers.js';

function fullyRegistered(): CapabilityRegistry {
  const registry = new CapabilityRegistry();
  registry.register('chat', createMockProvider('ok'));
  registry.register('search', createMockProvider('ok'));
  registry.register('sentiment', createMockProvider('skip'));
  registry.register('market_data', createMockMarketData());
  return registry;
}

afterEach(() => {
  vi.useRealTimers();
});

describe('resolve', () => {
  it('returns the registered provider instance', () => {
    const provider = createMockMarketData();
    const registry = new CapabilityRegistry();
    registry.register('market_data', provider);
    expect(registry.resolve('market_data')).toBe(provider);
  });

  it('throws for a capability that was never registered', () => {
    expect(() => new CapabilityRegistry().resolve('chat')).toThrow(/chat/);
  });

  it('exposes market_data methods without a cast at the call site', async () => {
    const registry = fullyRegistered();
    const cap = createCapabilityAccessor(registry);
    await expect(cap('market_data').fetch_ohlcv('RELIANCE', '1d')).resolves.toEqual([]);
  });

  it('rejects wrongly typed capabilities at compile time', () => {
    const cap = createCapabilityAccessor(fullyRegistered());
    // @ts-expect-error chat is a bare CapabilityProvider and has no fetch_ohlcv
    expect(() => cap('chat').fetch_ohlcv('RELIANCE', '1d')).toThrow();
    // @ts-expect-error 'nonexistent' is not a CapabilityName
    expect(() => cap('nonexistent')).toThrow();
  });
});

describe('register', () => {
  it('throws on duplicate registration', () => {
    const registry = new CapabilityRegistry();
    registry.register('chat', createMockProvider('ok'));
    expect(() => registry.register('chat', createMockProvider('ok'))).toThrow(/chat/);
  });

  it('throws after the registry is sealed by validateAll', async () => {
    const registry = fullyRegistered();
    await registry.validateAll();
    expect(registry.sealed).toBe(true);
    expect(() => registry.register('chat', createMockProvider('ok'))).toThrow(/sealed/i);
  });
});

describe('validateAll', () => {
  it('reports capabilities skipped because they implement no healthCheck', async () => {
    const result = await fullyRegistered().validateAll();
    expect(result.skipped).toEqual(['sentiment']);
  });

  it('aggregates every failure into one CapabilityHealthError', async () => {
    const registry = new CapabilityRegistry();
    registry.register('chat', createMockProvider('fail', 'ECONNREFUSED'));
    registry.register('search', createMockProvider('ok'));
    registry.register('sentiment', createMockProvider('fail', 'ETIMEDOUT'));
    registry.register('market_data', createMockMarketData());
    const error = await registry.validateAll().then(
      () => undefined,
      (e: unknown) => e as CapabilityHealthError,
    );
    expect(error).toBeInstanceOf(CapabilityHealthError);
    expect(error?.message).toContain('chat: ECONNREFUSED');
    expect(error?.message).toContain('sentiment: ETIMEDOUT');
  });

  it('seals the registry even when validation fails', async () => {
    const registry = new CapabilityRegistry();
    registry.register('chat', createMockProvider('fail'));
    await registry.validateAll().catch(() => undefined);
    expect(registry.sealed).toBe(true);
  });

  it('bounds a provider that ignores its abort signal', async () => {
    const registry = new CapabilityRegistry();
    registry.register('market_data', { ...createMockMarketData(), ...createMockProvider('rude') } as never);
    const started = Date.now();
    const error = await registry.validateAll({ timeoutMs: 200 }).then(
      () => undefined,
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(CapabilityHealthError);
    expect(Date.now() - started).toBeLessThan(1500);
  });

  it('prefixes the capability name exactly once on a timeout', async () => {
    const registry = new CapabilityRegistry();
    registry.register('market_data', { ...createMockMarketData(), ...createMockProvider('rude') } as never);
    const error = await registry.validateAll({ timeoutMs: 50 }).then(
      () => undefined,
      (e: unknown) => e as Error,
    );
    expect(error?.message).toBe('market_data: probe timeout');
  });

  it('passes an AbortSignal that is aborted when the probe budget expires', async () => {
    let observed: AbortSignal | undefined;
    const registry = new CapabilityRegistry();
    registry.register('chat', {
      healthCheck: (signal: AbortSignal) => {
        observed = signal;
        return new Promise<void>((resolve) => {
          setTimeout(resolve, 3_000_000);
        });
      },
    });
    await registry.validateAll({ timeoutMs: 50 }).catch(() => undefined);
    expect(observed?.aborted).toBe(true);
  });

  it('leaves no pending timer on the success path', async () => {
    vi.useFakeTimers();
    const registry = fullyRegistered();
    await registry.validateAll({ timeoutMs: 5000 });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('leaves no pending timer on the failure path', async () => {
    vi.useFakeTimers();
    const registry = new CapabilityRegistry();
    registry.register('chat', createMockProvider('fail'));
    await registry.validateAll({ timeoutMs: 5000 }).catch(() => undefined);
    expect(vi.getTimerCount()).toBe(0);
  });
});
```

Two cases here cannot be replaced by a return-value assertion:
- `prefixes the capability name exactly once` uses `toBe`, not `toContain` — `toContain('market_data: probe timeout')` would also pass against the double-prefixed `market_data: market_data: probe timeout` bug.
- `leaves no pending timer` asserts `vi.getTimerCount() === 0`. `validateAll()` returns correctly *and quickly* even with the leaked-timer bug present; the only observable symptom is the process hanging afterwards. Nothing about the returned value can see it.

The two `@ts-expect-error` directives are load-bearing: if the types regress and those lines stop being compile errors, `tsc` fails on the now-unused directives. That is how the negative acceptance cases are enforced by the build.

- [ ] **Step 3: Run test to verify it fails**

Run: `cd harness && pnpm vitest run tests/registry.test.ts`
Expected: FAIL — `Error: Cannot find module '../src/capabilities/registry.js' imported from .../tests/registry.test.ts`

- [ ] **Step 4: Write `harness/src/capabilities/types.ts`**

```ts
import type { CapabilityName } from '../config.js';

export type { CapabilityName };

export interface CapabilityProvider {
  healthCheck?(signal: AbortSignal): Promise<void>;
}

export interface MarketDataProvider extends CapabilityProvider {
  fetch_ohlcv(symbol: string, range: string): Promise<unknown[]>;
}

export interface CapabilityMap {
  chat: CapabilityProvider;
  search: CapabilityProvider;
  sentiment: CapabilityProvider;
  market_data: MarketDataProvider;
}
```

`chat`, `search` and `sentiment` are deliberately the base `CapabilityProvider` — their shapes are unknown until later milestones, and aliasing them to named types that add nothing was explicitly cut during spec review. Zero framework imports in this directory.

- [ ] **Step 5: Write `harness/src/capabilities/registry.ts`**

```ts
import { CapabilityHealthError } from '../errors.js';
import type { CapabilityMap, CapabilityName, CapabilityProvider } from './types.js';

export interface ValidateAllOptions {
  timeoutMs?: number;
}

export interface ValidateAllResult {
  skipped: CapabilityName[];
}

export class CapabilityRegistry {
  readonly #providers = new Map<CapabilityName, CapabilityProvider>();
  #sealed = false;

  get sealed(): boolean {
    return this.#sealed;
  }

  register<K extends CapabilityName>(name: K, provider: CapabilityMap[K]): void {
    if (this.#sealed) throw new Error(`registry is sealed; cannot register "${name}"`);
    if (this.#providers.has(name)) throw new Error(`capability "${name}" is already registered`);
    this.#providers.set(name, provider);
  }

  resolve<K extends CapabilityName>(name: K): CapabilityMap[K] {
    const provider = this.#providers.get(name);
    if (provider === undefined) throw new Error(`capability "${name}" is not registered`);
    return provider as CapabilityMap[K];
  }

  async validateAll({ timeoutMs = 5000 }: ValidateAllOptions = {}): Promise<ValidateAllResult> {
    const skipped: CapabilityName[] = [];
    const probes: Promise<void>[] = [];
    const names: CapabilityName[] = [];

    for (const [name, provider] of this.#providers) {
      if (typeof provider.healthCheck !== 'function') {
        skipped.push(name);
        continue;
      }
      names.push(name);
      probes.push(this.#probe(provider, timeoutMs));
    }

    const outcomes = await Promise.allSettled(probes);
    this.#sealed = true;

    const failures = outcomes.flatMap((outcome, index) =>
      outcome.status === 'rejected' ? [`${names[index]}: ${(outcome.reason as Error).message}`] : [],
    );
    if (failures.length > 0) throw new CapabilityHealthError(failures);

    return { skipped };
  }

  async #probe(provider: CapabilityProvider, timeoutMs: number): Promise<void> {
    const controller = new AbortController();
    let timer: NodeJS.Timeout | undefined;
    try {
      const expiry = new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new Error('probe timeout'));
        }, timeoutMs);
      });
      await Promise.race([provider.healthCheck!(controller.signal), expiry]);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }
}

export function createCapabilityAccessor(
  registry: CapabilityRegistry,
): <K extends CapabilityName>(name: K) => CapabilityMap[K] {
  return (name) => registry.resolve(name);
}
```

Three things here are load-bearing and must not be "cleaned up":
- The `as CapabilityMap[K]` in `resolve()` is the single unsound spot in the design. It is sound only because `register<K>()` is typed to `CapabilityMap[K]` and `#providers` is private, so every write goes through that one typed door. Do not widen `register()`'s signature.
- The probe constructs its **own** `AbortController` and clears its timer in a `finally`. `AbortSignal.timeout()` and bare race timers are ref'd and hold the event loop open — measured as a 5s hang on the success path.
- The abort reason is the bare string `'probe timeout'`. The `${name}: ` prefix is attached exactly once, in the aggregation step.

- [ ] **Step 6: Run tests, typecheck and lint to verify they pass**

```bash
cd harness && pnpm test && pnpm typecheck && pnpm lint
```
Expected: all 12 tests in `tests/registry.test.ts` pass; `tsc --noEmit` exits 0 (which also confirms both `@ts-expect-error` directives are suppressing real errors); ESLint and Prettier clean.

- [ ] **Step 7: Commit**

```bash
git add harness/src/capabilities/ harness/tests/registry.test.ts harness/tests/helpers.ts
git commit -m "feat(harness): add sealed capability registry with bounded health probes"
```

**Gemini delegation prompt.**

> `run_agy --mode write --add-dir /mnt/c/Users/vama0/Desktop/Forecasting_Agent/harness`
>
> You are implementing TWO files in an existing TypeScript package (Node 24, strict ESM, `module: NodeNext`, `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `verbatimModuleSyntax: true`). Because `verbatimModuleSyntax` is on, every relative import must end in `.js` and type-only imports must use `import type`.
>
> These already exist and you must NOT modify them:
> - `harness/src/config.ts` exports `type CapabilityName = 'chat' | 'search' | 'sentiment' | 'market_data'` (derived as `keyof z.infer<typeof CapabilitiesSchema>`).
> - `harness/src/errors.ts` exports `class CapabilityHealthError extends Error` with `constructor(failures: readonly string[])`, whose `message` is `failures.join('; ')`.
> - `harness/tests/helpers.ts` and `harness/tests/registry.test.ts` (the acceptance suite, below).
>
> CREATE `harness/src/capabilities/types.ts`:
> ```ts
> import type { CapabilityName } from '../config.js';
>
> export type { CapabilityName };
>
> export interface CapabilityProvider {
>   healthCheck?(signal: AbortSignal): Promise<void>;
> }
>
> export interface MarketDataProvider extends CapabilityProvider {
>   fetch_ohlcv(symbol: string, range: string): Promise<unknown[]>;
> }
>
> export interface CapabilityMap {
>   chat: CapabilityProvider;
>   search: CapabilityProvider;
>   sentiment: CapabilityProvider;
>   market_data: MarketDataProvider;
> }
> ```
> `healthCheck` is OPTIONAL — do not make it required, so providers with nothing to probe need no stub. `chat`, `search` and `sentiment` are deliberately the bare `CapabilityProvider`; do NOT invent named alias types for them. This directory must have zero framework imports.
>
> CREATE `harness/src/capabilities/registry.ts` exporting:
> - `export interface ValidateAllOptions { timeoutMs?: number }`
> - `export interface ValidateAllResult { skipped: CapabilityName[] }`
> - `export class CapabilityRegistry` with a PRIVATE `#providers = new Map<CapabilityName, CapabilityProvider>()` and a private `#sealed = false`, plus:
>   - `get sealed(): boolean`
>   - `register<K extends CapabilityName>(name: K, provider: CapabilityMap[K]): void` — throws if the registry is sealed (message must contain the word "sealed"), throws if the name is already registered (message must contain the name).
>   - `resolve<K extends CapabilityName>(name: K): CapabilityMap[K]` — throws if unregistered (message must contain the name). The body ends in `return provider as CapabilityMap[K]`.
>   - `validateAll(options?: ValidateAllOptions): Promise<ValidateAllResult>` with `timeoutMs` DEFAULTING to `5000`.
> - `export function createCapabilityAccessor(registry: CapabilityRegistry): <K extends CapabilityName>(name: K) => CapabilityMap[K]`
>
> `validateAll` must, in this order:
> 1. Walk `#providers`. If a provider has no callable `healthCheck`, push its name to `skipped` and do not probe it. Otherwise queue a probe and record its name in a parallel array so failures can be attributed.
> 2. `await Promise.allSettled(probes)` — aggregate; do NOT use `Promise.all`, which would report only the first failure.
> 3. Set `#sealed = true` — on BOTH the success and the failure path, before any throw.
> 4. Map each rejected outcome to `` `${name}: ${reason.message}` `` and, if there is at least one, throw a single `CapabilityHealthError(failures)`.
> 5. Otherwise return `{ skipped }`.
>
> Each probe MUST be implemented exactly like this:
> ```ts
> async #probe(provider: CapabilityProvider, timeoutMs: number): Promise<void> {
>   const controller = new AbortController();
>   let timer: NodeJS.Timeout | undefined;
>   try {
>     const expiry = new Promise<never>((_resolve, reject) => {
>       timer = setTimeout(() => {
>         controller.abort();
>         reject(new Error('probe timeout'));
>       }, timeoutMs);
>     });
>     await Promise.race([provider.healthCheck!(controller.signal), expiry]);
>   } finally {
>     if (timer !== undefined) clearTimeout(timer);
>   }
> }
> ```
>
> CRITICAL, all three measured defects — do NOT "simplify" any of these:
> - Do NOT use `AbortSignal.timeout()`. Do NOT omit the `Promise.race`. Do NOT omit `clearTimeout` in the `finally`. `AbortSignal.timeout()` and bare race timers are ref'd and hold the Node event loop open: with every provider healthy and `validateAll()` returning in 2ms, the process still hung for the full timeout — a 5s hang on every successful startup. The signal ALONE also bounds nothing: a provider that ignores it ran 3004ms against a 200ms budget, which is why the race is mandatory too.
> - The abort reason must be the BARE string `'probe timeout'`, never `` `${name}: probe timeout` ``. The capability name is attached in exactly ONE place — the aggregation step in `validateAll`. Prefixing in both places produces `market_data: market_data: probe timeout`.
> - Do NOT widen `register()`'s signature away from `CapabilityMap[K]`. The `as CapabilityMap[K]` cast in `resolve()` is sound ONLY because every write into the private map goes through that one typed door.
>
> ACCEPTANCE CRITERION — `harness/tests/registry.test.ts` already exists and currently fails. It must pass unmodified. Do not edit it, weaken it, remove the `@ts-expect-error` directives, or skip any case. Here it is verbatim:
>
> ```ts
> import { afterEach, describe, expect, it, vi } from 'vitest';
> import { CapabilityRegistry, createCapabilityAccessor } from '../src/capabilities/registry.js';
> import { CapabilityHealthError } from '../src/errors.js';
> import { createMockMarketData, createMockProvider } from './helpers.js';
>
> function fullyRegistered(): CapabilityRegistry {
>   const registry = new CapabilityRegistry();
>   registry.register('chat', createMockProvider('ok'));
>   registry.register('search', createMockProvider('ok'));
>   registry.register('sentiment', createMockProvider('skip'));
>   registry.register('market_data', createMockMarketData());
>   return registry;
> }
>
> afterEach(() => {
>   vi.useRealTimers();
> });
>
> describe('resolve', () => {
>   it('returns the registered provider instance', () => {
>     const provider = createMockMarketData();
>     const registry = new CapabilityRegistry();
>     registry.register('market_data', provider);
>     expect(registry.resolve('market_data')).toBe(provider);
>   });
>
>   it('throws for a capability that was never registered', () => {
>     expect(() => new CapabilityRegistry().resolve('chat')).toThrow(/chat/);
>   });
>
>   it('exposes market_data methods without a cast at the call site', async () => {
>     const registry = fullyRegistered();
>     const cap = createCapabilityAccessor(registry);
>     await expect(cap('market_data').fetch_ohlcv('RELIANCE', '1d')).resolves.toEqual([]);
>   });
>
>   it('rejects wrongly typed capabilities at compile time', () => {
>     const cap = createCapabilityAccessor(fullyRegistered());
>     // @ts-expect-error chat is a bare CapabilityProvider and has no fetch_ohlcv
>     expect(() => cap('chat').fetch_ohlcv('RELIANCE', '1d')).toThrow();
>     // @ts-expect-error 'nonexistent' is not a CapabilityName
>     expect(() => cap('nonexistent')).toThrow();
>   });
> });
>
> describe('register', () => {
>   it('throws on duplicate registration', () => {
>     const registry = new CapabilityRegistry();
>     registry.register('chat', createMockProvider('ok'));
>     expect(() => registry.register('chat', createMockProvider('ok'))).toThrow(/chat/);
>   });
>
>   it('throws after the registry is sealed by validateAll', async () => {
>     const registry = fullyRegistered();
>     await registry.validateAll();
>     expect(registry.sealed).toBe(true);
>     expect(() => registry.register('chat', createMockProvider('ok'))).toThrow(/sealed/i);
>   });
> });
>
> describe('validateAll', () => {
>   it('reports capabilities skipped because they implement no healthCheck', async () => {
>     const result = await fullyRegistered().validateAll();
>     expect(result.skipped).toEqual(['sentiment']);
>   });
>
>   it('aggregates every failure into one CapabilityHealthError', async () => {
>     const registry = new CapabilityRegistry();
>     registry.register('chat', createMockProvider('fail', 'ECONNREFUSED'));
>     registry.register('search', createMockProvider('ok'));
>     registry.register('sentiment', createMockProvider('fail', 'ETIMEDOUT'));
>     registry.register('market_data', createMockMarketData());
>     const error = await registry.validateAll().then(
>       () => undefined,
>       (e: unknown) => e as CapabilityHealthError,
>     );
>     expect(error).toBeInstanceOf(CapabilityHealthError);
>     expect(error?.message).toContain('chat: ECONNREFUSED');
>     expect(error?.message).toContain('sentiment: ETIMEDOUT');
>   });
>
>   it('seals the registry even when validation fails', async () => {
>     const registry = new CapabilityRegistry();
>     registry.register('chat', createMockProvider('fail'));
>     await registry.validateAll().catch(() => undefined);
>     expect(registry.sealed).toBe(true);
>   });
>
>   it('bounds a provider that ignores its abort signal', async () => {
>     const registry = new CapabilityRegistry();
>     registry.register('market_data', { ...createMockMarketData(), ...createMockProvider('rude') } as never);
>     const started = Date.now();
>     const error = await registry.validateAll({ timeoutMs: 200 }).then(
>       () => undefined,
>       (e: unknown) => e,
>     );
>     expect(error).toBeInstanceOf(CapabilityHealthError);
>     expect(Date.now() - started).toBeLessThan(1500);
>   });
>
>   it('prefixes the capability name exactly once on a timeout', async () => {
>     const registry = new CapabilityRegistry();
>     registry.register('market_data', { ...createMockMarketData(), ...createMockProvider('rude') } as never);
>     const error = await registry.validateAll({ timeoutMs: 50 }).then(
>       () => undefined,
>       (e: unknown) => e as Error,
>     );
>     expect(error?.message).toBe('market_data: probe timeout');
>   });
>
>   it('passes an AbortSignal that is aborted when the probe budget expires', async () => {
>     let observed: AbortSignal | undefined;
>     const registry = new CapabilityRegistry();
>     registry.register('chat', {
>       healthCheck: (signal: AbortSignal) => {
>         observed = signal;
>         return new Promise<void>((resolve) => {
>           setTimeout(resolve, 3_000_000);
>         });
>       },
>     });
>     await registry.validateAll({ timeoutMs: 50 }).catch(() => undefined);
>     expect(observed?.aborted).toBe(true);
>   });
>
>   it('leaves no pending timer on the success path', async () => {
>     vi.useFakeTimers();
>     const registry = fullyRegistered();
>     await registry.validateAll({ timeoutMs: 5000 });
>     expect(vi.getTimerCount()).toBe(0);
>   });
>
>   it('leaves no pending timer on the failure path', async () => {
>     vi.useFakeTimers();
>     const registry = new CapabilityRegistry();
>     registry.register('chat', createMockProvider('fail'));
>     await registry.validateAll({ timeoutMs: 5000 }).catch(() => undefined);
>     expect(vi.getTimerCount()).toBe(0);
>   });
> });
> ```
>
> VERIFY before you finish, from inside `harness/`: `pnpm test && pnpm typecheck && pnpm lint` — all three exit 0. `pnpm typecheck` passing also proves both `@ts-expect-error` directives are suppressing REAL errors; if your types are too loose, `tsc` will fail on the unused directives, which is the intended behaviour.
>
> BOUNDARIES:
> - Create ONLY `harness/src/capabilities/types.ts` and `harness/src/capabilities/registry.ts`.
> - Do NOT create or modify `harness/src/config-loader.ts` — a different task owns it and is running in parallel.
> - Do not modify `harness/src/config.ts`, `harness/src/errors.ts`, `harness/tests/*`, or any config file.
> - Do NOT implement live MCP client construction, plugin auto-discovery, a CLI entrypoint, or a "required vs optional capabilities" feature. All are out of scope for this story.
> - Do not add dependencies. Do not import `nunjucks`, `@langchain/langgraph`, or `@modelcontextprotocol/sdk`.
> - Repo standards: OOP/SOLID/Clean Architecture — the registry depends on the `CapabilityProvider` interface only, never on a concrete provider; composition over inheritance (the registry WRAPS a Map, it does not extend one). No comments unless the WHY is non-obvious. Prettier at 120 columns, single quotes.

**Validator brief.**

> You are validating an implementation produced by an external agent. It is unverified until you say otherwise. You have NO edit authority — report findings only, do not fix anything.
>
> Worktree: `<WORKTREE_PATH>`. Task: implement `harness/src/capabilities/types.ts` and `harness/src/capabilities/registry.ts`.
> Failing test now expected to pass: `harness/tests/registry.test.ts` (12 cases), using `harness/tests/helpers.ts`.
>
> Run each gate verbatim and report PASS/FAIL with actual output on failure:
> 1. `cd harness && pnpm install && pnpm test` — every case in `tests/registry.test.ts` passes.
> 2. `cd harness && pnpm typecheck` — exit 0. This gate is doubly important here: it also proves the two `@ts-expect-error` directives suppress real errors.
> 3. `cd harness && pnpm lint` — exit 0.
> 4. Event-loop check — the suite must not hang. Run `cd harness && timeout 60 pnpm test`; if it is killed by the timeout, that is a FAIL and almost certainly the leaked-timer defect.
> 5. `cd <repo root> && uv run ruff check . && uv run bandit -r src/ -c pyproject.toml -ll && uv run pytest tests/ -v` — Python side unaffected.
> 6. `git diff --stat` — only the two `src/capabilities/*.ts` files added; `tests/registry.test.ts` and `tests/helpers.ts` unchanged.
>
> Then give a correctness read, not just "tests green". Read the source and check specifically:
> - **Probe lifecycle.** Each probe constructs its OWN `AbortController`, races the provider's `healthCheck(signal)` against a `setTimeout`-driven rejection, and calls `clearTimeout` in a `finally`. If you see `AbortSignal.timeout()`, or a race timer that is never cleared, that is a FAIL even if all tests pass — those are ref'd and hold the event loop open, producing a measured 5s hang on the SUCCESS path.
> - **Bare abort reason.** The timeout rejection must be `new Error('probe timeout')` with NO capability-name prefix. The name is attached in exactly one place, the aggregation step. Both prefixing produces `market_data: market_data: probe timeout`.
> - **Aggregation.** `Promise.allSettled`, not `Promise.all`. All failures reported in one `CapabilityHealthError`.
> - **Sealing.** `#sealed` is set to `true` on BOTH the success and failure paths, before any throw.
> - **Optional probe.** `healthCheck` is `?`-optional in `types.ts`, providers without it are pushed to `skipped` rather than probed, and `skipped` is returned.
> - **Type soundness.** `register<K>` is typed `provider: CapabilityMap[K]` and `#providers` is genuinely private (`#` field, not `private` keyword on a public-ish property). The single `as CapabilityMap[K]` in `resolve()` is only sound because of this; if `register`'s signature was widened, flag it as a FAIL.
> - **Composition.** `CapabilityRegistry` WRAPS a `Map`; it must not `extend Map`.
> - No `@ts-ignore`, `@ts-nocheck`, `as any`, or eslint-disable comments introduced to get gates passing; the `@ts-expect-error` lines in the TEST file must still be present and unmodified.
> - No out-of-scope work: no MCP client, no plugin discovery, no CLI, no required-vs-optional capability feature.
>
> Report format: one line per gate (`GATE n: PASS|FAIL`), then a correctness section, then `VERDICT: PASS|FAIL`.

---

## Task 5: Toolchain integration

**Seam note.** The interface is the promise that `make check` is the one honest command for this repo: run it and both stacks are actually checked. It hides the two-language split from every caller — a developer, a pre-commit hook, and CI all invoke the same three Makefile targets, and none of them needs to know that half the work is `uv run` and half is `pnpm`. It is a real boundary because without it `make check` and CI go green while zero TypeScript is checked (verified 2026-08-14: `ci.yml` has no Node step, all Makefile targets are `uv`-only, `.pre-commit-config.yaml` has no JS hooks) — the gate would be describing a check it does not perform.

**Files:**
- Modify: `.github/workflows/ci.yml` — add a `harness` job
- Modify: `Makefile:14-25` — `lint`, `format`, `test`, `check`, `setup` targets
- Modify: `.pre-commit-config.yaml` — add local ESLint/Prettier hooks

**Interfaces:**
- Consumes from Task 1: the pnpm scripts `lint`, `format`, `typecheck`, `test` in `harness/package.json`; `harness/pnpm-lock.yaml`; `packageManager: pnpm@11.21.0`.
- Produces: `make lint`, `make test`, `make check` covering both stacks; a CI job named `harness`.

- [ ] **Step 1: Write the failing test**

The gate for this task is executable and lives in the shell. Create the check script `scripts/check_toolchain.sh`:

```bash
#!/usr/bin/env bash
# Gate for the two-stack toolchain wiring: make/CI/pre-commit must all reach harness/.
set -euo pipefail
fail=0
check() { if eval "$2" >/dev/null 2>&1; then echo "PASS: $1"; else echo "FAIL: $1"; fail=1; fi; }

check "Makefile lint target reaches harness"    "grep -A4 '^lint:' Makefile | grep -q 'pnpm.*lint'"
check "Makefile typecheck runs in harness"      "grep -A4 '^lint:' Makefile | grep -q 'pnpm.*typecheck'"
check "Makefile test target reaches harness"    "grep -A4 '^test:' Makefile | grep -q 'pnpm.*test'"
check "Makefile still runs ruff"                "grep -A4 '^lint:' Makefile | grep -q 'ruff check'"
check "Makefile still runs pytest"              "grep -A4 '^test:' Makefile | grep -q 'pytest'"
check "check target composes lint+security+test" "grep -q '^check: lint security test' Makefile"
check "CI defines a harness job"                "grep -q '^  harness:' .github/workflows/ci.yml"
check "CI installs pnpm"                        "grep -q 'pnpm/action-setup' .github/workflows/ci.yml"
check "CI pins Node 24"                         "grep -q \"node-version: '24'\" .github/workflows/ci.yml"
check "CI installs frozen lockfile"             "grep -q 'pnpm install --frozen-lockfile' .github/workflows/ci.yml"
check "CI typechecks the harness"               "grep -q 'pnpm typecheck' .github/workflows/ci.yml"
check "CI tests the harness"                    "grep -q 'pnpm test' .github/workflows/ci.yml"
check "pre-commit has an eslint hook"           "grep -q 'id: harness-eslint' .pre-commit-config.yaml"
check "pre-commit has a prettier hook"          "grep -q 'id: harness-prettier' .pre-commit-config.yaml"
check "pre-commit JS hooks scoped to harness"   "grep -q 'files: ..harness/.*.ts\$' .pre-commit-config.yaml"
check "python hooks still present"              "grep -q 'ruff-pre-commit' .pre-commit-config.yaml"

exit "$fail"
```

- [ ] **Step 2: Run the gate to verify it fails**

```bash
chmod +x scripts/check_toolchain.sh && ./scripts/check_toolchain.sh
```
Expected: FAIL, exit 1, with `FAIL:` on every harness-related line — `ci.yml` has no Node/pnpm step, the Makefile targets are `uv run` only, and `.pre-commit-config.yaml` has no JS hooks. The four "still present" lines (ruff, pytest, check-target, ruff-pre-commit) should already PASS; they are the regression guard proving the Python wiring survived.

- [ ] **Step 3: Modify the `Makefile`**

Replace the `setup`, `lint`, `format` and `test` targets with:

```make
setup:
	uv python install 3.12
	uv sync
	corepack enable pnpm
	cd harness && pnpm install

lint:
	uv run ruff check .
	uv run mypy src/
	cd harness && pnpm lint
	cd harness && pnpm typecheck

format:
	uv run ruff check --fix .
	uv run ruff format .
	cd harness && pnpm format

test:
	uv run pytest tests/ -v
	cd harness && pnpm test
```

`check: lint security test` is unchanged and now transitively covers both stacks — that is the point. Each recipe line runs in its own shell, so every `cd harness` is repeated rather than assumed to persist.

- [ ] **Step 4: Modify `.github/workflows/ci.yml`**

Add a second job alongside the existing `lint-and-test` (leave that job exactly as it is):

```yaml
  harness:
    runs-on: ubuntu-latest
    defaults:
      run:
        working-directory: harness

    steps:
      - uses: actions/checkout@v4

      - uses: pnpm/action-setup@v4
        with:
          version: 11

      - uses: actions/setup-node@v4
        with:
          node-version: '24'
          cache: pnpm
          cache-dependency-path: harness/pnpm-lock.yaml

      - name: Install dependencies
        run: pnpm install --frozen-lockfile

      - name: Lint
        run: pnpm lint

      - name: Typecheck
        run: pnpm typecheck

      - name: Test
        run: pnpm test
```

- [ ] **Step 5: Modify `.pre-commit-config.yaml`**

Append a `local` repo block after the existing bandit block:

```yaml
  - repo: local
    hooks:
      - id: harness-eslint
        name: eslint (harness)
        entry: bash -c 'cd harness && pnpm eslint --no-warn-ignored "$@"' --
        language: system
        files: ^harness/.*\.ts$
        pass_filenames: false

      - id: harness-prettier
        name: prettier (harness)
        entry: bash -c 'cd harness && pnpm prettier --check "src/**/*.ts" "tests/**/*.ts"'
        language: system
        files: ^harness/.*\.ts$
        pass_filenames: false
```

`files: ^harness/.*\.ts$` scopes them so a Python-only commit does not pay for a Node run.

- [ ] **Step 6: Run the gate to verify it passes**

```bash
./scripts/check_toolchain.sh
```
Expected: every line `PASS`, exit 0.

- [ ] **Step 7: Verify the wired commands actually run**

```bash
make lint
uv run pre-commit run harness-eslint --all-files
uv run pre-commit run harness-prettier --all-files
```
Expected: `make lint` runs ruff, mypy, then the harness lint and typecheck. Both pre-commit hooks pass.

Note: `make test` and `make check` will only pass once Tasks 3 and 4 have merged, since the harness suite references their modules. If this task is validated before they merge, that is expected — see the merge-order constraint in the Dependency Ordering section.

- [ ] **Step 8: Commit**

```bash
git add Makefile .github/workflows/ci.yml .pre-commit-config.yaml scripts/check_toolchain.sh
git commit -m "build: wire harness TypeScript checks into make, CI and pre-commit"
```

**Gemini delegation prompt.**

> `run_agy --mode write --add-dir /mnt/c/Users/vama0/Desktop/Forecasting_Agent`
>
> You are wiring a new TypeScript package into an existing Python repository's build tooling at `/mnt/c/Users/vama0/Desktop/Forecasting_Agent`. A `harness/` package already exists with `package.json` scripts named exactly `lint`, `format`, `typecheck`, and `test`, plus `harness/pnpm-lock.yaml` and `packageManager: pnpm@11.21.0`.
>
> The problem you are fixing (verified 2026-08-14): `.github/workflows/ci.yml` has no Node/pnpm step, every `Makefile` target is `uv run`-only, and `.pre-commit-config.yaml` has no JS hooks. So `make check` and CI both go green while ZERO TypeScript is checked. `make check` must remain the one honest command for this repo.
>
> MAKE THESE FOUR CHANGES:
>
> 1. CREATE `scripts/check_toolchain.sh` (executable, `chmod +x`) with exactly this content:
> ```bash
> #!/usr/bin/env bash
> # Gate for the two-stack toolchain wiring: make/CI/pre-commit must all reach harness/.
> set -euo pipefail
> fail=0
> check() { if eval "$2" >/dev/null 2>&1; then echo "PASS: $1"; else echo "FAIL: $1"; fail=1; fi; }
>
> check "Makefile lint target reaches harness"    "grep -A4 '^lint:' Makefile | grep -q 'pnpm.*lint'"
> check "Makefile typecheck runs in harness"      "grep -A4 '^lint:' Makefile | grep -q 'pnpm.*typecheck'"
> check "Makefile test target reaches harness"    "grep -A4 '^test:' Makefile | grep -q 'pnpm.*test'"
> check "Makefile still runs ruff"                "grep -A4 '^lint:' Makefile | grep -q 'ruff check'"
> check "Makefile still runs pytest"              "grep -A4 '^test:' Makefile | grep -q 'pytest'"
> check "check target composes lint+security+test" "grep -q '^check: lint security test' Makefile"
> check "CI defines a harness job"                "grep -q '^  harness:' .github/workflows/ci.yml"
> check "CI installs pnpm"                        "grep -q 'pnpm/action-setup' .github/workflows/ci.yml"
> check "CI pins Node 24"                         "grep -q \"node-version: '24'\" .github/workflows/ci.yml"
> check "CI installs frozen lockfile"             "grep -q 'pnpm install --frozen-lockfile' .github/workflows/ci.yml"
> check "CI typechecks the harness"               "grep -q 'pnpm typecheck' .github/workflows/ci.yml"
> check "CI tests the harness"                    "grep -q 'pnpm test' .github/workflows/ci.yml"
> check "pre-commit has an eslint hook"           "grep -q 'id: harness-eslint' .pre-commit-config.yaml"
> check "pre-commit has a prettier hook"          "grep -q 'id: harness-prettier' .pre-commit-config.yaml"
> check "pre-commit JS hooks scoped to harness"   "grep -q 'files: ..harness/.*.ts\$' .pre-commit-config.yaml"
> check "python hooks still present"              "grep -q 'ruff-pre-commit' .pre-commit-config.yaml"
>
> exit "$fail"
> ```
>
> 2. MODIFY `Makefile` — replace the `setup`, `lint`, `format`, and `test` targets with:
> ```make
> setup:
> 	uv python install 3.12
> 	uv sync
> 	corepack enable pnpm
> 	cd harness && pnpm install
>
> lint:
> 	uv run ruff check .
> 	uv run mypy src/
> 	cd harness && pnpm lint
> 	cd harness && pnpm typecheck
>
> format:
> 	uv run ruff check --fix .
> 	uv run ruff format .
> 	cd harness && pnpm format
>
> test:
> 	uv run pytest tests/ -v
> 	cd harness && pnpm test
> ```
> Use TABS for recipe indentation, not spaces. Leave `sync`, `security`, `check`, `all`, and `clean` EXACTLY as they are — in particular `check: lint security test` must not change; it now transitively covers both stacks, which is the entire point. Each recipe line runs in its own shell, so repeat `cd harness` on every line that needs it; do not assume it persists.
>
> 3. MODIFY `.github/workflows/ci.yml` — leave the existing `lint-and-test` job completely untouched and ADD a second job under `jobs:`:
> ```yaml
>   harness:
>     runs-on: ubuntu-latest
>     defaults:
>       run:
>         working-directory: harness
>
>     steps:
>       - uses: actions/checkout@v4
>
>       - uses: pnpm/action-setup@v4
>         with:
>           version: 11
>
>       - uses: actions/setup-node@v4
>         with:
>           node-version: '24'
>           cache: pnpm
>           cache-dependency-path: harness/pnpm-lock.yaml
>
>       - name: Install dependencies
>         run: pnpm install --frozen-lockfile
>
>       - name: Lint
>         run: pnpm lint
>
>       - name: Typecheck
>         run: pnpm typecheck
>
>       - name: Test
>         run: pnpm test
> ```
> `pnpm/action-setup` must come BEFORE `actions/setup-node`, otherwise `cache: pnpm` has no pnpm to find.
>
> 4. MODIFY `.pre-commit-config.yaml` — leave every existing hook untouched and APPEND after the bandit block:
> ```yaml
>   - repo: local
>     hooks:
>       - id: harness-eslint
>         name: eslint (harness)
>         entry: bash -c 'cd harness && pnpm eslint --no-warn-ignored "$@"' --
>         language: system
>         files: ^harness/.*\.ts$
>         pass_filenames: false
>
>       - id: harness-prettier
>         name: prettier (harness)
>         entry: bash -c 'cd harness && pnpm prettier --check "src/**/*.ts" "tests/**/*.ts"'
>         language: system
>         files: ^harness/.*\.ts$
>         pass_filenames: false
> ```
>
> ACCEPTANCE CRITERION — `./scripts/check_toolchain.sh` must print `PASS:` on all 16 lines and exit 0. Before your change it exits 1. Additionally `make lint` must run to completion.
>
> BOUNDARIES:
> - Modify ONLY `Makefile`, `.github/workflows/ci.yml`, `.pre-commit-config.yaml`, and create `scripts/check_toolchain.sh`.
> - Do NOT touch anything under `harness/` — other tasks own that directory and are running in parallel.
> - Do NOT touch `.gitignore`; it already covers `/node_modules`, `/dist`, `pnpm-debug.log*` (verified).
> - Do NOT remove, weaken, or reorder any existing Python step, hook, or CI job. The Python stack must keep working exactly as before.
> - Do NOT add a Node step to the existing `lint-and-test` job; the harness gets its OWN job so the two stacks fail independently and legibly.
> - `make test` and `make check` may fail right now because two sibling tasks have not merged their harness source yet. That is EXPECTED. Do not "fix" it by weakening the Makefile — verify with `make lint` and `./scripts/check_toolchain.sh` instead.
> - Repo standards: Python via `uv run`, Node via `pnpm` from inside `harness/`. No comments beyond the one already in the script.

**Validator brief.**

> You are validating an implementation produced by an external agent. It is unverified until you say otherwise. You have NO edit authority — report findings only, do not fix anything.
>
> Worktree: `<WORKTREE_PATH>`. Task: wire the `harness/` TypeScript package into `Makefile`, `.github/workflows/ci.yml`, and `.pre-commit-config.yaml`.
> Executable gate: `scripts/check_toolchain.sh`.
>
> IMPORTANT CONTEXT before you start: two sibling tasks implement `harness/src/config-loader.ts` and `harness/src/capabilities/*` in parallel and may not have merged. Therefore `make test` and `make check` are EXPECTED to fail here with missing-module errors from the harness test suite. That specific failure is NOT a defect in this task. Do not run `make check` as a gate; use the gates below.
>
> Run each gate verbatim from the worktree root and report PASS/FAIL with actual output on failure:
> 1. `chmod +x scripts/check_toolchain.sh && ./scripts/check_toolchain.sh` — all 16 lines `PASS`, exit 0.
> 2. `make lint` — runs ruff, mypy, then the harness lint and typecheck; must exit 0.
> 3. `uv run ruff check . && uv run bandit -r src/ -c pyproject.toml -ll && uv run pytest tests/ -v` — the Python stack must be completely unaffected.
> 4. `uv run pre-commit run harness-eslint --all-files` and `uv run pre-commit run harness-prettier --all-files` — both pass.
> 5. `python3 -c "import yaml,sys; yaml.safe_load(open('.github/workflows/ci.yml')); yaml.safe_load(open('.pre-commit-config.yaml')); print('YAML OK')"` — both files still parse.
> 6. `git diff --stat` — ONLY `Makefile`, `.github/workflows/ci.yml`, `.pre-commit-config.yaml` modified and `scripts/check_toolchain.sh` added. Anything under `harness/` appearing in this diff is a FAIL — sibling tasks own it.
>
> Then give a correctness read, not just "gates green". Check specifically:
> - **Nothing Python was removed or weakened.** Diff the `Makefile`, CI file and pre-commit config carefully: every pre-existing ruff/mypy/bandit/pytest step and hook must still be there, unchanged. A green `check_toolchain.sh` with a deleted bandit step is still a FAIL.
> - **`check: lint security test` is unchanged.** The whole design is that `check` composes the other targets and therefore covers both stacks for free. If the implementer hand-expanded it, flag that.
> - **Makefile recipes use TAB indentation**, and every line needing `harness/` repeats its own `cd harness` — recipe lines each get a fresh shell, so a single `cd` on an earlier line does not carry over.
> - **CI ordering:** `pnpm/action-setup` appears BEFORE `actions/setup-node`, or `cache: pnpm` has nothing to find.
> - **CI job separation:** the harness runs in its OWN job named `harness`, not bolted onto `lint-and-test`.
> - **Node is pinned to 24** in CI and the install uses `--frozen-lockfile`.
> - **Pre-commit JS hooks are scoped** with `files: ^harness/.*\.ts$` so Python-only commits do not pay for a Node run.
> - No secrets, tokens, or absolute developer-machine paths introduced into any of the three config files.
>
> Report format: one line per gate (`GATE n: PASS|FAIL`), then a correctness section, then `VERDICT: PASS|FAIL`.

---

## Self-Review

### 1. Spec coverage

| Spec element | Task |
|---|---|
| `harness/` structure, package.json, tsconfig, `.env.example`, `harness_config.yaml` | 1 |
| Tooling: `zod@^4`, `yaml@2.9.0`, `vitest@4.1.10`, Node 24 + `.npmrc engine-strict=true` | 1 |
| Decision 11 — no `nunjucks`, no `@langchain/langgraph` | 1 (asserted in the acceptance check), boundaries of 2/3/4 |
| Decision 3 — `sandbox`/`eval` as `z.record(z.string(), z.unknown())` placeholders | 2 |
| Decision 5 — `CapabilityName` derived from the schema; all four keys required | 2, 4 |
| Decision 7 (errors) — two distinct error types | 2 |
| Decision 9 — secrets redacted at the error boundary | 2 (`redact`), 3 (secret set threaded through all three throw paths) |
| Decision 1 — parse YAML first, then interpolate into string values only | 3 (+ two injection regression tests) |
| Decision 2 — config failure throws, no `process.exit` | 3 |
| Data-flow referential check: every `capabilities` value exists in `mcp_servers` or `llm` | 3 |
| Type design — `resolve<K>`, `CapabilityMap`, `MarketDataProvider`, castless call site, negative cases | 4 |
| The contained `as CapabilityMap[K]` cast and its containment invariant | 4 (documented in code notes, prompt, and validator brief) |
| Decision 6 — `healthCheck` optional; `validateAll` returns `skipped` | 4 |
| Decision 7 (probes) — owned `AbortController` + `Promise.race` + `clearTimeout` in `finally` | 4 |
| Decision 4 — exactly one layer prefixes the capability name; bare abort reason | 4 |
| Decision 8 — `Promise.allSettled` aggregation, then seal; post-seal and duplicate `register()` throw | 4 |
| Testing section — every listed config-loader and registry case | 3, 4 |
| Toolchain Integration section — `ci.yml`, `Makefile`, `.pre-commit-config.yaml` | 5 |
| `.gitignore` already covers node artifacts — no work | noted, no task |
| Decision 10 — required-vs-optional deferred | explicitly out of scope; no task |
| Integration test with a real mock MCP server → Story #5 | explicitly out of scope; no task, and no test relabelled to claim it |

No gaps. Every out-of-scope item is out of scope by an explicit instruction in the relevant task's boundaries, not by omission.

### 2. Placeholder scan

No "TBD", "TODO", "similar to Task N", "add appropriate error handling", or "write tests for the above". Every test is complete runnable code, repeated in full inside each Gemini prompt rather than cross-referenced — the prompts are read by stateless subagents that cannot see other tasks. Every code step carries a code block.

### 3. Type consistency

Names and signatures were checked across task boundaries against a compiled reference implementation, not by eye:
- `ConfigValidationError(issues, secrets?)` — defined in Task 2, called from Task 3 on three paths.
- `CapabilityHealthError(failures)` — defined in Task 2, thrown in Task 4.
- `redact(message, secrets)` / `REDACTED` — defined in Task 2, used in Task 2.
- `CapabilityName` — derived in Task 2's `config.ts`, re-exported by Task 4's `types.ts`, used in both.
- `HarnessConfigSchema`, `type HarnessConfig`, `LLM_TARGET` — defined in Task 2, consumed in Task 3.
- `CapabilityMap`, `CapabilityProvider`, `MarketDataProvider` — defined in Task 4's `types.ts`, used by Task 4's `registry.ts` and `tests/helpers.ts`.
- pnpm script names `lint`/`format`/`typecheck`/`test` — defined in Task 1, invoked verbatim by Task 5's Makefile, CI job and gate script.
- `validateAll` returns `{ skipped }` consistently in the interface block, the test, the implementation and the validator brief.

### 4. Test-runs-red check

| Task | Gate | Ran red? | Actual failure observed |
|---|---|---|---|
| 1 | `cd harness && ...` scaffold assertion | Yes | `cd: harness: No such file or directory` |
| 2 | `tests/errors.test.ts` | Yes | `Cannot find module '../src/errors.js'` |
| 3 | `tests/config.test.ts` | Yes | `Cannot find module '../src/config-loader.js'` |
| 4 | `tests/registry.test.ts` | Yes | `Cannot find module '../src/capabilities/registry.js'` |
| 5 | `scripts/check_toolchain.sh` | Yes | exit 1 — every harness line `FAIL`, the four Python-regression lines `PASS` |

Each failure is missing implementation, not a typo. All were then driven green against a reference implementation (32/32 tests, `tsc` clean, `eslint` clean, `prettier --check` clean), so no task is chasing an unsatisfiable spec.

### 5. Independence check

Completed above in the Dependency Ordering section — one row per pair, with the merge-order constraint for Task 5 recorded in Global Constraints territory rather than left to be discovered mid-execution.

### 6. Delegation completeness

Every task carries a Gemini prompt that names its `--mode`, its `--add-dir`, the exact files to create, the full acceptance test verbatim, the repo standards, and an explicit boundary list; and a validator brief that names the test file, the verbatim gate commands, the correctness checks to read for, and the no-edit-authority instruction. Each was written to be handed to a context-free subagent with zero follow-up questions. Task 5's brief additionally pre-empts the one predictable false positive (parallel sibling tasks making `make check` fail), so its validator does not escalate to Sonnet over an expected condition.

---

Plan complete and saved to `docs/superpowers/plans/2026-08-14-capability-layer-config-registry.md`. Ready for `gemini-plan-implementation`.
