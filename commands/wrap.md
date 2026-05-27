---
name: phantom:wrap
description: "Use when work is DONE — finalizing a session, creating a PR, recording learnings, or opening a pull request. Also use when user says 'wrap up', 'we're done', 'ship it', 'create the PR', 'open PR', 'finalize', 'finish up', 'record what we learned', 'commit my work', or 'submit'. NOT for bare git push. Runs shadows eval, saves learnings, creates PR."
---

> **Preamble Tier: T4** — loads ALL shared contexts

<precondition>
## Smart Verification Gate

Nothing ships without passing verification. No "proceed at your own risk" option.

1. **Check** `state/sessions/{TICKET}/verification.json`:

   | State | Action |
   |-------|--------|
   | Missing | Auto-run verify (step 2) |
   | `verdict: "fail"` | Auto-run verify (step 2) |
   | `verdict: "pass"` BUT `_meta.gitHead` ≠ current `git rev-parse HEAD` | Stale — auto-run verify (step 2) |
   | `verdict: "pass"` AND `_meta.gitHead` = current HEAD | Current — proceed to wrap |

2. **Auto-run**: Report status, then run `Skill(skill="phantom:verify")`:
   - Missing: `"No verification found — running quality gates (lint → build → tests → simplify → review)..."`
   - Failed: `"Previous verification failed — re-running quality gates..."`
   - Stale: `"Files changed since last verification (HEAD moved) — re-running quality gates..."`

3. **Gate result**:
   - verify passes → proceed with wrap
   - verify fails → **STOP**. Print failures. Suggest `/phantom:fix` then `/phantom:wrap` again. Do not continue to ship ceremony.
</precondition>

# /phantom:wrap

Single ship ceremony. All git operations happen here — no commits, pushes, or PRs before wrap.

<knowledge_recording>
Full shutdown:

1. **Run Pre-Wrap Hook** -- verify implementation, test, and review status is recorded
2. `TaskCreate({ subject: "[Apex] SESSION:wrap" })` — hook handles archival + cleanup
3. **Diff-against-main review** (scope creep detection):
   Before creating PR or pushing branch:
   a. Run `git diff main...HEAD --stat` to see all changed files
   b. Run `git diff main...HEAD` for full diff
   c. Apex reviews: "Do these changes align with the contract scope?"
   
   Check for:
   - Files changed that aren't in the contract scope → flag as scope creep
   - Unrelated formatting/refactoring changes → separate or revert
   - Debug/console.log statements left in → remove
   - TODO comments added → document or remove
   
   If scope creep detected:
   - Present to user: "These files weren't in the original scope: [list]. Keep or revert?"
   - User decides before PR is created
   
   If clean → proceed to next step

### Grill Gate (auto-triggered)

**Condition:** 3+ files changed by agents during this session.

If triggered:
1. Run `Skill(skill="phantom:grill", args="--quick")` — 3-question rapid grill
2. **SHIP IT** verdict → proceed to PR creation
3. **NOT YET** verdict → block PR, show gaps, user must address and re-run `/phantom:grill`

If not triggered (< 3 agent-changed files): skip silently.

**Override:** User can skip with `--skip-grill` flag on `/phantom:wrap`.

4. Write session file to `sessions/{ticket}/{date}_{label}.md`
5. Write new decisions to the correct file:
   - **Feature-specific** -> `sessions/{ticket}/decisions.md`
   - **Cross-cutting** -> `decisions/global.md`
   - When in doubt, put it in the session
6. **Run shadows evaluation** (see `/phantom:eval`) -- record scores in session file
7. Update learnings — append to the relevant **domain file** in `learnings/` (ui.md, data.md, auth.md, testing.md, shadows.md, migration.md, tooling.md):
   - New patterns → under `## Patterns` with `[proposed]` or `[validated:1]` lifecycle tag
   - New corrections → under `## Corrections` with `[failed]` tag + approach signature format: `CORRECTION [{keyword}]: [{failure}] — [{alternative}] [failed] ({date})`
   - New habits → under `## Habits` with `[validated:1]` tag
   - If a new entry doesn't fit an existing domain, create a new `learnings/{domain}.md` with all 3 sections
