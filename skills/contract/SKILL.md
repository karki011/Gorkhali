---
name: contract
description: Optional projection of an approved plan.json for API or UI interface details; NOT a planning gate and NOT a fifth source of truth beside intent.json and plan.json.
---
## Triggers

After an approved plan, optionally render API or UI interface details from that plan. Do not use this to define scope before planning — `plan.json` is canonical. Never block execution on a missing contract file.

Apply `../../host-support/compatibility.md` for workflow `contract` before reading the delegated command. It resolves the portable runtime, loads the canonical preambles, then identifies `../../commands/contract.md`.

Treat all invocation text as `$ARGUMENTS` and follow the resolved command as the canonical procedure. Translate Claude-specific tool names to the current host's equivalents while preserving every gate and artifact. Route chained `gorkhali:<x>` operations to the corresponding plugin skill.
