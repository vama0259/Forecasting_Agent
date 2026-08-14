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

## Decisions

1. **Parse YAML first, then interpolate `${VAR}` into string values.** Text-level interpolation before parsing lets a secret's value inject config structure — demonstrated, not theorized (Review Log R1). Ponytail's trust-boundary exemption applies: this is validation, not decoration.
2. **Config failure throws; it does not `process.exit`.** Story #10's CLI catches, prints, exits. Keeps the loader testable.
3. **`sandbox`/`eval` are placeholders** — `z.record(z.string(), z.unknown())` (Zod 4 requires both args). Stories #7/#6 tighten their own section.
4. **Two error types.** `ConfigValidationError` (malformed config — a developer fixes a file) and `CapabilityHealthError` (a provider is unreachable — an operator checks infra). Different operator responses must not share a type.
5. **`CapabilityName` derived from the schema.** Note the one-file-change claim from round 1 was **wrong**: adding a capability touches `config.ts` *and* `CapabilityMap` in `types.ts`. Still correct to derive — one source of truth for the *names* — but the justification is corrected. All four keys are required; an omitted binding is a startup failure.
6. **`healthCheck` is optional** (`healthCheck?(signal)`), so providers with nothing to probe don't implement a stub. `validateAll()` **returns the list of skipped capabilities** so a pass never overstates what was checked. Accepted risk: a provider that should be probed but forgets is silently skipped — bounded because bootstrap registers every provider in-repo.
7. **Health probes need `race` AND `AbortSignal` — both.** The signal alone bounds nothing: a provider that ignores it ran 3004ms against a 200ms budget (Review Log R2). `Promise.race` bounds `validateAll()` unconditionally; the signal lets well-behaved providers actually cancel so the process can exit. Timeout is a defaulted parameter (`validateAll({timeoutMs = 5000})`), not config surface.
8. **`validateAll()` aggregates** via `Promise.allSettled` and reports every failure at once, then **seals the registry**. Post-seal `register()` throws, as does duplicate registration — otherwise "validated at startup" is a description rather than a guarantee.
9. **Secrets are redacted at the error boundary.** Zod echoes offending values; `llm.api_key` must never reach a log or CI output.
10. **Required-vs-optional capabilities: deferred.** ADR-015's flat map stands. Nothing consumes degradation yet, and `required_capabilities` is purely additive later. **Latent coupling — record before undoing this:** today every health failure is fatal, so the CLI exits and an abandoned probe is harmless. Make failures non-fatal without honoring cancellation and the CLI will hang after logging success (measured: returns at 100ms, exits at 3003ms). Undoing this deferral requires decision 7's signal to be honored by every provider.
11. **`nunjucks` and `@langchain/langgraph` are deferred** to Stories #9/#11. This story imports neither.

## SOLID / Clean Architecture

SRP — `config.ts` schema-only, `config-loader.ts` owns I/O. DIP — registry depends on the interface, never a provider. OCP — new capabilities register without touching registry internals. ISP — `healthCheck` optional rather than forced on every provider (round 1 claimed ISP while violating it). Composition — registry wraps a `Map`; the only `extends` are the two error classes and `MarketDataProvider extends CapabilityProvider`. Dependency rule — `capabilities/` has zero framework imports.

## Testing (Vitest)

- **config-loader:** valid YAML accepted; invalid type rejected with Zod path; `${VAR}` resolves via `vi.stubEnv`; missing env var throws; dangling capability→provider reference rejected; **a secret containing `\n`/`: ` is inert, not structural** (regression test for decision 1); **error messages never contain a secret value** (decision 9).
- **registry:** resolves a mock; throws on unregistered; aggregates multiple health failures; reports skipped providers; `register()` throws after seal and on duplicates; **a provider ignoring its signal still times out** (decision 7).

**Open — needs your approval.** Issue #4's AC says "integration test with mock MCP server". A genuine one needs an MCP client, which this story's scope excludes. Options: (a) move it to Story #2 and edit issue #4's AC — requires editing GitHub issues, which I will not do unattended; (b) build a stdio mock server here, pulling `@modelcontextprotocol/sdk` into a story that excluded MCP wiring. Until you choose, the AC stands unmet and this spec does not claim otherwise.

## Toolchain Integration (in scope)

Verified 2026-08-14: `ci.yml` has no Node/pnpm step; `Makefile` targets are `uv run` only; `.pre-commit-config.yaml` has no JS hooks. Without this, `make check` and CI go green while none of this story's TypeScript is checked.

- `ci.yml`: add pnpm job — `install --frozen-lockfile`, `lint`, `typecheck` (`tsc --noEmit`), `test`.
- `Makefile`: `lint`/`test`/`check` cover both stacks, so `make check` stays the one honest command.
- `.pre-commit-config.yaml`: ESLint/Prettier scoped to `harness/`.

`.gitignore` already covers `/node_modules`, `/dist`, `pnpm-debug.log*` — verified, no work.

## Tooling

Registry-verified 2026-08-14: `zod@4.4.3` (**pin `^4`** — v3 differs), `yaml@2.9.0` (dual CJS/ESM, `type: commonjs` with ESM conditions), `vitest@4.1.10`.

**Node 24 — resolved 2026-08-14.** `devcontainer.json` updated `22` → `24`, matching the local machine (`v24.19.0`) and the Kanban record. `harness/package.json` sets `"engines": {"node": ">=24"}` so the pin is enforced rather than assumed.

## Out of Scope

Live MCP client construction · plugin auto-discovery (ADR-015 Phase B, MVP2) · CLI entrypoint (Story #10) · full `sandbox`/`eval` schemas (Stories #7/#6) · required/optional capabilities (decision 10).

## Review Log

**R1 — `REJECTED`.** 2 blockers: `z.record` single-arg doesn't compile under Zod 4 (proven by `tsc`); `resolve()` couldn't satisfy the AC as typed. Plus unverified "pure ESM" claim, no probe timeout, conflated error types, unsealed registry, ISP claim contradicted, no redaction, mislabeled integration test, 2 unused deps.

**R2 — `CHANGES REQUESTED`.** Verified the revised type design compiles including negative cases. Found a defect **in R1's own fix**: `AbortSignal` alone doesn't bound a provider that ignores it (3004ms vs 200ms) — decision 7 now requires both mechanisms. Corrected decision 5's false "one-file change" justification. Cut three type aliases that named nothing (ponytail). Downgraded R1's required/optional finding from High to a recorded deferral with its latent coupling documented.

Remaining before `APPROVED`: the integration-test decision above, and the Node version pin. Both need your call; neither is mine to make.