8. Update `learnings/INDEX.md` quick reference with one-liners for any new entries (include lifecycle tag)
8b. **Increment validation counters** — for each pattern in INDEX.md that was successfully used during this session (Apex explicitly relied on it, or Blade followed it without issues), increment `[validated:N]` → `[validated:N+1]`. This builds confidence signal over time.
8c. **Promotion check** — for any pattern with `[validated:5+]` that is technology-generic (not repo-specific), offer to promote to `~/.claude/team/global/patterns/INDEX.md` with `[scope:global] derived_from:{REPO_NAME}` tag. Global entry starts at `[validated:1]` regardless of source count.
9. **Caveman-compress updated learnings** — for each learnings file that was modified this session, run:
   ```bash
   cd ~/.claude/plugins/marketplaces/caveman/compress && python3 -m scripts <absolute_path>
   ```
   Skip `INDEX.md` (already terse). This keeps learnings compressed for future sessions.
9b. **Phantom outcome feedback** (if phantom available):
   - Call `phantom_evaluate_output` with verification summary + Gaze verdict as output, original goal as context
   - This closes phantom's learning loop — the orchestrator records success/failure and adjusts strategy weights for similar future goals
   - If verification failed: phantom records failure reason, penalizing the strategy for similar goals going forward
9c. **Auto-learning trigger 3:**
   - Validate all patterns used this session: increment `[validated:N]` on patterns that held, downgrade patterns that caused issues
   - Auto-promote `[validated:5+]` patterns to `global/patterns/INDEX.md`
   - Auto-demote patterns not validated in 30+ days → `[stale]`
   - Append session summary to INDEX.md: `SESSION {TICKET}: route={route}, outcome={outcome}, fix_loops={N}, patterns_validated={N}, corrections_added={N} ({date})`
   - See `_shared-auto-learning.md` for full protocol
10. **Testgaps scan** (advisory — does not block wrap):
    Check for changed source files without corresponding test changes:
    ```bash
    # Get source files changed in this session (exclude tests, configs, docs)
    git diff main...HEAD --name-only | grep -E '\.(ts|tsx|js|jsx|go|py)$' | grep -v -E '(test|spec|__tests__|_test\.go)' > /tmp/changed-sources.txt
    # Get test files changed
    git diff main...HEAD --name-only | grep -E '(test|spec|__tests__|_test\.go)' > /tmp/changed-tests.txt
    ```
    For each source file, check if a matching test file was also changed. If gaps found:
    - Log to `learnings/testing.md`: `TESTGAP: {file} changed without test update ({date})`
    - Report in wrap summary: "Test gaps: {N} source files changed without corresponding test updates"
    - Do NOT block — this is informational. User decides whether to address before PR.
</knowledge_recording>

## Ship

**No git operations happened before this point. All prior work was local-only.**

<ship_ceremony>
11. **Stage changed files**:

<NEVER_COMMIT_SECRETS>
    - Read `state/sessions/{TICKET}/execution.json` for `filesChanged` list if available
    - Fallback: `git diff --name-only main...HEAD`
    - `git add <each file>` (never `git add -A`)
    - Skip: `.env`, `credentials.*`, `*.key`, `*.pem` (warn if found)
</NEVER_COMMIT_SECRETS>

12. **Commit**:
    - Message format: `{TICKET}: {summary}`
    - Do NOT add "Co-Authored-By: AI" or any AI attribution

13. **Push**:
    - `git push -u origin $(git branch --show-current)`
    - If push fails (no remote, auth error): warn user, continue to archive

