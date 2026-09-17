# Shared lifecycle contract

## State and bounded shell access

Resolve the absolute installed plugin path from this file. The lead calls:

`node "/absolute/plugin/lib/cli.js" <action>`

For first use call `node "/absolute/plugin/lib/cli.js" open TASK-ID`.
Thereafter write the action's JSON input with Write to `{SESSION_DIR}/request.json`
and invoke the action without shell arguments. This file is a request, not a
checkpoint. Read the JSON result. Do not run inline node, pipelines, redirections,
or arbitrary shell commands as the lead. Bash is restricted by the edit hook
while a session is active. Read/Grep/Glob remain available for repository context.

`lib/paths.js` and `lib/session.js` keep state under `$GORKHALI_DATA`, default
`~/.gorkhali`, outside the project. Task IDs use letters, digits, dot, dash,
or underscore. The CLI returns the session directory on `open`.
Only the orchestrator updates shared plan/progress/checkpoint state; agents
write their own completion/evidence records. Do not run two leads for one session.
The active-session pointer is keyed by checkout, so several leads working in different
checkouts on one machine never disturb each other's session, and `open` is idempotent.

CLI actions and request fields:

| Action | Input | Result |
| --- | --- | --- |
| branch | `{name}` | Creates a clean feature branch before planning |
| plan | `{plan}` | Validates, stores plan, checkpoints; returns `notice` when the amendment discards passed verification evidence |
| approve | `{confirmed:true}` after explicit user approval, or `{autonomous:true}` under `autonomy.md` | Binds human or eligible policy approval to this exact plan; autonomous base never resets |
| scope | `{}` for raw totals, or `{files:[{file,implementation,tests,comments,blank,reason?}]}` | Measures the original-base diff and records complete current line classifications |
| route | `{}` | Waves, task assignments, Auditor model, and conditional Opposition |
| dispatch | `{}` | Checkpoints the next single-task wave, its base, task hash, and unique attempt assignment |
| result | `{record}` with taskId, attemptId, status, summary | Records each Engineer outcome once; failures enter bounded recovery. A non-done result with leftover commits or dirty files requires reconcile before recover; the reconcile reason separately reports ownership for the commits and for the dirty files, since reconcile does not itself discard or commit them, the lead raises one decision to the user (discard or commit under the task's files) before recover, and `dispatch`/`recover` still reject a dirty integration tree |
| resolve-failures | `{confirmed:true,failureIds,reason}` after explicit human decision | Retires named blockers after clarification, environment restoration, or authorized retry; preserves all counters |
| reconcile | `{scope:"unchanged" or "changed",reason}` | Records Git/scope evidence; changed scope requires approval |
| integrate | `{records:[record]}` exactly one | Checks ownership and dependency ancestry, verifies the completion's commits already sit on the integration branch with the recorded head as HEAD, journals them, checkpoints |
| snapshot | `{}` | HEAD, branch, worktree, dirty files, content fingerprint |
| diff | `{baseHead}` full commit ID | Integrated diff for the approved scope |
| progress | `{entry:{phase,next,...}}` | Appends progress and checkpoints |
| pause / resume / status | `{}` | Structured handoff, reconciliation, or read-only state. An active Engineer's own commits classify as `branchWork` (next `result`), never as divergence, only while HEAD descends from its base on the same dispatched branch and checkout; a branch or checkout switch is divergence even at the same commit |
| human-confirmation | `{confirmed:true}` after explicit user pass | Binds confirmation to content |
| recover | `{failureId,failureClass,repairTaskId,unclear,flaky,infrastructure,diagnosed}` | Bounded repair or diagnosis decision from recorded evidence |
| verify | `{}` | Runs once at wrap on the final integrated commit. Requires current Inspector, Auditor, and applicable human evidence; for non-autonomous work after a PR exists and the last Auditor passed, a current Inspector pass alone can satisfy verify and returns `auditorWaived`, controlled by `config/routing.json`'s `review.postShipAuditor` policy (default required) |
| ship | `{authorized:true,title,body}` after ship authorization | Reuses an existing PR or pushes and creates one; returns `{url}` |
| review-state | `{pr,classifications:[{id,classification}]}` | Reads inline bodies/authors/locations, head/checks; checkpoints classified feedback and bounded rounds |
| close | `{pr}` numeric | Requires merge, records completion, releases session |
| tracking-configure | `{reference,site?,repo?,assignee?}` or `{decision:"none",confirmed:true,reason}` | Binds a ticket or the user's no-ticket decision |
| tracking-begin | `{stage:"intake" or "start" or "review" or "done"}` | Creates or reuses a pending update, gated by lifecycle evidence |
| tracking-sync | `{}` | Reads GitHub and performs at most one needed mutation; call again for read-back |
| tracking-observe | `{observation}` | Validates Jira tool read-back and returns a receipt or next action |
| tracking-settings | `{confirmed:true,statusNames?,projectId?}` | Resolves a pending update using the user's workflow selection |
| tracking-failure / tracking-status | `{reason}` / `{}` | Records an error / reads durable tracking state |

An explicit task can also be provided in request JSON. Model/risk policy lives
in `lib/routing.js` and `config/role-tiers.json`, with the sole model mapping in
`config/hosts/claude-code.json`. Never copy routing thresholds into prompts.
Use CLI `route` for each role assignment; it invokes `tierForTask` and
`modelForTier`, including Auditor over the union of integrated risk signals. `priorFailure` describes a
failure before this session; counters describe this session, capped by policy.
Opposition is justified by architecture ambiguity or the configured deep threshold.
Every Engineer runs serially in the integration checkout; `routing.js` orders tasks one per wave alongside tiering.

## Context and authority

Read `lib/preferences.js`'s per-repo preferences, falling back to global.
Inject only relevant context into each role. Planning, Opposition, and Engineer
prompts include saved preferences verbatim under `## User Preferences (verbatim)`;
omit that block if empty. Follow target-repository conventions rather than
imposing framework policy. Follow `tracking.md` for ticket intake and lifecycle
updates. Follow `autonomy.md` before asking the optional ticket question: eligible
described work records a policy no-ticket decision. Otherwise ask when none was
supplied; no-ticket work makes no tracker calls. `lib/tracker.js` resolves provider preferences;
`lib/tracking.js` persists decisions and read-back receipts. Only mark a ticket done
after merge. Ticket status is separate from code verification.

All shell tools and user-installed hooks execute with the user's OS permissions.
This is a workflow discipline boundary, not a sandbox for hostile repository code.
Keep implementation agents separate from the Inspector and Auditor contexts.
Machine verification is one Inspector and one Auditor on the final integrated
commit at wrap, never a per-wave gate. Human visual review comes before both,
because it is where the user reshapes the result and it costs no agent run.

## Communication

Use concise, professional language. Lead with the result, decision, or blocker.
Omit repeated context and routine tool narration; give useful progress updates
during long work and enough context for informed approval. Preserve uncertainty,
conditions, negation, identifiers, paths, commands, exact quoted errors, quantities,
and units. Expand when requested or needed to understand a decision.

Keep complete structured completion, verification, and checkpoint records.
Summaries may link to authoritative artifacts but never replace required fields,
evidence, independent review, or human decisions. Any change to an approved plan,
including widened task ownership, is presented the same way as the first approval:
the full plan in plain English with the changed parts marked, never a request file
or JSON. A yes or no question alone is not an approval request. Do not shorten saved preferences
or approved scope. Write persisted documentation and review findings in normal
prose for their readers. Inject only the communication guidance each role needs.

Read `autonomy.md` for the scoped policy approval path and actual implementation-line
accounting. `code-comments.md` applies globally in every mode. Eligibility replaces only the
plan confirmation pause. Ship authorization and applicable human visual review
remain separate; merge always remains human-controlled.
