# Handbook: Planning Reference

## Scout Missions (Phase B — Background Research)

During planning, when you identify knowledge gaps, spawn research scouts in the background.
The main conversation CONTINUES with the user while scouts gather intel.

### When to Scout

| Knowledge Gap | Scout Agent | Model | What They Do |
|---|---|---|---|
| Need BE API schema/types | Spark (Backend Coord focus) (or general-purpose) | `sonnet` | Read BE repo/API docs, extract contracts, return TypeScript types |
| Need to understand existing FE patterns | Spark (React Arch focus) | `sonnet` | Explore codebase for reusable hooks/components, return inventory |
| Need design specs from Figma | Lens | `sonnet` | Extract specs via Figma MCP, return component specs |
| Need to check legacy code | Spark (Migration focus) | `sonnet` | Survey legacy codebase for migration scope |
| Need to check if feature exists elsewhere | Any crew | `sonnet` | Search codebase for similar implementations |

### How to Scout

1. **Identify the gap** during Phase B planning conversation
2. **Spawn scout** with `run_in_background: true` and a descriptive `name` (e.g., "spark-be-scout")
3. **Continue planning** with the user — don't block on scout results
4. **When scout returns**, incorporate findings into the plan
5. If plan is finalized before scout returns, **wait for scout data** before finalizing API contracts

### FE ↔ BE Coordination Pattern

For cross-stack features:
1. Spawn Spark (Backend Coord focus) to read the BE codebase (provide repo path or API docs URL)
2. Spark (Backend Coord focus) returns: endpoint shapes, response types, error codes, auth requirements
3. Cortex creates a `contracts/api/` file with aligned FE types
4. Spark (API focus) implements the hooks matching the discovered BE contract
5. Spark (React Arch focus) designs the data flow from API → domain → UI

### Scout Rules
- Scouts ALWAYS use `run_in_background: true`
- Scouts ALWAYS have a descriptive `name` for tracking
- Scouts return structured data (types, schemas, file inventories) — not prose
- If a scout fails or times out, fall back to asking the user

## Workflow Detection

| Signals | Workflow | Pattern |
|---|---|---|
| "build/create/add", branch `feat/` | Feature Build | Fan-out parallel |
| "fix/bug/crash", branch `fix/` | Bug Fix | Pipeline: diagnose → fix → verify |
| "review/audit/check" | Code Review | Parallel analysis → synthesized report |
| "refactor/migrate", branch `refactor/` | Refactor | Snapshot → restructure → verify |

## Decision Capture

**Quick decisions** → append one row to `decisions/index.md`:
```markdown
| D14 | Short description of decision | 2026-03-25 | Active |
```

**Complex decisions** (with rationale, trade-offs, references) → also create `decisions/adr/D14-short-name.md`:
```markdown
# D14: Short description
**Date**: 2026-03-25 | **Status**: Active
## Decision
What was chosen.
## Why
Context and rationale.
## Alternatives considered
What was rejected and why.
```