14. **Smart PR Decision**:

    Evaluate whether to create a Draft PR based on what happened, not the route.

    <pr_decision>
    #### Gather signals (from artifacts already in memory)

    ```
    changed_files    = execution.json.filesChanged OR git diff --name-only main...HEAD
    file_count       = len(changed_files)
    has_code_changes = any file matches \.(ts|tsx|js|jsx|go|py|rs|java|rb|sql)$
    route            = route-decision.json.route (DIRECT|PLAN|BRAINSTORM|FULL)
    branch           = git branch --show-current
    on_main          = branch == "main" OR branch == "master"
    has_ui_changes   = any changed file matches \.(tsx|jsx)$ OR paths contain /components/|/pages/|/views/
    HAS_UI           = repo has UI layer (from stack detection in _shared-repo-detection.md)
    only_artifacts   = all changed files are in state/|.planning/|docs/|*.md
    user_said_no_pr  = user explicitly said "don't PR" or "no PR" during session
    ```

    #### Decision table

    | # | Condition | Action | Reason |
    |---|-----------|--------|--------|
    | 1 | `on_main = true` | **SKIP** | Cannot PR from default branch |
    | 2 | `user_said_no_pr = true` | **SKIP** | User override |
    | 3 | `has_code_changes = false` AND `only_artifacts = true` | **SKIP** | No shippable code — research/planning only |
    | 4 | `HAS_UI = true` AND `has_ui_changes = true` | **DRAFT PR** | UI changes need visual review, draft signals "not yet approved visually" |
    | 5 | `has_code_changes = true` | **DRAFT PR** | Default: code changes should be visible to the team |
    | 6 | Everything else | **SKIP** | No meaningful changes to PR |

    First matching row wins.

    #### Execute decision

    **If DRAFT PR:**
    - `gh pr create --draft --title "{TICKET}: {summary}" --body "{body}"`
    - PR body:
      ```
      ## Summary
      {1-3 bullet points from intent or session context}

      ## Changes
      {files changed, grouped by concern}

      ## Test plan
      {verification results from verification.json if available}
      ```
    - If `gh` not available: print branch name + "run `gh pr create --draft` when ready"

    **If SKIP:**
    - Log reason to wrap.json: `"pr": { "status": "skipped", "reason": "{reason}" }`
    - Print: "PR skipped ({reason}). Branch pushed — create manually when ready."
    </pr_decision>

15. **Greptile review** (non-blocking):
    - If Greptile integration available: request AI review on the PR
    - If unavailable: skip silently

16. **Jira transition** (non-blocking):
    - If Atlassian MCP available AND TICKET matches `[A-Z]+-\d+`:
      a. Get available transitions: `mcp__atlassian__getTransitionsForJiraIssue({ issueIdOrKey: "{TICKET}" })`
      b. Find transition matching: "Review", "In Review", "Reviewing", "Ready for Review", or "Code Review" (case-insensitive)
      c. If found: `mcp__atlassian__transitionJiraIssue({ issueIdOrKey: "{TICKET}", transitionId: "{id}" })`
      d. Add PR link as comment: `mcp__atlassian__addCommentToJiraIssue({ issueIdOrKey: "{TICKET}", body: "PR #{number}: {url}" })`
      e. If no matching transition found: log warning, skip silently (ticket may already be in review or workflow differs)
    - If Atlassian MCP unavailable: skip silently
</ship_ceremony>

<output_format>
17. **Write wrap artifact** to `state/sessions/{TICKET}/wrap.json`:
    ```json
    {
      "_meta": {
        "writtenAt": "{ISO 8601 now}",
        "gitHead": "{new HEAD after commit}",
        "gitBranch": "{branch}",
        "phase": "wrap",
        "skill": "phantom:wrap",
        "version": 1
      },
      "pr": { "number": N, "url": "...", "status": "draft|skipped", "skipReason": "on-main|no-code|user-override|null" },
      "jira": { "ticket": "{TICKET}", "transition": "Review", "commented": true },
      "greptile": { "requested": true, "status": "pending" },
      "learnings": { "recorded": N, "promoted": N, "pruned": N }
    }
    ```
</output_format>

<evolution_check>
## Evolution Check (Haiku sidecar)

Spawn Haiku agent (model: haiku, mode: bypassPermissions, run_in_background: false):

Prompt: "Scan learnings/INDEX.md. Find:
1. Entries with [validated:5+] → Tier 1 (auto-promote to reference/)
2. [failed] corrections in 3+ sessions → Tier 2 (propose skill edit)
3. Repeated multi-step patterns in 4+ sessions → Tier 3 (propose new skill)
4. Files over size cap? (reference: 100 lines, commands: 80 lines)
Output JSON: {tier1: [...], tier2: [...], tier3: [...], oversized: [...]}"

