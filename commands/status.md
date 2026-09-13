---
name: status
description: Read current lifecycle state, blockers, verification freshness, and PR progress.
allowed-tools: ["Read", "Write", "Bash"]
user-invocable: true
---

# Status

Read `../references/lifecycle.md`; call CLI `status`. Report session, current phase, running and
integrated tasks, pending tasks, human decisions, and PR link. Compare checkpoint
and current fingerprints: display verification as stale on any divergence, without
mutating state. A wave notification is informational, not an approval gate.
Show the active preferences layer. Do not infer shipped or merged from task completion.
Include the bound ticket URL (or explicit no-ticket decision), completed tracking
stages, pending update, and tracker error from `tracking`. A created PR does not
imply that the ticket reached In Review, nor does a merged PR imply ticket closure.
