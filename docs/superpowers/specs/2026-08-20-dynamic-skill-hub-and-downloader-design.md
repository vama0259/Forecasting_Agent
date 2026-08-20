---
type: adr
date: 2026-08-20
status: proposed
parent: "[[Forecasting Agent]]"
---

# M11 Dynamic Skill Hub, Downloader Engine & Agent Skill Injection — Design Spec

**Issue:** #43 (M11 Skill Registry & Dynamic Skill Hub) · **ADRs:** ADR-021 (sandbox lifecycle/network/workspace), ADR-027 §4 (skill lifecycle & pruning), ADR-028 (prompt architecture, prefix stability), ADR-029 (imported factor floor vs agent-discovered strategies), ADR-020 (`as_of` discipline extends to workspace artifacts), ADR-023 (participant intent agents) · **Depends on:** #4 (Capability Layer), #10 (Participant Agents) · **Blocks:** M10 CLI Delivery Interface

**Revision 2 (2026-08-20)** — rewritten after an adversarial grill of revision 1. Six findings were
upheld and are resolved here; each is marked **[Gn]** at the point it is answered. Revision 1's
§0 asserted an ADR *decision* as a measured *fact*, and that error propagated into a plan whose
first task wrote into a directory that does not exist. §0 below now carries the command that
produced each fact.

---

## 0. Measured Environment & Codebase Facts

Every line below was produced by the command shown, run in the repo root on 2026-08-20. Facts
that are **ADR decisions rather than implemented behaviour** are labelled as such — the
distinction is the reason this revision exists.

| # | Fact | Evidence |
| :--- | :--- | :--- |
| 1 | `.agents/skills/` holds **41** directories, and they are Claude Code *developer-workflow* skills (`brainstorming`, `clean-architecture`, `docker-build-deploy`, `ponytail`, …), not market-analysis skills. | `ls .agents/skills \| wc -l` → `41`; `ls .agents/skills \| head -20` |
| 2 | `skills/` **does not exist**. This milestone creates it. | `ls -d skills` → `No such file or directory` |
| 3 | `ParticipantAgentConfigSchema` already declares `skills: z.array(z.string()).default([])`; all four agents (`price`, `fii`, `dii`, `retail`) currently set `skills: []`. | `harness/src/agents/types.ts:18`, `AGENT_CONFIGS` at `:26` |
| 4 | Prompts render through **nunjucks**, not Python Jinja2. `renderPrompt(config, context)` at `harness/src/prompts/engine.ts:44` renders `config.promptTemplate` from `harness/prompts/`. ADR-028 §2 specifies exactly this split (`jinja2` offline in Python, `nunjucks` online in TS). | `harness/src/prompts/engine.ts:1,10,44` |
| 5 | **`workspace/skills/` is an ADR-021 decision that no code implements.** Zero hits across `harness/src`, `harness/tests`, `harness/prompts`, `src/`, `infra/`, `scripts/`, `sandbox/Dockerfile`, `docker-compose.yml`. The two-tier sandbox spec says so in writing: `SandboxManager` "does not implement ADR-021's `workspace/skills/`, `workspace/models/` (persist) vs `workspace/scratch/` (wipe) policy; that split remains the caller's (M7's) responsibility." | `grep -rn "workspace/skills" harness/src harness/tests src infra scripts sandbox docker-compose.yml` → no matches; `docs/superpowers/specs/2026-08-14-two-tier-sandbox-design.md:55` |
| 6 | **No host workspace is bind-mounted on the explore tier today.** `SandboxManager.getOrCreateWarmContainer` computes `const binds = workspacePath ? [...] : []` (`manager.ts:249`), and `workspacePath` is never supplied: `SandboxBackendAdapter.execute()` calls `runExplore({runId, tier:'explore', code})` with no workspace path, and no other caller passes one. `binds` is therefore always `[]`. | `grep -rn "workspacePath" harness/src` → only `types.ts:11`, `manager.ts:87,245,249`; `deepagents-adapter.ts:47` |
| 7 | The sandbox image sets `WORKDIR /workspace` and `ENV PYTHONPATH=/opt/agent_lib`. The **validate** tier additionally sets `PYTHONPATH=/workspace/m8:/opt/agent_lib`. The explore tier sets no `PYTHONPATH` override, so `/workspace` is **not** importable there. | `sandbox/Dockerfile:21,24`; `harness/src/sandbox/manager.ts:131` |
| 8 | **The submitted model may not import anything from the workspace.** `_macros.j2`'s `eval_contract` requires `/workspace/model.py` to be "SELF-CONTAINED … NO network access and NO external files", re-executed in a clean `--network none` container. | `harness/prompts/_macros.j2:1-16`; ADR-021 (validation tier) |
| 9 | `yaml@^2.9.0` is already a harness dependency. **No tokenizer dependency exists** (`tiktoken`, `js-tiktoken`, `gpt-tokenizer` all absent). | `harness/package.json:35`, `grep -n "tiktoken" harness/package.json` → no match |
| 10 | Current suite sizes: **283** harness tests across 48 `.test.ts` files; **299** Python tests. | `grep -rho "^\s*\(it\|test\)(" harness/tests \| wc -l` → 283; `uv run pytest --collect-only -q` → `299 tests collected` |
| 11 | `harness/src/cli/` does not exist. The spec's `skills` subcommands are therefore new surface, not an addition to an existing CLI. | `ls harness/src/cli` → `No such file or directory` |

