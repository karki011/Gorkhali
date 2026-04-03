---
name: team:recruit
description: Bring in a temporary ally
argument-hint: "<ally>"
---

> Load `_shared.md` + `_shared-crew.md` before executing.

# /team:recruit $ARGUMENTS

Bring in a temporary ally for specialized work.

1. Validate the ally name against the registry: `jinbe`, `jinbe-data`, `brook`, `law`, `shanks`, `yamato`, `vivi`, `ace`, `sabo`, `marco`
2. Load ally definition from `.claude/agents/allies/{name}.md`
3. Load active contracts and session context
4. Spawn the ally with their persona, specialty, and relevant contract sections
5. Ally output follows the same Post-Agent Hook as core crew
6. Record ally participation in session state
