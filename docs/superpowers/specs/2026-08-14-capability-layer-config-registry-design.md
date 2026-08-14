---
type: adr
date: 2026-08-14
status: decided
parent: "[[Forecasting Agent]]"
---

# Capability Layer & Config Registry — Design Spec

**Story:** GitHub #4 — Story 1: Capability Layer & Config Registry (TypeScript + Zod)
**Implements:** ADR-015 (`docs/ARCHITECTURE.md:195`), Module Spec §1 (`docs/MODULE_SPECIFICATIONS.md:11`)
**Milestone:** MVP 1 — Indian Equities & Derivatives
**Review status:** round 2 of `reviewing-specs` — see Review Log

## Scope

This story builds the **registry mechanism and config validation**, not live MCP client wiring. `resolve()` returns whatever `CapabilityProvider` was registered under a name; turning an `mcp_servers` config entry into a connected MCP client is later work. Tests use mock providers.

## Structure

```
harness/
  package.json            pnpm; typescript, zod@^4, yaml, vitest, eslint, prettier
  tsconfig.json            strict, ESM
  harness_config.yaml
  .env.example
  src/
    config.ts              Zod schemas + derived types
    config-loader.ts        loadConfig(path) → HarnessConfig
    errors.ts               ConfigValidationError, CapabilityHealthError, redact()
    capabilities/
      types.ts              CapabilityProvider, CapabilityMap, CapabilityName
      registry.ts            CapabilityRegistry + createCapabilityAccessor
  tests/
    helpers.ts               createMockProvider()
    config.test.ts
    registry.test.ts
```

## Data Flow

```
harness_config.yaml
  → YAML parse                          (parse FIRST — see decision 1)
  → interpolate ${VAR} in string values only
  → Zod validate → ConfigValidationError on failure
  → referential check: every `capabilities` value exists in `mcp_servers` or `llm`
  → bootstrap registers a provider per capabilities entry
  → registry.validateAll({timeoutMs}) → CapabilityHealthError on failure
  → registry seals; no further registration accepted
```

## Type Design

Verified to compile under `tsc --strict` with Zod 4 (see Review Log R2):

```ts
export type CapabilityName = keyof z.infer<typeof CapabilitiesSchema>;

export interface CapabilityProvider {
  healthCheck?(signal: AbortSignal): Promise<void>;
}
export interface MarketDataProvider extends CapabilityProvider {
  fetch_ohlcv(symbol: string, range: string): Promise<unknown[]>;
}
export interface CapabilityMap {
  chat: CapabilityProvider;      // shape unknown until M2 — base type, deliberately not aliased
  search: CapabilityProvider;    // Story #3
  sentiment: CapabilityProvider; // M4
  market_data: MarketDataProvider;
}

resolve<K extends CapabilityName>(name: K): CapabilityMap[K]
```

`cap('market_data').fetch_ohlcv(...)` typechecks with no cast at the call site; `cap('chat').fetch_ohlcv(...)` and `cap('nonexistent')` are both compile errors. This is the acceptance criterion, proven rather than asserted.

**One unsound spot, deliberately contained:** the internal store is `Map<CapabilityName, CapabilityProvider>`, so `resolve()` ends in `p as CapabilityMap[K]`. The cast is sound only because `register<K>()` is typed to `CapabilityMap[K]` — the Map is private (`#providers`) and every write goes through that one typed door. A per-key heterogeneous map would remove the cast at the cost of significant type machinery; not worth it for one contained assertion. Documented so nobody "cleans up" `register()`'s signature and silently breaks it.

## Decisions

