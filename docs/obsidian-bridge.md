# Obsidian Bridge

Design notes, research, and project tracking live in the Obsidian vault,
accessible via a directory junction at `docs/vault/`.

## Vault Location
- **Source:** `C:\Users\vama0\Knowledge\Projects\Forecasting Agent\`
- **Junction:** `docs/vault/` (git-ignored)

## Vault Structure
- `Forecasting Agent.md` — project hub
- `Architecture.md` — architecture & decision records
- `Research.md` — research notes
- `Kanban.md` — task board
- `Tech Stack.md` — stack decisions
- `Models Catalog.md` — forecasting models evaluation

Outside the junction (vault root only, not mirrored into `docs/vault/`):
- `Daily/<YYYY-MM-DD>.md` — daily session logs
- `Templates/` — `Daily Note.md`, `Meeting.md`, `Project.md`

## Installed Plugins (verified 2026-08-14, all enabled)
| Plugin | What it does | WHEN → DO (Claude Code trigger rule) |
|---|---|---|
| Dataview v0.5.68 | SQL-like queries over frontmatter (used live in `Forecasting Agent.md`'s "Key Decisions" / "Recent Activity" blocks) | WHEN writing/editing an architecture, tech-stack, or ADR-style decision → set `type: adr`, `date: <YYYY-MM-DD>`, `status: <decided\|proposed\|superseded>`, `parent: "[[Forecasting Agent]]"`. WHEN creating any project sub-note → set `parent` so "Recent Activity" indexes it. Verify frontmatter names against the actual query in `Forecasting Agent.md` before assuming — one query was found silently broken 2026-08-14 (referenced fields `Architecture.md` never set) and fixed |
| Kanban v2.0.51 | Renders `Kanban.md` as a board | WHEN a task starts this session → move Backlog → In Progress. WHEN it finishes → move to Done as `- [x]`. Do this as part of every session's mandatory sync, not only on request. Preserve `kanban-plugin: basic` frontmatter, the 3 headers, and the trailing `%% kanban:settings %%` block exactly |
| Templater v2.25.0 | Handlebars-style note templates in `Templates/` (`Daily Note.md`, `Meeting.md`, `Project.md`) | WHEN creating a new Daily note → use `Daily Note.md`'s shape (`## Focus`/`## Notes`/`## Links`/`## End of Day`), don't freehand. WHEN logging a conversation with an external party → use `Meeting.md`. WHEN starting a genuinely new top-level project → use `Project.md`. Found unused 2026-08-14 (daily notes were freehand, missing `## End of Day`) — fixed |
| Smart Connections v4.7.2 | Local semantic (vector) search across the vault — model `TaylorAI/bge-micro-v2`, runs on-device via `transformers` adapter, zero API key, embeddings persisted in `.smart-env/` at the vault root | WHEN the user asks "what did we decide/discuss about X" and a direct file read/grep doesn't turn up a clear match → tell them to check Obsidian's Smart Connections/Smart Chat pane before asserting nothing exists (its index isn't queryable from the CLI). Don't build a separate embedding pipeline — this already solves semantic search for free |
| Excalidraw v2.26.4 | Visual/diagram notes | WHEN the user wants a conceptual/whiteboard sketch → point them to Excalidraw in Obsidian, never hand-author `.excalidraw` files. WHEN the ask is a formal system/architecture diagram for the repo → use `docs/architecture.drawio.svg` instead, that's the code-side tool |
| Git (obsidian-git) v2.39.0 | Independent git history/backup of the whole vault | No CLI trigger — it auto-commits on its own schedule. Never run git commands inside the vault directory |
| Calendar v1.5.10 | Calendar UI over `Daily/` notes | No CLI trigger; just keep `YYYY-MM-DD.md` naming exact |
| Outliner v4.10.2 | List-editing UX | No CLI trigger; standard markdown lists satisfy it |
| Markdown Table Editor v0.3.1 | Table-editing UX | No CLI trigger; standard GFM tables satisfy it |
