---
name: team:scout
description: "Use when you need context before planning — explore the codebase, understand how something is implemented, map dependencies, or find patterns. Also use when user says 'how is X implemented', 'before we build', 'what does this do', 'how does this work', 'find related code', 'explore', or 'gather context'. NOT for implementation — use team:start."
argument-hint: "[area]"
---

> **Preamble Tier: T1** — loads '_shared.md' only

# /team:scout $ARGUMENTS

Run background scouts to fill context gaps. Areas: `design`, `api`, `patterns`, `deps`, `tests`.

1. If no area specified, auto-detect from Pre-Plan Hook findings
2. Spawn explorer agents (run_in_background: true) to:
   - `design`: Scan for Figma URLs, existing component patterns, design tokens
   - `api`: Scan for existing API clients, endpoint patterns, types
   - `patterns`: Scan for existing hooks, state patterns, composition approaches
   - `deps`: Check package.json, import graph, shared utilities
   - `tests`: Scan for existing test patterns, factories, mocks
3. Scouts report findings as structured context for planning
4. Update session state with scout results