Process results (see `reference/evolution.md` for full protocol):
- Tier 1: auto-apply, prune INDEX entry, log to `state/evolution-log.json`
- Tier 2-3: present to user, apply on approval, log
- Oversized: offer Haiku distillation
</evolution_check>

<archive_and_shutdown>
18. **Archive session**:
    - Copy session state to `state/completed/{TICKET}/`
    - Update `state/current.json`: remove {TICKET} from active sessions

19. **Memory layer sync** (persist key learnings to Claude auto-memory):
   After Trigger 3 validates patterns, sync significant learnings to Claude's persistent memory:
   
   a. **What to sync** (only high-value, cross-session patterns):
      - Corrections from this session (Trigger 0 or Trigger 2 entries)
      - Patterns promoted to `[validated:5+]` this session
      - Decisions recorded in `sessions/{TICKET}/decisions.md` marked as cross-cutting
      - NOT: session-specific context, temporary state, or task details
   
   b. **Where to sync:**
      Write to `~/.claude/projects/{PROJECT_PATH}/memory/` as memory files:
      ```
      File: learning_{REPO_NAME}_{keyword}.md
      ---
      name: {keyword} learning
      description: {one-line description of the pattern/correction}
      type: feedback
      ---
      
      {Pattern or correction content}
      **Why:** {context from the session}
      **How to apply:** {when this pattern is relevant}
      ```
      
      Update the project's `MEMORY.md` index with a one-liner pointer.
   
   c. **Dedup check:** Before writing, scan existing memory files for the same keyword.
      If exists → update the existing file instead of creating a duplicate.
   
   d. **Why this matters:** Claude's auto-memory loads at session start regardless of
      whether the Phantom is invoked. Critical corrections and validated patterns
      survive even in quick sessions that don't load the full Phantom.
20. Update auto-memory (`project_*.md` in memory dir)
21. **Iron Law #13 audit report** — scan `~/.claude/team/audit/apex-edits-$(date +%Y-%m-%d).jsonl` for this session:
    ```bash
    grep "\"session\":\"{SESSION_ID}\"" ~/.claude/team/audit/apex-edits-*.jsonl 2>/dev/null
    ```
    - If no entries → ✓ Iron Law #13 held (subagent-driven was respected)
    - If entries found → ✗ violations occurred. Report in wrap summary:
      - Count of violations
      - Files touched directly
      - Append summary to `learnings/shadows.md ## Corrections`: `CORRECTION [subagent-driven]: Apex edited {N} files directly — should have spawned Blade [failed] ({date})`
    - This is informational for Option C mode. If Option A (hard block) was active, violations wouldn't have been possible.
22. **Deactivate apex hook ward:**
    ```
    rm -f ~/.claude/team/.apex-active
    ```
23. **Clear native `/goal` if still active:**
    ```
    /goal clear
    ```
    Safe to run even if no goal is active — it's a no-op. Prevents a lingering goal from auto-triggering turns after wrap.
24. Shut down shadows
</archive_and_shutdown>

---

> **Output on wrap complete:**
> ```
>   ╭───────────────────────────╮
>   │                           │
>   │   SESSION WRAPPED  ✓      │
>   │                           │
>   │   Ticket:  {TICKET}       │
>   │   Route:   {SOLO|SHADOWS}    │
>   │   Outcome: {pass|fail}    │
>   │   Loops:   {N}            │
>   │   PR:      #{N} (draft)   │  ← or "skipped ({reason})" if pr_decision = SKIP
>   │   Jira:    → Review       │
>   │   Learned: {N} patterns   │
>   │   Corrections: {N}        │
>   │                           │
>   ╰───────────────────────────╯
> ```
> Fun sign-off (random): "Apex out. Mic drop." | "Learnings saved. Brain bigger." | "Session archived. History written." | "Until next time, shadows." | "Patterns locked. Mistakes noted. Moving on."
