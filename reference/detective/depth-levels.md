# Investigation Depth Tiers

Author: Subash Karki

Three depth levels determine how much forensic work Hound does. Deeper levels include all steps from shallower levels.

---

## Depth Summary

| Depth | Steps | Git Commands | Output | Trigger |
|-------|-------|-------------|--------|---------|
| **SHALLOW** (Pre-scan) | 1-2 | 2-3 | Field in context.json | start.md bug detection |
| **MEDIUM** (Failure scan) | 1-3 | 4-5 | Field in verification.json | verify.md failure |
| **DEEP** (Full investigation) | All 7 | 8-12 | investigation.html | hound command or fix loop 2+ |

---

## SHALLOW — Pre-scan

Triggered automatically when `start.md` detects a bug report (see [protocol.md](protocol.md) for detection heuristics). Runs steps 1-2 only.

**Output schema (field in context.json):**
```json
{
  "hound": {
    "depth": "pre-scan",
    "suspects": [
      {
        "file": "src/foo.ts",
        "changeFreq": 47,
        "hotspotRisk": 0.82,
        "topOwner": "alice (78%)",
        "busFactor": 1
      }
    ],
    "flags": ["single-owner-hotspot", "high-churn"],
    "recommendation": "Investigate coupling with src/bar.ts before planning fix"
  }
}
```

---

## MEDIUM — Failure Scan

Triggered when `verify.md` detects a test/build failure. Runs steps 1-3.

**Output schema (field in verification.json):**
```json
{
  "hound": {
    "depth": "failure-scan",
    "failingFiles": ["src/foo.ts", "src/bar.ts"],
    "suspects": [
      {
        "file": "src/foo.ts",
        "changeFreq": 47,
        "hotspotRisk": 0.82,
        "coupledWith": [{"file": "src/bar.ts", "strength": 0.67}],
        "recentCommits": ["abc123 — refactor foo handler", "def456 — add error check"]
      }
    ],
    "hypothesis": "foo.ts changed without updating coupled bar.ts",
    "confidence": "medium"
  }
}
```

---

## DEEP — Full Investigation

Triggered by explicit `hound` command or when fix loop reaches 2+ iterations. Runs all 7 steps. Produces `investigation.html` using the [report template](report-template.md).

---

## Confidence Thresholds

Used in hypothesis formation (step 6) and report output.

| Level | Range | Color | Meaning |
|-------|-------|-------|---------|
| Low | 0-39% | red | Circumstantial only. Need more evidence. |
| Medium | 40-69% | yellow | Pattern matches but no confirmation. |
| High | 70-100% | green | Specific commit + behavior change + reproducible. |
