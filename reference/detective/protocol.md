# Core Investigation Protocol

Author: Subash Karki

Detective's 7-step forensic investigation flow. Each step builds on the previous. Not all steps are needed for every depth level — see [depth-levels.md](depth-levels.md).

---

## Step 1: Symptoms Collection

Gather all observable symptoms: error messages, failing tests, user-reported behavior, stack traces. Capture exact text, not summaries.

## Step 2: Timeline Reconstruction

Build a chronological timeline of relevant commits using `git log`. Identify when the behavior changed. Mark the last known-good state and first known-bad state. See [git-recipes.md](git-recipes.md) for commands.

## Step 3: Suspect Identification

Run hotspot analysis to find high-churn, high-complexity files in the affected area. Cross-reference with the timeline to identify files that changed near the symptom onset. See [hotspots.md](hotspots.md) for analysis recipes.

## Step 4: Ownership Mapping

For each suspect file, determine who owns it (>50% of recent commits), bus factor (minimum contributors for 50% coverage), and whether the recent changes were made by the usual owner or someone unfamiliar with the code.

## Step 5: Coupling Analysis

Identify files that historically co-change with suspects. A suspect that changed WITHOUT its coupled partner is a red flag ("missing co-change"). See [hotspots.md](hotspots.md) for coupling detection.

## Step 6: Hypothesis Formation

Combine evidence from steps 1-5 into a testable hypothesis. Assign a confidence score (see [depth-levels.md](depth-levels.md) for thresholds). A good hypothesis names: the specific change, why it broke things, and what the expected vs actual behavior is.

## Step 7: Evidence Collection & Verdict

Collect concrete evidence that supports or refutes the hypothesis: specific commits, diff snippets, test results, reproduction steps. Produce a verdict with recommended actions. For full investigations, generate an HTML report using [report-template.md](report-template.md).

---

## Bug Report Detection Heuristics

Classify input as bug report if ANY match:

**Keywords in description/title:**
`bug`, `broken`, `regression`, `error`, `crash`, `failing`, `doesn't work`, `TypeError`, `undefined is not`, `null pointer`, `500 error`, `timeout`, `flaky`

**Jira issue type:** Bug, Defect, Incident

**Branch prefix:** `fix/`, `bugfix/`, `hotfix/`, `patch/`

**Negative signals (NOT a bug):** `feature`, `add`, `implement`, `create`, `new`, `enhance`, `refactor`, `chore`

If mixed signals -> ask user: "This looks like it might be a bug investigation. Want me to run detective mode first?"
