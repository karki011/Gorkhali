# Phantom Works Crew -- Auto-Learning System

> Loaded by commands that complete work (start, execute, fix, verify, wrap).
> Always load `_shared.md` first. This system writes learnings AUTOMATICALLY — Cortex does not have permission to skip it.

---

## Four Mandatory Triggers

### Trigger 0: User Correction (IMMEDIATE — highest priority)

**When:** Immediately when the user:
- Rejects a proposed approach ("no, don't do that", "that's wrong", "not like that")
- Corrects an implementation ("use X instead of Y", "that's the wrong pattern")
- Redirects scope ("that's not what I meant", "I wanted X not Y")
- Expresses frustration with a repeated mistake ("I already told you", "again?")

**Who:** Cortex (automatic, inline — do NOT wait for verification gate).

**Actions:**
1. STOP current work immediately
2. Extract the correction:
   - What was attempted (the wrong approach)
   - What user wants instead (the right approach)
   - Domain classification (ui/data/auth/testing/crew/migration/tooling)
3. Write to `learnings/{domain}.md ## Corrections`:
   ```
   CORRECTION [{keyword}]: [{what was wrong}] — [{what user wants instead}] [failed] ({date})
   ```
4. Update `learnings/INDEX.md` with one-liner
5. Log to event board: `[LEARNING] Trigger 0: user correction captured — [{keyword}]`
6. Resume work with the corrected approach

**This is the HIGHEST-SIGNAL trigger.** User corrections are more valuable than automated verification signals because they capture intent, not just pass/fail. NEVER skip this trigger. NEVER wait until wrap to record a user correction.

### Trigger 1: Post-Verification (after Sentinel PASS)

**When:** Immediately after the MANDATORY VERIFICATION GATE passes — before simplify/code-review.
**Who:** Cortex (automatic, not delegated to agents).

**Actions:**
1. Extract from the session:
   - Files changed (paths)
   - Approach taken (strategy: SOLO/CREW, agent count, role focuses)
   - Repo stack detected
   - Verification commands that ran
2. Check `learnings/INDEX.md` for a similar entry (same files or same approach keyword)
3. If no similar entry exists → append to `learnings/INDEX.md`:
   ```
   - [{approach keyword}] {what worked} — {files involved} [proposed] ({date})
   ```
4. If similar entry exists with `[proposed]` → increment to `[validated:1]`
5. If similar entry exists with `[validated:N]` → increment to `[validated:N+1]`

**This is NOT optional.** Skipping this step means successful approaches are never recorded and the system never learns from wins.

### Trigger 2: Post-Fix-Loop (after ANY fix loop iteration)

**When:** After each fix loop iteration — whether it passes or fails.
**Who:** Cortex (automatic).

**Actions on failure:**
1. Extract:
   - What approach was tried
   - What failed (error class, file, description)
   - What fix was applied
2. Write correction to `learnings/{domain}.md ## Corrections`:
   ```
   CORRECTION [{approach-keyword}]: [{what failed}] — [{what to do instead}] [failed] ({date})
   ```
3. Update `learnings/INDEX.md` with one-liner for the correction

**Actions on fix success:**
1. If the fix applied a correction from learnings → increment that correction's validation count
2. Log: "Correction [{keyword}] applied successfully — now [validated:{N+1}]"

**This is NOT optional.** Every fix loop iteration MUST produce a learning entry. No silent failures.

### Trigger 3: Post-Session (during /team:wrap — MANDATORY section)

**When:** During `/team:wrap`, after crew evaluation but before auto-memory update.
**Who:** Cortex (automatic).

**Actions:**
1. **Validate patterns used this session:**
   - Scan all patterns in INDEX.md that were loaded into agent prompts via anti-repetition
   - For each pattern that was followed without issues → increment `[validated:N]` → `[validated:N+1]`
   - For each pattern that was followed but caused issues → downgrade: `[validated:N]` → `[validated:N-1]` (min 0, then flip to `[failed]`)

2. **Auto-promote to global:**
   - Any pattern with `[validated:5+]` that is not repo-specific → copy to `global/patterns/INDEX.md` with `[scope:global] derived_from:{REPO_NAME}` tag
   - Global entry starts at `[validated:1]` regardless of source count

3. **Auto-demote stale patterns:**
   - Any pattern with `[validated:0]` or `[failed]` that hasn't been validated in 30+ days → mark `[stale]`
   - `[stale]` patterns are still loaded but deprioritized in anti-repetition (logged as "stale — verify before relying on this")

4. **Session summary to INDEX.md:**
   - Append: `SESSION {TICKET}: route={SOLO|CREW}, outcome={pass|fail}, fix_loops={N}, patterns_validated={N}, corrections_added={N} ({date})`

**This is NOT optional.** The wrap command MUST NOT complete without running this section.

---

## Learning Data Flow

```
Session starts
  ↓
Anti-repetition gate READS learnings (existing, WEIGHTED by validation count)
  ↓
Implementation happens
  ↓ (if user corrects)
User correction → Trigger 0: IMMEDIATE record to learnings (highest signal)
  ↓
Verification PASS → Trigger 1: auto-record what worked
  ↓ (or)
Verification FAIL → Fix loop → Trigger 2: auto-record what failed + what fixed it
  ↓
Simplify + Code Review
  ↓
Prism review
  ↓
/team:wrap → Trigger 3: validate/promote/demote patterns, session summary
```

**Closed loop:** every session both reads AND writes learnings. No session can consume patterns without contributing back.

---

## INDEX.md Entry Format

