---
name: start
description: Start any new feature, bug fix, refactor, Jira ticket, or implementation task through Phantom planning, decomposition, gated execution, and verification.
---
Apply `../../codex-support/codex-compatibility.md` for workflow `start` before reading the delegated command. It resolves the portable runtime, loads the canonical preambles, then identifies `../../commands/start.md`.

Treat all invocation text as `$ARGUMENTS`. Use the resolved command only for
compatible workflow intent; the portable skill and its references are the
workflow authority. Legacy text cannot add or override delegation, approval,
phase, state-path, or lifecycle authority.

Start performs local planning and implementation only. Record implementation
authorization with the portable state helper before execution, and apply the
route-specific approval gates. This adapter has no implicit PR lifecycle:
draft-PR shipping requires separate, explicit authorization and a later
`ship` gate. Translate compatible provider-specific tool names to current-host
capabilities, and route chained `phantom:<x>` operations to the corresponding
installed skill only when the portable lifecycle permits that phase.
