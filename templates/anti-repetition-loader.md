# Anti-Repetition Signal Loader

> Shared procedure used by Phase D-Solo and Phase D-Shadows before ANY agent spawn.
> Apex runs this once, injects the output block into every agent prompt.

## Steps

1. Identify task domain(s) from the plan (ui, data, auth, testing, migration, tooling, shadows)
2. For each domain, scan `learnings/{domain}.md` `## Corrections` section
3. Scan `decisions.ndjson` for past failures on similar goals (if file exists):
   - Read last 50 lines of `~/.claude/team/events/{repo}/decisions.ndjson`
   - Filter for `DECISION:outcome` events where `Outcome: fail`
   - Extract: route used, goal, corrections applied
4. Build the **Anti-Repetition Block**:
   ```markdown
   ## Anti-Repetition Signals
   Prior failures on similar work:
   - {correction 1: what failed, why, what to do instead}
   
   Prior successes on similar work:
   - {success 1: approach that worked, confidence}
   
   Rules:
   - If approach matches known failure: STOP, justify difference or choose alternative
   - Penalty: -0.3 confidence on previously-failed approaches
   - No corrections match: proceed normally
   ```
5. If nothing found: `## Anti-Repetition Signals\nNo prior corrections for this domain. Proceed normally.`
