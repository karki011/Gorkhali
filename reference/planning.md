# Planning Protocol

## Intent Capture (mandatory)

```
Goal:            [success in one sentence]
Done When:       [machine-checkable exit conditions — verifiable predicates]
Priority:        [speed | quality | ux | stability | scope — ranked]
Tradeoffs:       [what CAN be sacrificed]
Non-negotiables: [what MUST NOT be compromised]
```

Done When sourcing:
1. Jira acceptance criteria (if available) → default
2. Ask user explicitly → required if no Jira
3. Format as verifiable predicates ("tests pass", "lint clean", "endpoint returns 200")

## Rival (mandatory, every plan)

Spawn sage agent (opus, no tools, blocking):
- Input: complete plan + coding principles
- Output: Challenges (must address), Warnings (consider), Verdict
- PROCEED → continue. REVISE → address + re-run. RETHINK → back to research.
- Max 2 iterations. Still RETHINK → escalate to user.

## Codebase Research

Spawn Explore (opus) + Plan (opus) agents for:
- File structure and patterns
- Existing similar implementations
- Import/dependency chains

## Anti-Repetition Check

Before finalizing plan:
1. Scan `learnings/INDEX.md` for matching corrections
2. `[failed]` entries → acknowledge, explain difference, or choose alternative
3. Log matches in plan under anti-repetition notes

## SOLO vs SHADOWS Decision

See `reference/agents.md` for routing table.

---

## Plan Quality Rules

### Machine-Checkable Acceptance Criteria

Every `doneWhen` entry in `intent.json` must be verifiable by one of:

| Type | Form |
|------|------|
| Test command | `pnpm test:changed` exits 0 |
| Lint/build | `pnpm lint && pnpm build` exits 0 |
| File existence | `[ -f src/foo.ts ]` |
| Grep match | `grep -r "export.*FooComponent" src/` finds a result |
| API/CLI output | `curl localhost:3000/health` returns `{"status":"ok"}` |
| Snapshot/diff | `git diff --name-only` includes expected file |

**Banned forms** (plan fails immediately if any appear):

```
TBD / TODO / TBC
"similar to Task N"
"etc." / "and so on"
"as needed" / "if necessary" / "where appropriate"
"appropriate error handling"
"proper validation"
"update tests accordingly"
```

If any appear in `doneWhen`, `description`, or `action` fields — the plan is incomplete. Rewrite the criterion as a command or observable fact.

### Requirement Coverage

Before finalizing `plan.json`, trace every `doneWhen` entry to at least one task:

```
intent.doneWhen[i]  →  plan.tasks[j].description  (must match)
```

A `doneWhen` with no matching task is a coverage gap — it will not be verified. Either add a task or remove the criterion.

### Placeholder Prohibition

The apex agent MUST reject `plan.json` with `verdict: REVISE` if:
- Any task `description` contains banned terms above
- Any `doneWhen` is not independently verifiable (no command, no file, no grep)
- Any task has `files: []` (every task must touch at least one file)
- `dependsOn` references a non-existent task ID

---

## Task Structure Template

Each entry in `plan.json → tasks[]` must follow this shape (see `artifact-schemas.md` for full schema):

```json
{
  "id": "T1",
  "description": "Add useCostByTag hook that calls /api/cost-by-tag and memoizes result",
  "read_first": [
    "src/hooks/useCostData.ts",
    "src/api/client.ts"
  ],
  "acceptance_criteria": [
    "grep -r 'export.*useCostByTag' src/hooks/ finds exactly one match",
    "pnpm test -- useCostByTag exits 0",
    "Hook returns { data, loading, error } matching CostByTagResponse type"
  ],
  "action": "Create src/hooks/useCostByTag.ts with memoized selector, error boundary, and TypeScript types",
  "verify": "pnpm test:changed && pnpm lint",
  "files": ["src/hooks/useCostByTag.ts", "src/hooks/useCostByTag.test.ts"],
  "dependsOn": [],
  "agent": "backend"
}
```

**Field rules:**

| Field | Rule |
|-------|------|
| `read_first` | Files the agent reads BEFORE writing. Prevents blind edits. |
| `acceptance_criteria` | Each item is a shell command or observable fact. Never prose. |
| `action` | One sentence. Subject = what file. Verb = what operation. No "etc." |
| `verify` | Single command that exits 0 on success. Must be runnable by Ward. |
| `files` | Non-empty. Files agent is expected to create or modify. |

> `read_first` and `acceptance_criteria` are extensions to the base `plan.json` schema.
> Agents read them from the task object; Ward reads `acceptance_criteria` to validate task completion.
