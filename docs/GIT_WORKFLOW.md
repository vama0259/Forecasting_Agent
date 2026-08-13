# Git Workflow, Kanban & Release Guide

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                     ENGINEERING WORKFLOW & GIT STANDARDS MANUAL                        │
│                                                                                        │
│     Kanban Rules • GitHub Labels • Branch Naming • Conventional Commits • Tags         │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 1. How Kanban & GitHub Labels Work

A **Kanban Board** gives you a visual pipeline of your work:

```
┌──────────────────┐      ┌──────────────────┐      ┌──────────────────┐
│   1. BACKLOG     │ ──►  │  2. IN PROGRESS  │ ──►  │     3. DONE      │
│  (Queued Tasks)  │      │ (Active Coding)  │      │ (Merged & Tested)│
└──────────────────┘      └──────────────────┘      └──────────────────┘
```

### Label Color Taxonomy (Active on GitHub)

| Label | Color | Purpose | Example |
|---|---|---|---|
| `type:feat` | 🟢 Green | New capability or business logic | `type:feat` |
| `type:fix` | 🔴 Red | Bug fix or error recovery | `type:fix` |
| `type:docs` | 🔵 Blue | Architecture, ADRs, and manuals | `type:docs` |
| `type:eval` | 🟣 Purple | Metrics, ground truth, backtesting | `type:eval` |
| `layer:harness` | 🔷 Dark Blue | TypeScript, LangGraph, Orchestrator | `layer:harness` |
| `layer:mcp-data`| 🟡 Yellow | Python MCP servers, scrapers, Hampel | `layer:mcp-data` |
| `layer:sandbox` | 🪻 Lavender | Docker container & execution sandbox | `layer:sandbox` |
| `layer:prompt`  | 🍑 Peach | DSPy MIPROv2, prompt templates | `layer:prompt` |
| `priority:p0`   | 🛑 Bright Red | Blocker / Critical path for MVP 1 | `priority:p0` |
| `priority:p1`   | 🌸 Soft Pink | Standard feature | `priority:p1` |

---

## 2. Git Branch Naming Rules

**Rule:** Never write code directly on `main`. Always create a feature branch linked to a GitHub issue:

```bash
# Pattern: <type>/issue-<number>-<short-description>
git checkout -b feat/issue-4-capability-layer
git checkout -b feat/issue-5-market-data-mcp
git checkout -b fix/issue-12-hampel-outlier-nan
```

### Prefix Convention:
- `feat/`: Adding a new feature or module.
- `fix/`: Fixing a broken test, bug, or crash.
- `docs/`: Writing documentation or pitch decks.
- `refactor/`: Cleaning up code without changing functionality.

---

## 3. Conventional Commit Rules

We follow the **Conventional Commits** standard. This makes commit history readable and enables automated changelogs.

### Pattern:
```text
<type>(<scope>): <short imperative description> (#<issue-number>)

[Optional detailed explanation of non-obvious choices]
```

### Examples:
```bash
# Good Commits:
git commit -m "feat(harness): implement Zod capability registry (#4)"
git commit -m "feat(m1): add Hampel outlier filter using scipy (#5)"
git commit -m "fix(sandbox): add async-mutex semaphore concurrency limiter (#7)"
git commit -m "docs(adr): add ADR-028 prompt compilation with DSPy (#12)"

# Bad Commits (Never use these):
# ❌ git commit -m "updated stuff"
# ❌ git commit -m "fixed bug"
# ❌ git commit -m "wip"
```

---

## 4. Pull Requests & Auto-Closing Issues

When your feature branch is tested and ready to merge into `main`:

1. Open a Pull Request using `gh pr create`:
   ```bash
   gh pr create --title "feat(harness): implement capability registry" --body "Implements ADR-015.\n\nCloses #4"
   ```
2. **Magic Keyword:** Writing `Closes #4` or `Fixes #5` in the PR body **automatically moves the issue to DONE and closes it** on GitHub when the PR merges!

---

## 5. Git Tags & Semantic Versioning (SemVer)

Tags mark major milestones or releases. We use **Semantic Versioning (`vMAJOR.MINOR.PATCH`)**:

```
           v0.1.0-alpha                      v0.1.0                       v0.2.0
┌──────────────────────────────┐  ┌──────────────────────────────┐  ┌───────────────┐
│ Milestone 6: Single-Agent    │  │ MVP 1 Complete:              │  │ MVP 2:        │
│ End-to-End Baseline          │──┼──► 4-Round Participant Debate│──┼──► RL Training│
│ (Price Anchor MASE verified) │  │ & Executive Digest Card      │  │ & MinIO S3    │
└──────────────────────────────┘  └──────────────────────────────┘  └───────────────┘
```

### How to Create & Push Tags:

```bash
# 1. Create an annotated tag for a milestone
git tag -a v0.1.0-alpha -m "Milestone 6: Single-agent price anchor end-to-end verified"

# 2. Push tag to GitHub
git push origin v0.1.0-alpha

# 3. View existing tags
git tag -n
```

---

## 6. The Day-to-Day Developer Cheat Sheet

```bash
# 1. Pick up an issue from the Kanban board (e.g. Issue #4)
git checkout main
git pull origin main
git checkout -b feat/issue-4-capability-layer

# 2. Write code & test
uv run pytest
npm test

# 3. Commit with issue reference
git add -A
git commit -m "feat(harness): implement capability registry and config (#4)"

# 4. Push branch & create PR
git push -u origin feat/issue-4-capability-layer
gh pr create --fill --body "Closes #4"

# 5. Merge PR & update local main
gh pr merge --squash --delete-branch
git checkout main
git pull origin main
```
