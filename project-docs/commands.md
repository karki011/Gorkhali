# Commands

Every command the native compatibility plugin exposes, with the route it takes.

On Cursor, the `/` menu is the seven user-invocable commands: `/start`, `/pause`, `/resume`, `/verify`, `/review`, `/pr-review`, `/wrap`. Other rows below are skill-chained or hidden from that menu.

| Command | Route | Description |
|---------|-------|-------------|
| `/gorkhali:start` | Entry | Adaptive router → classify → execute appropriate route |
| `/gorkhali:intake` | Entry | Capture originator intent as dual-readable `intent.md`; does not plan or implement |
| `/gorkhali:loop` (alias `/gorkhali:q`) | Entry | Self-contained Jira loop - polls every ticket assigned to you in status "Ready for Implementation" (all projects), triages AC: solid → `/gorkhali:start` to a ready-for-review PR; weak → `/gorkhali:start --to-plan` + Jira comment, then waits for the human to tighten the AC |
| `/gorkhali:verify` | - | Run repo checks, simplify, independent review. Reports failures; never auto-fixes. Review is blocking or advisory |
| `/gorkhali:wrap` | - | Open a ready-for-review PR after `ship-pr` authorization. Does not merge (+ optional `--recap` HTML diff recap) |
| `/gorkhali:close` | - | Post-merge closeout - Jira→Done, finalize+archive session, cleanup branch/worktree, final cost |
| `/gorkhali:greploop` | - | All-author review loop; may skip if Greptile is unavailable; never invents a pass. Wrap invokes it |
| `/gorkhali:fix` | - | Triage failures, assign scoped repairs (loop ceiling owned by `hooks/loop-controller.js`) |
| `/gorkhali:pause` | - | Save session state + emit a portable handoff packet (`handoff.md`) for cold/cross-session continuation |
| `/gorkhali:resume` | - | Restore session from saved state |
| `/gorkhali:detective` | - | Forensic investigation with HTML report |
| `/gorkhali:review` | - | Trigger Auditor quality gate |
| `/gorkhali:visual` | - | Present a UI checklist; optionally run advisory Surveyor with explicit `--surveyor` |
| `/gorkhali:visualflow` | - | Visual flow pass for net-new UI (auto-recommended, user-gated) |
| `/gorkhali:scout` | - | Background research agents |
| `/gorkhali:recruit` | - | Spawn specialist agent (role focus) |
| `/gorkhali:grill` | - | Quiz yourself on the diff before shipping |
| `/gorkhali:contract` | - | Create contract (feature/api/testing/ui/fix) |
| `/gorkhali:brainstorm` | - | Diverge/converge approaches for ambiguous scope (usually auto-invoked by start) |
| `/gorkhali:wire` | - | Map dependency topology → execution waves (auto/optional after plan) |
| `/gorkhali:execute` | - | Execute a saved plan |
| `/gorkhali:learn` | - | Capture a learning mid-session |
| `/gorkhali:evolve` | - | Scan learnings, propose promotions |
| `/gorkhali:health` | - | Diagnose knowledge layer |
| `/gorkhali:eval` | - | Evaluate shadows performance |
| `/gorkhali:validate` | - | Validate plan/output/session |
| `/gorkhali:sessions` | - | List all sessions with status |
| `/gorkhali:status` | - | Current task board |
