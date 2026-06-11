# Verification Protocol

## Command Discovery (4-tier precedence)

1. **CLAUDE.md** — check for explicit lint/test/build commands
2. **Repo scripts** — check package.json scripts, Makefile targets
3. **Stack defaults** — infer from detected stack (pnpm/yarn/npm + framework)
4. **Monorepo affected** — run only on affected packages

## Stack Defaults (placeholder resolution)

Single home for concrete commands. Every `{TEST_CMD}` / `{LINT_CMD}` / `{BUILD_CMD}` / `{TYPECHECK_CMD}` placeholder elsewhere in this plugin resolves here — but only after tiers 1-2 yield nothing. Node package manager is selected by lockfile per `commands/_shared-repo-detection.md`.

| Stack (marker) | {TEST_CMD} | {LINT_CMD} | {BUILD_CMD} | {TYPECHECK_CMD} |
|----------------|------------|------------|-------------|-----------------|
| pnpm (`pnpm-lock.yaml`) | `pnpm test` | `pnpm lint` | `pnpm build` | `pnpm exec tsc --noEmit` |
| yarn (`yarn.lock`) | `yarn test` | `yarn lint` | `yarn build` | `yarn tsc --noEmit` |
| bun (`bun.lockb`) | `bun test` | `bun run lint` | `bun run build` | `bunx tsc --noEmit` |
| npm (`package-lock.json`) | `npm test` | `npm run lint` | `npm run build` | `npx tsc --noEmit` |
| Go (`go.mod`) | `go test ./...` | `go vet ./...` | `go build ./...` | — |
| Rust (`Cargo.toml`) | `cargo test` | `cargo clippy` | `cargo build` | `cargo check` |
| Python (`pyproject.toml` / `setup.py`) | `pytest` | — | — | — |
| Make (`Makefile`, tier 2) | `make test` | `make lint` | `make build` | — |

`—` = no stack default: resolve via tier 1/2 or report `not_observed`. Make rows apply only when the target exists in the Makefile.

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

## Observation Confidence Protocol

Every verification step MUST report one of three states:

| State | Meaning | Example |
|-------|---------|---------|
| `checked:pass` | Ran the check, it passed | "lint: checked:pass — 0 errors" |
| `checked:fail` | Ran the check, it failed | "build: checked:fail — TS2345 in foo.ts:42" |
| `not_observed` | Could not run the check | "tests: not_observed — no test runner configured" |

**`not_observed != absent`** — never claim an area is clean without running the check. If a command doesn't exist, times out, or is skipped for any reason, report `not_observed` with the reason.

This feeds into Gaze's `observation_confidence` gate. Areas marked `not_observed` are surfaced in the review, not hidden.

## Ward Protocol

1. Discover commands per tier precedence
2. Run each command, capture full output
3. Read output completely (don't truncate)
4. Report: checked:pass / checked:fail / not_observed per command with relevant error lines
