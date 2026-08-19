# Verification and independent review

Load this phase after execution begins. Verification establishes deterministic
correctness evidence; independent review evaluates the already-verified change.
Neither substitutes for the other.

## Required order

1. Inspect the complete changed scope and compare it with the approved outcome.
2. Run the narrowest meaningful checks for each acceptance criterion.
3. Run every repository-required type, lint, build, and test command that
   applies to the changed scope. Record commands, exit status, and relevant
   observations without inventing unavailable results.
4. Run the simplification pass over every changed file. It may reduce accidental
   complexity but may not remove approved behavior, validation, compatibility,
   accessibility, security controls, or evidence.
5. If simplification changes a file, rerun every affected correctness check.
6. Record passed verification against the current worktree fingerprint.
7. Only after that record succeeds, run independent review and any specialists
   triggered by observed risk.
8. Resolve blocking findings within scope, then repeat affected verification
   before recording a newer independent review.

The state engine owns fingerprint freshness and record ordering. A later
content change makes earlier verification and review stale. A later verification
also makes an earlier review stale even when the fingerprint is unchanged.

### Ordered quality path

Verification classifies the final post-simplification diff's risk exactly once
and persists the unique required role strings in `requiredSpecialists`. Review
runs exactly those persisted roles and merges their results into `specialists`;
review and shipping never reclassify the diff. No stage auto-fixes a failure,
and missing required verification or independent review evidence blocks.

## Command discovery precedence

Resolve every check command in this order, first match wins:

1. Repository instructions (`AGENTS.md` or the host's equivalent instruction file).
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

## Verification evidence

Verification must contain at least one named passed check and enough observation
to connect checks to the approved criteria. Distinguish passed, failed, blocked,
and not observed. A skipped or unavailable check is not a pass.

### Inspector evidence

Deterministic verification is read-only. Record, for every applicable check:

- stable check name;
- exact command;
- exit code;
- `passed`, `failed`, `blocked`, or `not-applicable`;
- concise evidence and any observation gap; and
- whether the worktree remained unchanged.

Never translate absent, skipped, timed-out, or truncated output into a pass.

Enter the verification phase before running checks, then record the canonical
payload once after those checks finish:

```text
node <skill-directory>/scripts/phantom-state.mjs verify --workspace <path>
node <skill-directory>/scripts/phantom-state.mjs record --workspace <path> --type verification --status passed --input <json-file>
```

If correctness fails, return to the smallest responsible execution scope. If
the failure invalidates the plan or confirmed root cause, return to planning or
investigation rather than stacking patches.

## Risk-triggered specialists

Justice runs only when cross-file architecture or integration risk triggers an
independent structural pass. Visual and interaction behavior uses explicit
user verification in the ordinary verification artifact; it does not create a
specialist artifact. When a design artifact or specification defines the
intended result, compare the rendered change against that artifact rather than
a neighboring implementation file, cite what was compared, and report the
observed deltas as measured values. Other risk-specific checks remain
deterministic verification checks or repository-required review inputs.

### Risk triggers

| Observed diff risk | Specialist |
|---|---|
| User-visible UI/visual behavior | Explicit user verification before passed verification evidence |
| Auth, authorization, permissions | Justice |
| Money, destructive operations, data-loss risk | Justice |
| Migration or public API compatibility | Justice |
| Concurrency or broad cross-module architecture | Justice |
| Infrastructure/deploy or dependency changes | Justice |

Resolve this table once against the final post-simplification diff. Persist a
unique `requiredSpecialists` array containing only `"justice"`, or `[]` when no
Justice row applies. RPSL remains an explicit optional deep-review preset, never
a normal shipping prerequisite.

Each required specialist returns a current passed, failed, or blocked artifact
with findings and observation gaps. Missing, stale, failed, or blocked required specialist
evidence blocks review completion and shipping. Untriggered Justice work creates
no artifact.

When user observation is required, add it to the same verification payload:

```json
{
  "checks": [{ "name": "focused tests", "result": "passed" }],
  "requiredSpecialists": [],
  "userVerification": {
    "required": true,
    "status": "confirmed",
    "routes": ["/primary-flow"],
    "confirmedBy": "user",
    "observations": ["Primary interaction completes at the supported viewport"]
  }
}
```

User interaction is optional for non-visual work, but passed verification must
classify it explicitly with `userVerification: { "required": false }`. When
`required: true`, the same object requires `status: "confirmed"`,
`confirmedBy: "user"`, and non-empty routes. Pending confirmation blocks a
passed verification record. With `required: false`, omit status, routes,
confirmation provenance, and observations. Optional Surveyor inspection runs only
when the user explicitly requests it; its evidence is advisory, does not enter
`requiredSpecialists`, and never replaces user confirmation. A legacy
verification artifact that requires Surveyor cannot advance; keep it inspectable,
then record fresh verification with explicit user verification instead of
recreating the former Surveyor gate.

The portable helper stores that decision atomically with the complete final
worktree fingerprint. Any later tracked, indexed, mode, deletion, untracked,
symlink, or gitlink change makes the verification stale and requires a fresh
classification. Inspector classifies the whole diff rather than relying on path or
extension heuristics, so non-UI work remains prompt-free while rendered changes
through API data, configuration, or unconventional source paths still require
the confirmed arm.

## Independent review

The reviewer must be independent of the implementation pass and receive the
approved outcome, changed scope, verification evidence, repository rules, and
relevant risks. It should inspect code and tests directly rather than trust an
implementation summary.

Auditor must compare `userVerification` with the complete diff bound to the Inspector
artifact. Any user-visible behavior paired with `required: false` is a blocking
finding and cannot produce a passed review. This is semantic review over the
actual change set; the state engine intentionally does not guess UI behavior
from filenames. The accepted Auditor delegation result must contain a passed check
named `user-verification-classification`; missing, duplicate, failed, or
skipped blocks the portable review record.

Review reports a pass verdict or actionable findings with severity, evidence,
and path. It does not modify code. When findings require changes, return them to
execution, rerun affected checks and simplification, record newer verification,
then run a fresh review.

Record review only after the authoritative current verification passes. Use one
run id for the independent Auditor delegation task, its accepted result, and the
review. The state engine validates and binds that result so a caller-supplied
role label cannot establish independence by itself:

```text
node <skill-directory>/scripts/phantom-state.mjs record --workspace <path> --type delegation-task --run <review-run> --status pending --input <auditor-task-json>
node <skill-directory>/scripts/phantom-state.mjs record --workspace <path> --type delegation-result --run <review-run> --status passed --input <auditor-result-json>
node <skill-directory>/scripts/phantom-state.mjs record --workspace <path> --type review --run <review-run> --role auditor --status passed --input <review-json>
```

Do not manually select an older passing record. The engine treats the newest
required evidence as authoritative and fails closed on missing or stale gates.

After current verification, specialist evidence, and independent review pass,
local work may complete or enter the separately authorized shipping phase.
