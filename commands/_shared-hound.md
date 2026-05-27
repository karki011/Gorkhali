# Phantom Shadows -- Hound Mode Context

> Loaded at T2+ when hound mode activates.
> Skip entirely if not in a hound flow (bug investigation, verify failure, fix loop 2+).

---

<detective_triggers>

## When Hound Mode Activates

| Trigger | Source | Depth |
|---------|--------|-------|
| Bug report detected in `start.md` Phase A | Keywords, Jira type, branch prefix | Pre-scan (lightweight) |
| Verification failure in `verify.md` | Any correctness check fails | Failure scan (targeted) |
| Fix loop 2+ in `fix.md` | Same failure class repeats | Deep investigation (full) |
| Explicit `/phantom:hound` | User invocation | Full investigation |

**Depth levels:**
- **Pre-scan** — hotspot check + ownership on suspect files only. 2-3 git commands. Adds `hound` field to context.json.
- **Failure scan** — hotspot + coupling on failing files. 4-5 git commands. Adds `hound` field to verification.json.
- **Deep investigation** — full 7-step protocol. Produces standalone `investigation.html`.

</detective_triggers>

---

<git_recipes>

## Git Command Recipes

Single source for all forensic git commands. Do not invent variations.

```bash
# HOTSPOT: change frequency (last 6 months)
git log --format=format: --name-only --since="6.months" | sort | uniq -c | sort -rn | head -20

# HOTSPOT: scoped to specific files
git log --format=format: --name-only --since="6.months" -- {file1} {file2} | sort | uniq -c | sort -rn

# TEMPORAL COUPLING: files that change together
git log --format='---' --name-only --since="6.months" | awk '/^---$/{if(NR>1)for(i in f)for(j in f)if(i<j)print i,j;delete f;next}{if($0!="")f[$0]=1}' | sort | uniq -c | sort -rn | head -20

# OWNERSHIP: contributor distribution for a file
git shortlog -sn --no-merges -- {file}

# RECENT CHANGES: timeline for suspect files
git log --oneline --since="2.weeks" -- {file}

# BLAME: who last touched the failing lines
git blame -L {start},{end} -- {file}

# COMPLEXITY PROXY: line count + branch density
wc -l {file}; grep -c 'if\|else\|for\|while\|switch\|case\|catch\|&&\|||' {file}

# CHURN: additions + deletions over time
git log --numstat --since="6.months" -- {file} | awk 'NF==3{add+=$1;del+=$2}END{print "+"add" -"del}'
```

</git_recipes>

---

<research_benchmarks>

## Research Benchmarks

Cite these when reporting findings. Source column = what to say.

| Metric | Threshold | Implication | Source |
|--------|-----------|-------------|--------|
| Change frequency top 5% | 4-9x more defects | High-risk hotspot | Microsoft Research |
| >9 unique contributors/file | High coordination cost | Knowledge diffusion risk | Google engineering |
| >80% commits from 1 author | Bus factor = 1 | Single point of failure | Tornhill, "Your Code as a Crime Scene" |
| Temporal coupling >0.5 | Architecture violation | Hidden dependency | Tornhill |
| Unplanned work ratio >40% | Process problem | Morale + velocity drain | Tornhill |
| Test coupling ratio >2x | Brittle test suite | Tests change more than production code | Industry consensus |
| Complexity proxy >50 branches | High cognitive load | Refactor candidate | McCabe complexity research |

</research_benchmarks>

---

<formulas>

## Formulas

```
Hotspot Risk = normalize(change_freq) × normalize(complexity)
  where normalize(x) = (x - min) / (max - min) across file set

Coupling Strength = co_changes(A,B) / max(changes(A), changes(B))
  threshold: >0.5 = significant, >0.7 = strong

Bus Factor = min contributors needed to cover 50% of commits
  risk: 1 = critical, 2 = concerning, 3+ = healthy

Complexity Proxy = line_count × (1 + branch_density)
  where branch_density = branch_count / line_count
```

</formulas>

---

<html_template>

## Investigation Report HTML Template

Use this structure when generating `investigation.html`. Adapt content sections based on investigation depth.

READ `reference/hound-protocol.md` for the full HTML template and field definitions.

</html_template>
