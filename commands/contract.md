---
name: contract
description: "Use when you need to define scope, write an interface contract, or set acceptance criteria before implementation. Creates structured contracts from templates (feature/api/testing/ui/fix)."
argument-hint: "<type>"
# Generic triggers ('scope this', 'what are the requirements') are intentionally muted by user-invocable:false — contract is dispatched by gorkhali:start, not auto-selected from NL. Do not flip this flag without re-checking auto-dispatch safety.
user-invocable: false
---

> **Preamble Tier: T3** — shared contexts per the canonical registry (`scripts/preamble-tier.js`)

# /gorkhali:contract $ARGUMENTS

Create a new contract from template. Valid types: `feature`, `api`, `testing`, `ui`, `fix`.

1. Determine the active ticket from `state/current.json`
2. Read the template from `.claude/contracts/{type}/_template.md` (repo-level) OR use `reference/contract/contract-template.md` (built-in)
3. Fill in known fields from session context (ticket, repo patterns, existing files)
4. Present the draft contract to user for review/edit; open its HTML directly when useful and collect feedback in chat
5. Save to `sessions/{TICKET}/contracts/{type}.html`
6. Optionally copy to `.claude/contracts/{type}/{TICKET}.html` for repo persistence
7. Update session state with contract status
