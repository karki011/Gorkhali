---
name: team:contract
description: "Use when you need to define scope, write an interface contract, or create acceptance criteria before implementation. Creates structured contracts from templates (feature/api/testing/ui/fix) that agents must satisfy. Also use when user says 'define the interface', 'what are the requirements', 'scope this', or 'acceptance criteria'."
argument-hint: "<type>"
---

> **Preamble Tier: T3** — loads '_shared.md' + '_shared-crew.md' + '_shared-discipline.md' + '_shared-contracts.md'

# /team:contract $ARGUMENTS

Create a new contract from template. Valid types: `feature`, `api`, `testing`, `ui`, `fix`.

1. Determine the active ticket from `state/current.json`
2. Read the template from `.claude/contracts/{type}/_template.md` (repo-level) OR use built-in template
3. Fill in known fields from session context (ticket, repo patterns, existing files)
4. Present the draft contract to user for review/edit
5. Save to `sessions/{TICKET}/contracts/{type}.md`
6. Optionally copy to `.claude/contracts/{type}/{TICKET}.md` for repo persistence
7. Update session state with contract status
