# Phantom Works Crew -- Repo Detection Context

> Loaded by commands that need repo-aware verification or stack-specific behavior.
> Always load `_shared.md` first.

---

## Repo Stack Detection

Detect the repo's tech stack by checking for marker files at the git root. First match wins per category.

### Language / Runtime

| Marker File | Stack | Runtime |
|---|---|---|
| `go.mod` | Go | `go` |
| `Cargo.toml` | Rust | `cargo` |
| `pyproject.toml` or `setup.py` | Python | `python3` |
| `package.json` | Node.js | `node` |
| `mix.exs` | Elixir | `mix` |
| `build.gradle` or `pom.xml` | JVM | `java` |

### Package Manager (Node.js only)

| Marker File | Manager |
|---|---|
| `pnpm-lock.yaml` | pnpm |
| `yarn.lock` | yarn |
| `bun.lockb` | bun |
| `package-lock.json` | npm |

### Monorepo Detection

| Marker File | Tool |
|---|---|
| `nx.json` | Nx |
| `turbo.json` | Turborepo |
| `lerna.json` | Lerna |
| `pnpm-workspace.yaml` | pnpm workspaces |

### UI Layer Detection

Check if the repo has a UI layer that requires visual verification:

| Signal | Conclusion |
|---|---|
| Files matching `*.tsx` or `*.jsx` with JSX content | Has React UI |
| `libs/ui/` or `src/components/` or `src/pages/` directory exists | Has UI layer |
| `@chakra-ui/*` or `@mui/*` or `tailwindcss` in dependencies | Has styled UI |
| None of the above | No UI — backend/infra/library only |

**Result:** `HAS_UI = true | false`

This drives the PR strategy: UI work → push branch only (user verifies visually). Non-UI work → draft PR is acceptable.

---

## Verification Command Discovery

Order of precedence (first match wins):

### 1. Repo CLAUDE.md Commands Section

Read the repo's `CLAUDE.md` (or `AGENTS.md`) and look for a commands/verification table. If it lists explicit verify, lint, build, or test commands — use those. This is the highest-priority source.

### 2. Repo Scripts

| Check | Use |
|---|---|
| `package.json` scripts: `check`, `lint`, `build`, `test` | `{manager} {script}` |
| `Makefile` targets: `lint`, `check`, `build`, `test` | `make {target}` |
| `justfile` recipes | `just {recipe}` |
| `Taskfile.yml` tasks | `task {name}` |

### 3. Stack Defaults (fallback only)

| Stack | Lint | Build | Test |
|---|---|---|---|
| **Node/pnpm** | `pnpm check` | `pnpm build` | `pnpm test` |
| **Node/yarn** | `yarn lint` | `yarn build` | `yarn test` |
| **Node/npm** | `npm run lint` | `npm run build` | `npm test` |
| **Go** | `go vet ./...` | `go build ./...` | `go test ./...` |
| **Rust** | `cargo clippy` | `cargo build` | `cargo test` |
| **Python** | `ruff check .` | — | `pytest` |
| **Elixir** | `mix credo` | `mix compile` | `mix test` |
| **JVM/Gradle** | `./gradlew check` | `./gradlew build` | `./gradlew test` |
| **JVM/Maven** | `mvn verify` | `mvn package` | `mvn test` |

### 4. Monorepo: Affected Only

If a monorepo tool is detected, prefer affected/changed-only commands:

| Tool | Affected Command |
|---|---|
| Nx | `npx nx affected --target={lint\|build\|test}` |
| Turborepo | `npx turbo run {lint\|build\|test} --filter=...[HEAD~1]` |

---

## Sentinel Verification Protocol

Sentinel MUST use the discovered commands, not hardcoded ones. The verification sequence is:

```
1. DISCOVER: detect stack + find verify commands (this file)
2. LINT:     run lint command → capture full output
3. BUILD:    run build command → capture full output  
4. TEST:     run test command (affected only if monorepo) → capture full output
5. VERDICT:  ALL pass → PASS. ANY fail → FAIL with classified failures
```

Each step MUST:
- Run the actual command (not assume it passes)
- Read the FULL output (not truncate)
- Report the exact exit code
- On failure: extract file paths, line numbers, error messages for the fix packet

---

## PR Strategy

Based on `HAS_UI` detection:

| UI Layer | PR Strategy | Reason |
|---|---|---|
| `HAS_UI = true` AND changed files touch UI | Push branch only | User must verify visually |
| `HAS_UI = true` BUT changes are API/domain only | Draft PR | No visual impact |
| `HAS_UI = false` | Draft PR | No visual verification needed |

Draft PR format:
```bash
gh pr create --draft --title "{TICKET}: {summary}" --body "..."
```

Non-draft (ready for review) is NEVER auto-created. The user or `/team:wrap` promotes draft → ready.
