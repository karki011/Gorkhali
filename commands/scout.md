---
name: phantom:scout
description: "Use when you need context before planning — explore the codebase, understand how something is implemented, map dependencies, or find patterns. Also use when user says 'how is X implemented', 'before we build', 'what does this do', 'how does this work', 'find related code', 'explore', or 'gather context'. NOT for implementation — use phantom:start."
argument-hint: "[area]"
allowed-tools: ["Agent", "Read", "Bash", "Grep", "Glob", "LS"]
---

> **Preamble Tier: T1** — loads '_shared.md' only

# /phantom:scout $ARGUMENTS

Parallel codebase exploration via dedicated scout agents. The main LLM acts as **coordinator** — it determines which areas to explore, spawns parallel scouts, then synthesizes findings.

<instructions>

## Step 1: Determine Scout Areas (Coordinator)

Parse `$ARGUMENTS`:
- If specific area(s) given (e.g., "api", "patterns deps"), use those
- If no area specified, auto-detect from Pre-Plan Hook findings or default to all 5: `design`, `api`, `patterns`, `deps`, `tests`

Resolve TICKET from session state or `git branch --show-current`.

## Step 2: Spawn Scout Agents (Parallel)

Spawn one agent per area. All run in background simultaneously. Each scout is a `subagent_type: "blade"` with a read-only ROLE FOCUS: scout directive baked into the prompt. (model + effort come from the agent definition)

### Design Scout
```
Agent call:
  description: "Scout design: {TICKET}"
  subagent_type: "blade"
  mode: "bypassPermissions"
  run_in_background: true
  prompt: |
    You are a BLADE with ROLE FOCUS: scout (read-only) — design area explorer.
    Target: {TICKET or topic from $ARGUMENTS}

    Find and report:
    - Figma URLs in comments, README, or docs
    - Existing component patterns that match the target area
    - Design tokens in use (colors, spacing, typography)
    - Component composition patterns (how existing UI is structured)
    - Storybook stories or visual tests if they exist

    Return structured JSON:
    {
      "area": "design",
      "figmaUrls": [],
      "existingComponents": [{"path": "", "description": ""}],
      "designTokens": [{"name": "", "value": "", "file": ""}],
      "patterns": [{"name": "", "description": "", "example": ""}]
    }
```

### API Scout
```
Agent call:
  description: "Scout API: {TICKET}"
  subagent_type: "blade"
  mode: "bypassPermissions"
  run_in_background: true
  prompt: |
    You are a BLADE with ROLE FOCUS: scout (read-only) — API area explorer.
    Target: {TICKET or topic from $ARGUMENTS}

    Find and report:
    - Existing API clients and their patterns (REST, GraphQL, fetch wrappers)
    - Endpoint definitions related to the target area
    - Request/response types and schemas
    - Authentication patterns in use
    - Error handling conventions for API calls

    Return structured JSON:
    {
      "area": "api",
      "clients": [{"path": "", "type": "", "description": ""}],
      "endpoints": [{"method": "", "path": "", "file": "", "types": ""}],
      "authPattern": "",
      "errorHandling": "",
      "types": [{"name": "", "file": "", "description": ""}]
    }
```

### Patterns Scout
```
Agent call:
  description: "Scout patterns: {TICKET}"
  subagent_type: "blade"
  mode: "bypassPermissions"
  run_in_background: true
  prompt: |
    You are a BLADE with ROLE FOCUS: scout (read-only) — patterns area explorer.
    Target: {TICKET or topic from $ARGUMENTS}

    Find and report:
    - Custom hooks and their conventions
    - State management patterns (stores, context, signals)
    - Component composition approaches (HOCs, render props, compound components)
    - Form handling patterns
    - Routing patterns and conventions

    Return structured JSON:
    {
      "area": "patterns",
      "hooks": [{"name": "", "file": "", "description": ""}],
      "statePatterns": [{"name": "", "type": "", "file": "", "description": ""}],
      "composition": [{"pattern": "", "example": "", "file": ""}],
      "conventions": [""]
    }
```

### Deps Scout
```
Agent call:
  description: "Scout deps: {TICKET}"
  subagent_type: "blade"
  mode: "bypassPermissions"
  run_in_background: true
  prompt: |
    You are a BLADE with ROLE FOCUS: scout (read-only) — dependency area explorer.
    Target: {TICKET or topic from $ARGUMENTS}

    Find and report:
    - package.json dependencies relevant to the target area
    - Import graph for key modules (what imports what)
    - Shared utilities and helper functions
    - Internal package boundaries (monorepo structure if applicable)
    - Circular dependency risks

    Return structured JSON:
    {
      "area": "deps",
      "relevantPackages": [{"name": "", "version": "", "purpose": ""}],
      "sharedUtils": [{"path": "", "exports": [], "usedBy": []}],
      "importGraph": [{"file": "", "imports": [], "importedBy": []}],
      "packageBoundaries": [{"package": "", "publicApi": "", "path": ""}],
      "risks": [""]
    }
```

### Tests Scout
```
Agent call:
  description: "Scout tests: {TICKET}"
  subagent_type: "blade"
  mode: "bypassPermissions"
  run_in_background: true
  prompt: |
    You are a BLADE with ROLE FOCUS: scout (read-only) — test area explorer.
    Target: {TICKET or topic from $ARGUMENTS}

    Find and report:
    - Test framework and runner in use (jest, vitest, playwright, etc.)
    - Test file naming conventions and locations
    - Existing test factories, builders, or fixtures
    - Mock patterns (manual mocks, MSW handlers, jest.mock)
    - Coverage configuration and thresholds

    Return structured JSON:
    {
      "area": "tests",
      "framework": "",
      "conventions": {"filePattern": "", "location": ""},
      "factories": [{"name": "", "file": "", "description": ""}],
      "mocks": [{"pattern": "", "file": "", "description": ""}],
      "coverage": {"tool": "", "threshold": "", "config": ""}
    }
```

## Step 3: Convergence (Coordinator)

After ALL background scout agents complete:

1. Collect results from each scout agent
2. Synthesize into a unified context document
3. Write `{TEAM_DIR}/sessions/{TICKET}/scout-results.json`:

```json
{
  "_meta": {
    "ticket": "{TICKET}",
    "timestamp": "{ISO timestamp}",
    "areasScanned": ["design", "api", "patterns", "deps", "tests"],
    "scoutCount": 5
  },
  "design": { ... },
  "api": { ... },
  "patterns": { ... },
  "deps": { ... },
  "tests": { ... },
  "crossCutting": {
    "sharedFiles": [],
    "conventionSummary": "",
    "riskAreas": []
  }
}
```

4. Present a brief summary to the user:
   - Key findings per area (1 bullet each)
   - Cross-cutting patterns discovered
   - Risks or gaps identified
   - Recommendation: ready to plan, or needs deeper investigation in specific area

</instructions>

<constraints>

## Rules

- The coordinator does NOT explore the codebase — it delegates entirely to scout agents.
- All scouts run with `run_in_background: true` for parallel execution.
- All scouts spawn as `subagent_type: "blade"` with a read-only ROLE FOCUS: scout directive — model + effort come from the agent definition.
- All agents use `mode: "bypassPermissions"`.
- If only 1 area requested, still spawn as background agent (consistent pattern).
- Scout results feed into planning — write `scout-results.json` so `/phantom:start` can consume it.
- Do not implement anything. Scouts observe and report only.

</constraints>
