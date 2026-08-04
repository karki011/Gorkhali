# Commands

Every command the native compatibility plugin exposes, with the route it takes.

| Command | Route | Description |
|---------|-------|-------------|
| `/phantom:start` | Entry | Adaptive router → classify → execute appropriate route |
| `/phantom:loop` (alias `/phantom:q`) | Entry | Self-contained Jira loop - polls every ticket assigned to you in status "Ready for Implementation" (all projects), triages AC: solid → `/phantom:start` to a draft PR; weak → `/phantom:start --to-plan` + Jira comment, then waits for the human to tighten the AC |
| `/phantom:verify` | - | Power Level with auto-fix for P0/P1 |
| `/phantom:wrap` | - | Commit, push, PR, Jira transition (+ optional `--recap` HTML diff recap) |
| `/phantom:close` | - | Post-merge closeout - Jira→Done, finalize+archive session, cleanup branch/worktree, final cost |
| `/phantom:greploop` | - | Drive a PR to a perfect Greptile review (auto-invoked by wrap) |
| `/phantom:fix` | - | Triage failures, assign scoped repairs (loop ceiling owned by `hooks/loop-controller.js`) |
| `/phantom:pause` | - | Save session state + emit a portable handoff packet (`handoff.md`) for cold/cross-session continuation |
| `/phantom:resume` | - | Restore session from saved state |
| `/phantom:hound` | - | Forensic investigation with HTML report |
| `/phantom:review` | - | Trigger Gaze quality gate |
| `/phantom:visual` | - | Trigger Lens visual inspection |
| `/phantom:visualflow` | - | Visual flow pass for net-new UI (auto-recommended, user-gated) |
| `/phantom:scout` | - | Background research agents |
| `/phantom:recruit` | - | Spawn specialist agent (role focus) |
| `/phantom:grill` | - | Quiz yourself on the diff before shipping |
| `/phantom:contract` | - | Create contract (feature/api/testing/ui/fix) |
| `/phantom:brainstorm` | - | Diverge/converge approaches for ambiguous scope (usually auto-invoked by start) |
| `/phantom:wire` | - | Map dependency topology → execution waves (auto/optional after plan) |
| `/phantom:execute` | - | Execute a saved plan |
| `/phantom:learn` | - | Capture a learning mid-session |
| `/phantom:evolve` | - | Scan learnings, propose promotions |
| `/phantom:health` | - | Diagnose knowledge layer |
| `/phantom:eval` | - | Evaluate shadows performance |
| `/phantom:validate` | - | Validate plan/output/session |
| `/phantom:sessions` | - | List all sessions with status |
| `/phantom:status` | - | Current task board |
