---
name: team:recruit
description: "Use when you need a specialized agent for a specific task outside the normal flow — a one-off implementation, research, or focused coding job. Spawns a Spark agent with a ROLE FOCUS directive (e.g., 'React specialist', 'Go backend', 'test writer'). Also use when user says 'spawn an agent', 'I need help with', 'get someone to', or 'specialist for'."
argument-hint: "<role-focus>"
---

> **Preamble Tier: T3** — loads '_shared.md' + '_shared-crew.md' + '_shared-superpowers.md' + '_shared-contracts.md'

# /team:recruit $ARGUMENTS

> **Note:** The previous ally recruitment system has been replaced. Cortex now spawns Spark agents with specific ROLE FOCUS directives for specialized work.

1. Parse the requested role focus from arguments (e.g., "data migration", "performance", "security", "accessibility")
2. Load active contracts and session context
3. Cortex spawns a Spark with the specified ROLE FOCUS directive baked into the prompt
4. The Spark output follows the same Post-Agent Hook as core crew
5. Record Spark (ROLE FOCUS) participation in session state
