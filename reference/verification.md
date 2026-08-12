# Verification Protocol

The portable state and verification contracts are authoritative for lifecycle,
worktree fingerprints, artifact freshness, evidence states, and ordering. This
reference defines repository command discovery for compatibility adapters.

## Ordered quality path

Normal verification is exactly:

1. Ward runs deterministic, read-only correctness checks.
2. Sweep simplifies every changed file within scope.
3. Ward reruns checks affected by Sweep changes.
4. Verification classifies the final diff's risk once and persists the unique
   required role strings in `requiredSpecialists`.
5. The final Ward evidence and `requiredSpecialists` are recorded together as
   fingerprint-bound portable `verification` evidence.
6. One independent Gaze reviews the same fingerprint and is recorded as the
   portable `review` evidence.
7. Review runs exactly the persisted Lens/Archer roles and merges their results
   into `specialists`; review and wrap never reclassify the diff.

No stage auto-fixes a failure. Missing required Ward or Gaze evidence blocks.

## Command discovery precedence

1. Repository instructions (`AGENTS.md`, `CLAUDE.md`, or equivalent).
2. CI configuration and repository scripts (`package.json`, Makefile, task
   runner, workspace tooling).
3. Narrow commands already used by nearby tests or packages.
4. Stack defaults below, only when the repository exposes no command.

For monorepos, run affected-package checks plus any repository-required root
gate. Record the exact resolution source for each command.

## Stack defaults

| Stack marker | Test | Lint/static | Build | Typecheck |
|---|---|---|---|---|
| `pnpm-lock.yaml` | `pnpm test` | `pnpm lint` | `pnpm build` | `pnpm exec tsc --noEmit` |
| `yarn.lock` | `yarn test` | `yarn lint` | `yarn build` | `yarn tsc --noEmit` |
| `bun.lockb` | `bun test` | `bun run lint` | `bun run build` | `bunx tsc --noEmit` |
| `package-lock.json` | `npm test` | `npm run lint` | `npm run build` | `npx tsc --noEmit` |
| `go.mod` | `go test ./...` | `go vet ./...` | `go build ./...` | — |
| `Cargo.toml` | `cargo test` | `cargo clippy` | `cargo build` | `cargo check` |
| `pyproject.toml` | `pytest` | repository-defined | repository-defined | repository-defined |

Use a default only when its executable and configuration are present. `—` or a
missing command is `not-applicable` when genuinely irrelevant, otherwise
`blocked` with the reason.

## Ward evidence

Ward is read-only. It records, for every applicable check:

- stable check name;
- exact command;
- exit code;
- `passed`, `failed`, `blocked`, or `not-applicable`;
- concise evidence and any observation gap; and
- whether the worktree remained unchanged.

A passed portable verification contains at least one named passed check. Never
translate absent, skipped, timed-out, or truncated output into a pass.

## Risk triggers

| Observed diff risk | Specialist |
|---|---|
| User-visible UI/visual behavior | Lens |
| Auth, authorization, permissions | Archer |
| Money, destructive operations, data-loss risk | Archer |
| Migration or public API compatibility | Archer |
| Concurrency or broad cross-module architecture | Archer |
| Infrastructure/deploy or dependency changes | Archer |

Resolve this table once against the final post-Sweep diff. Persist a unique
`requiredSpecialists` array containing only `"lens"` and/or `"archer"`; persist
`[]` when no row applies. The portable review/ship gate compares this selection
with the merged review's `specialists` results. Each required role receives one
bounded, non-overlapping question; missing, failed, blocked, duplicate, or
unexpected specialist evidence blocks. RPSL remains an explicit optional
deep-review preset, never a normal shipping prerequisite.
