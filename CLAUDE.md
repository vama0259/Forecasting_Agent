# Forecasting Agent — Project Instructions

## Project
Private AI-powered forecasting agent. Python 3.12. Repo must stay private.

## Terminal
Native Linux (Fedora). Use Bash for all terminal commands.

## Obsidian Sync (HARD RULE)
Every session MUST update the Obsidian vault at `/home/varunmalhotra/Desktop/Knowledge` before finishing:
1. `Daily/<YYYY-MM-DD>.md` — log what was done
2. `Projects/Forecasting Agent/Kanban.md` — move tasks between columns
3. `Projects/Forecasting Agent.md` — update checklist
4. Relevant sub-notes (Architecture, Tech Stack, Research, Models Catalog) if decisions were made

### Obsidian Plugin Usage Rules (HARD RULE — apply automatically, don't wait to be asked)
Full plugin reference: see `docs/obsidian-bridge.md`. WHEN → DO triggers Claude Code must apply every session:
- **Dataview** — WHEN writing/editing an architecture, tech-stack, or ADR-style decision: give the note `type: adr`, `date: <YYYY-MM-DD>`, `status: <decided|proposed|superseded>`, `parent: "[[Forecasting Agent]]"` so it surfaces in the hub's "Key Decisions" table without being asked. WHEN creating any new project sub-note: give it `parent: "[[Forecasting Agent]]"` so "Recent Activity" picks it up. Never write a decision note with frontmatter the hub queries can't see — verify against the actual query in `Forecasting Agent.md` before assuming a field name is right (caught one broken query 2026-08-14).
- **Kanban** — WHEN a task starts this session: move it Backlog → In Progress. WHEN it finishes: move it → Done as `- [x]`. Do this as part of every session's mandatory sync (rule above), not only when the user asks for status.
- **Templater** — WHEN creating a new Daily note: use `Daily Note.md`'s shape (`## Focus` / `## Notes` / `## Links` / `## End of Day`) — don't freehand it. WHEN logging a conversation with an external party (not a coding session): use `Meeting.md`'s shape. WHEN starting a genuinely new top-level project (not a sub-note of an existing one): use `Project.md`'s shape.
- **Smart Connections** — WHEN the user asks "what have we already decided/discussed about X" and a direct file read/grep across vault notes doesn't turn up a clear match: tell them to check Obsidian's Smart Connections/Smart Chat pane before concluding nothing exists — its semantic index isn't queryable from the CLI, so don't assert absence based on grep alone.
- **Excalidraw** — WHEN the user wants a conceptual/whiteboard sketch: point them to Excalidraw inside Obsidian; never hand-author `.excalidraw` files (compressed binary format). WHEN the ask is a formal system/architecture diagram for the repo: use the repo's own `docs/architecture.drawio.svg` instead — that's the code-side diagram tool, Excalidraw is vault-side only.
- **Git (obsidian-git)** — no CLI trigger. It auto-commits vault backups on its own schedule; never run git commands inside the vault directory.
- **Calendar / Outliner / Markdown Table Editor** — no CLI trigger; standard `Daily/<YYYY-MM-DD>.md` naming and plain markdown lists/tables already satisfy all three.

