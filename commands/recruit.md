---
name: recruit
description: "Use when you need a specialized agent for a specific task outside the normal flow — a one-off implementation, research, audit, or focused coding job. Spawns an Engineer agent with a ROLE FOCUS directive (e.g., 'React specialist', 'Go backend', 'test writer', 'accessibility expert', 'performance auditor', 'security reviewer'). Also use when user says 'spawn an agent', 'spawn a specialist', 'get a specialist for', 'expert on', or 'audit this with an agent'. NOT for generic 'I need help' — net-new work routes to phantom:start."
argument-hint: "<role-focus>"
allowed-tools: ["Agent", "Read", "Bash", "Grep", "Glob", "LS"]
---

> **Preamble Tier: T3** — loads '_shared.md' + '_shared-shadows.md' + '_shared-discipline.md' + '_shared-contracts.md'

# /phantom:recruit $ARGUMENTS

> **Note:** The previous ally recruitment system has been replaced. Chief now spawns Engineer agents with specific ROLE FOCUS directives for specialized work.

1. Parse the requested role focus from arguments (e.g., "data migration", "performance", "security", "accessibility")
2. Load active contracts and session context
3. Per-spawn Engineer lifecycle state is owned by validated hooks
4. Spawn an Engineer with the specified ROLE FOCUS directive baked into the prompt (`subagent_type: "engineer"`, `name: "engineer-mendrik"`, `mode: "bypassPermissions"`) (effort = session `high`; model per `reference/agents.md` → Model Routing)
5. Wait for the Engineer's durable result
6. The Engineer output follows the same Post-Agent Hook as core shadows
7. Record Engineer (ROLE FOCUS) participation in session state