### 0.1 Consequences of facts 5–8 (read before §1)

Revision 1 assumed a working `workspace/skills/` substrate. There is none. Concretely:

- `SkillRegistry.syncToSandbox()` as revision 1 specified it would have written files to a host
  path that is never mounted into any container (fact 6), producing a silently no-op feature whose
  unit tests all pass. **[G2]**
- Even with a mount, `import skills.foo` would fail on the explore tier because `/workspace` is not
  on `PYTHONPATH` there (fact 7).
- Even with a mount and a `PYTHONPATH`, a model that imports `skills.foo` **fails validation by
  design** (fact 8) — and that is correct ADR-021 behaviour, not a bug to work around.

§1.2 and §2 answer these. They are the reason this milestone opens with a workspace task.

---

## 1. Architectural Decisions

### 1.1 Two-Tier Skill Model — and what Tier 2 is actually for

```
                          ┌───────────────────────────────────────┐
                          │        M11 Skill Architecture         │
                          └───────────────────┬───────────────────┘
                                              │
              ┌───────────────────────────────┴───────────────────────────────┐
              ▼                                                               ▼
 ┌──────────────────────────────────┐                    ┌──────────────────────────────────┐
 │ Tier 1: Analytical Prompt Skills │                    │ Tier 2: Exploration Code Skills  │
 ├──────────────────────────────────┤                    ├──────────────────────────────────┤
 │ • Source:  skills/<name>/SKILL.md│                    │ • Source:  skills/<name>/script.py│
 │ • Target:  nunjucks agent prompt │                    │ • Target:  /workspace/skills/     │
 │ • Lifetime: one render           │                    │ • Lifetime: explore tier only     │
 │ • Carries analysis frameworks    │                    │ • Carries NSE-shaped data parsers │
 │   (Wyckoff VSA, FII squeeze)     │                    │ • MUST be inlined before submit   │
 └──────────────────────────────────┘                    └──────────────────────────────────┘
                                                                        │
                                                          ┌─────────────┴─────────────┐
                                                          │ Submitted /workspace/     │
                                                          │ model.py imports NOTHING  │
                                                          │ from skills/ — validation │
                                                          │ tier is --network none    │
                                                          │ and self-contained (f.8)  │
                                                          └───────────────────────────┘
```

**The Tier-2 invariant, stated explicitly (new in rev 2):** a submitted model that does
`import skills.*` **fails validation, and that is the correct outcome.** ADR-021 built the
cold-container re-run precisely so that dependence on exploration-tier residue surfaces as a
failure before a contaminated result enters evaluation history. Tier 2 is scaffolding the agent
uses *while iterating*; anything it wants to keep must be inlined into `model.py` before
submission. The prompt templates must say this in so many words (§3.3), or the first agent that
factors its feature code into a skill will hit a validation failure it cannot diagnose.

