# MVP architecture and acceptance

The orchestrator owns planning and lifecycle state. Engineer implements, Inspector
checks, Auditor judges. Claude Code is the sole host. The supplied Lean Core PRD
sets product direction; this document records the concrete MVP contracts.

## Modules

| Module | Responsibility |
| --- | --- |
| `routing.js`, `plan-schema.js` | Risk policy, metadata validation, deterministic waves |
| `tiers.js`, `config/role-tiers.json` | Role defaults and allowed escalation; Claude model mapping |
| `git-state.js` | Exact Git/content fingerprint with no repository writes |
| `session.js` | Atomic plan, progress, and structured checkpoints |
| `execution.js` | Verify an Engineer's commits on the integration branch, validate ownership, journal integration |
| `verification.js` | Bind checks, independent review, and human confirmation to state |
| `recovery.js` | Two Engineer repair attempts per session; conditional diagnosis |
| `cli.js` | Bounded shell interface for the lead |
| `pr-watch.js` | Read external PR state through GitHub CLI |
| `tracking.js`, `tracker-github.js` | Ticket identity, durable stage receipts, read-back reconciliation, and GitHub effects |

The role prompts own reasoning and tool dispatch. JavaScript owns deterministic
policy and verifiable transitions. No background runtime dispatches models on its own.
No provider interface is added for a hypothetical future host.

## Routing and task ownership

Weights and thresholds live in config/routing.json and are exported constants in routing.js. Each failure counter
adds at most two points. `priorFailure` means before the current session, avoiding
double counting current attempts. Inspector never difficulty-escalates. Deep is the
highest tier; Detective does not invent a fourth tier.

Every wave holds exactly one task.
`buildExecutionWaves` orders tasks by `dependsOn`, then plan order among ready tasks.
Unknown dependencies, cycles, duplicate IDs, and malformed metadata are rejected before dispatch.
`parallelSafe`, `coordinationKeys`, and `isolation` are accepted for saved-plan compatibility and ignored.
Order a migration, public-contract, or destructive change before its consumers with `dependsOn`.

Each completion names task, base commit, result commit, checkout, actual changed files, all touched history paths, task hash, attempt ID, focused checks, and status.
Every outcome is recorded once; pending failures cannot bypass bounded repair through normal dispatch.
Integration takes one completion at a time, checks it against Git, validates dependency ancestry, and requires the record's commits to already sit on the integration branch with the recorded head as HEAD.
It journals those existing commits with an identity applied mapping; nothing is cherry-picked and nothing is released.
`prepareBranch` refuses to start an Engineer outside the integration checkout, on a dirty tree, or away from the wave base.
Task and transitive dependency revisions invalidate old completions after a plan change.
Legacy globs authorize matching changes.
Nothing resets away user work.
One writer owns integration.

## Evidence and checkpoints

Fingerprints include HEAD, index entries, branch, worktree identity, file modes,
tracked content, deletions, and nonignored untracked files. Symbolic links are hashed
as links, not followed outside the repository. Submodules/special files currently
block verification. Ignored build outputs are excluded.

Inspector must supply every discovered check with command, provenance, and observed
result. Auditor must reference the current passed Inspector ID and fingerprint.
Changed content, a new commit, or new Inspector evidence invalidates old review.
Visual confirmation is explicit and bound to the same content state. Commit before
verification; no version bump or commit occurs between final review and shipping.

Checkpoint schema includes phase, wave, HEAD, branch/worktree, dirty files,
fingerprint, integrated/pending tasks, active Engineers, blockers, verification,
approved plan hash, repair count, PR, and next transition. Atomic rename protects
individual records; the checkpoint and Git journal are authoritative on recovery.
An external identity record pins each physical Git common directory to its state
ID, so adding or changing origin does not orphan sessions. Separate clones never
inherit an active task merely because they share a remote or folder name.
The active-session sentinel is keyed by the checkout's own real path, so a second
worktree of the same repository never sees another checkout's session; a legacy
global sentinel is still read once and cleaned up when it names this checkout.
Only the lead appends shared progress. Resume inspects Git rather than replaying
an uncertain action; legacy verification never gets a synthetic pass. Explicit resume
reactivates the selected session, and divergence requires a recorded scope reconciliation.

Pause stops/collects Engineers before clearing active state. An interrupted Engineer's
commits and dirty files on the integration branch are preserved. Changed approved scope/dependencies require
a new plan decision; unchanged approved work resumes automatically.

`requireVerified` still requires a current Inspector pass. Once the checkpoint
records a PR and the latest Auditor record passed with no blocking findings, a
fresh Inspector pass alone satisfies verify and reports `auditorWaived`, because
Codex and Gitar re-review every push in an independent context; a failed or
missing Auditor, or a policy of `required`, still demands a fresh Auditor. This is
controlled by `config/routing.json`'s `review.postShipAuditor` key (`optional` or
`required`, missing means required), and the exported pure `auditorWaiver` helper
keeps that decision unit-testable. A user-visible last Auditor still requires a
current human confirmation bound to the Inspector's fingerprint before the waiver applies.

