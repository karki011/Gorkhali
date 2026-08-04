# Phantom Shadows -- Hound Mode Context

> Loaded at T2+ when hound mode activates.
> Skip entirely if not in a hound flow (bug investigation, verify failure, fix loop 2+).

---

<detective_triggers>

## When Hound Mode Activates

| Trigger | Source | Depth |
|---------|--------|-------|
| Defect or regression detected in `start.md` Phase A | Keywords, Jira type, branch prefix | Defect proof gate |
| Verification failure in `verify.md` | Any correctness check fails | Failure scan (targeted) |
| Fix loop 2+ in `fix.md` | Same failure class repeats | Deep investigation (full) |
| Explicit `/phantom:hound` | User invocation | Full investigation |

Depth levels and abbreviated flows defined in `reference/detective/depth-levels.md`.
The start-time pre-scan may enrich context, but it never authorizes a fix.
Before mutation, defect work MUST satisfy `reference/defect-proof.md`.

</detective_triggers>

---

<defect_proof_gate>

## Evidence Before Mutation

Classify reported defects and regressions as `workKind: "investigation"`.
Reproduce the current failure, capture evidence, trace the exact code path, form
one falsifiable root-cause claim, and obtain user confirmation. Record the
result in `{SESSION_DIR}/defect-proof.json` using
`reference/defect-proof.md`.

- Complete proof: `state: "ready_for_fix"` and
  `verdict: "confirmed_defect"`.
- Inconclusive proof: `state: "waiting_for_evidence"` and
  `verdict: "unconfirmed_defect"`; no implementation mutation.
- Diagnostic instrumentation is denied unless an unexpired `DiagnosticGrant`
  explicitly lists its objective, actions, paths, expiry, and cleanup. The
  grant permits only that evidence collection and never authorizes a fix.

`commands/execute.md` rechecks this artifact before the Blade marker is
activated. Missing or contradictory proof fails closed.

</defect_proof_gate>

---

<git_recipes>

## Git Command Recipes

Single source for all forensic git commands. Do not invent variations.
Full recipe catalog with examples: `reference/detective/git-recipes.md`.

```bash
# HOTSPOT: change frequency (last 6 months)
git log --format=format: --name-only --since="6.months" | sort | uniq -c | sort -rn | head -20

# TEMPORAL COUPLING: files that change together
git log --format='---' --name-only --since="6.months" | awk '/^---$/{if(NR>1)for(i in f)for(j in f)if(i<j)print i,j;delete f;next}{if($0!="")f[$0]=1}' | sort | uniq -c | sort -rn | head -20

# OWNERSHIP: contributor distribution
git shortlog -sn --no-merges -- {file}

# BLAME: who last touched failing lines
git blame -L {start},{end} -- {file}
```

</git_recipes>

---

<research_benchmarks>

## Research Benchmarks

Cite these when reporting findings. Formulas in `reference/detective/hotspots.md`.

| Metric | Threshold | Implication | Source |
|--------|-----------|-------------|--------|
| Change freq top 5% | 4-9x more defects | High-risk hotspot | Microsoft Research |
| >80% commits 1 author | Bus factor = 1 | Single point of failure | Tornhill |
| Temporal coupling >0.5 | Architecture violation | Hidden dependency | Tornhill |
| Complexity proxy >50 branches | High cognitive load | Refactor candidate | McCabe |

</research_benchmarks>

---

<html_template>

## Investigation Report

READ `reference/detective/report-template.md` for full HTML template and field definitions.

</html_template>