**Flagged assumption — Tier 2's remaining value is narrower than revision 1 claimed.** Revision 1
justified Tier 2 as "reusable math primitives without burning token budget re-writing formulas."
ADR-029 already answers that: `ta`, `scipy`, `statsmodels`, `arch`, `scikit-learn` are baked into
the image precisely so the agent never hand-rolls a rolling standard deviation. What is genuinely
left for Tier 2 is the layer ADR-029 assigns to the agent — **NSE-disclosure-shaped parsing and
transforms that no PyPI package has**: participant-wise F&O OI CSV shapes, bhavcopy delivery-volume
joins, option-chain max-pain migration over NSE's JSON payload. That is a real gap, but it is a
*smaller* gap than "reusable math primitives," and it may support fewer skills than the four in §2.
**Decision:** ship Tier 2 with the two catalog skills that genuinely need it (§2) and re-evaluate
at M12. If fewer than two skills carry non-trivial `script.py` content by then, cut Tier 2 rather
than maintain a second format for one file.

- **Pros:** LLM reasoning frameworks and Python data-shaping evolve independently; neither is
  blocked on the other's format. Tier 1 alone is useful even if Tier 2 is later cut.
- **Cons:** Two skill formats, two lifecycles, two failure modes. Tier 2's explore-only constraint
  is a sharp edge that must be taught in the prompt or it bites once per agent.
- **Where it fits best:** systems where the LLM both reasons *and* executes code against a
  proprietary data shape.
- **Where it does not suit:** deployments with no sandbox — Tier 2 is pure overhead there, and the
  spec should degrade to Tier 1 only.

### 1.2 Workspace Lifecycle — M11 owns it **[G2]**

Fact 5 established that ADR-021's persist/wipe policy was assigned to M7 and never built, and fact
6 that no host directory is mounted at all. M11 is the first consumer that cannot function without
it. **Decision: M11 builds it** (the alternative — shipping `syncToSandbox` against an unmanaged
directory — is the one option that produces green tests and no working feature).

Scope of the new `WorkspaceManager` (`harness/src/sandbox/workspace.ts`):

```
<workspaceRoot>/<runId>/          ← host directory, bind-mounted rw at /workspace
├── skills/                       ← PERSISTS across runs (ADR-021)
│   ├── __init__.py               ← written by WorkspaceManager, makes `import skills.x` resolve
│   └── <skill_name>.py
├── models/                       ← PERSISTS across runs (ADR-021)
└── scratch/                      ← WIPED at the start of every run (ADR-021)
```

- `prepare(runId, asOf)` → creates the tree, wipes `scratch/`, preserves `skills/` and `models/`,
  returns the host path to hand to the sandbox.
- **Two seams must be threaded, not one** (fact 6): `SandboxBackendAdapter` must accept a
  `workspacePath` and forward it on every `runExplore` call, *and* both construction sites
  (`multi-agent.ts:237`, `single-agent.ts:122`) must supply one. Wiring only the adapter leaves
  `binds` empty and reproduces the silent no-op.
- The explore container's `PYTHONPATH` becomes `/workspace:/opt/agent_lib` (fact 7). The validate
  container's is **left unchanged** — `/workspace/m8:/opt/agent_lib` — so the Tier-2 invariant of
  §1.1 is enforced by the runtime, not by a rule anyone has to remember.

- **Pros:** One owner for the whole directory contract; the persist/wipe split becomes testable
  instead of aspirational; ADR-021's residue-detection property finally holds end to end.
- **Cons:** M11 absorbs a task that was scoped to M7, widening this milestone by one task.
- **Where it fits best:** the first milestone that actually reads and writes cross-run state.
- **Where it does not suit:** stateless deployments — `prepare()` degrades to a temp dir.

### 1.3 Point-in-Time Discipline for Persisted Skills **[G5]**

