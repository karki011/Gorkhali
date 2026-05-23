# Detective Mode — Research & Design

Author: Subash Karki

## 1. What forensic-skills Does

AlabamaMike/forensic-skills is 11 Claude Code skills + 2 slash commands that perform git-history-based code forensics, inspired by Adam Tornhill's "Your Code as a Crime Scene."

### Skills (11 total)

| Skill | Analyzes | Key Metric |
|-------|----------|------------|
| hotspot-finder | Change frequency × complexity | Risk = Norm(freq) × Norm(complexity) |
| change-coupling | Files that change together | Coupling strength >0.5 = violation |
| complexity-trends | Monthly complexity over time | >+20% = deteriorating |
| coordination-analysis | Contributors per file | >9 unique = high risk (Google research) |
| debt-quantification | Complexity → dollar amounts | 2.5x dev time for complex files |
| knowledge-mapping | Ownership from git commits | >80% single author = silo |
| onboarding-risk | Bus factor, transition cost | Single-owner file count |
| organizational-alignment | Conway's Law violations | Team → module alignment score |
| refactoring-roi | ROI = Annual Savings / Investment | Effort-impact matrix |
| test-analysis | Test coupling ratios | >2x coupling = brittle |
| unplanned-work | Bug fix ratio | >40% = low morale indicator |

### Structure Pattern (6-Element)
1. YAML frontmatter (name + description as trigger)
2. "When You Use This Skill" behavioral contract
3. Prominent core formula (ALL CAPS, emoji-marked)
4. Research benchmarks table with citation phrasing
5. Common mistakes (bad vs good examples)
6. Integration guidance (next skills to suggest)

### Strengths
- Research-grounded: 18+ studies, exact benchmarks
- Business translation: complexity → dollar amounts
- Cross-skill integration: 32+ integration points
- Git-only: no external tools needed

### Weaknesses
- **No automatic triggering** — only activates on description match
- **Massive context** — avg 569 lines/skill, 6,420 total
- **No incremental analysis** — full re-analysis every time
- **No structured output** — free-form markdown, no schema
- **Redundant** — same git commands, citations repeated across skills
- **No integration with fix loops** — forensics and debugging are separate concerns

## 2. Current Team Skill Capabilities

### Existing Detective-Adjacent Features
| Component | What It Does | Gap |
|-----------|-------------|-----|
| `fix.md` | Root cause triage (max 3 loops), calls systematic-debugging | No forensic pre-scan, no git-history analysis |
| `hawkeye` agent | Cross-file regression: removed handlers, dropped imports, dead code | Post-hoc only, no proactive detection |
| `sentinel` agent | Witness regression markers in `witness-fixes.json` | Tracks known fixes, not unknown bugs |
| `cortex` | Failure classification (build/type/test/ui/visual/integration) | Classifies but doesn't investigate |
| `grill.md` | Edge cases, failure modes, blast radius from diff | Human-understanding check, not root cause |
| `scout.md` | Background context gathering (design/api/patterns/deps/tests) | No "debug" scout area |

### Integration Points for Detective Mode
1. **Phase A of start.md** — if input is a bug report, branch into detective flow
2. **Before fix.md triage** — forensic pre-scan of failing files
3. **scout.md extension** — new `debug` scout area
4. **Post-verification failure** — auto-trigger investigation when verify fails
5. **Standalone command** — `team:detective` or `team:investigate`

## 3. Design: Detective Mode for Team Skill

### Philosophy
Forensic-skills treats analysis as a standalone activity. We treat it as **integrated intelligence** — detective mode activates automatically when symptoms appear, produces structured artifacts, and feeds into the existing fix/verify loop.

### Architecture: Three Layers

```
┌─────────────────────────────────────────────────┐
│  Layer 1: Proactive Detection (auto-trigger)    │
│  Hooks into: start, verify, fix                 │
│  Lightweight scans that flag issues              │
├─────────────────────────────────────────────────┤
│  Layer 2: Investigation Engine (on-demand)       │
│  team:detective — full forensic analysis         │
│  Structured output → session artifacts           │
├─────────────────────────────────────────────────┤
│  Layer 3: Forensic Knowledge (shared context)    │
│  _shared-detective.md — formulas, thresholds     │
│  Loaded only when detective mode activates       │
└─────────────────────────────────────────────────┘
```

### Layer 1: Proactive Detection

Auto-triggers in three situations:

**A. Bug Report Detection (in start.md Phase A)**
When start.md parses the ticket/input, detect if it's a bug report vs feature:
- Keywords: "bug", "broken", "regression", "error", "crash", "failing", "doesn't work"
- Jira issue type: Bug
- Git branch prefix: `fix/`, `bugfix/`, `hotfix/`

If detected → inject detective pre-scan before planning:
```
Phase A.5: Detective Pre-Scan
  1. Identify suspect files from error/description
  2. Run lightweight hotspot check on those files
  3. Check ownership (bus factor risk)
  4. Add findings to context.json as `detective` field
  5. Feed into Phase B planning
```

**B. Verification Failure (in verify.md)**
When verification fails, before routing to fix.md:
```
Pre-Fix Detective Scan
  1. Classify failure type
  2. For test failures: check if failing files are hotspots
  3. For build failures: check change-coupling violations
  4. Add detective findings to verification.json
  5. Pass to fix.md as structured evidence
```

**C. Fix Loop Exhaustion (in fix.md, loop 2+)**
When fix attempt fails and we're about to retry:
```
Deep Investigation
  1. Git blame the failing code
  2. Check recent change history (last 30 days)
  3. Look for temporal coupling (files that should have changed together but didn't)
  4. Check if similar fixes were attempted before (learnings scan)
  5. Produce hypothesis with confidence score
```

### Layer 2: Investigation Engine (team:detective)

