---
name: contract
description: "Use when you need to define scope, write an interface contract, or create acceptance criteria before implementation. Creates structured contracts from templates (feature/api/testing/ui/fix) that agents must satisfy. Also use when user says 'define the interface', 'what are the requirements', 'scope this', or 'acceptance criteria'."
argument-hint: "<type>"
# Generic triggers ('scope this', 'what are the requirements') are intentionally muted by user-invocable:false — contract is dispatched by phantom:start, not auto-selected from NL. Do not flip this flag without re-checking auto-dispatch safety.
user-invocable: false
---

> **Preamble Tier: T3** — loads '_shared.md' + '_shared-shadows.md' + '_shared-discipline.md' + '_shared-contracts.md'

# /phantom:contract $ARGUMENTS

Create a new contract from template. Valid types: `feature`, `api`, `testing`, `ui`, `fix`.

1. Determine the active ticket from `state/current.json`
2. Read the template from `.claude/contracts/{type}/_template.md` (repo-level) OR use `reference/contract/contract-template.md` (built-in)
3. Fill in known fields from session context (ticket, repo patterns, existing files)
4. Present the draft contract to user for review/edit; open its HTML directly when useful and collect feedback in chat
5. Save to `sessions/{TICKET}/contracts/{type}.html`
6. Optionally copy to `.claude/contracts/{type}/{TICKET}.html` for repo persistence
7. Update session state with contract status