1. **Parse YAML first, then interpolate `${VAR}` into string values.** Text-level interpolation before parsing lets a secret's value inject config structure — demonstrated, not theorized (Review Log R1). Ponytail's trust-boundary exemption applies: this is validation, not decoration.
2. **Config failure throws; it does not `process.exit`.** Story #10's CLI catches, prints, exits. Keeps the loader testable.
3. **`sandbox`/`eval` are placeholders** — `z.record(z.string(), z.unknown())` (Zod 4 requires both args). Stories #7/#6 tighten their own section.
4. **Two error types.** `ConfigValidationError` (malformed config — a developer fixes a file) and `CapabilityHealthError` (a provider is unreachable — an operator checks infra). Different operator responses must not share a type. **Exactly one layer attaches the capability name**: the per-probe catch prefixes `${name}: `, so the abort reason itself must be bare (`"probe timeout"`, not `` `${name}: probe timeout` ``) or messages read `market_data: market_data: probe timeout`. Verified output: `chat: ECONNREFUSED; market_data: probe timeout`.
5. **`CapabilityName` derived from the schema.** Note the one-file-change claim from round 1 was **wrong**: adding a capability touches `config.ts` *and* `CapabilityMap` in `types.ts`. Still correct to derive — one source of truth for the *names* — but the justification is corrected. All four keys are required; an omitted binding is a startup failure.
6. **`healthCheck` is optional** (`healthCheck?(signal)`), so providers with nothing to probe don't implement a stub. `validateAll()` **returns the list of skipped capabilities** so a pass never overstates what was checked. Accepted risk: a provider that should be probed but forgets is silently skipped — bounded because bootstrap registers every provider in-repo.
7. **Health probes: own the `AbortController`, race it, and always `clearTimeout`.** Three findings stack here, each measured (Review Log R2/R3):
   - The signal alone bounds nothing — a provider ignoring it ran 3004ms against a 200ms budget. `Promise.race` is required to bound `validateAll()` unconditionally.
   - **`AbortSignal.timeout()` and a bare race timer are both ref'd and hold the event loop open.** With all providers healthy and `validateAll()` returning in 2ms, the process still hung until the full timeout elapsed — a user-visible 5s hang on *every successful startup*. Unacceptable, and invisible to any test that only asserts return values.
   - Therefore: construct an `AbortController` per probe, `setTimeout` to `abort()` it, race the probe against the abort, and `clearTimeout` in a `finally`. Measured success path after the fix: 2ms, no lingering.

   Timeout is a defaulted parameter (`validateAll({timeoutMs = 5000})`), not config surface.

   **Constraint this imposes on Story #10:** a provider that ignores cancellation holds the loop with *its own* timers, which we cannot clear (measured: process lingered to 12.5s). The CLI must therefore call `process.exit()` explicitly after reporting, not fall off the end of `main`.
8. **`validateAll()` aggregates** via `Promise.allSettled` and reports every failure at once, then **seals the registry**. Post-seal `register()` throws, as does duplicate registration — otherwise "validated at startup" is a description rather than a guarantee.
9. **Secrets are redacted at the error boundary.** Zod echoes offending values; `llm.api_key` must never reach a log or CI output.
10. **Required-vs-optional capabilities: deferred.** ADR-015's flat map stands. Nothing consumes degradation yet, and `required_capabilities` is purely additive later. **Latent coupling — record before undoing this:** today every health failure is fatal, so the CLI exits and an abandoned probe is harmless. Make failures non-fatal without honoring cancellation and the CLI will hang after logging success (measured: returns at 100ms, exits at 3003ms). Undoing this deferral requires decision 7's signal to be honored by every provider.
11. **`nunjucks` and `@langchain/langgraph` are deferred** to Stories #9/#11. This story imports neither.

## SOLID / Clean Architecture

SRP — `config.ts` schema-only, `config-loader.ts` owns I/O. DIP — registry depends on the interface, never a provider. OCP — new capabilities register without touching registry internals. ISP — `healthCheck` optional rather than forced on every provider (round 1 claimed ISP while violating it). Composition — registry wraps a `Map`; the only `extends` are the two error classes and `MarketDataProvider extends CapabilityProvider`. Dependency rule — `capabilities/` has zero framework imports.

## Testing (Vitest)

- **config-loader:** valid YAML accepted; invalid type rejected with Zod path; `${VAR}` resolves via `vi.stubEnv`; missing env var throws; dangling capability→provider reference rejected; **a secret containing `\n`/`: ` is inert, not structural** (regression test for decision 1); **error messages never contain a secret value** (decision 9).
- **registry:** resolves a mock; throws on unregistered; aggregates multiple health failures; reports skipped providers; `register()` throws after seal and on duplicates; **a provider ignoring its signal still times out** (decision 7); **`validateAll()` leaves no pending timer on the success path** — assert via `vi.useFakeTimers()` + `vi.getTimerCount() === 0` after resolution, since a return-value assertion cannot see a leaked timer (decision 7, the startup-hang bug).

**Integration test — decided: moves to Story #5.** Issue #4's AC says "integration test with mock MCP server". A genuine one needs a live MCP client, which this story's scope excludes; building a stdio mock here would test a mock against a mock and pull `@modelcontextprotocol/sdk` into the one story that excluded MCP wiring. Story #5 ships a real market-data MCP server, so the test is real there. **This story's test suite therefore does not claim to satisfy that criterion** — no unit test is relabeled to cover it.