ADR-021 states it directly: "persisted skills and models are cross-run state, so `as_of` discipline
extends beyond database rows to workspace artifacts — a skill saved in June must not influence a
backtest dated March." The postgres/langfuse spec deferred this explicitly as "a sandbox-story
concern." **M11 is the story that creates the artifacts, so the deferral comes due here.**

Revision 1's answer was `.skills.lock.json`, which locks *versions*. A version lock makes a
backtest reproducible while still letting a June skill run against March data — it addresses a
different failure entirely.

**Decision:**
- `SkillManifestSchema` gains a required `available_from` (ISO `YYYY-MM-DD`) — the date from which
  this skill may legitimately influence a forecast. For hand-authored catalog skills it is the
  authoring date; for downloaded skills the downloader stamps the install date.
- `SkillRegistry.discover(asOf: string)` **takes the run's `as_of` and excludes every skill whose
  `available_from > asOf`.** The parameter is required, not optional — an optional one defaults to
  "no filtering" and the leak returns the first time a caller forgets it.
- `.skills.lock.json` records `{name, version, available_from, contentHash}` so a backtest is both
  reproducible *and* point-in-time honest.
- The existing validity gate treats a skill injected with `available_from > as_of` as a leakage
  failure, same class as a lookahead feature.

- **Pros:** Closes an aging deferral before it becomes a decision by default; makes every M11
  backtest number defensible; costs one field and one required parameter.
- **Cons:** Every `discover()` caller must know the run's `as_of`, which slightly couples the
  registry to the forecast context.
- **Where it fits best:** any system where accumulated artifacts feed backtests.
- **Where it does not suit:** live-only inference with no historical evaluation.

### 1.4 Discovery, Download & the Honest Threat Model **[G6]**

**Local indexing.** `SkillRegistry` scans `skills/` **only**. Revision 1 also scanned
`.agents/skills/`; fact 1 shows that directory holds Claude Code developer-workflow skills, which
would have injected `docker-build-deploy` and `clean-architecture` into a market-forecasting
agent's prompt. Removed.

**Remote fetch.** `git clone --depth 1` of a URL, or a GitHub tarball, unpacked to a temp dir,
validated, then moved into `skills/`. `npx skills find` / ClawHub integration is **deferred** —
it is a network dependency on a third-party index for a feature that works without it, and no
catalog skill needs it. `skills search` in M11 searches the local index only (§3.4).

**Threat model, stated honestly.** Revision 1 described a static Python scan as a security control.
It is not one, because ADR-021 already grants the explore container arbitrary agent-authored
Python with reachable PyPI and accepted that residual risk in writing. A downloaded `script.py` and
an agent-written script execute in the same container under the same rules — scanning one and not
the other moves no boundary. But there *is* a real boundary revision 1 missed: **the harness
unpacks the archive on the host, as Node, outside any container.** So the split is:

| Check | Boundary | Behaviour |
| :--- | :--- | :--- |
| Archive entry with absolute path, `..` traversal, symlink, or non-regular file | **Host filesystem** — real, uncontained | **HARD REJECT** |
| Unpacked path resolving outside the target directory | **Host filesystem** | **HARD REJECT** |
| Total unpacked size > 5 MB, or > 50 files | **Host disk** | **HARD REJECT** |
| `SKILL.md` missing or failing `SkillManifestSchema` | Correctness | **HARD REJECT** |
| `os.system`, `subprocess`, `socket`, `eval`, `exec` in `script.py` | Inside a container ADR-021 already concedes | **WARN ONLY** — recorded as `lintWarnings` on the package, shown by `skills list`, never blocks |

The lint is labelled a lint. It catches accidents and gives a human something to look at; it is not
claimed to stop an attacker, because a static string match does not (`getattr(__import__('os'),
'system')` defeats it) and adding patterns does not change that.

- **Pros:** The hard checks defend a boundary that is genuinely undefended; the soft check stops
  pretending. Nobody later reads "sanitized" as "safe to run untrusted code."
- **Cons:** Installing a hostile skill remains possible; the mitigation is the container, and that
  mitigation is ADR-021's already-accepted single-user risk posture.
