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
| `execution.js` | Align isolated worktrees or verify an in-place branch-mode Engineer, validate ownership, journal integration |
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

A missing `parallelSafe` field means serial. Files are concrete relative paths or
directory prefixes, with conservative case-insensitive overlap detection. Unknown
ownership (including globs) cannot co-schedule. Coordination keys are explicit shared
logical resources. Unknown dependencies, cycles, duplicate IDs, and malformed metadata
are rejected before dispatch. A migration/public-contract/destructive task always
runs serially; its independent consumers may parallelize after it integrates.

`isolationForTask` decides worktree versus branch mode per task. An explicit
`worktree` on the task or plan always wins; a wave with more than one task or any
other active Engineer forces worktree; an explicit `branch` then applies; otherwise
another pending task, a pending dependent, a pending task sharing a coordination
key, a deep Engineer tier, or any implementation failure this session also forces
worktree. Only a single low-risk task with no other pending or active work runs in
branch mode.

Each completion names task, base commit, result commit, worktree, actual changed
files, all touched history paths, task hash, attempt ID, focused checks, isolation
mode, and status. Every outcome is recorded once; pending failures cannot bypass
bounded repair through normal dispatch. Integration checks these against Git and
validates dependency ancestry. Worktree-mode integration journals each source commit
before applying it with a cherry-pick source marker; on interruption, markers in
actual current Git history prevent replay, and persisted applied lists alone never
prove presence. Missing commits are reapplied only when current history is a valid
prefix. Branch-mode integration instead verifies the record's commits already sit
on the integration branch at the recorded head, journals those existing commits
without cherry-picking them, and the integration worktree is never released.
Integration rejects a record whose isolation mode differs from the assignment's
stored mode. Task and transitive dependency revisions invalidate old completions
after a plan change. Legacy globs authorize changes serially. A conflict is
preserved and delegated; nothing resets away user work. One writer owns integration.

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

Pause stops/collects Engineers before clearing active state. Interrupted Engineers'
worktrees and dirty files are preserved. Changed approved scope/dependencies require
a new plan decision; unchanged approved work resumes automatically.

## Approval and boundaries

Shipping resolves the actual origin default branch and refuses to push it directly.
Close requires the merged PR URL recorded by this session and preserves another
active task. Every route requires explicit plan approval. User authorization already given for
that exact plan counts. Shipping requires explicit authorization and current evidence.
The lead's editing tools cannot write implementation. Its Bash access while active
is limited to the installed lifecycle CLI. Only the exact live Engineer identity gets
implementation edit permission. Reviewers write external artifacts only; repository
scripts still execute with user permissions. This is not a hostile-code sandbox.

## Recovery and PR review

Two Engineer repairs are allowed per session. Diagnosis does not reset the counter.
An unclear/repeated/flaky failure gets Detective; tool/environment failure goes to a
human. Exhaustion stops. Every repair requires fresh integrated verification.
An explicit `resolve-failures` transition records the human decision after clarification
or environment restoration; it retires named blockers without resetting counters.
A branch-mode Engineer's own commits on top of its dispatched base are classified as
in-progress work on resume/status, not divergence, but only while the checkout is
still the dispatched branch and worktree; a branch or worktree switch is divergence
even at the same commit. A non-done branch-mode result that leaves commits or dirty
files on the integration branch forces a scope reconciliation, with the reason
separately naming the leftover commits and their ownership status and the leftover
dirty files and their ownership status, before recover or integrate can touch that
branch. Reconcile only records the scope decision; it never discards, commits, merges,
or force-removes those dirty files. When dirty files remain after reconciling, the
lead raises one decision to the user: discard the listed files or commit them under
the task's declared files themselves, and only then call recover. Dispatch and
recover keep rejecting a dirty integration tree in both isolation modes.
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

Use the installed plugin in disposable repositories for role/worktree acceptance,
and deterministic fault fixtures for the recovery/gating cases below. The completed
MVP evidence is in [the PRD acceptance record](acceptance.md).

- A small task produces one Engineer, one Inspector, one independent Auditor.
- Two independent tasks use distinct aligned worktrees, integrate in order, then
  receive one integrated Inspector and Auditor.
- A shared file, resource, dependency, or high-conflict risk forces serial execution.
- A known failing check gets one scoped repair; repeated failure gets diagnosis and
  the repair budget eventually stops. An unavailable tool does not trigger edits.
- Pause waits for stopped Engineers. Kill a session without pause and resume its
  pending wave, completed cherry-pick, or already-created PR without duplicating work.
- Edit staged/unstaged/untracked content after verification and confirm shipping blocks.
- Confirm a user-visible change cannot ship without a current explicit human pass.
- Confirm only the eight public commands and five roles load in Claude Code.

Fixture tests and plugin-load checks do not substitute for these live model runs.
