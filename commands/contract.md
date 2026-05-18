---
name: team:contract
description: Create contract from template (feature/api/testing/ui/fix)
argument-hint: "<type>"
---

> **Preamble Tier: T3** — loads '_shared.md' + '_shared-crew.md' + '_shared-superpowers.md' + '_shared-contracts.md'

# /team:contract $ARGUMENTS

Create a new contract from template. Valid types: `feature`, `api`, `testing`, `ui`, `fix`.

1. Determine the active ticket from `state/current.json`
2. Read the template from `.claude/contracts/{type}/_template.md` (repo-level) OR use built-in template
3. Fill in known fields from session context (ticket, repo patterns, existing files)
4. Present the draft contract to user for review/edit
5. Save to `sessions/{TICKET}/contracts/{type}.md`
6. Optionally copy to `.claude/contracts/{type}/{TICKET}.md` for repo persistence
7. Update session state with contract status
