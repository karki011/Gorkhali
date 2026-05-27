# Adaptive Cognitive Router

Author: Subash Karki

The router classifies tasks into the minimum-viable cognitive route.
Human intervention scales with **uncertainty**, not task size.

---

## Routes

| Route | Ceremony | Human Gates | When |
|-------|----------|-------------|------|
| **DIRECT** | Execute + Verify | 0 | Clear scope, <=3 files, known pattern, confidence >=0.9 |
| **PLAN** | Decompose + Deliberate + Execute + Verify | 1 (approve plan) | Clear scope, 3-10 files, known approach, confidence >=0.7 |
| **BRAINSTORM** | Diverge + Converge + Plan + Deliberate + Execute + Verify | 2 (approve direction + approve plan) | Ambiguous scope, new domain, competing patterns, confidence <0.7 |
| **FULL** | Brainstorm + Plan + Wire + Execute + Verify | 3 (approve direction + approve plan + approve wiring) | 10+ files, 3+ packages, cross-layer, security/schema/public-API |

---

## Signal Dimensions

### Scope Signals
- **file_count_estimate** — from graph blast radius or description keywords
- **package_span** — how many packages/modules touched (derive from blast radius paths)
- **layer_span** — FE only / BE only / cross-layer (path heuristic: `apps/` vs `packages/` vs `backend/` vs `infra/`)

### Uncertainty Signals
- **domain_novelty** — no learnings matches + no similar past sessions (check INDEX.md)
- **ambiguity_markers** — regex: `should we`, `might`, `explore`, `what if`, `not sure`, `maybe`, `consider`, `options`
- **competing_patterns** — codebase has 2+ ways to do same thing (graph search or learnings note)
- **missing_acceptance_criteria** — no Jira AC, or AC is generic/vague

### Risk Signals (hard overrides)
- **security_sensitive** — auth, secrets, RBAC, input validation → forces FULL
- **schema_migration** — DB schema changes + application code → forces FULL
- **public_api_change** — external-facing contract changes → forces FULL
- **high_churn_files** — files with >20 changes in 6 months (from hound pre-scan)

### Confidence Signals (route DOWN)
- **known_pattern** — learnings have `[validated:5+]` approach for this type
- **clear_spec** — Jira AC present, explicit "done when"
- **single_concern** — task addresses exactly one thing
- **past_routing_success** — similar tasks routed this way succeeded (shadows.md routing-history)

---

## Classification Algorithm

```
1. Hard overrides (skip scoring):
   - user_explicit_route → use it ("just do it" = DIRECT, "let's brainstorm" = BRAINSTORM)
   - security_sensitive → FULL
   - schema_migration → FULL

2. Compute uncertainty (0.0 = certain, 1.0 = ambiguous):
   uncertainty = weighted_sum([
     (domain_novelty,              0.30),
     (ambiguity_markers,           0.25),
     (competing_patterns,          0.20),
     (missing_acceptance_criteria, 0.25),
   ])

3. Compute scope (0.0 = trivial, 1.0 = massive):
   scope = weighted_sum([
     (normalize(file_count, 1, 20),  0.40),
     (normalize(package_span, 1, 5), 0.30),
     (layer_span > 1 ? 1.0 : 0.0,   0.30),
   ])

4. Apply learnings correction:
   correction = lookup routing-history in learnings/shadows.md
   adjusted_uncertainty = uncertainty * (1 + correction.bias)  // bias: -0.3 to +0.3

5. Route selection:
   adjusted_uncertainty < 0.2 AND scope < 0.3  → DIRECT
   adjusted_uncertainty < 0.4 AND scope < 0.6  → PLAN
   adjusted_uncertainty >= 0.4 AND scope < 0.6 → BRAINSTORM
   scope >= 0.6                                → FULL
   else                                        → BRAINSTORM (default: more ceremony when uncertain)
```

---

## Signal Extraction (how to gather)

| Signal | Source | Cost |
|--------|--------|------|
| file_count_estimate | `phantom_graph_blast_radius` or `get_impact_radius` | 1 MCP call |
| package_span | Derived from blast radius file paths | Free |
| layer_span | Path heuristic on blast radius | Free |
| domain_novelty | `learnings/INDEX.md` match count | 1 file read |
| ambiguity_markers | Regex on task description + Jira body | Free |
| competing_patterns | `semantic_search_nodes` for task keywords | 1 MCP call |
| missing_acceptance_criteria | Jira parse result (already in context.json) | Free |
| past_routing_success | `learnings/shadows.md` routing-history section | 1 file read |

**Total cost:** 2-3 MCP calls + 2 file reads. Under 5 seconds.

---

## Route Flows

### DIRECT

```
Context → Router(DIRECT) → status report → Spawn Blade → Ward verify → Done
```

- 0 questions. Human sees: `"[DIRECT] Fix typo in UserProfile.tsx — executing"`
- Rival SKIPPED (known pattern = no value)
- If verify FAILS → auto-escalate to PLAN (not retry)
- If >3 files changed → log routing correction to shadows.md, bias future similar tasks
- Artifacts: context.json, route-decision.json, execution.json, verification.json

### PLAN

```
Context → Router(PLAN) → Capture Intent → Codebase Research
  → Produce plan → Deliberation (Planner ↔ Challenger, max 2 rounds)
  → Present to human (consensus or disagreement) → Human OK
  → Contracts → [optional: Wire] → Execute → Verify → Done
```

- 1 human gate: approve plan after deliberation
- Lightweight wiring auto-generated (wave assignments, no separate approval)
- **Optional wiring**: if plan touches >5 files, invoke `Skill(skill="phantom:wire")` for topology — no human gate on PLAN route, wiring is informational only
- Artifacts: + intent.json, plan.json, deliberation.json, wiring.json (auto or via phantom:wire)

