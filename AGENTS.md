# Forecasting Agent — Antigravity Agent Guidelines

<!-- lean-ctx-rules -->
<!-- version: 9 -->

lean-ctx shadow mode: native read/search/shell calls auto-route to ctx_* — no tool-mapping needed.
File editing → native Edit/StrReplace (lean-ctx only handles reads); if denied, use ctx_patch.
Exclusive tools (no native trigger): ctx_compose (understand code, call first), ctx_search(action=symbol) (exact symbol), ctx_search(action=semantic) (by meaning), ctx_callgraph (callers), ctx_knowledge / ctx_session (memory).
<!-- lean-ctx-compression -->
OUTPUT STYLE: concise
- Bullet points over paragraphs
- Skip filler words and hedging ("I think", "probably", "it seems")
- 1-sentence explanations max, then code/action
- No repeating what the user said
<!-- /lean-ctx-compression -->
<!-- /lean-ctx-rules -->

## Project Instructions

- **Environment**: Python 3.12, `uv` package manager (`uv sync`, `uv run pytest`).
- **Terminal**: Bash on WSL.
- **Code Quality**: Ruff (120 char line length), Bandit security scanner, strict mypy.
- **Repository**: Private repository (`vama0259/Forecasting_Agent`).

## Obsidian Sync (HARD RULE)
Every session MUST update the Obsidian vault at `C:\Users\vama0\Knowledge` before finishing:
1. `Daily/<YYYY-MM-DD>.md` — log work completed
2. `Projects/Forecasting Agent/Kanban.md` — update task status
3. `Projects/Forecasting Agent.md` — update checklist and hub notes
4. Decision notes with frontmatter: `type: adr`, `date: <YYYY-MM-DD>`, `status: decided`, `parent: "[[Forecasting Agent]]"`.

## Architectural Principles (HARD RULE)
- **OOP & SOLID**: Single responsibility, open/closed, Liskov substitution, interface segregation, dependency inversion.
- **Clean Architecture**: Inward dependency rule, framework-independent business rules.
- **Composition over Inheritance**: Compose behaviors rather than deep inheritance trees.
- **/ponytail Mindset**: Implement the simplest working solution (YAGNI).
- **grilling** (model-invoked): Stress-test non-trivial architectural decisions. `/grill-me` is the same interview but user-invoked only.
- **/verification-before-completion**: Test and verify before marking tasks complete.

## MCP Servers Integration

### 1. lean-ctx (★ Context & Memory Runtime)
- **Shadow Mode**: Native file reads and shell commands route through lean-ctx compression.
- **Read Modes**:
  - `ctx_read(mode="full")` — initial read (cached, subsequent re-reads cost ~13 tokens).
  - `ctx_read(mode="map")` — imports, exports, API map (~90-95% compression).
  - `ctx_read(mode="signatures")` — AST signatures for 26 languages (~85-90% compression).
  - `ctx_read(mode="diff")` — inspect changed lines after edits (~98% compression).
  - `ctx_read(mode="anchored")` — generates `N:hh|` hash anchors for `ctx_patch`.
  - `ctx_read(raw=true)` — raw byte passthrough when exact formatting is required.
- **Operations & Execution**:
  - `ctx_multi_read` — batch multi-file reading.
  - `ctx_search` — compressed regex, symbol, and BM25 semantic search.
  - `ctx_shell` — run commands with output noise and progress bar filtering.
  - `ctx_patch` — anchored atomic file patcher.
  - `ctx_overview` / `ctx_preload` — project overview and proactive context caching.
- **Session Continuity (CCP) & Memory**:
  - `ctx_session` (`load`, `status`, `task`, `finding`, `decision`, `save`).
  - `ctx_knowledge` (`remember`, `recall`, `search`, `consolidate`).
  - `ctx_agent` (`register`, `list`, `post`, `read`).
  - `ctx_gain` / `ctx_metrics` — monitor token savings.

### 2. graphify (★ Code Intelligence Graph)
- Use `query_graph`, `graphify_find`, `graphify_callers`, `graphify_callees`, `graphify_impact`, `impact_and_risk`, `graphify_rank_files` for code intelligence and impact analysis.