- **Where it fits best:** single-user systems with a real container boundary.
- **Where it does not suit:** multi-tenant SaaS — ADR-021 already flags that this posture must be
  revisited before launch, and M11 does not change that.

### 1.5 Prompt Injection, Cache Stability & the Token Budget **[G6 cont.]**

`SkillInjector` (`harness/src/skills/injector.ts`) renders resolved skills into the prompt context.

**Placement.** ADR-028 §3 fixes the ordering *static instructions → market state → few-shot
exemplars → volatile retrieved memories at the TAIL* to hold ≥85% prefix cache hits. Skill
instructions are static per agent, so the block sits in the **static instructions** segment, at the
head. It is nested **inside ADR-028's existing `<rules>` boundary** rather than added as a fifth
top-level XML boundary — a skill is a rule the agent follows, not a new semantic category, and
adding boundaries to a fixed schema for no semantic gain is how fixed schemas stop being fixed.

**Determinism is what makes the cache claim true, not placement.** The block is byte-identical
across runs only if:
- skills are sorted by `name` before rendering — never filesystem iteration order, which varies;
- the rendered form derives solely from `config.skills` (fixed per agent) plus file contents;
- skill files do not change mid-run. `SkillRegistry` reads once at run start and caches; a
  mid-run edit is not picked up, deliberately.

**Budget.** The cap is 1,500 tokens per agent. Fact 9: there is no tokenizer dependency, and adding
one to count characters is not worth a dependency. **Decision: cap at 6,000 characters as an
explicitly-stated ~4-chars-per-token proxy.** The number is a proxy and the spec says so; it is
conservative for English prose and the failure direction is "slightly under budget."

**Overflow behaviour: drop the whole skill and warn — never truncate.** A truncated skill is a
half-rule the model will still try to follow, which is worse than an absent one. Skills are added
in sorted order until the next one would exceed the cap; every dropped skill is logged by name.

### 1.6 Skill Lifecycle — what the state machine actually gates in M11 **[G4]**

ADR-027 §4 specifies `DRAFT → ACTIVE → ARCHIVED`, with `ACTIVE` earned by ≥3 purged walk-forward
folds at MASE < 1.0 and `ARCHIVED` entered at rolling 30-day MASE > 1.05.

Revision 1 defaulted `status` to `"active"` in the schema, which promoted every downloaded skill
past the gate by default. Fixing that default to `"draft"` is necessary but raises the question the
grill flagged as blocking: **do `DRAFT` skills get injected?** Both answers have a cost:

- *Draft skills do not inject* → M11 ships with four catalog skills, all `draft`, none injected,
  and the injector is dead code until a promotion loop exists that can attribute MASE to an
  individual skill. **That loop is not in M11's scope** (see below). This ships nothing observable.
- *Draft skills inject* → the state machine gates nothing at injection time in M11.

**Decision: `DRAFT` and `ACTIVE` both inject; `ARCHIVED` is excluded.** Stated plainly so nobody
later mistakes it for something it isn't:

> In M11, `ACTIVE` is **reporting metadata, not a safety gate.** The only transition with teeth is
> `ARCHIVED`, which excludes a skill from injection. `DRAFT → ACTIVE` promotion is manual (via
> `skills promote`) until an attribution mechanism exists.

**Why automatic promotion is out of scope, explicitly.** `ACTIVE` requires attributing a MASE to
*one skill*, which requires a counterfactual — the same run, same `as_of`, same seed, with and
without that skill — and a policy for attributing a shared delta when an agent carries several
skills. That is a whole evaluation subsystem, not a field on a manifest. Building the schema now
and the attribution later is fine; *claiming* the gate works now is not. `status` defaults to
`"draft"`.

**Assignment direction — one source of truth.** Revision 1 had two: `SkillManifestSchema.target_agents`
(skill declares who it is for) and `ParticipantAgentConfig.skills` (agent declares what it wants),
with no rule for disagreement. **Decision: `config.skills` is authoritative.** `target_agents` is
demoted to a **search/discovery hint** — it ranks results in `skills search` and warns on
`skills add` if no agent lists the skill, but it never causes injection on its own. An agent gets
exactly the skills its config names.