New T2 command: `commands/detective.md`

**Trigger conditions:**
- "investigate", "why is X broken", "debug", "trace", "root cause"
- Explicit `/team:detective`
- Auto-routed from start.md when bug detected

**Investigation Protocol (7 Steps):**

```
1. SYMPTOMS     — What's failing? Error messages, test output, user report
2. TIMELINE     — When did it start? git log --oneline --since="2.weeks"
3. SUSPECTS     — Which files? Hotspot analysis on changed files
4. OWNERSHIP    — Who knows this code? git shortlog for suspect files
5. COUPLING     — What else should have changed? Temporal coupling check
6. HYPOTHESIS   — Root cause theory with confidence (low/medium/high)
7. EVIDENCE     — Specific line numbers, commits, or test cases that confirm/deny
```

**Output artifact:** `state/sessions/{TICKET}/investigation.json`
```json
{
  "_meta": { "type": "investigation", "created": "..." },
  "symptoms": ["test X fails with error Y"],
  "timeline": { "first_failure": "commit abc123", "suspect_range": "abc123..def456" },
  "suspects": [
    {
      "file": "src/foo.ts",
      "hotspot_score": 0.82,
      "change_freq": 47,
      "complexity": "high",
      "owners": ["alice (78%)", "bob (15%)"],
      "coupling": ["src/bar.ts (0.67)", "src/baz.ts (0.54)"]
    }
  ],
  "hypothesis": {
    "description": "Change to foo.ts broke implicit contract with bar.ts",
    "confidence": "high",
    "evidence": ["commit abc123 changed foo.ts but not bar.ts", "coupling score 0.67"]
  },
  "recommended_fix": "Update bar.ts to match new foo.ts interface",
  "recommended_tests": ["test coupling between foo and bar"]
}
```

### Layer 3: Shared Context (_shared-detective.md)

Loaded at T2+ only when detective mode activates. Contains:

**Git command recipes** (single source, not repeated per analysis):
```bash
# Hotspot: change frequency
git log --format=format: --name-only --since="6.months" | sort | uniq -c | sort -rn | head -20

# Temporal coupling: files changing together
git log --format=format: --name-only | awk '/^$/{if(NR>1)for(i in f)for(j in f)if(i<j)print i,j;delete f}{f[$0]=1}' | sort | uniq -c | sort -rn | head -20

# Ownership: contributor distribution
git shortlog -sn --no-merges -- <file>

# Complexity proxy: line count + cyclomatic (approximation)
wc -l <file>; grep -c 'if\|else\|for\|while\|switch\|case\|catch\|&&\|||' <file>
```

**Research benchmarks** (from Tornhill, Microsoft Research, Google):
| Metric | Threshold | Source |
|--------|-----------|--------|
| Change frequency top 5% | 4-9x more defects | Microsoft Research |
| >9 contributors/file | High coordination cost | Google engineering |
| >80% single author | Bus factor risk | Tornhill |
| Coupling >0.5 | Architecture violation | Tornhill |
| Unplanned work >40% | Process problem | Tornhill |
| Test coupling >2x | Brittle test | Forensic-skills |

**Formulas:**
```
Hotspot Risk = normalize(change_freq) × normalize(complexity)
Coupling Strength = co_changes(A,B) / max(changes(A), changes(B))
Bus Factor = min contributors needed to cover 50% of commits
Debt Cost = base_dev_hours × complexity_multiplier × hourly_rate
```

### Layer Integration with Existing Team Skill

```
team:start ─── bug detected? ──→ detective pre-scan ──→ plan with evidence
                    │
team:verify ── failure? ──→ detective scan ──→ enriched fix context
                    │
team:fix ──── loop 2+? ──→ deep investigation ──→ new hypothesis
                    │
team:detective ──── standalone investigation ──→ investigation.json
```

### Differences from forensic-skills

| Aspect | forensic-skills | Our Detective Mode |
|--------|----------------|-------------------|
| Triggering | Manual (description match only) | Auto (hooks) + manual |
| Context cost | 569 lines avg per skill | ~150 lines shared context |
| Output | Free-form markdown | Structured JSON artifacts |
| Integration | Standalone | Feeds into fix/verify loop |
| Scope | 11 separate skills | 1 command + 3 hook points |
| Incremental | Full re-analysis | Compare to baseline |
| Graph intel | None | Phantom AI blast radius |
| Learnings | None | Records investigation outcomes |

### Implementation Plan

**Phase 1: Core Detective Command** (detective.md + _shared-detective.md)
- New T2 command with 7-step investigation protocol
- Shared context with formulas, thresholds, git recipes
- investigation.json artifact schema
- Trigger: explicit `/team:detective` or "investigate"

**Phase 2: Auto-Detection Hooks** (modify start.md, verify.md, fix.md)
- Bug report detection in start.md Phase A
- Pre-fix scan in verify.md failure path
- Deep investigation in fix.md loop 2+
- Each injects detective findings into existing artifacts

**Phase 3: Forensic Dashboard** (optional)
- Aggregate hotspot/coupling/ownership into health score
- Store baseline in `state/forensics/` for trending
- Compare current state to last baseline
- Could tie into CloudZero cost attribution

### Files to Create/Modify

**New files:**
- `commands/detective.md` — main detective skill (~200 lines)
- `_shared-detective.md` — shared forensic context (~150 lines)
- `agents/detective.md` — detective agent persona (~50 lines)
- `reference/detective-protocol.md` — investigation protocol + artifact schema

**Modified files:**
- `commands/start.md` — add bug detection + detective pre-scan routing
- `commands/verify.md` — add pre-fix detective scan on failure
- `commands/fix.md` — add deep investigation on loop 2+
- `reference/artifact-schemas.md` — add investigation.json schema
