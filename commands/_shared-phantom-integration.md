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

### Phase A — Full Recon (consolidated)

**When:** Session starts, after context loading (Phase A step 5 of `start.md`).
**If available:** Call ALL four phantom tools in parallel:
1. `phantom_orchestrator_process` → strategy, risk, complexity
2. `phantom_before_edit` → blast radius, related files (skip if no files extractable yet)
3. `phantom_orchestrator_history` → past decisions for anti-repetition
4. `phantom_conflict_status` → active session conflicts

Print `PHANTOM RECON` diagram to user (non-blocking, inform only).
Use the **full diagram** (strategy pipeline + blast radius + routing table + context) when blast radius is non-empty or strategy is not Direct.
Use the **compact variant** when strategy is Direct with high confidence and no blast radius data.

Store results in session variables:
- `PHANTOM_STRATEGY` — strategy object with alternatives
- `PHANTOM_BLAST_RADIUS` — blast radius + related files
- `PHANTOM_HISTORY` — recent decisions array
- `PHANTOM_CONFLICTS` — conflict status

**If not:** Print `PHANTOM RECON: unavailable` and continue. All downstream phases use fallback behavior.

Note: `phantom_graph_build` is no longer called explicitly — `phantom_before_edit` triggers graph indexing implicitly.

### Phase B — Strategy-Informed Routing

**When:** After task assessment, before SOLO/CREW decision.
**If `PHANTOM_STRATEGY` set (from Phase A):**
Use stored `PHANTOM_STRATEGY` — no tool call needed.

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

**If not set:** Use current manual SOLO/CREW heuristic (file count + concern count + risk feel).

### Phase B — Anti-Repetition Enhancement

**When:** During anti-repetition gate check.
**If `PHANTOM_HISTORY` set (from Phase A):**
Use stored `PHANTOM_HISTORY` — no tool call needed.

Merge with learnings INDEX.md scan:
- Phantom history provides **semantic** similarity (embedding-based)
- Learnings INDEX provides **keyword** matching
- Both checked. If phantom finds a failed approach that learnings missed, add it to anti-repetition notes.

**If not set:** Use learnings INDEX.md only (current behavior).

### Phase D — Blast Radius Scoping

**When:** Before dispatching agents, after plan is approved.
**If `PHANTOM_BLAST_RADIUS` set (from Phase A):**
Use stored `PHANTOM_BLAST_RADIUS`. If Phase B discovered NEW files not in the original extraction, re-call `phantom_before_edit` with the full plan file list and update `PHANTOM_BLAST_RADIUS`.

Use blast radius to:
1. **Validate agent scope** — if an agent's assigned files have high blast radius (impactScore > 0.3), flag for review before dispatching
2. **Discover missing files** — relatedFiles may surface files the plan missed. Add them to the relevant agent's scope.
3. **Inform Sentinel** — pass blastRadius.directlyAffected to Sentinel so it knows which additional files to check

**If not set:** Dispatch based on plan's file mapping only (current behavior).

### Phase D — Conflict Detection

**When:** Before spawning parallel agents.
**If `PHANTOM_CONFLICTS` set (from Phase A):**
Use stored `PHANTOM_CONFLICTS`. Re-call `phantom_conflict_status` only if significant time has passed since Phase A (> 10 minutes between Phase A and Phase D dispatch).

If `hasConflicts = true`:
- Log: "Other editing sessions detected on this repo: {session count}"
- If file-level conflicts overlap with planned changes → warn user, suggest sequential execution
- If repo-level only (no file overlap) → proceed with caution note

**If not set:** Skip. Parallel dispatch proceeds as normal.

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

## Session Variable Contract

Phase A stores these variables. Downstream phases consume them — no duplicate tool calls unless data needs refresh.

| Variable | Set By | Consumed By | Refresh Condition |
|---|---|---|---|
| `PHANTOM_STRATEGY` | Phase A step 5 | Phase B step 7 | Never (strategy doesn't change) |
| `PHANTOM_BLAST_RADIUS` | Phase A step 5 | Phase B step 7, Phase D | Phase B discovers new files |
| `PHANTOM_HISTORY` | Phase A step 5 | Phase B anti-repetition | Never |
| `PHANTOM_CONFLICTS` | Phase A step 5 | Phase D | > 10 min elapsed |
| `PHANTOM_FILES` | Phase A step 5 | Phase A (internal) | N/A |

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
- **Don't block on graph indexing.** `phantom_before_edit` triggers it implicitly. If the graph isn't ready, proceed without it.
- **Don't call phantom for non-code tasks** (docs-only, config-only). Blast radius is meaningless without code dependencies.