*Pending action (queued, not applied):* the corresponding edits to issues #4 and #5 are outward-facing and await explicit approval before pushing.

## Toolchain Integration (in scope)

Verified 2026-08-14: `ci.yml` has no Node/pnpm step; `Makefile` targets are `uv run` only; `.pre-commit-config.yaml` has no JS hooks. Without this, `make check` and CI go green while none of this story's TypeScript is checked.

- `ci.yml`: add pnpm job — `install --frozen-lockfile`, `lint`, `typecheck` (`tsc --noEmit`), `test`.
- `Makefile`: `lint`/`test`/`check` cover both stacks, so `make check` stays the one honest command.
- `.pre-commit-config.yaml`: ESLint/Prettier scoped to `harness/`.

`.gitignore` already covers `/node_modules`, `/dist`, `pnpm-debug.log*` — verified, no work.

## Tooling

Registry-verified 2026-08-14: `zod@4.4.3` (**pin `^4`** — v3 differs), `yaml@2.9.0` (dual CJS/ESM, `type: commonjs` with ESM conditions), `vitest@4.1.10`.

**Node 24 — resolved 2026-08-14.** `devcontainer.json` updated `22` → `24`, matching the local machine (`v24.19.0`) and the Kanban record. `harness/package.json` sets `"engines": {"node": ">=24"}` — **and `harness/.npmrc` sets `engine-strict=true`, without which `engines` is advisory only.** Measured: default install with an impossible `engines` range emits `npm warn EBADENGINE` and succeeds; with `engine-strict=true` it fails `notsup`. A pin nobody enforces is a comment.

## Out of Scope

Live MCP client construction · plugin auto-discovery (ADR-015 Phase B, MVP2) · CLI entrypoint (Story #10) · full `sandbox`/`eval` schemas (Stories #7/#6) · required/optional capabilities (decision 10).

## Review Log

**R1 — `REJECTED`.** 2 blockers: `z.record` single-arg doesn't compile under Zod 4 (proven by `tsc`); `resolve()` couldn't satisfy the AC as typed. Plus unverified "pure ESM" claim, no probe timeout, conflated error types, unsealed registry, ISP claim contradicted, no redaction, mislabeled integration test, 2 unused deps.

**R2 — `CHANGES REQUESTED`.** Verified the revised type design compiles including negative cases. Found a defect **in R1's own fix**: `AbortSignal` alone doesn't bound a provider that ignores it (3004ms vs 200ms) — decision 7 now requires both mechanisms. Corrected decision 5's false "one-file change" justification. Cut three type aliases that named nothing (ponytail). Downgraded R1's required/optional finding from High to a recorded deferral with its latent coupling documented.

**R3 — `CHANGES REQUESTED`.** Runtime review (ex-Google JS/Node lens) found a defect **in R2's own fix**: `AbortSignal.timeout()` and bare race timers are ref'd, so with every provider healthy and `validateAll()` returning in 2ms the process still hung for the full timeout — a 5s hang on every successful startup, invisible to any return-value assertion. Decision 7 now mandates an owned `AbortController` + `clearTimeout` in `finally`, plus a fake-timer test asserting zero pending timers. Also: `engines.node` is advisory without `engine-strict=true` (measured `npm warn EBADENGINE` then success) — the Node 24 "enforcement" was decorative; `.npmrc` added. Documented the single unsound cast in `resolve()` and its containment. Settled the integration test: moves to Story #5, with this story's suite explicitly not claiming that criterion.

**R4 — `CHANGES REQUESTED`.** Full runtime execution of the amended design: success path 0ms with `skipped: ['sentiment']`, sealing rejects post-validation registration, duplicates rejected, aggregation reports both failures, timeout bounds the rude provider at 201ms, process exits at 203ms. One defect: error messages double-prefixed the capability name (`market_data: market_data: probe timeout`). Fixed by keeping the abort reason bare; decision 4 now pins which layer owns the prefix.

**R5 — `APPROVED`.** Re-ran typecheck (incl. negative `@ts-expect-error` cases) and full runtime after R4's fix: `chat: ECONNREFUSED; market_data: probe timeout`, success path 1ms, clean exit. No blockers, no highs, no open decisions. Only queued item is the outward-facing GitHub issue edit, which is an action awaiting approval rather than an unresolved design question.
