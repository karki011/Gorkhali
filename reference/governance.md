# Governance — Core Rules & Rules

## Core Rules (structural enforcement in v2)

| # | Law | Enforcement |
|---|-----|-------------|
| 1 | Feature branch | Hook: block Edit on default/protected branches (`hooks/feature-branch-gate.sh` is the authority) |
| 2 | Verify before ship | wrap reads verification.json |
| 3 | Anti-repetition | Search INDEX.md before planning |
| 4 | Rival | plan.json requires verdict field |
| 5 | Simplify always | verification.json requires simplifyRan |
| 6 | Intent check | Power Leveler compares to intent.json |
| 7 | Smart PR | wrap step 14 `<pr_decision>` — Draft PR default, skip only for on-main/no-code/user-override |
| 8 | Jira transition | wrap step (structural) |
| 9 | Learnings | wrap step (structural) |
| 10 | Auto-SHADOWS | plan.json routing logic |
| 11 | Root cause | fix.md structure |
| 12 | Parallel agents | plan.json dependency graph |
| 13 | Subagent-driven | Existing hook |

## Additional Rules

- Use task events for state (TaskCreate/TaskUpdate with [CrewName] prefixes)
- No Co-Authored-By or AI attribution in commits or PRs
- Lifecycle tags on all learnings: [proposed], [validated:N], [failed]
- All learnings repo-scoped under repos/{REPO_NAME}/
- Static content first, dynamic last in prompts (cache-friendly)

## Output Style

All agents: terse, technical-exact, no filler. Expand for security warnings or user confusion.
