---
name: team:recruit
description: Spawn a Spark with ROLE FOCUS directive
argument-hint: "<role-focus>"
---

> Load `_shared.md` + `_shared-crew.md` before executing.

# /team:recruit $ARGUMENTS

> **Note:** The previous ally recruitment system has been replaced. Cortex now spawns Spark agents with specific ROLE FOCUS directives for specialized work.

1. Parse the requested role focus from arguments (e.g., "data migration", "performance", "security", "accessibility")
2. Load active contracts and session context
3. Cortex spawns a Spark with the specified ROLE FOCUS directive baked into the prompt
4. The Spark output follows the same Post-Agent Hook as core crew
5. Record Spark (ROLE FOCUS) participation in session state