---

## 2. Pre-Built Indian Quantitative Skills Catalog

| Skill | Assigned via `config.skills` | Tier | Analytical focus |
| :--- | :--- | :--- | :--- |
| `wyckoff-volume-spread` | `retail`, `price` | 1 + 2 | Bhavcopy delivery volume vs price spread — effort-vs-result, absorption vs distribution. `script.py` parses the NSE bhavcopy delivery join, which no PyPI package does. |
| `fii-derivative-positioning` | `fii` | 1 + 2 | Participant-wise Index Futures long/short ratio (<15% extreme short squeeze, >80% overbought exhaustion). `script.py` parses NSE's participant-wise OI CSV shape. |
| `dii-sip-resilience` | `dii` | 1 only | Monthly mutual-fund cash-buffer absorption against global macro selloffs. Pure reasoning framework; no parsing gap, so no `script.py` (§1.1). |
| `option-chain-pcr-skew` | `retail`, `fii` | 1 only | Strike-wise OI build-up, max-pain migration, PCR momentum. Framework only in M11; the option-chain fetch capability does not exist yet, so a `script.py` would have nothing to parse. |

Two Tier-2 scripts, matching §1.1's "ship two, re-evaluate at M12" decision. All four ship as
`status: draft`, `available_from: 2026-08-20`.

---

## 3. Interfaces

### 3.1 Modules

```
harness/src/sandbox/
└── workspace.ts        # NEW: WorkspaceManager — ADR-021 persist/wipe, /workspace host tree

harness/src/skills/
├── index.ts
├── types.ts            # SkillManifestSchema, SkillPackage
├── registry.ts         # as_of-filtered local scan, manifest parse, sandbox sync
├── downloader.ts       # git/tarball fetch, archive safety (hard), script lint (soft)
└── injector.ts         # <skills> block rendering, sorted, char-budgeted

harness/src/cli/
└── skills.ts           # NEW: list / search / add / remove / promote / archive
```

### 3.2 Schema

```typescript
export const SkillManifestSchema = z.object({
  name: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),        // kebab-case; normalized to snake_case for Python
  description: z.string().min(10),
  version: z.string().default('1.0.0'),
  // Point-in-time gate (ADR-020/021). Required -- a default would silently disable the filter.
  available_from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  // Discovery/ranking hint ONLY. config.skills decides injection. See 1.6.
  target_agents: z.array(z.enum(['price', 'fii', 'dii', 'retail', 'all'])).default([]),
  tags: z.array(z.string()).default([]),
  // Entry state of ADR-027's machine must be the default, or the machine is decorative.
  status: z.enum(['draft', 'active', 'archived']).default('draft'),
});

export interface SkillPackage {
  manifest: z.infer<typeof SkillManifestSchema>;
  instructions: string;      // SKILL.md body below the frontmatter
  scriptPath?: string;       // absolute host path to script.py, if present
  examples: string[];
  moduleName: string;        // manifest.name with '-' -> '_'; the Python import path for scriptPath
  lintWarnings: string[];    // soft findings from 1.4; never blocks
  contentHash: string;       // sha256 over SKILL.md + script.py, for .skills.lock.json
}
```

**Name normalization, not rejection.** Skill names are kebab-case by convention (`wyckoff-volume-spread`),
but `-` is not legal in a Python identifier, so a Tier-2 skill cannot be written to disk under its
own name. `syncToSandbox` therefore writes `/workspace/skills/<name with - replaced by _>.py`, and
the skill is imported as `skills.wyckoff_volume_spread`. Rejecting hyphenated names instead would
make the catalog in §2 unbuildable — both Tier-2 skills there are kebab-case, as every skill is.
`SkillPackage` exposes the derived name as `moduleName` so the injector can tell the agent the exact
import path rather than leaving it to guess the transform.

### 3.3 Key signatures

