# Phantom Shadows -- Repo Detection Context

> Loaded by commands that need repo-aware verification or stack-specific behavior.
> Always load `_shared.md` first.

---

## Repo ID Resolution

`REPO_ID` is the shard key for ALL per-repo state (`<data>/repos/<REPO_ID>/…`).
It is resolved by ONE shared codec - `skills/phantom/scripts/lib/shared-state.cjs` -
which `detectRepo(cwd)` in `scripts/lib/phantom-paths.js`, the portable ESM skill
(`skills/phantom/scripts/lib/portable.mjs`), and `phantom_detect_repo` in
`scripts/lib/phantom-paths.sh` all route through, so every layer produces the
SAME id for the same workspace. **This section is the single documented source of
the precedence.** Do not restate the order elsewhere (it drifted once, in
`_shared.md`).

Precedence - first match wins, never throws:

| # | Step | Why |
|---|------|-----|
| 1 | cwd inside `<data>/worktrees/<seg>/…` → that `<seg>` verbatim | Phantom-**managed** worktrees. **`~/.phantom-os/worktrees` is NOT this root** - user worktrees never hit this step; they resolve at step 3/4. |
| 2 | `PHANTOM_REPO` env (trimmed) → verbatim | Per-spawn, deterministic override; never export globally. |
| 3 | origin remote → normalized → `<name>-<hash>` | Collision-resistant and convergent. The remote is normalized (host lowercased, credentials and default ports `22`/`443` stripped, trailing `.git` removed, owner/repo case preserved) so SSH, HTTPS, SCP-short, renamed clones, and worktrees of one repo share one id, while same-named repos under different owners/hosts stay distinct. |
| 4 | `git rev-parse --path-format=absolute --git-common-dir` → main-root basename | No-remote fallback. Common-dir points at the MAIN checkout's `.git`, so a worktree and its main checkout resolve to the same id. |
| 5 | Walk up to the first `.git` entry (dir or file) → basename | Last resort when git is unavailable or the dir is a bare tree. |
| 6 | `_default` | Nothing matched. |

**Guards:** every `git` invocation (not just `command -v git`) is wrapped; a
missing binary, non-git dir, timeout, or nonzero exit degrades to the next step.
The shell delegates steps 3–6 to the codec via a small `node -e` call and, only
when node is unavailable, falls back to a pure-shell walk-up.
**Perf:** the JS resolver memoizes per resolved cwd (+ `PHANTOM_REPO` + data root),
so the hot hook path is a single map hit after the first call.

**Aliases:** a repo's earlier ids (the plain remote basename, or a hash of the
un-normalized remote) are recorded as aliases in `<data>/repos/.aliases.json`
(alias → canonical, merge-only) so state written under a previous id stays
discoverable after an origin change or codec upgrade.

**Data root:** `<data>` is `PHANTOM_DATA` when set (deterministic; absolute wins,
relative resolves against the workspace), else `$HOME/.phantom`, else
`<workspace>/.phantom` - the same codec resolves it for every layer.

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
