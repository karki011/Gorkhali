---
name: recruit
description: "Use when you need a specialist agent for a one-off implementation, research, or audit job. Spawns an Engineer with a ROLE FOCUS directive ('React specialist'). Net-new work → gorkhali:start."
argument-hint: "<role-focus>"
allowed-tools: ["Agent", "Read", "Bash", "Grep", "Glob", "LS"]
---

> **Preamble Tier: T3** — shared contexts per the canonical registry (`scripts/preamble-tier.js`)

# /gorkhali:recruit $ARGUMENTS

> **Note:** The previous ally recruitment system has been replaced. Chief now spawns Engineer agents with specific ROLE FOCUS directives for specialized work.

1. Parse the requested role focus from arguments (e.g., "data migration", "performance", "security", "accessibility")
2. Load active contracts and session context
3. Per-spawn Engineer lifecycle state is owned by validated hooks
4. Spawn an Engineer with the specified ROLE FOCUS directive baked into the prompt (`subagent_type: "engineer"`, `name: "engineer-mendrik"`, `mode: "bypassPermissions"`) (effort = session `high`; model per `reference/agents.md` → Model Routing)
5. Wait for the Engineer's durable result
6. The Engineer output follows the same Post-Agent Hook as core shadows
7. Record Engineer (ROLE FOCUS) participation in session state