```typescript
// WorkspaceManager
prepare(runId: string, asOf: string): Promise<string>;      // returns host path for the bind mount

// SkillRegistry
discover(asOf: string, skillsDir?: string): Promise<SkillPackage[]>;   // asOf REQUIRED (1.3)
getSkill(name: string, asOf: string): Promise<SkillPackage | null>;
resolveForAgent(config: ParticipantAgentConfig, asOf: string, skillsDir?: string): Promise<SkillPackage[]>;
syncToSandbox(skills: SkillPackage[], workspacePath: string): Promise<string[]>;  // writes skills/ + __init__.py

// SkillDownloader
download(source: string, targetDir: string): Promise<SkillPackage>;    // hard checks throw
searchLocal(query: string, available: SkillPackage[]): SkillPackage[];

// SkillInjector
renderSkillsBlock(skills: SkillPackage[]): { block: string; dropped: string[] };  // sorted, budgeted
```

`renderPrompt` gains one optional parameter, `skills: SkillPackage[]`, and passes the rendered
block into the nunjucks context as `skills_block`. Templates render it inside `<rules>` (§1.5).
Each of `price.j2`, `fii.j2`, `dii.j2`, `retail.j2` also gains the Tier-2 invariant sentence from
§1.1 — that `/workspace/model.py` must inline anything it uses from `skills/`, because the
validation container has neither the mount nor the `PYTHONPATH`.

### 3.4 CLI

```bash
forecasting-agent skills list                  # name, version, status, available_from, lint warnings
forecasting-agent skills search <query>        # LOCAL index only in M11 (1.4)
forecasting-agent skills add <git-url|path>    # fetch -> hard checks -> lint -> install as draft
forecasting-agent skills remove <name>
forecasting-agent skills promote <name>        # draft -> active, MANUAL (1.6), records who/when
forecasting-agent skills archive <name>        # -> archived, excluded from injection
```

---

## 4. Edge Cases & Defensive Invariants

1. **Missing skill** — an agent config naming a skill absent from disk logs a warning and renders
   without it. Prompt compilation never crashes.
2. **Future-dated skill** — `available_from > as_of` excludes the skill silently-but-logged; the
   validity gate treats injection of one as a leakage failure (§1.3).
3. **Budget overflow** — skill dropped whole, name logged. Never truncated (§1.5).
4. **Kebab-case Tier-2 name** — normalized to `moduleName` (`-` → `_`) on sync; the injected prompt
   states the resulting import path so the agent never guesses the transform (§3.2).
5. **Archive escape** — hard reject before anything touches `skills/` (§1.4).
6. **Submitted model imports `skills.*`** — fails validation. Correct behaviour; the diagnostic
   must name the cause, since ADR-021 already warns this class of failure is "maddening to debug"
   without one.
7. **Mid-run skill edit** — not picked up; registry caches at run start for cache stability (§1.5).
8. **Reproducibility** — `.skills.lock.json` pins `{name, version, available_from, contentHash}`.

---

## 5. Verification Plan

### 5.1 The comprehension check — the gate that decides whether M11 works **[G1]**

M11's entire premise is that **skill content changes agent behaviour**. Revision 1 never tested
that premise: its only catalog test asserted the four skills parse against the schema and match
agent assignments, which passes byte-identically whether `SKILL.md` contains Wyckoff analysis or
lorem ipsum. That is the M8 Layer-1 MASE failure reproduced exactly — a green suite that cannot
distinguish a working feature from a broken one.

Two checks, kept separate, because one of them is much weaker than the other:

**(a) Injection check — cheap, necessary, NOT sufficient.** Render `price.j2` with and without
`wyckoff-volume-spread`; assert the strings differ and that a distinctive sentence from the skill
body appears verbatim. *This proves injection happened. It would still pass with lorem ipsum, so it
is not the comprehension gate.*

**(b) Responsiveness check — the actual gate. It is a live run, not a test.**

