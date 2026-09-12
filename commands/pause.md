---
name: pause
description: Stop dispatch and create a stable structured handoff checkpoint.
allowed-tools: ["Agent", "Read", "Write", "Bash"]
user-invocable: true
---

# Pause

Read `../references/lifecycle.md`. Stop dispatching immediately. Collect or stop running Engineers
and record their worktree paths, task IDs, commits, uncommitted files, and blockers
in progress. Preserve incomplete work; do not integrate or clean up silently.
Clear `activeEngineers` only after they have stopped. Call CLI `pause`, which
refuses a stable pause while Engineers remain active. The checkpoint preserves
the next valid transition, wave, Git identity, task state, and verification.
Report the phase and resume hint. Pause improves recovery; it is never required.
