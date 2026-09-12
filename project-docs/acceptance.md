# PRD acceptance record

This records the Lean Core and Smart Orchestration MVP acceptance for version 3.0.0.
Claude Code is the only supported host. Git history is preserved; this is the
approved incremental MVP PR, not a replacement root commit.

## Validation results

- **150 automated tests** pass, including real temporary Git worktrees and failure injection.
- Claude Code **2.1.269** loaded exactly **8 public commands and 5 roles**.
- Live normal task: **1 Engineer, 1 Inspector, 1 Auditor**, verified.
- Live parallel task: **2 overlapping Engineers in distinct worktrees, 1 integrated Inspector, 1 Auditor**, verified.
- Live failure recovery: **1 scoped Engineer repair**, fresh passing checks, deep Auditor, verified. An extra initial Inspector was needed for a missing session path; the new directory guard and explicit prompt context address it.
- A fresh Claude process resumed unchanged work without prior pause, then paused and resumed successfully.
- Independent review accepted the implementation fixes. Plugin validation, whitespace checks, and real GitHub review reads passed.

[Machine-readable receipts](acceptance-evidence.json) include role/model counts,
evidence IDs, state fingerprints, costs, and observed prompt errors. These are
small fixture runs; final GitHub CI is attached to the PR commit.

## Requirement coverage

| PRD requirement | Implementation and verification |
| --- | --- |
| FR-1: lead cannot implement | Exact Engineer identity in `never-edits`; lead shell restricted to lifecycle CLI. Hook tests and actual Claude rejection of out-of-contract lead commands. |
| FR-2: compatible plan fields | Plan-schema and routing tests cover omitted metadata, legacy glob ownership, and explicit dependency/resource/risk fields. |
| FR-3: safe deterministic waves | Routing tests cover direct/transitive dependencies, file/directory/resource overlap, high-conflict risks, cycles, and sequential fallback. |
| FR-4: isolated Engineers | Real Git fixture tests plus live Claude worktree dispatch, alignment, structured completion, ownership history, and ordered integration. |
| FR-5: integrated Inspector | Live single and parallel workflows count actual agent starts; one Inspector follows integration. |
| FR-6: current independent Auditor | Evidence tests bind Inspector ID, plan, and exact Git/content state; live Auditor runs in a separate agent context. |
| FR-7/8: routing and allowed tiers | Deterministic risk/threshold boundary tests and role-model hook tests; actual balanced Engineer/Auditor and economy Inspector calls. |
| FR-9/10: conditional specialists | Risk/recovery tests and no Opposition or Detective in the low-risk live workflows. |
| FR-11: bounded recovery | Tests cover two-attempt budget, repeated failure diagnosis, idempotent outcomes, parallel peer failures, dispatch bypass prevention, and explicit human resolution without counter resets. |
| FR-12/13: pause and resume | Real Git checkpoint/reconstruction tests, selected-session activation, interrupted integration, partial waves, and a fresh Claude process resuming without prior pause. |
| FR-14: stale evidence | Tests cover changed HEAD, index, branch/worktree, tracked/untracked content, plan revisions, and explicit scope reconciliation before continuation. |
| FR-15/16: lean review surface | Actual Claude discovery has eight public commands and five roles. Verify owns the only Auditor artifact required by ship. |
| FR-17: human visual confirmation | Tests reject missing/stale human confirmation; prompt presents a checklist and requires explicit user pass. |
| FR-18: repository hygiene | Surface regression checks, removed committed session artifacts, current docs rewritten, old roadmap explicitly historical. |

## Additional defects closed during independent review

- Reconstruct applied commits from actual Git after interruption/reset; reject non-prefix histories.
- Bind completion to task and transitive dependency revisions instead of task IDs alone.
- Reject out-of-scope intermediate commits even if later reverted; support legacy globs sequentially.
- Keep unfinished peers active after partial integration; preserve failed attempts across peer integration.
- Record implementation failures once and enforce recovery before redispatch or verification.
- Require a recorded human decision to release clarified/restored blockers; preserve counters.
- Read inline review bodies, authors, and locations; track changed feedback, remote HEAD,
  checks, and bounded actionable rounds. Approved threadless PRs can finish review.
- Reject shipping from the actual remote default branch; bind close to the session PR.
- Preserve repository state identity across origin changes and sentinel removal,
  without inheriting another clone's active task.
- Remove internal helper/router entries from actual public command discovery.

## Evidence boundaries

Automated tests exercise deterministic failure, recovery, approval, shipping, and
human-confirmation gates using disposable Git repositories. GitHub shipping tests
use a local remote and a stub GitHub CLI. Live model runs exercise real Claude
hooks, model selection, worktrees, independent roles, and evidence recording.
The live fixtures do not publish a release, merge a PR, or simulate a human visual
pass. Their public surface and result receipts are recorded alongside this file.
