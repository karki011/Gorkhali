# Verification Protocol

## Command Discovery (4-tier precedence)

1. **CLAUDE.md** — check for explicit lint/test/build commands
2. **Repo scripts** — check package.json scripts, Makefile targets
3. **Stack defaults** — infer from detected stack (pnpm/yarn/npm + framework)
4. **Monorepo affected** — run only on affected packages

## Stack Detection

| Marker | Stack |
|--------|-------|
| go.mod | Go |
| Cargo.toml | Rust |
| package.json | Node.js |
| pyproject.toml / setup.py | Python |
| mix.exs | Elixir |
| pom.xml / build.gradle | JVM |

## UI Detection

HAS_UI = true if any of:
- package.json has react/vue/svelte/angular dependency
- src/ contains *.tsx, *.jsx, *.vue, *.svelte files
- Framework detected: Next.js, Remix, Vite with React

## Sentinel Protocol

1. Discover commands per tier precedence
2. Run each command, capture full output
3. Read output completely (don't truncate)
4. Report: pass/fail per command with relevant error lines
