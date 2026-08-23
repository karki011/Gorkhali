# Phantom Shadows -- Repo Detection Context

> Loaded by commands that need repo-aware verification or stack-specific behavior.
> Always load `_shared.md` first.

---

## Repo Facts (script-computed — never rediscover by hand)

Run the detector instead of walking marker files yourself:

```
{PR_BOOTSTRAP}; [ -n "$PR" ] && node "$PR/scripts/repo-detect.js" --json
```

It emits `repo_id` (+ `aliases`), `data_root`, `stack`, `package_manager`,
`monorepo`, `has_ui`, and discovered `verify_commands` — computed by ONE shared
codec (`skills/phantom/scripts/lib/shared-state.cjs`, routed through
`scripts/lib/phantom-paths.js`'s `detectRepo`, the portable ESM skill, and the
shell resolver), so every layer produces the SAME id for the same workspace.
Never reimplement the precedence in prose or per-command shell — the codec's
comment owns it (it drifted once, in `_shared.md`).

**Aliases:** a repo's earlier ids are recorded merge-only in
`<data>/repos/.aliases.json` (alias → canonical) so state written under a
previous id stays discoverable after an origin change or codec upgrade. Readers
resolve through `resolveRepoSubdir` (fresh canonical data always wins).

**Data root:** `<data>` is `PHANTOM_DATA` when set (absolute wins, relative
resolves against the workspace), else `$HOME/.phantom`, else
`<workspace>/.phantom`.

---

## Verification Command Discovery

Order of precedence (first match wins):
1. Repo `CLAUDE.md` / `AGENTS.md` commands section
2. Machine-readable layer reported by `repo-detect.js`: `package.json` scripts, `Makefile` targets, `justfile`, `Taskfile.yml`
3. Stack defaults (see `skills/phantom/references/verification.md` for full table)
4. Monorepo: Nx `affected`, Turborepo `--filter`

Inspector verification protocol: see `skills/phantom/references/verification.md`.

---

## PR Strategy

Smart PR creation — default is to create, exceptions are explicit.
Decision is based on **what happened** (changed files, code vs artifacts), not the route.
This is the canonical decision table; `reference/wrap/ship-ceremony.md` executes it during `/phantom:wrap`.

| # | Condition | Action | Reason |
|---|-----------|--------|--------|
| 1 | On a default/protected branch (enforced by convention and checked at wrap - no hook, there is no `feature-branch-gate.sh`) | Skip | Cannot PR from default branch |
| 2 | User said "no PR" | Skip | User override |
| 3 | No code changes (only artifacts/docs) | Skip | Research/planning — nothing to review |
| 4 | `has_ui = true` AND UI files changed | PR | Visual review needed |
| 5 | Any code changes | PR | Default: code should be visible to the team |
| 6 | Everything else | Skip | No meaningful changes |

First matching row wins. Wrap creates ready-for-review PRs; never auto-merge one — merging stays human.
