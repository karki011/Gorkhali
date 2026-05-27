---
name: phantom:arise
description: "Use when you need a specialized agent for a specific task outside the normal flow — a one-off implementation, research, audit, or focused coding job. Spawns a Blade agent with a ROLE FOCUS directive (e.g., 'React specialist', 'Go backend', 'test writer', 'accessibility expert', 'performance auditor', 'security reviewer'). Also use when user says 'spawn an agent', 'I need help with', 'get someone to', 'specialist for', 'expert on', or 'audit this'."
argument-hint: "<role-focus>"
---

> **Preamble Tier: T3** — loads '_shared.md' + '_shared-shadows.md' + '_shared-discipline.md' + '_shared-contracts.md'

# /phantom:arise $ARGUMENTS

> **Note:** The previous ally recruitment system has been replaced. Apex now spawns Blade agents with specific ROLE FOCUS directives for specialized work.

1. Parse the requested role focus from arguments (e.g., "data migration", "performance", "security", "accessibility")
2. Load active contracts and session context
3. Apex spawns a Blade with the specified ROLE FOCUS directive baked into the prompt
4. The Blade output follows the same Post-Agent Hook as core shadows
5. Record Blade (ROLE FOCUS) participation in session state
