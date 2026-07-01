# Phantom Shadows -- Repo Detection Context

> Loaded by commands that need repo-aware verification or stack-specific behavior.
> Always load `_shared.md` first.

---

## Repo Name Resolution

`REPO_NAME` is the shard key for ALL per-repo state (`<data>/repos/<REPO_NAME>/…`).
It is resolved by a single seam — `detectRepo(cwd)` in `scripts/lib/phantom-paths.js`
and its byte-for-byte mirror `phantom_detect_repo` in `scripts/lib/phantom-paths.sh`.
**This section is the single documented source of the precedence.** Do not restate
the order elsewhere (it drifted once, in `_shared.md`).

Precedence — first match wins, never throws:

| # | Step | Why |
|---|------|-----|
| 1 | cwd inside `<data>/worktrees/<repo>/…` → that `<repo>` segment | Phantom-**managed** worktrees. **`~/.phantom-os/worktrees` is NOT this root** — user worktrees never hit this step; they resolve at step 3. |
| 2 | `PHANTOM_REPO` env (trimmed) | Per-spawn override; never export globally. |
| 3 | `git remote get-url origin` → basename minus `.git` | **The fix.** Worktree- and clone-name-invariant. User worktrees live at `~/.phantom-os/worktrees/{repo}/{branch}`, so a naive `.git` walk-up returns the **BRANCH**, sharding state under branch names. The remote name is stable across every checkout. |
| 4 | `git rev-parse --path-format=absolute --git-common-dir` → main-root basename | No-remote fallback. Common-dir points at the MAIN checkout's `.git`, so it is worktree-safe (returns the real repo dir, not the worktree/branch dir). |
| 5 | Walk up to the first `.git` entry (dir or file) → basename | Last resort when git is unavailable or the dir is a bare tree. |
| 6 | `_default` | Nothing matched. |

**Guards:** every `git` invocation (not just `command -v git`) is wrapped; a
missing binary, non-git dir, timeout, or nonzero exit degrades to the next step.
**Perf:** the JS resolver memoizes per resolved cwd (+ `PHANTOM_REPO` + data root),
so the hot hook path is a single map hit after the first call.

---

## Stack Detection

### Language / Runtime

| Marker File | Stack |
|---|---|
| `go.mod` | Go |
| `Cargo.toml` | Rust |
| `pyproject.toml` / `setup.py` | Python |
| `package.json` | Node.js |
| `mix.exs` | Elixir |
| `build.gradle` / `pom.xml` | JVM |

### Package Manager (Node.js)

| Marker | Manager |
|---|---|
| `pnpm-lock.yaml` | pnpm |
| `yarn.lock` | yarn |
| `bun.lockb` | bun |
| `package-lock.json` | npm |

### Monorepo

| Marker | Tool |
|---|---|
| `nx.json` | Nx |
| `turbo.json` | Turborepo |
| `pnpm-workspace.yaml` | pnpm workspaces |

---

## UI Layer Detection

| Signal | Conclusion |
|---|---|
| `*.tsx`/`*.jsx` with JSX content | Has React UI |
| `libs/ui/`, `src/components/`, `src/pages/` exists | Has UI layer |
| `@chakra-ui/*`, `@mui/*`, `tailwindcss` in deps | Has styled UI |
| None of above | No UI (`HAS_UI = false`) |

---

## Verification Command Discovery

Order of precedence (first match wins):
1. Repo `CLAUDE.md` / `AGENTS.md` commands section
2. `package.json` scripts, `Makefile` targets, `justfile`, `Taskfile.yml`
3. Stack defaults (see `reference/verification.md` for full table)
4. Monorepo: Nx `affected`, Turborepo `--filter`

Ward verification protocol: see `reference/verification.md`.

---

## PR Strategy

Smart Draft PR creation — default is to create, exceptions are explicit.
Decision is based on **what happened** (changed files, code vs artifacts), not the route.
Full decision table lives in `commands/wrap.md` step 14 `<pr_decision>`.

| # | Condition | Action | Reason |
|---|-----------|--------|--------|
| 1 | On a default/protected branch (per `hooks/feature-branch-gate.sh`) | Skip | Cannot PR from default branch |
| 2 | User said "no PR" | Skip | User override |
| 3 | No code changes (only artifacts/docs) | Skip | Research/planning — nothing to review |
| 4 | `HAS_UI = true` AND UI files changed | Draft PR | Visual review needed, draft signals not yet approved |
| 5 | Any code changes | Draft PR | Default: code should be visible to the team |
| 6 | Everything else | Skip | No meaningful changes |

First matching row wins. Never auto-create ready-for-review PR — user promotes draft → ready.