Verification is a single pass at wrap. The lead collects the human visual pass
first, then one Inspector and one Auditor on the final integrated commit. Every
plan amendment after a passed verification is reported by the `plan` action as a
`notice`, since it forces the whole pass to repeat; the lead batches amendments
instead of verifying per wave.

## Approval and boundaries

Shipping resolves the actual origin default branch and refuses to push it directly.
Close requires the merged PR URL recorded by this session and preserves another
active task. Clear work below the autonomous line limit can use policy approval;
other routes and later scope amendments require explicit plan approval. User
authorization already given for that exact plan counts. Shipping requires explicit
authorization and current evidence.
The lead's editing tools cannot write implementation. Its Bash access while active
is limited to the installed lifecycle CLI. Only the exact live Engineer identity gets
implementation edit permission. Reviewers write external artifacts only; repository
scripts still execute with user permissions. This is not a hostile-code sandbox.

`lib/autonomy.js` owns the strict 300-line boundary. An eligible plan records
well-scoped status, an estimate, no open questions, and whether a ticket was supplied.
Autonomous approval binds the original base commit, plan hash, branch, and checkout.
Raw Git additions plus deletions form a conservative upper bound; complete per-file
classifications exclude tests, comment-only lines, and blanks. The runtime validates
coverage and arithmetic; Inspector supplies source classifications and Auditor
independently validates exclusions. This is not language parsing or a security
boundary against fabricated role evidence. Missing/uncertain evidence and binary
changes require normal human approval. Final verification always requires a current
scope review for autonomous work, even under optional post-ship review policy.

In every mode, Inspector and Auditor record no added explanatory code comments, with only
documented license/tool-directive exceptions. Inspector checks current comments
even when post-ship policy waives Auditor. Passes without that evidence are rejected;
older persisted evidence needs fresh verification under the new policy.
The [global comment rule](../references/code-comments.md) is independent of
autonomous eligibility, task size, and human approval.
See [the autonomous workflow](../references/autonomy.md) for the role contracts.

## Recovery and PR review

Two Engineer repairs are allowed per session. Diagnosis does not reset the counter.
An unclear/repeated/flaky failure gets Detective; tool/environment failure goes to a
human. Exhaustion stops. Every repair requires fresh integrated verification.
An explicit `resolve-failures` transition records the human decision after clarification
or environment restoration; it retires named blockers without resetting counters.
An active Engineer's own commits on top of its dispatched base are classified as
in-progress work on resume/status, not divergence, but only while the checkout is
still the dispatched branch and checkout; a branch or checkout switch is divergence
even at the same commit. A non-done result that leaves commits or dirty
files on the integration branch forces a scope reconciliation, with the reason
separately naming the leftover commits and their ownership status and the leftover
dirty files and their ownership status, before recover or integrate can touch that
branch. Reconcile only records the scope decision; it never discards, commits, merges,
or force-removes those dirty files. When dirty files remain after reconciling, the
lead raises one decision to the user: discard the listed files or commit them under
the task's declared files themselves, and only then call recover. Dispatch and
recover keep rejecting a dirty integration tree.
Wrap owns external review with five actionable rounds maximum, persisted item IDs,
feedback content versions, remote head/checks, inline bodies/authors/locations,
and human decisions for ambiguous or unapproved scope. Posting comments requires
communication authorization. Human merge is never automated.

## Ticket lifecycle

Ticket intake asks for a number/URL when none was supplied, and persists either a
bound Jira/GitHub ticket or the explicit no-ticket decision. Approval requires the
intake receipt; dispatch/repair require assignment and In Progress read-back. Ship
queues PR linking and In Review; external review waits for that receipt. Close
records a verified merge and keeps the session active until Done is confirmed.

`tracking.json` lives beside the checkpoint outside the repository. Pending update
IDs and PR-link markers survive interruption. Every external mutation is followed
by a fresh provider read; an uncertain outcome is reconciled before any retry.
Successful earlier stages are not replayed on resume or review repairs. GitHub uses
fixed `gh` argument arrays and Projects Status options. Jira uses the available
connector's real tool schemas and records normalized read-back through the CLI.
The latter is tool evidence supplied by the orchestrator, not independent server
attestation. See [tracking protocol](../references/tracking.md) for field mapping,
permissions, custom workflows, explicit no-ticket work, and recovery.

## Live acceptance

Use the installed plugin in disposable repositories for role acceptance,
and deterministic fault fixtures for the recovery/gating cases below. The completed
MVP evidence is in [the PRD acceptance record](acceptance.md).

- A small task produces one Engineer, one Inspector, one independent Auditor.
- Two independent tasks run one after the other in the integration checkout,
  integrate in order, then receive one integrated Inspector and Auditor.
- Dependencies order tasks; nothing runs concurrently.
- A known failing check gets one scoped repair; repeated failure gets diagnosis and
  the repair budget eventually stops. An unavailable tool does not trigger edits.
- Pause waits for stopped Engineers. Kill a session without pause and resume its
  pending task, un-journaled completion, or already-created PR without duplicating work.
- Edit staged/unstaged/untracked content after verification and confirm shipping blocks.
- Confirm a user-visible change cannot ship without a current explicit human pass.
- Confirm only the eight public commands and five roles load in Claude Code.

Fixture tests and plugin-load checks do not substitute for these live model runs.
