# Phantom Works Crew -- Auto-Learning System

> Loaded by commands that complete work (start, execute, fix, verify, wrap).
> Always load `_shared.md` first. This system writes learnings AUTOMATICALLY — Cortex does not have permission to skip it.

---

## Three Mandatory Triggers

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
Anti-repetition gate READS learnings (existing)
  ↓
Implementation happens
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
