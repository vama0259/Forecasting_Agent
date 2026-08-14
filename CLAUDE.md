# Forecasting Agent — Project Instructions

## Project
Private AI-powered forecasting agent. Python 3.12. Repo must stay private.

## Terminal
Always use Bash (WSL) for all terminal commands. Never use PowerShell.

## Obsidian Sync (HARD RULE)
Every session MUST update the Obsidian vault at `C:\Users\vama0\Knowledge` before finishing:
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
- `reviewing-specs` — run on EVERY spec/ADR/plan before implementation; loops verify → ponytail → grill until the SDE III reviewer returns `APPROVED` twice
- `spec-reviewer` (agent, HARD RULE) — after writing or materially editing ANY spec/ADR/plan, dispatch this agent BEFORE implementation, before committing it, and before `writing-plans`. Never self-approve a spec you authored. It exits only on two consecutive `APPROVED` verdicts; anything else means another round.
- `/lean-ctx` — leverage context-efficient reads, compressed shell execution, and CCP session memory
- `gemini-delegated-implementation` (model-invoked) — WHEN implementation splits into independent, well-specified chunks: delegate to Gemini 3.7 Flash (High) via `agy`, fan out in parallel worktrees, then verify every result before accepting — never skip the verification pass
- `gemini-plan-implementation` (model-invoked) — WHEN a plan's tasks are independent enough to delegate: full spec→merge pipeline (`reviewing-specs` → `writing-plans` → per chunk: `codebase-design` seam check → `test-driven-development` tests-first → Gemini implements → Haiku validates, escalating to Sonnet on failure → `systematic-debugging` before any corrective round) → `dispatching-parallel-agents` fan-out → `finishing-a-development-branch`
- `gemini-plan-writer` (agent, HARD RULE) — EVERY time an implementation plan is written, dispatch this agent instead of writing the plan inline via `writing-plans` directly. No exceptions, no "just this once inline plan." Requires the spec already cleared `spec-reviewer`; if it hasn't, run that first — do not write the plan around it. Produces each task pre-loaded with a seam note, a real failing test (run, watched red), a ready-to-paste Gemini delegation prompt, and a validator brief, so the execution loop needs no re-derivation.

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
- `gemini-delegated-implementation` — delegate parallelizable implementation to Gemini 3.7 Flash (High) via `agy`, then verify (model-invoked)
- `gemini-plan-implementation` — full plan pipeline: Gemini implements, Haiku→Sonnet escalating subagents validate, parallel dispatch per chunk (model-invoked)
- `gemini-plan-writer` — agent that writes plans pre-structured for `gemini-plan-implementation` (seam note + failing test + Gemini prompt + validator brief per task)

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

Self-hosted MCP server (`~/mcp-servers/agy-mcp`, registered user-scope) wrapping Google's Antigravity CLI (`agy`) so Claude can delegate implementation work to Gemini. See `gemini-delegated-implementation` skill for full usage rules — model, effort, instruction quality, parallel dispatch, and the mandatory verification pass.

- `run_agy` — run a single non-interactive prompt (`agy --print`); accepts `model`, `agent`, `effort`, `mode`, `project`, `conversation`, `continue_session`, `add_dirs`, `dangerously_skip_permissions`, `timeout_seconds`
- `list_agy_agents` / `list_agy_models` — **unreliable in this sandbox, hang indefinitely** — don't rely on these for live discovery
- **`--model` fails silently on any non-exact match** (verified) — no error, just keeps whatever model the session already defaulted to. Local default is already Gemini 3.7 Flash (High); omit `model` entirely, or use the exact string `"Gemini 3.7 Flash (High)"` (not `--effort`, which hard-errors on Gemini models). Full details in `gemini-delegated-implementation` skill.
- Default delegation call: `run_agy(prompt=..., add_dirs=[...], mode="accept-edits")` — no `model`/`effort` needed to get Gemini 3.7 Flash (High) in this environment

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
- No comments unless the WHY is non-obvious
- Security: Bandit clean, no secrets in code
- Use `/ponytail` mindset: simplest solution that works (YAGNI within SOLID)
- All commands via `uv run` (not bare `python`/`pip`)
