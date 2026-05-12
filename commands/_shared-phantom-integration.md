# Team Skill Crew -- Phantom AI Integration (Optional)

> Loaded by commands that benefit from graph intelligence.
> Always load `_shared.md` first. ALL phantom tools are OPTIONAL — skill degrades gracefully without them.

---

## Availability Check

Before any phantom tool call, check if the MCP server is registered:

```
PHANTOM_AVAILABLE = phantom_list_projects succeeds (returns project list)
```

If `phantom_list_projects` fails or is not a registered tool → set `PHANTOM_AVAILABLE = false` and skip ALL phantom integration. Never block the workflow on phantom availability.

---

## Integration Points

### Phase A — Graph Readiness

**When:** Session starts, before codebase exploration.
**If available:** Call `phantom_graph_build` to trigger async index rebuild, then continue (don't wait).
**If not:** Skip. Codebase exploration uses Grep/Glob/Read as usual.

### Phase B — Strategy-Informed Routing

**When:** After task assessment, before SOLO/CREW decision.
**If available:**
```
phantom_orchestrator_process({
  goal: "{TICKET} — {requirement summary}",
  activeFiles: [files from plan's File Structure section]
})
```
Returns: `{ strategy, confidence, complexity, risk, guidance }`

Map phantom strategy to team routing:

| Phantom Strategy | Team Route | Rationale |
|---|---|---|
| Direct | SOLO | Simple, one Spark |
| Advisor | SOLO + Oracle | Moderate, guidance helpful |
| Self-Refine | SOLO | Iterative, one agent refines |
| Decompose | CREW | Complex, needs subtask split |
| Tree of Thought | CREW + brainstorming | Ambiguous, explore approaches |
| Debate | CREW + Red Team | High risk, needs challenge |
| Graph of Thought | CREW + topological order | Critical, parallel groups |

Use phantom's `complexity` and `risk` scores instead of manual assessment. Cortex still makes final routing call — phantom is advisory.

**If not:** Use current manual SOLO/CREW heuristic (file count + concern count + risk feel).

### Phase B — Anti-Repetition Enhancement

**When:** During anti-repetition gate check.
**If available:**
```
phantom_orchestrator_history({ limit: 10 })
```
Returns past decisions with strategy, confidence, outcome (pass/fail), and failure reasons for this repo.

Merge with learnings INDEX.md scan:
- Phantom history provides **semantic** similarity (embedding-based)
- Learnings INDEX provides **keyword** matching
- Both checked. If phantom finds a failed approach that learnings missed, add it to anti-repetition notes.

**If not:** Use learnings INDEX.md only (current behavior).

### Phase D — Blast Radius Scoping

**When:** Before dispatching agents, after plan is approved.
**If available:**
```
phantom_before_edit({
  files: [all files from plan's File Structure section]
})
```
Returns: `{ context, blastRadius, relatedFiles, strategy }`

Use blast radius to:
1. **Validate agent scope** — if an agent's assigned files have high blast radius (impactScore > 0.3), flag for review before dispatching
2. **Discover missing files** — relatedFiles may surface files the plan missed. Add them to the relevant agent's scope.
3. **Inform Sentinel** — pass blastRadius.directlyAffected to Sentinel so it knows which additional files to check

**If not:** Dispatch based on plan's file mapping only (current behavior).

### Phase D — Conflict Detection

**When:** Before spawning parallel agents.
**If available:**
```
phantom_conflict_status({})
```
Returns: `{ hasConflicts, repoConflicts, fileConflicts, sessions }`

If `hasConflicts = true`:
- Log: "Other editing sessions detected on this repo: {session count}"
- If file-level conflicts overlap with planned changes → warn user, suggest sequential execution
- If repo-level only (no file overlap) → proceed with caution note

**If not:** Skip. Parallel dispatch proceeds as normal.

### Phase Wrap — Outcome Feedback

**When:** During `/team:wrap`, after verification results are known.
**If available:**
```
phantom_evaluate_output({
  output: "{verification summary + Prism verdict}",
  context: "{original goal}"
})
```
This feeds the outcome back into phantom's learning loop — the orchestrator records success/failure and adjusts strategy weights for future similar goals.

**If not:** Skip. Outcomes recorded only in learnings files (current behavior).

---

## Degradation Behavior

| Component | With Phantom | Without Phantom |
|---|---|---|
| Strategy routing | Data-driven (7 strategies, confidence scores) | Manual SOLO/CREW heuristic |
| Anti-repetition | Semantic + keyword match | Keyword match only |
| Blast radius | Graph-computed, precise | File list from plan only |
| Conflict detection | Multi-session awareness | None (hope for the best) |
| Outcome learning | Closed-loop with auto-tuning | Learnings INDEX.md files |
| Codebase exploration | Graph neighbors + Grep/Glob | Grep/Glob only |

The skill MUST work identically well without phantom. Phantom enhances precision — it doesn't gate functionality.

---

## When NOT to Call Phantom

- **Don't call phantom tools inside Spark/Sentinel/Prism agents.** Only Cortex calls phantom. Agents don't need graph context — they get scoped assignments from Cortex.
- **Don't block on phantom_graph_build.** It runs async. If the graph isn't ready, proceed without it.
- **Don't call phantom for non-code tasks** (docs-only, config-only). Blast radius is meaningless without code dependencies.
