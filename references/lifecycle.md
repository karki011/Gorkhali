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

CLI actions and request fields:

| Action | Input | Result |
| --- | --- | --- |
| branch | `{name}` | Creates a clean feature branch before planning |
| plan | `{plan}` | Validates, stores plan, checkpoints |
| approve | `{confirmed:true}` after explicit user approval | Binds approval to this plan |
| route | `{}` | Waves, task assignments, Auditor model, and conditional Opposition |
| dispatch | `{}` | Checkpoints the next wave, base, task hashes, and unique attempt assignments |
| result | `{record}` with taskId, attemptId, status, summary | Records each Engineer outcome once; failures enter bounded recovery |
| resolve-failures | `{confirmed:true,failureIds,reason}` after explicit human decision | Retires named blockers after clarification, environment restoration, or authorized retry; preserves all counters |
| reconcile | `{scope:"unchanged" or "changed",reason}` | Records Git/scope evidence; changed scope requires approval |
| integrate | `{records:[...]}` | Checks ownership, integrates commits, checkpoints |
| snapshot | `{}` | HEAD, branch, worktree, dirty files, content fingerprint |
| diff | `{baseHead}` full commit ID | Integrated diff for the approved scope |
| progress | `{entry:{phase,next,...}}` | Appends progress and checkpoints |
| pause / resume / status | `{}` | Structured handoff, reconciliation, or read-only state |
| human-confirmation | `{confirmed:true}` after explicit user pass | Binds confirmation to content |
| recover | `{failureId,failureClass,repairTaskId,unclear,flaky,infrastructure,diagnosed}` | Bounded repair or diagnosis decision from recorded evidence |
| verify | `{}` | Requires current Inspector, Auditor, and applicable human evidence |
| ship | `{authorized:true,title,body}` after ship authorization | Reuses an existing PR or pushes and creates one |
| review-state | `{pr,classifications:[{id,classification}]}` | Reads inline bodies/authors/locations, head/checks; checkpoints classified feedback and bounded rounds |
| close | `{pr}` numeric | Requires merge, records completion, releases session |

An explicit task can also be provided in request JSON. Model/risk policy lives
in `lib/routing.js` and `config/role-tiers.json`, with the sole model mapping in
`config/hosts/claude-code.json`. Never copy routing thresholds into prompts.
Use CLI `route` for each role assignment; it invokes `tierForTask` and
`modelForTier`, including Auditor over the union of integrated risk signals. `priorFailure` describes a
failure before this session; counters describe this session, capped by policy.
Opposition is justified by architecture ambiguity or the configured deep threshold.

## Context and authority

Read `lib/preferences.js`'s per-repo preferences, falling back to global.
Inject only relevant context into each role. Planning, Opposition, and Engineer
prompts include saved preferences verbatim under `## User Preferences (verbatim)`;
omit that block if empty. Follow target-repository conventions rather than
imposing framework policy. Tracker support is optional through `lib/tracker.js`;
none means no tracker calls. Only mark a ticket done after merge.

All shell tools and user-installed hooks execute with the user's OS permissions.
This is a workflow discipline boundary, not a sandbox for hostile repository code.
Keep implementation agents separate from the Inspector and Auditor contexts.
