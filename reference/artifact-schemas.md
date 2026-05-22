# Team Skill v2 — Artifact Schemas

Canonical schemas for all file-based artifacts used in the team skill v2 system.
A validation hook enforces these shapes at write time.

---

## `_meta` (required on every artifact)

Every artifact JSON must include a `_meta` object at the top level.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| writtenAt | ISO 8601 string | yes | When artifact was written |
| gitHead | string | yes | Git HEAD sha at write time |
| gitBranch | string | yes | Current branch name |
| phase | string | yes | Phase that wrote this (`A`, `B`, `C`, `D`, `verify`, `wrap`) |
| skill | string | yes | Skill that wrote this (`team:start`, `team:pause`, etc.) |
| version | number | yes | Schema version (start at `1`) |

**Example:**
```json
{
  "_meta": {
    "writtenAt": "2026-05-22T14:30:00Z",
    "gitHead": "abc1234",
    "gitBranch": "feat/my-ticket",
    "phase": "B",
    "skill": "team:start",
    "version": 1
  }
}
```

---

## `pause-state.json`

Written by `team:pause`. Read by `team:resume` to restore context.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| ticket | string | yes | Jira ticket key or task ID |
| phase | string (`A`/`B`/`C`/`D`) | yes | Phase where work was paused |
| phaseStep | string | no | Sub-step within the phase |
| status | `"paused"` | yes | Always `"paused"` |
| intent | string | no | File path to `intent.json` |
| plan | string | no | File path to `plan.json` |
| contracts | string[] | no | File paths to contract files |
| contractsCompleted | string[] | no | Contract IDs already fulfilled |
| contractsPending | string[] | no | Contract IDs still pending |
| route | `"solo"` \| `"crew"` | no | Execution route chosen in phase B |
| verifyStatus | `"pass"` \| `"fail"` \| `null` | no | Result of last verify run |
| resumeNotes | string | yes | Human-readable context for resume |

**Example:**
```json
{
  "_meta": { "...": "..." },
  "ticket": "ENG-1234",
  "phase": "C",
  "phaseStep": "agent-spawn",
  "status": "paused",
  "intent": "~/.claude/team/state/sessions/ENG-1234/intent.json",
  "plan": "~/.claude/team/state/sessions/ENG-1234/plan.json",
  "contracts": ["~/.claude/team/state/sessions/ENG-1234/contracts/api.md"],
  "contractsCompleted": [],
  "contractsPending": ["api.md"],
  "route": "crew",
  "verifyStatus": null,
  "resumeNotes": "Paused mid-spawn; frontend agent finished, backend pending."
}
```

---

## `verification.json`

Written by `team:verify`. Read by `team:wrap` to decide PR strategy.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| correctness | object | yes | Mechanical checks (lint, build, tests) |
| correctness.lint | boolean | yes | Lint passed |
| correctness.build | boolean | yes | Build passed |
| correctness.tests | boolean | yes | Tests passed |
| correctness.commands | string[] | yes | Commands actually run |
| review | object | yes | Self-review results |
| review.temperature | number | yes | Reviewer strictness (0–1) |
| review.findings | object[] | yes | Array of finding objects |
| review.fixLoops | number | yes | How many fix/re-verify loops ran |
| simplifyRan | boolean | yes | Whether simplify was run on changed files |
| intentAlignment | `"aligned"` \| `"drift"` \| `"wrong"` | yes | How well output matches intent.json |
| verdict | `"pass"` \| `"fail"` | yes | Overall gate result |
| score | number (0–10) | no | Numeric quality score |

**Example:**
```json
{
  "_meta": { "...": "..." },
  "correctness": {
    "lint": true,
    "build": true,
    "tests": true,
    "commands": ["pnpm lint", "pnpm build", "pnpm test:changed"]
  },
  "review": {
    "temperature": 0.7,
    "findings": [
      { "file": "src/foo.ts", "line": 42, "severity": "warn", "message": "Unused import" }
    ],
    "fixLoops": 1
  },
  "simplifyRan": true,
  "intentAlignment": "aligned",
  "verdict": "pass",
  "score": 8
}
```

---

## `wrap.json`

Written by `team:wrap` after all post-merge actions complete.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| pr | object \| `null` | yes | PR details, or null if no PR |
| pr.number | number | yes | PR number |
| pr.url | string | yes | PR URL |
| pr.status | string | yes | PR status (e.g., `"open"`, `"merged"`) |
| jira | object \| `null` | no | Jira update result |
| jira.ticket | string | yes (if present) | Ticket key |
| jira.transition | string | yes (if present) | Transition applied |
| jira.commented | boolean | yes (if present) | Whether comment was posted |
| greptile | object \| `null` | no | Greptile review result |
| greptile.requested | boolean | yes (if present) | Whether review was requested |
| greptile.status | string | yes (if present) | `"pending"`, `"done"`, `"skipped"` |
| learnings | object | yes | Learning record actions |
| learnings.recorded | string[] | yes | Learnings written this session |
| learnings.promoted | string[] | yes | Learnings promoted to validated |
| learnings.pruned | string[] | yes | Stale learnings removed |

**Example:**
```json
{
  "_meta": { "...": "..." },
  "pr": {
    "number": 1042,
    "url": "https://github.com/org/repo/pull/1042",
    "status": "open"
  },
  "jira": {
    "ticket": "ENG-1234",
    "transition": "In Review",
    "commented": true
  },
  "greptile": {
    "requested": true,
    "status": "pending"
  },
  "learnings": {
    "recorded": ["Use duck-type checks across module boundaries"],
    "promoted": [],
    "pruned": []
  }
}
```