*Measured before writing this section:* `harness/tests/` contains **no recorded-LLM or replay
infrastructure** — no `nock`, no `msw`, no VCR-style fixtures, no `FakeListChatModel`. The e2e
tests mock the agent object outright (`harness/tests/e2e/single-agent.test.ts:98` and siblings),
which means they never exercise a model at all.

```
grep -rln "nock\|msw\|recorded\|vcr\|replay\|FakeListChatModel" harness/tests   →   no matches
```

That rules out the recorded-turn approach revision 1 of this section assumed, and it rules out the
tempting substitute: a fake model that echoes a function of its prompt would make "output moves when
the skill changes" *trivially* true while proving nothing about a real LLM. That is a fake gate, and
it is worse than no gate because it looks like one.

**So the gate is a manual live run** — the same pattern this project already uses for every
"verify it for real" check (real NSE fetch, real Docker daemon, real Angel One login, real pipeline
invocation). `harness/scripts/skill-responsiveness.ts`, run by hand against the real LLM at a fixed
`as_of`, printing three `AgentSignal` outputs side by side:

| Run | Skills | Expected |
| :--- | :--- | :--- |
| 1 | `[]` | baseline |
| 2 | `['wyckoff-volume-spread']` | **differs from run 1** — evidence, probability, or direction |
| 3 | same skill, body mutated (absorption ⇄ distribution, bullish ⇄ bearish) | **differs from run 2**, in the direction the inverted rule implies |

It does not run in CI: it costs real tokens and a real LLM is not deterministic, so an equality
assertion on it would flake. It runs **once per skill-catalog change**, and its three outputs are
pasted into the session and the Daily note. A run that produces three identical signals means the
injector is decorative, whatever the unit tests say.

Stated in plain language, for the user to answer independently: **if I change what the skill says,
should the agent's forecast change? Run it and watch the number.**

**Consequence, stated rather than buried:** M11's core premise is verified by *one manual run*, not
by the suite. Nothing in CI will catch a regression that silently stops skills from reaching the
model — check (a) will still pass. Building a replay harness so this can become an automated
assertion is the natural M12 follow-up, and it is not in M11's scope.

### 5.2 Unit & integration

- `workspace.test.ts` — persist/wipe: write to `skills/`, `models/`, `scratch/`; re-run `prepare()`;
  assert the first two survive and the third is empty. Assert `__init__.py` is created.
- `registry.test.ts` — discovery, frontmatter parse, invalid-manifest rejection, **`as_of` filtering
  (a skill with `available_from` after `as_of` must not be returned)**, kebab→snake module-name
  normalization on sync.
- `downloader.test.ts` — archive traversal/symlink/size hard rejects; lint warnings recorded but
  **not** blocking; local search ranking.
- `injector.test.ts` — sorted-order determinism (same input in two directory orders → identical
  bytes), budget overflow drops whole skills, `<rules>` nesting.
- **Integration (real Docker, not mocked):** `prepare()` → `syncToSandbox()` → explore container
  runs `import skills.wyckoff_volume_spread` successfully; the **same** import in the validate
  container **fails**, confirming the §1.1 invariant is runtime-enforced.

### 5.3 Quality gates

- `pnpm --prefix harness test` — 283 tests currently pass (fact 10); no regression.
- `uv run pytest` — 299 tests currently pass (fact 10); no regression.
- `pnpm --prefix harness typecheck && lint`; `uv run ruff check . && uv run mypy src/`.

---

## 6. Out of Scope (named, so no one reads omission as coverage)

- **Automatic `DRAFT → ACTIVE` promotion** — needs per-skill MASE attribution, i.e. a counterfactual
  evaluation subsystem (§1.6). Manual `skills promote` only.
- **Automatic `ARCHIVED` decay** — needs the same rolling per-skill attribution. Manual only.
- **`npx skills find` / ClawHub remote index** (§1.4).
- **Option-chain `script.py`** — blocked on a fetch capability that does not exist (§2).
- **Multi-tenant hardening** — ADR-021 already defers this to pre-launch.

M11 Skill Lifecycle status after this milestone: **schema complete, transitions manual.** ADR-027 §4
should be amended to record that, rather than continuing to read as though the automation exists.