```markdown
## Patterns
- [chart-hourly-granularity] Hourly format needs h:mm a not M/d — cost-chart.tsx, format-x-axis-label.ts [validated:3] (2026-05-06)
- [go-handler-middleware] Always check context cancellation before DB call [proposed] (2026-05-06)

## Corrections
- CORRECTION [absolute-pixel-crossline]: Crossline positioning with absolute px breaks on resize — use relative positioning [failed] (2026-04-10)

## Sessions
- SESSION CP-41171: route=CREW, outcome=pass, fix_loops=0, patterns_validated=2, corrections_added=0 (2026-05-06)
```

---

## Enforcement Rules

| Rule | Enforcement |
|---|---|
| **Every verification pass produces a learning** | Trigger 1 runs inside the verification gate — same "NO SKIP" enforcement |
| **Every fix loop produces a correction** | Trigger 2 runs inside the fix sub-loop — before re-running Sentinel |
| **Every wrap validates patterns** | Trigger 3 is a mandatory section in wrap.md — wrap blocks without it |
| **No silent sessions** | INDEX.md session summary ensures every session leaves a trace |
| **Corrections are never deleted** | They can be marked `[stale]` but never removed — failure memory persists |
| **Write before read** | Cortex writes this session's learnings BEFORE updating auto-memory (which other sessions read) |

---

## Weighted Pattern Retrieval

When the anti-repetition gate scans `learnings/INDEX.md`, weight patterns by validation count:

| Lifecycle Tag | Weight | Anti-Repetition Behavior |
|---|---|---|
| `[validated:5+]` | **HIGH** | Auto-apply — follow this pattern unless task is fundamentally different. Log: "Following validated pattern [{keyword}]" |
| `[validated:1-4]` | **MEDIUM** | Suggest — mention to user/agent as recommended approach. Log: "Suggesting pattern [{keyword}] (validated {N} times)" |
| `[proposed]` | **LOW** | Mention only — note it exists but don't auto-apply. Log: "Noting proposed pattern [{keyword}]" |
| `[failed]` | **BLOCKING** | Block — this approach failed before. MUST acknowledge and explain why current approach differs OR choose alternative. |
| `[stale]` | **DEPRIORITIZED** | Log as "stale — verify before relying on this" but don't block or auto-apply |

**Corrections always take priority over patterns.** If a correction says "don't use X" and a pattern says "use X", the correction wins regardless of validation count.

**Example anti-repetition check output:**
```
Anti-repetition scan for [chart rendering]:
  BLOCK: CORRECTION [absolute-pixel-crossline] — don't use absolute px positioning (failed)
  HIGH: [chart-hourly-granularity] — use h:mm a format (validated:5)
  MEDIUM: [responsive-chart-container] — use ResizeObserver (validated:2)
  LOW: [d3-axis-labels] — custom tick formatter (proposed)
```

---

## Semantic Anti-Repetition (Multi-Source)

The anti-repetition gate uses a **layered retrieval strategy** — not just keyword matching:

### Layer 1: Keyword Match (always available)
Scan `learnings/INDEX.md` for exact keyword matches against the current task's file paths, approach keywords, and domain.
- Fast, zero-cost, always works
- Limitation: misses paraphrased patterns ("use ResizeObserver" won't match "responsive container sizing")

### Layer 2: Phantom Semantic Match (if phantom-ai MCP available)
Call `phantom_orchestrator_history({ limit: 10 })` for embedding-based similarity search:
- Finds conceptually similar past approaches even with different keywords
- Returns confidence scores — only surface matches with confidence > 0.6
- Merge results with Layer 1: if phantom finds a failed approach that keyword scan missed, add to anti-repetition block

### Layer 3: AgentDB Vector Search (if claude-flow MCP available)
Call `memory_search({ query: "{task description}", type: "pattern" })` for cross-session semantic retrieval:
- Searches patterns stored via `memory_store` during previous wraps
- Broader than per-repo learnings — can surface patterns from other repos
- Lower priority than repo-specific learnings (repo context > global context)

### Merge Strategy

```
anti_repetition_results = []

# Layer 1: Always
keyword_matches = scan_index_md(task_keywords, task_files)
anti_repetition_results += keyword_matches

# Layer 2: If available
if AVAILABLE_MCPS.phantom:
  semantic_matches = phantom_orchestrator_history(limit=10)
  for match in semantic_matches:
    if match.confidence > 0.6 AND match not in keyword_matches:
      anti_repetition_results += match  # tagged [semantic]

# Layer 3: If available
if AVAILABLE_MCPS.claude_flow:
  vector_matches = memory_search(query=task_description, type="pattern")
  for match in vector_matches:
    if match.similarity > 0.7 AND match not in anti_repetition_results:
      anti_repetition_results += match  # tagged [cross-session]

# Apply weights from Weighted Pattern Retrieval table
# Semantic/cross-session matches default to MEDIUM weight unless they have lifecycle tags
```

### Anti-Repetition Block Format (injected into agent prompts)

```
## Anti-Repetition (DO NOT repeat these failures)
{for each BLOCKING result}
⛔ CORRECTION [{keyword}]: {failure description} — {what to do instead} ({source: keyword|semantic|cross-session})

## Suggested Patterns (validated approaches)
{for each HIGH/MEDIUM result}
✅ [{keyword}]: {what worked} (validated:{N}, source: {keyword|semantic|cross-session})

## Noted Patterns (unvalidated, for awareness)
{for each LOW result}
📝 [{keyword}]: {approach} (proposed, source: {keyword|semantic|cross-session})
```

**Graceful degradation:** If only Layer 1 is available, the system works identically to the current keyword-only approach. Layers 2 and 3 are additive — they never replace Layer 1.