### BRAINSTORM

```
Context → Router(BRAINSTORM) → Skill(skill="phantom:brainstorm")
  → Diverge (explore + questions + 2-3 approaches)
  → Converge (human picks direction, decision locked)
→ Standard PLAN flow (decompose → deliberate → approve → execute → verify)
```

- 2 human gates: approve direction (in brainstorm) + approve plan
- Brainstorm phase invoked via `Skill(skill="phantom:brainstorm")` — see `commands/brainstorm.md`
- Artifacts: + decisions.json (from brainstorm), intent.json (updated with chosen approach)

### FULL

```
Context → Router(FULL) → Skill(skill="phantom:brainstorm") (diverge/converge)
→ Direction locked → PLAN (decompose/deliberate) → Plan approved
→ Skill(skill="phantom:wire") (dependency topology, wave assignments, risk points) → Human approves wiring
→ EXECUTE (wave-based dispatch) → VERIFY → Done
```

- 3 human gates: direction + plan + wiring
- Brainstorm invoked via `Skill(skill="phantom:brainstorm")` — see `commands/brainstorm.md`
- Wiring invoked via `Skill(skill="phantom:wire")` — see `commands/wire.md` and `reference/wiring.md`
- Artifacts: + decisions.json (from brainstorm), wiring.json (gated)

---

## Deliberation Protocol

Planner (Apex) and Challenger (Rival, opus, no tools) deliberate **before** presenting to human.

### Round Flow
- Round 1: Planner sends plan → Challenger returns verdict (PROCEED / REVISE / RETHINK)
- If PROCEED → present to human immediately
- If REVISE/RETHINK → Planner revises, Round 2
- Round 2: Planner sends revised plan → Challenger returns verdict
- After Round 2: ALWAYS present to human (max 2 rounds, never 3)

### Presentation to Human
| Outcome | Human Sees |
|---------|------------|
| Consensus (PROCEED) | Unified plan: "Plan reviewed by Rival (PROCEED). Ready to execute?" |
| Partial (REVISE after R2) | Plan with annotated unresolved concerns. Human decides per point. |
| Disagreement (RETHINK after R2) | Two approaches side-by-side. Human picks A, B, or "neither." |

### Challenger Constraints
- Max 5 challenges per round, max 100 words each
- Must cite specifics: task numbers, file paths, function names
- No tools (reason from plan text only)
- No vague concerns ("this might have issues" = rejected)

### When Deliberation is Skipped
- DIRECT: entirely skipped
- PLAN/BRAINSTORM: full (1-2 rounds on plan only)
- FULL: full + wiring review

---

## Question-Asking Rules

### The Filter
```
For each potential question:
  Does answer change WHAT we build? → NO → auto-resolve silently (HOW question)
  Does answer change WHAT we build? → YES → Can codebase answer it? → YES → auto-resolve with citation
  Does answer change WHAT we build? → YES → Can codebase answer it? → NO → ASK THE HUMAN
```

### Batching
- 2-5 questions per batch, grouped by theme
- Each question includes recommended default
- 0 questions is valid: "All scope questions resolved from ticket AC and codebase patterns."
- Max 2 question rounds total (initial + follow-up)

### Good vs Bad
- **Bad** (auto-resolve): testing framework?, file structure?, naming?, error handling?, SOLID?
- **Good** (ask): performance target?, which auth pattern?, backward-compatible migration?, controlled vs uncontrolled?

---

## Learning Integration

### What Gets Recorded (in wrap)
- Route selected + outcome (SUCCESS / ESCALATED / OVERKILL) → `learnings/shadows.md` routing-history
- Route escalation (e.g., DIRECT→PLAN) → correction bias for future classification
- Questions asked vs auto-resolved → expand auto-resolve patterns
- Deliberation challenges that caught real issues → `[devil-advocate:validated]`
- Wiring risk points that materialized → shadows.md wiring-risk section

### Routing History Format (in shadows.md)
```
## Routing History

ROUTE [2026-05-23] DIRECT → feature-web-apps/fix-typo-CP-1234 → SUCCESS
  signals: {files: 1, uncertainty: 0.05, scope: 0.1}

ROUTE [2026-05-23] DIRECT → feature-web-apps/add-filter-CP-1230 → ESCALATED:PLAN
  signals: {files: 2, uncertainty: 0.15, scope: 0.2}
  correction: task touched 6 files (3x estimate). Bias +0.2 for "filter" tasks.
```

### Correction Feedback Loop
```
Session completes → compare planned route vs actual execution
  Route held → record SUCCESS
  Route escalated (DIRECT→PLAN) → record ESCALATED, compute +bias
  Route was overkill (BRAINSTORM, no questions needed) → record OVERKILL, compute -bias
Next similar task → classifier applies correction bias
```

---

## Route Decision Artifact

Written to `state/sessions/{TICKET}/route-decision.json`:

```json
{
  "route": "PLAN",
  "confidence": 0.78,
  "signals": {
    "file_count_estimate": 5,
    "package_span": 2,
    "layer_span": 1,
    "domain_novelty": 0.2,
    "ambiguity_markers": 0.1,
    "competing_patterns": 0.0,
    "missing_acceptance_criteria": 0.0,
    "security_sensitive": false,
    "schema_migration": false,
    "public_api_change": false
  },
  "uncertainty_score": 0.28,
  "scope_score": 0.42,
  "corrections_applied": [],
  "rationale": "Clear scope from Jira AC, 5 files across 2 packages, known hook pattern."
}
```
