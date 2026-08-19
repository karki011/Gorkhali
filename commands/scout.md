---
name: scout
description: "Use when you need context before planning — explore the codebase, understand how something is implemented, map dependencies, or find patterns. Also use when user says 'how is X implemented', 'before we build', 'what does this do', 'how does this work', 'find related code', 'explore', or 'gather context'. NOT for implementation — use phantom:start."
argument-hint: "[area]"
allowed-tools: ["Agent", "Read", "Bash", "Grep", "Glob", "LS"]
---

> **Preamble Tier: T1** — loads '_shared.md' only

# /phantom:scout $ARGUMENTS

Parallel codebase exploration via scout agents. Main LLM = **coordinator**: picks areas, spawns parallel scouts, synthesizes.

<instructions>

## Step 1: Determine Scout Areas (Coordinator)

Parse `$ARGUMENTS`:
- Specific area(s) given (e.g. "api", "patterns deps") → use those.
- None → auto-detect from Pre-Plan Hook findings, else default all 5: `design`, `api`, `patterns`, `deps`, `tests`.

Resolve TICKET from session state or `git branch --show-current`.

## Step 1.5: Brain Recall (Optional)

On-demand only — never preloaded. Coordinator MAY grep `{TEAM_DIR}/brain/cards/`
for cards matching TICKET or the target area's file paths (recipes: `_shared-brain.md`).
Matched card `id`s go into each scout's prompt as extra context; cite them in
`scout-results.json` `crossCutting`. No matches → proceed without mention.

## Step 2: Spawn Scout Agents (Parallel)

One agent per area, all in background simultaneously. Each: `subagent_type: "engineer"`, `name:` per `reference/roster.md` slot table - consecutive `scout-*` slots in area order (`scout-pember`, `scout-quade`, `scout-ranthe`, `scout-saldur`, `scout-teviss` for the 5 default areas: design, api, patterns, deps, tests), `mode: "bypassPermissions"`, `run_in_background: true`, `description: "Scout {area}: {TICKET}"` (effort = session `high`; model per `reference/agents.md` → Model Routing).

Areas come from `$ARGUMENTS`, so the area count is user-unbounded: a 6th or later area takes bare roster-length overflow (`scout-10`, `scout-11`, ...), never `scout-6`. The derivation and the reason slots 6-9 are off-limits here are `reference/roster.md` Rule 3 (Overflow) plus its `scout.md` row in the Spawn-Site Slot Table.

Prompt template per scout:
```
You are an ENGINEER with ROLE FOCUS: scout (read-only) — {area} area explorer.
Target: {TICKET or topic from $ARGUMENTS}
Find and report: {find-list}
Return structured JSON: {schema}
```

**Design** — find: Figma URLs in comments/README/docs; existing component patterns matching target; design tokens in use (colors, spacing, typography); component composition patterns (how UI is structured); Storybook stories/visual tests.
Schema: `{"area":"design","figmaUrls":[],"existingComponents":[{"path":"","description":""}],"designTokens":[{"name":"","value":"","file":""}],"patterns":[{"name":"","description":"","example":""}]}`

**API** — find: existing API clients + patterns (REST, GraphQL, fetch wrappers); endpoint defs for target; request/response types + schemas; auth patterns; API error-handling conventions.
Schema: `{"area":"api","clients":[{"path":"","type":"","description":""}],"endpoints":[{"method":"","path":"","file":"","types":""}],"authPattern":"","errorHandling":"","types":[{"name":"","file":"","description":""}]}`

**Patterns** — find: custom hooks + conventions; state mgmt patterns (stores, context, signals); composition approaches (HOCs, render props, compound components); form handling; routing patterns/conventions.
Schema: `{"area":"patterns","hooks":[{"name":"","file":"","description":""}],"statePatterns":[{"name":"","type":"","file":"","description":""}],"composition":[{"pattern":"","example":"","file":""}],"conventions":[""]}`

**Deps** — find: package.json deps relevant to target; import graph for key modules (what imports what); shared utils/helpers; internal package boundaries (monorepo if applicable); circular dependency risks.
Schema: `{"area":"deps","relevantPackages":[{"name":"","version":"","purpose":""}],"sharedUtils":[{"path":"","exports":[],"usedBy":[]}],"importGraph":[{"file":"","imports":[],"importedBy":[]}],"packageBoundaries":[{"package":"","publicApi":"","path":""}],"risks":[""]}`

**Tests** — find: test framework/runner (jest, vitest, playwright, etc.); test file naming conventions + locations; existing factories/builders/fixtures; mock patterns (manual mocks, MSW handlers, jest.mock); coverage config + thresholds.
Schema: `{"area":"tests","framework":"","conventions":{"filePattern":"","location":""},"factories":[{"name":"","file":"","description":""}],"mocks":[{"pattern":"","file":"","description":""}],"coverage":{"tool":"","threshold":"","config":""}}`

## Step 3: Convergence (Coordinator)

After ALL background scouts complete:

1. Collect each scout's results.
2. Synthesize into unified context doc.
3. Write `{TEAM_DIR}/sessions/{TICKET}/scout-results.json`:
```json
{
  "_meta": { "ticket": "{TICKET}", "timestamp": "{ISO timestamp}", "areasScanned": ["design","api","patterns","deps","tests"], "scoutCount": 5 },
  "design": { ... }, "api": { ... }, "patterns": { ... }, "deps": { ... }, "tests": { ... },
  "crossCutting": { "sharedFiles": [], "conventionSummary": "", "riskAreas": [] }
}
```
4. Present brief summary: key findings per area (1 bullet each); cross-cutting patterns; risks/gaps; recommendation (ready to plan, or needs deeper investigation in specific area).

</instructions>

<constraints>

## Rules

- Coordinator does NOT explore — delegates entirely to scout agents.
- All scouts `run_in_background: true` (parallel).
- All scouts `subagent_type: "engineer"` with read-only ROLE FOCUS: scout directive — named from the `scout` roster row, not `engineer` (see `reference/roster.md`); routing per Step 2.
- All agents `mode: "bypassPermissions"`.
- Only 1 area requested → still spawn as background agent (consistent pattern).
- Scout results feed planning — write `scout-results.json` so `/phantom:start` can consume it.
- Do not implement. Scouts observe and report only.

</constraints>
