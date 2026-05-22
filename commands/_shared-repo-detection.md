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

| Condition | Action |
|---|---|
| `HAS_UI = true` AND changes touch UI | Push branch only (user verifies visually) |
| `HAS_UI = true` BUT API/domain only | Draft PR |
| `HAS_UI = false` | Draft PR |

Never auto-create ready-for-review PR. User or `/team:wrap` promotes draft → ready.