## Skill Usage (HARD RULE)
ALL installed skills and tools MUST be actively used when relevant. Don't limit to a subset — use the full arsenal wisely. Key enforcement:
- `/ponytail` — run on EVERY implementation to force simplest solution
- `grilling` (model-invoked) — stress-test EVERY design decision before committing; `/grill-me` is the same interview but user-invoked only, run it yourself for a manual session
- `/using-superpowers` — leverage advanced tool capabilities for complex tasks
- `/verification-before-completion` — verify EVERY piece of work before marking done
- `/clean-code-principles` + `/solid-principles` — consult on EVERY class/module design
- `/ponytail-review` — run on EVERY PR/diff before merging
- **Token-efficiency mode (HARD RULE, overrides subagent dispatch below where noted)** — spec authorship, spec review, and plan writing run **inline in the main session**, not as dispatched `Agent`/`Task` subagents. Same rigor (`reviewing-specs`' verify→ponytail→grill loop, two consecutive `APPROVED` verdicts, evidence over assertion), just without the token overhead of a fresh subagent context per round. Only **implementation** is delegated out, and directly to Gemini via `agy` (`gemini-delegated-implementation`) — not the heavier `gemini-plan-implementation` multi-subagent pipeline (Haiku/Sonnet validator dispatch). Validate Gemini's output inline instead of via a dispatched validator subagent.
- `reviewing-specs` — run on EVERY spec/ADR/plan before implementation; loops verify → ponytail → grill until the SDE III reviewer returns `APPROVED` twice. Run this inline (see Token-efficiency mode) — do not dispatch the `spec-reviewer` agent as a background/subagent call.
- **Spec authorship (HARD RULE, revised)** — Claude authors and revises every round of every spec **inline, in this session**. Do not delegate spec drafting or revision to Codex or any other external tool.
- `/lean-ctx` — leverage context-efficient reads, compressed shell execution, and CCP session memory
- `gemini-delegated-implementation` (model-invoked) — the standard implementation path once a plan exists: delegate directly to Gemini 3.7 Flash (High) via `agy`, fan out in parallel worktrees for independent chunks, then verify every result **inline** before accepting — never skip the verification pass, never dispatch a separate validator subagent for it.
- `writing-plans` — write the implementation plan **inline** (see Token-efficiency mode), not via a dispatched `gemini-plan-writer` agent. Requires the spec already cleared `reviewing-specs`' two-`APPROVED` gate; if it hasn't, run that first. Each task still needs a seam note, a real failing test (run, watched red), a ready-to-paste Gemini delegation prompt, and a validator brief — same output shape, produced inline instead of by a subagent.

## Design Principles (HARD RULE)
Every design decision MUST be reasoned out. No implicit choices.

### Required for all code:
- **OOP** — object-oriented design throughout (classes, encapsulation, polymorphism)
- **SOLID** — Single Responsibility, Open/Closed, Liskov Substitution, Interface Segregation, Dependency Inversion
- **Clean Architecture** — dependency rule, layers pointing inward, business logic independent of frameworks
- **Composition over Inheritance** — prefer composing behaviors over deep class hierarchies

### Required for all design decisions:
Before implementing any module, class, or architectural choice, document:
- **Pros** — why this approach
- **Cons** — trade-offs and risks
- **Where it fits best** — ideal use cases for this pattern
- **Where it doesn't suit** — when to avoid it

---

## Comprehension Gate (HARD RULE — process rigor is not comprehension)

Every existing gate in this file checks *process*. None of them check whether anyone
**understood** the result. Add this one, and apply it before accepting any code that produces a
number — a metric, score, probability, cost, latency, or count.

**The responsiveness check.** Name the input that *should* drive the output. Change it. Confirm
the output actually moves. Run it — do not reason about it, and do not accept a passing test
suite as evidence.

Claude MUST run this check itself and show the before/after values, and MUST also state the
check in plain language so the user can answer it independently. Ask the user the question
directly ("if X changed, should this number move?") rather than only reporting the result — the
point is to build the user's own judgement, not to add another automated gate they trust blindly.

**Why this rule exists (2026-08-17).** M8's Layer-1 MASE had: a spec reviewed to two consecutive
`APPROVED` verdicts, a written implementation plan, 120 passing tests, a merged PR (#9), and a
committed 50-symbol production sweep. It still scored a fixed baseline instead of the agent's
forecast, because `pipeline.py` never read `EvalRequest.forecasts` and **every** test passed
`forecasts=[0.0]*n`. A perfect forecast and a catastrophically wrong one produced byte-identical
scores. No additional process would have caught it. One question would have: *"if I change the
forecast, does the number move?"*

**Corollary — delegation scales output, not understanding.** Gemini delegation, parallel
sessions, and review loops all raise throughput. None of them raise comprehension, and
comprehension is the current bottleneck. When the two trade off, prefer understanding one thing
fully over shipping three things reviewed.

## Standing Retro (every ~5 sessions, or when the user says "retro")

Read the last ~5 `Daily/` notes plus `git log`, then report — briefly, no ceremony:

1. **Deferred-work ledger.** Everything deliberately deferred, with the date and the stated
   reason, flagged if it is aging. Deferral in this project has a poor completion record:
   `FeatureLagAudit` was deferred 2026-08-14 with a sound justification and is still unbuilt
   while ADR-011 lists it as part of the validity gate. Name each one; do not let a deferral
   quietly become a decision.
2. **Doc/code drift.** Claims in `docs/`, the vault, or `scripts/generate_pptx.py` that the code
   does not implement. Known open instance: `generate_pptx.py:1465` asserts shipped ARIMA and
   exponential-smoothing baselines; only a naive baseline exists.
3. **Scope load.** Open issue count and how many parallel sessions ran. Flag when infra work has
   run ahead of the product for several stories in a row.
4. **One thing to improve**, stated concretely, with the evidence it is based on.

---

## Full Toolkit Reference

### Installed Project Skills (use via /skill-name)

#### Development Workflow (obra/superpowers)
- `/writing-plans` — architecture and implementation plans
- `/executing-plans` — step-by-step plan execution
- `/subagent-driven-development` — parallel implementation across files via subagents
- `/dispatching-parallel-agents` — fan out independent tasks to multiple agents
- `/test-driven-development` — TDD workflow (write test → fail → implement → pass)
- `/using-git-worktrees` — parallel branch work without stashing
- `/finishing-a-development-branch` — PR preparation, cleanup, merge readiness
- `/brainstorming` — ideation with visual companion and spec document review
- `/using-superpowers` — advanced multi-tool orchestration patterns
- `/writing-skills` — create new custom skills for the project

#### Code Quality & Review (obra/superpowers)
- `/requesting-code-review` — get structured PR review
- `/receiving-code-review` — handle and apply review feedback
- `/systematic-debugging` — root cause tracing, condition-based waiting, defense in depth
- `/verification-before-completion` — verify all work before marking done

#### Code Quality (ponytail suite)
- `/ponytail` — force laziest/simplest solution that works (YAGNI enforcement)
- `/ponytail-review` — find over-engineering in diffs (what to delete/simplify)
- `/ponytail-audit` — whole-repo scan for bloat, reinvented stdlib, dead flexibility
- `/ponytail-debt` — harvest all `ponytail:` comments into a debt ledger

#### Design & Architecture
- `reviewing-specs` — adversarial spec review loop (verify → ponytail → grill) until SDE III sign-off
- `codebase-design` — deep-module vocabulary: small interfaces, seam placement, testability (TS-oriented)
- `/clean-code-principles` — SOLID, DRY, KISS, design patterns, clean code fundamentals
- `/solid-principles` — SOLID implementation guidance for modules/functions/components
- `/clean-architecture` — dependency rule, ports/adapters, hexagonal, onion architecture
- `/composition-over-inheritance` — when to compose vs inherit, refactoring hierarchies

#### API & Backend
- `/fastapi` — official FastAPI best practices, Pydantic, SSE, dependencies
- `/fastapi-templates` — production-ready FastAPI project scaffolding
- `/fastapi-python` — FastAPI async patterns, error handling, middleware

#### Data Science & ML
- `/data-science-python-stack` — opinionated Python ML/DS library choices (probabl-ai)
- `/time-series-analysis` — time series methods, decomposition, forecasting approaches
- `/llm-evaluation` — LLM quality metrics, automated evaluation, benchmarking
- `/llm-app-patterns` — production LLM application patterns (Dify-inspired)

#### Infrastructure
- `/github-actions` — CI/CD workflow management
- `/docker-build-deploy` — containerization, multi-stage builds, GitHub Actions deploy

#### Other Project Skills
- `grilling` — stress-test ideas, code, or implementations (model-invoked interview primitive)
- `/grill-me` — same interview, user-invoked only (type it yourself; Claude cannot trigger it)
- `/lean-ctx` — context-efficient coding patterns
- `/graphify` — build knowledge graph from codebase, query it, trace paths
- `gemini-delegated-implementation` — the standard implementation path: delegate to Gemini 3.7 Flash (High) via `agy`, verify inline, no subagent dispatch (model-invoked)
- `gemini-plan-implementation` / `gemini-plan-writer` — the heavier multi-subagent pipeline variant. Superseded by inline spec/plan authorship + direct `gemini-delegated-implementation` per the Token-efficiency mode rule; keep installed but do not dispatch by default

### Platform Skills (always available, no install needed)

#### Engineering
- `/engineering:architecture` — system architecture design
- `/engineering:system-design` — distributed system design
- `/engineering:code-review` — structured code review
- `/engineering:debug` — structured debugging methodology
- `/engineering:testing-strategy` — test planning and strategy
- `/engineering:tech-debt` — technical debt management
- `/engineering:deploy-checklist` — release preparation checklist
- `/engineering:incident-response` — incident management workflow
- `/engineering:documentation` — documentation generation
- `/engineering:standup` — standup report generation

#### Design & UX
- `/design:accessibility-review` — accessibility audit
- `/design:design-critique` — design critique and feedback
- `/design:design-system` — design system creation/management
- `/design:research-synthesis` — synthesize user research findings
- `/design:user-research` — user research methodology
- `/design:ux-copy` — UX writing and copy

#### Figma Integration
- `/figma:figma-design-to-code` — implement Figma designs as code
- `/figma:figma-generate-design` — translate app pages into Figma
- `/figma:figma-generate-library` — build design system in Figma from code
- `/figma:figma-code-connect` — map Figma components to codebase components
- `/figma:figma-generate-diagram` — create diagrams in Figma
- `/figma:figma-use` — general Figma interaction
- `/figma:figma-use-figjam` — FigJam content creation
- `/figma:figma-use-slides` — Figma Slides
- `/figma:figma-implement-motion` — motion/animation implementation
- `/figma:figma-create-new-file` — create new Figma files

#### Web Research & Scraping (firecrawl suite)
- `/firecrawl` — general web scraping
- `/firecrawl-deep-research` — thorough multi-source research
- `/firecrawl-search` — web search with structured results
- `/firecrawl-scrape` — scrape specific pages
- `/firecrawl-crawl` — crawl entire sites
- `/firecrawl-map` — site mapping
- `/firecrawl-competitive-intel` — competitive intelligence gathering
- `/firecrawl-market-research` — market research automation
- `/firecrawl-lead-gen` — lead generation
- `/firecrawl-lead-research` — lead research and enrichment
- `/firecrawl-knowledge-base` — build knowledge bases from web
- `/firecrawl-knowledge-ingest` — ingest web content into knowledge
- `/firecrawl-research-papers` — research paper discovery
- `/firecrawl-developer-index` — developer documentation indexing
- `/firecrawl-seo-audit` — SEO audit
- `/firecrawl-monitor` — website monitoring
- `/firecrawl-qa` — QA testing via web
- `/firecrawl-dashboard-reporting` — dashboard data gathering
- `/firecrawl-website-design-clone` — clone website designs
- `/firecrawl-build` — build projects from web references

#### Document Generation (anthropic-skills)
- `/anthropic-skills:pdf` — generate PDF documents
- `/anthropic-skills:pptx` — generate PowerPoint presentations
- `/anthropic-skills:xlsx` — generate Excel spreadsheets
- `/anthropic-skills:docx` — generate Word documents
- `/anthropic-skills:schedule` — scheduling assistance
- `/anthropic-skills:morning` — morning briefing

#### Frontend & UI
- `/frontend-design` — frontend design patterns
- `/react-best-practices` — React patterns (if we add frontend)
- `/web-design-guidelines` — web design guidelines
- `/ui-ux-pro-max` — advanced UI/UX design
- `/design-taste-frontend` — design taste for frontend
- `/accessibility-audit` / `/accessibility-fix` / `/accessibility-scan` — a11y tools

#### Visualization
- `/dataviz` — chart design system (colors, forms, marks, interactions)

#### Code Intelligence
- `/claude-api` — Claude/Anthropic API reference (models, pricing, tool use, agents)
- `/simplify` — review changed code for reuse, simplification, efficiency
- `/security-review` — security audit of code

#### Productivity & Automation
- `/loop` — run commands on recurring intervals
- `/update-config` — configure hooks and settings
- `/keybindings-help` — customize keyboard shortcuts
- `/fewer-permission-prompts` — optimize permission settings
- `/init` — project initialization
- `/run` — launch and drive the app

#### Resume & Career (if needed)
- `/resume-ats-optimizer` — ATS optimization
- `/tailored-resume-generator` — tailored resume generation
- `/resume-bullet-writer` — resume bullet points

### MCP Servers (connected)

#### graphify — Code Intelligence Graph (★ PRIMARY MCP)

**MUST USE graphify MCP for all code intelligence.** Prefer graphify tools over reading files when finding symbols, tracing calls, assessing blast radius, or mapping dependencies.

**Graph Query Tools** (active once repo is indexed):
- `query_graph` — semantic code search with materialized definition bodies (start here for any code question)
- `graphify_find` — find symbols by name substring
- `graphify_node` — get symbol body + direct graph neighbors
- `graphify_callers` — who calls this symbol (directed)
- `graphify_callees` — what this symbol calls (directed)
- `graphify_trace` — directed call paths between two symbols
- `graphify_impact` — change-impact fanout from a symbol
- `impact_and_risk` — impact + linked-test coverage = ranked hotspot files
- `graphify_rank_files` — rank source files for a natural-language question
- `graphify_file_neighbors` — per-file blast-radius map
- `graphify_imports_exports` — import/export dependency edges for a file
- `graphify_tests_for` — find tests linked to a symbol or file
- `graphify_references` — non-call references touching a symbol
- `graphify_expand` — materialize node handles into full definition bodies
- `graphify_find_seeds` — scored seed nodes for a question (without expansion)
- `shortest_path` — confidence-weighted path between two symbols
- `graph_stats` — summary stats (nodes, edges, communities)
- `list_repositories` — list all indexed repos

**Durable Memory Tools** (always available):
- `remember` — store a durable fact/decision/constraint for later recall
- `recall` — retrieve stored memories ranked by relevance
- `ingest_turns` — store full conversations for cross-turn reasoning

**When to use which:**
- "Where is X defined?" → `graphify_find` or `query_graph`
- "What calls X?" → `graphify_callers`
- "What does X call?" → `graphify_callees`
- "How does A connect to B?" → `graphify_trace` or `shortest_path`
- "If I change X, what breaks?" → `graphify_impact` or `impact_and_risk`
- "Which files matter for this question?" → `graphify_rank_files`
- "What tests cover this?" → `graphify_tests_for`
- "What imports/exports does this file have?" → `graphify_imports_exports`
- "Remember this decision for next session" → `remember`
- "What did we decide about X?" → `recall`

#### lean-ctx — Context Engineering & Memory Runtime (★ PRIMARY MCP)

**MUST USE lean-ctx MCP for context-efficient reads, shell execution, and persistent session state.**
- Shadow mode: native read/search/shell automatically routes through lean-ctx compression.

**Core Context Tools:**
- `ctx_read` — adaptive compressed file reader (`mode="full"|"map"|"signatures"|"diff"|"anchored"|"entropy"`)
  - `mode="full"`: standard initial read (cached, subsequent reads cost ~13 tokens)
  - `mode="map"`: dependency graph, exports, API surface (~90-95% compression)
  - `mode="signatures"`: function/class signatures only (~85-90% compression)
  - `mode="diff"`: changed lines since last read (~98% compression)
  - `mode="anchored"`: adds `N:hh|` line/hash anchors for atomic editing with `ctx_patch`
  - `mode="entropy"`: Shannon entropy filtering for information-dense blocks
- `ctx_multi_read` — read multiple files in a single compressed context batch
- `ctx_search` — compressed search (BM25 semantic search, regex, symbol lookups)
- `ctx_shell` — run terminal commands with output noise filtering (strips progress bars/ansi)
- `ctx_patch` — anchored atomic file patcher using `N:hh|` hash anchors from `ctx_read(mode="anchored")`
- `ctx_overview` — task-relevant project map generation
- `ctx_preload` — proactive context caching for task-relevant files

**Memory & Session Continuity (CCP):**
- `ctx_session` — cross-session memory management (`load`, `status`, `task`, `finding`, `decision`, `save`)
- `ctx_knowledge` — permanent knowledge base operations (`remember`, `recall`, `search`, `consolidate`)
- `ctx_agent` — multi-agent communication channel (`register`, `list`, `post`, `read`)
- `ctx_gain` / `ctx_metrics` — inspect token savings and runtime efficiency stats

**Read Mode Decision Tree:**
- Will edit? → `ctx_read mode=full` (re-reads: 13 tokens) → after edit: `mode=diff`
- API surface only? → `ctx_read mode=signatures`
- Dependencies / imports / exports? → `ctx_read mode=map`
- Editing by reference? → `ctx_read mode=anchored` then `ctx_patch`
- Unmodified raw bytes needed? → `ctx_read raw=true` or `lean-ctx raw "<command>"`

#### agy — Antigravity CLI Bridge (Gemini delegation)

**No MCP wrapper on this machine** (the old `~/mcp-servers/agy-mcp` self-hosted server was never rebuilt on native Linux — decided 2026-08-15 to not recreate it). Delegation instead goes through the `agy` CLI directly via Bash: Claude writes the detailed plan/prompt and gathers the file context, then invokes `agy` non-interactively itself. See `gemini-delegated-implementation` skill for full usage rules — instruction quality, parallel dispatch, and the mandatory verification pass still apply exactly as before, just issued as a Bash call instead of an MCP tool call.

- Invoke directly: `agy --print "<prompt>" --add-dir <dir> [--add-dir <dir> ...] --mode accept-edits`
- `agy --help` lists all flags (`--model`, `--agent`, `--effort`, `--project`, `--conversation`, `--continue`, `--dangerously-skip-permissions`, `--print-timeout`, `--output-format`) if a call needs them
- `agy list-agents` / `agy list-models` — **unreliable in this sandbox, hang indefinitely** — don't rely on these for live discovery
- **`--model` fails silently on any non-exact match** (verified) — no error, just keeps whatever model the session already defaulted to. Local default is already Gemini 3.7 Flash (High); omit `--model` entirely, or use the exact string `"Gemini 3.7 Flash (High)"` (not `--effort`, which hard-errors on Gemini models). Full details in `gemini-delegated-implementation` skill.
- Default delegation call: `agy --print "<prompt>" --add-dir <dirs> --mode accept-edits` — no `--model`/`--effort` needed to get Gemini 3.7 Flash (High) in this environment
- **Autonomy grant**: same as `codex` — Gemini controls and spends its own tokens/tool-calls for bash commands it runs during `--mode accept-edits` delegation (tests, repo checks, edits). Claude does not gate each individual `agy` bash invocation the CLI makes internally, only the outer `agy` call itself (same as any other Bash tool use). The mandatory post-delegation verification pass (`gemini-delegated-implementation` skill) is the sole final gate before Gemini's output is accepted — Gemini never self-approves its own work.

##### Gemini delegation — known quality gap (observed #4–#9)

Gemini's own self-reported "tests pass" / "all green" claims have repeatedly diverged from reality: a false "41/41 passed" claim (#8) where a re-run found real failures from a non-idempotent test; #7's own commit log shows "verification pass — real Docker run surfaces 4 bugs Gemini's tests missed"; an untested `<50ms` acceptance criterion went unverified through 6 tasks; a missing `pyarrow` dependency silently broke a feature until a real round-trip test caught it; uncommitted test files were missed until a manual `git status` check.

**Pattern**: Gemini's tests passing is not evidence the feature works — its own test suites have repeatedly failed to exercise the real failure mode (real Docker daemon behavior, repeat-run state, declared dependencies, acceptance-criteria timing). The gap is specifically between "unit-level mocked tests green" and "actual runtime/integration behavior correct."

**Required check system going forward, every Gemini delegation, no exceptions:**
1. Never accept "tests pass" as reported — re-run the exact test command from a cold shell yourself.
2. For anything touching Docker/external processes/timing-sensitive code: separately verify against the real system (real container, real repeat run, real clock), not just the mocked test suite.
3. Explicitly check declared dependencies (`package.json`/`pyproject.toml`) were actually updated, not just imported and working locally in Gemini's one run.
4. Run `git status` after every delegation before considering it done — check for both missing commits (uncommitted test files) and out-of-scope writes (Gemini has written unprompted to the Obsidian vault outside its stated file boundaries at least once, harmlessly, but it's a real scope violation each time).
5. Re-run any numeric acceptance criterion (latency, size, count) with a real measurement — don't accept "should be under X" without measuring X.

This reinforces why the "verify inline, never dispatch a separate validator subagent, never trust a self-report" rule exists — it's not caution for its own sake, it's a response to a specific, repeated, observed failure mode.

#### codex — OpenAI Codex CLI Bridge (installed, not in the default spec loop)

Registered user-scope via `codex mcp-server` (stdio, `claude mcp add --scope user codex -- codex mcp-server`). Requires `codex login` first — check `codex mcp list` shows `✔ Connected`, not `! Needs authentication`, before delegating.

- **Superseded by the Token-efficiency mode rule above: spec authorship and every revision round are Claude-authored, inline, in this session — Codex is not used for spec drafting or revision by default.** Kept registered for explicit one-off use if the user asks for it by name.
- If invoked deliberately: model `gpt-5.6` codename `luna`, effort `medium`.

#### langchain-docs — LangChain Documentation
- `search_docs_by_lang_chain` — search LangChain docs
- `query_docs_filesystem_docs_by_lang_chain` — query docs filesystem

#### figma — Design ↔ Code Bridge
- Full design reading, writing, code connect, diagram generation, asset management

#### visualize — Inline Visualization
- `show_widget` — render SVG/HTML inline (charts, diagrams, dashboards, interactive widgets)
- `read_me` — load design system guidance for visualizations

#### openart — AI Image/Video Generation
- Image generation, video generation, model listing, project management

#### claude-in-chrome — Real Browser Automation
- Navigate, read pages, fill forms, execute JS, capture screenshots in real Chrome

#### Browser (built-in) — In-App Browser
- Navigate, read pages, forms, console, network, screenshots, tabs

#### mcp-registry — Discover New Tools
- Search for and discover new MCP servers

#### scheduled-tasks — Cron/Recurring
- Create, update, delete, list scheduled tasks

### Agent Types (spawnable)
- `Explore` — fast read-only code search (quick/medium/thorough)
- `Plan` — architecture and implementation planning
- `claude` — general-purpose catch-all
- `general-purpose` — multi-step research and complex tasks
- `claude-code-guide` — Claude Code usage questions

### Workflow Tool
- Multi-agent orchestration with `pipeline()`, `parallel()`, `phase()`, `agent()`
- Patterns: adversarial verify, judge panel, loop-until-dry, multi-modal sweep

---

## GitHub
- Repo: `vama0259/Forecasting_Agent` (private)
- CLI: `gh` authenticated as `vama0259`
- Remote: `origin` → `https://github.com/vama0259/Forecasting_Agent.git`

## Toolchain
- **Python 3.12** pinned via `.python-version`
- **uv** for dependency management — `uv sync`, `uv run pytest`, etc. No pip/requirements.txt
- **Ruff** for linting + formatting (120 char lines, config in pyproject.toml)
- **Bandit** for security scanning
- **mypy** for strict type checking
- **pre-commit** for git hooks (ruff, bandit, trailing whitespace, secrets detection)
- **Makefile** — `make setup`, `make check`, `make test`, `make format`
- **graphify MCP** — code graph indexed, queryable for impact analysis

## Code Style
- Python 3.12, Ruff for linting/formatting, 120 char line length
- **Comments (HARD RULE, overrides "no comments unless WHY is non-obvious")**: every file must own a one-line abstract at the top explaining what the file does as a whole. Every function/method must have a one-line comment stating its input and output (what it takes, what it returns) — not a restatement of the body. Keep each to a single line; do not add multi-line docstrings or narrate the implementation.
- Security: Bandit clean, no secrets in code
- Use `/ponytail` mindset: simplest solution that works (YAGNI within SOLID)
- All commands via `uv run` (not bare `python`/`pip`)