---

## `context.json`

Written by Phase A (`team:start`). Provides ticket context for all downstream phases.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| ticket | string | yes | Ticket key or task label |
| summary | string | yes | Human-readable ticket summary |
| source | `"jira"` \| `"args"` \| `"branch"` | yes | Where context was sourced from |
| jira | object \| `null` | no | Raw Jira issue fields (if source=jira) |
| learningsRefs | string[] | no | Paths to relevant learning files |
| phantomStrategy | string | no | Strategy from phantom_orchestrator_process |
| blastRadius | string[] | no | Files flagged by phantom_graph_blast_radius |
| modelOverride | string \| `null` | no | Force a specific model for spawns |

**Example:**
```json
{
  "_meta": { "...": "..." },
  "ticket": "ENG-1234",
  "summary": "Add cost-per-tag breakdown to the dashboard",
  "source": "jira",
  "jira": { "status": "In Progress", "priority": "High" },
  "learningsRefs": ["~/.claude/team/repos/feature-web-apps/learnings/frontend.md"],
  "phantomStrategy": "decompose",
  "blastRadius": ["src/components/Dashboard.tsx", "src/hooks/useCostData.ts"],
  "modelOverride": null
}
```

---

## `intent.json`

Written by Phase B (`team:start`). Defines the goal contract for verify and wrap.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| goal | string | yes | Single clear goal statement |
| doneWhen | string[] | yes | Acceptance criteria (observable, testable) |
| priority | string[] | yes | Ordered implementation priorities |
| tradeoffs | string[] | no | Acknowledged tradeoffs |
| nonNegotiables | string[] | no | Hard constraints that must not be violated |

**Example:**
```json
{
  "_meta": { "...": "..." },
  "goal": "Render a cost-per-tag breakdown table below the existing cost summary",
  "doneWhen": [
    "Table renders with correct tag keys and summed costs",
    "Loading and empty states are handled",
    "Existing tests pass; new snapshot test added"
  ],
  "priority": [
    "Correctness of cost rollup",
    "Accessible table markup",
    "Performance — avoid redundant API calls"
  ],
  "tradeoffs": ["No pagination for now; defer until >50 tags is common"],
  "nonNegotiables": ["No new dependencies without approval"]
}
```

---

## `plan.json`

Written by Phase B after devil's advocate review. Drives Phase C execution.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| route | `"solo"` \| `"crew"` | yes | Whether to spawn agents or work inline |
| devilsAdvocateVerdict | `"PROCEED"` \| `"REVISE"` \| `"RETHINK"` | yes | Grill gate outcome |
| tasks | object[] | yes | Ordered list of task objects |
| tasks[].id | string | yes | Unique task ID |
| tasks[].description | string | yes | What this task does |
| tasks[].files | string[] | yes | Files expected to be touched |
| tasks[].dependsOn | string[] | no | Task IDs this task must wait for |
| tasks[].agent | string | no | Agent role for crew route |
| antiRepetition | string[] | no | Patterns to avoid (from learnings) |
| estimatedSpawns | number | no | Expected agent count for crew route |

**Example:**
```json
{
  "_meta": { "...": "..." },
  "route": "crew",
  "devilsAdvocateVerdict": "PROCEED",
  "tasks": [
    {
      "id": "T1",
      "description": "Add useCostByTag hook",
      "files": ["src/hooks/useCostByTag.ts"],
      "dependsOn": [],
      "agent": "backend"
    },
    {
      "id": "T2",
      "description": "Build CostByTagTable component",
      "files": ["src/components/CostByTagTable.tsx"],
      "dependsOn": ["T1"],
      "agent": "frontend"
    }
  ],
  "antiRepetition": ["Do not use instanceof across module boundaries"],
  "estimatedSpawns": 2
}
```

---

## `execution.json`

Written by Phase C after agents complete. Summarizes what was actually done.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| tasks | object[] | yes | Per-task execution results |
| tasks[].id | string | yes | Task ID from plan.json |
| tasks[].status | `"done"` \| `"failed"` \| `"skipped"` | yes | Final task status |
| tasks[].agent | string | no | Agent that ran this task |
| tasks[].filesChanged | string[] | yes | Files actually modified |
| tasks[].selfReviewScore | number | no | Agent's self-review score (0–10) |
| tasks[].outputSummary | string | yes | 1–2 sentence summary of what was done |
| totalSpawns | number | yes | Total agent instances spawned |
| agentOutputs | string | no | Path to raw agent output logs |

**Example:**
```json
{
  "_meta": { "...": "..." },
  "tasks": [
    {
      "id": "T1",
      "status": "done",
      "agent": "backend",
      "filesChanged": ["src/hooks/useCostByTag.ts"],
      "selfReviewScore": 9,
      "outputSummary": "Hook added with memoized selector and error boundary."
    },
    {
      "id": "T2",
      "status": "done",
      "agent": "frontend",
      "filesChanged": ["src/components/CostByTagTable.tsx", "src/components/CostByTagTable.test.tsx"],
      "selfReviewScore": 8,
      "outputSummary": "Table renders with loading/empty states; snapshot test added."
    }
  ],
  "totalSpawns": 2,
  "agentOutputs": "~/.claude/team/state/sessions/ENG-1234/agent-logs/"
}
```

---

## Schema Versioning

- `version` starts at `1`.
- Increment when fields are added or semantics change.
- Breaking changes (field removal, type change) require a major version bump and migration note here.
- The validation hook reads `_meta.version` to apply the correct validator.
