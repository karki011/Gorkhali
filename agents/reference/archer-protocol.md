# Archer Review Protocol

Detailed review checklist, detection methods, scoring, and triage rules for the Archer cross-file reviewer.

## Review Dimensions (Detailed)

### 1. Cross-File Coherence
Shared state (cache keys, query keys, atoms, context values) must compute compatible values across all consumers.

**Detection method:**
- From graph context, identify all files that share the same query key, atom, or cache key pattern
- Compare how each file computes its parameters (timestamps, IDs, filter values)
- Flag when independent computations produce values that should be identical but aren't

**Example:** Two hooks calling `DateTime.utc()` independently — React Query cache keys never match, causing duplicate network requests.

### 2. Regression Detection
Features, capabilities, or behaviors present in the base branch but absent in the diff — without explanation in the commit messages.

**Detection method:**
- From `git diff main...HEAD`, scan for:
  - Removed destructuring assignments (a variable was extracted before, now it's not)
  - Deleted function calls (a function was called before, now it's not)
  - Dropped imports (a module was imported before, now it's not)
  - Removed event handlers or click handlers
- Cross-reference with commit messages — if the removal is mentioned, it's intentional
- Flag unmentioned removals as potential regressions

**Example:** `reconnect` function removed from PulsePage component destructuring — users can no longer manually recover from WebSocket disconnection.

### 3. Semantic Accuracy
UI labels must match the data they display. A label saying "Average" must divide by count. "Total" must sum. "Count" must count. "Rate" must be per-unit-time.

**Detection method:**
- Find JSX elements with text labels (strings, i18n keys)
- Trace the expression that produces the displayed value
- Verify the expression's operation matches the label's semantic meaning
- Flag mismatches

**Example:** Label says "Avg Latency" but value is `row.totalLatencyMs` (a cumulative sum, not a per-event average).

### 4. Dead Code / Dead Props
Props, exports, handlers, or variables that exist but are never used, wired to no-ops, or unreachable.

**Detection method:**
- From graph context (impact radius), check if changed exports have any importers
- Scan for `() => {}` or `(_) => {}` handler patterns in JSX props
- Look for variables assigned but never read
- Check for type exports that duplicate existing types

**Example:** `onTimeRangeChange` prop wired to `() => {}`, time-range selector UI removed, prop never invoked internally.

### 5. Convention Deviation
How similar code elsewhere in the repo handles the same pattern — type definitions, error handling, naming, hook structure.

**Detection method:**
- From graph context, find analogous code (similar function names, same directory, same domain)
- Compare patterns: does new code handle errors the same way? Use the same type imports? Follow the same naming?
- Flag deviations from established patterns

**Example:** Inlining a `TimeRange` union type in a new atom instead of importing the existing `TimeRange` type from its canonical location.

## Scoring & Triage Rules

Severity levels:
- **P0** — Critical/security issues. Always FIX.
- **P1** — Bugs, incorrect behavior, data correctness. Default FIX.
- **P2** — Quality, maintainability. Default SKIP unless high blast radius.

Triage rules:
- P0, P1 → default FIX (bugs, regressions, data correctness issues)
- P2 → default SKIP unless it's in a hot path or has high blast radius
- Convention deviations → SKIP unless they'll cause confusion for other developers

## Example Output

```
P1 | cross-file-coherence | use-pulse-dashboard.ts:57 | Cache keys diverge — independent DateTime.utc() calls prevent React Query cache sharing | Extract shared timestamp computation
P1 | semantic-accuracy | token-summary-table.tsx:32 | "Avg Latency" displays totalLatencyMs (cumulative sum), not per-event average | Divide totalLatencyMs by eventCount
P1 | regression | pulse-page.tsx:54 | reconnect capability silently removed — users cannot recover from WebSocket disconnection | Restore reconnect destructuring
P2 | dead-code | pulse-page.tsx:143 | onTimeRangeChange wired to no-op — never invoked internally | Remove prop or wire up control
P2 | convention-deviation | event-buffer.ts:67 | pulseTimeRangeAtom inlines TimeRange union instead of importing canonical type | Import existing TimeRange type
```

## Auto-Triage Format

```
FIX  P1  cross-file-coherence  use-pulse-dashboard.ts:57   Cache keys diverge — high impact
FIX  P1  semantic-accuracy     token-summary-table.tsx:32  Label-value mismatch misleads users
FIX  P1  regression            pulse-page.tsx:54           Feature silently removed
SKIP P2  dead-code             pulse-page.tsx:143          Cosmetic — cleanup pass
SKIP P2  convention-deviation  event-buffer.ts:67          Minor DRY, low blast radius
```
