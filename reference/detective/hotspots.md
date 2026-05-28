# Hotspot Analysis, Ownership & Coupling Detection

Author: Subash Karki

Techniques for identifying high-risk files: change frequency analysis, ownership mapping, bus factor calculation, and temporal coupling detection.

---

## Hotspot Analysis

A "hotspot" is a file with high change frequency AND high complexity. These are the most likely sources of bugs.

**Risk score formula:**
```
hotspotRisk = normalize(changeFreq) * 0.6 + normalize(complexity) * 0.4
```

Where:
- `changeFreq` = number of commits touching the file in the last 6 months
- `complexity` = line count + branch count (approximated via indentation depth)
- `normalize()` = rank within the file set, scaled 0-1

**Risk classification:**
| Risk Score | Class | Meaning |
|-----------|-------|---------|
| > 0.7 | `high` | Active hotspot — investigate first |
| 0.4 - 0.7 | `medium` | Watch list — check if recently changed |
| < 0.4 | `low` | Stable — unlikely source |

---

## Ownership Mapping

For each suspect file, determine:
- **Primary owner**: contributor with >50% of recent commits
- **Bus factor**: minimum number of contributors needed to cover 50% of commits
- **Red flag**: bus factor of 1 means single point of failure

**Ownership output:**
```json
{
  "file": "src/foo.ts",
  "topOwner": "alice (78%)",
  "busFactor": 1,
  "contributors": [
    {"name": "alice", "pct": 78},
    {"name": "bob", "pct": 22}
  ]
}
```

---

## Coupling Detection

Two files are "coupled" if they frequently change in the same commit. A suspect that changed WITHOUT its coupled partner is a major red flag.

**Coupling strength:**
```
strength = coChangeCount / max(changesA, changesB)
```

**Strength classification:**
| Strength | Class | Meaning |
|----------|-------|---------|
| > 0.5 | `violation` | Tightly coupled — missing co-change is a red flag |
| 0.3 - 0.5 | `warning` | Moderately coupled — worth checking |
| < 0.3 | `normal` | Loosely coupled — independent changes OK |

**Red flag detection:**
If a suspect file changed but a file with coupling strength > 0.5 did NOT change in the same commit, flag it as `MISSING co-change`.
