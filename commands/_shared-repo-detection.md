# Team Skill Crew -- Repo Detection Context

> Loaded by commands that need repo-aware verification or stack-specific behavior.
> Always load `_shared.md` first.

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

Sentinel verification protocol: see `reference/verification.md`.

---

## PR Strategy

Smart Draft PR creation — default is to create, exceptions are explicit.
Decision is based on **what happened** (changed files, code vs artifacts), not the route.
Full decision table lives in `commands/wrap.md` step 14 `<pr_decision>`.

| # | Condition | Action | Reason |
|---|-----------|--------|--------|
| 1 | On default branch (main/master) | Skip | Cannot PR from default branch |
| 2 | User said "no PR" | Skip | User override |
| 3 | No code changes (only artifacts/docs) | Skip | Research/planning — nothing to review |
| 4 | `HAS_UI = true` AND UI files changed | Draft PR | Visual review needed, draft signals not yet approved |
| 5 | Any code changes | Draft PR | Default: code should be visible to the team |
| 6 | Everything else | Skip | No meaningful changes |

First matching row wins. Never auto-create ready-for-review PR — user promotes draft → ready.
