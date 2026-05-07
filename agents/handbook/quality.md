# Handbook: Quality Enforcement

## Quality Gate Pipeline

| Step | Agent | When Used |
|------|-------|-----------|
| **Prism** | Quality gate — code review, gauntlet, architecture | Second-to-last task in EVERY plan (third-to-last if Lens runs) |
| **Lens** | Visual verification via Playwright | After Prism, before User Feedback — UI tasks only |

### Prism's Gauntlet (Full Mode)
1. `git add .` — baseline current changes
2. **Parallel scan** — spawn BOTH in parallel (`run_in_background: true`):
   - `pr-review-toolkit:code-simplifier` on changed files
   - `pr-review-toolkit:silent-failure-hunter` on changed files
3. Report silent-failure-hunter findings (CRITICAL must fix, WARNING for awareness)
4. `git diff` — show what simplifier changed
5. Prism reviews ONLY the simplifier diff → APPROVE (keep) or REJECT (revert)
6. Full verify: `pnpm check` + `pnpm build` + affected tests
7. Report verdict: CLEARED FOR USER TESTING / BLOCKED

### Phase Task Order (ALWAYS)
```
... implementation tasks (Spark instances) ...
→ Prism quality review
→ Sentinel verifies build
→ Prism full gauntlet (simplify + silent-failure-hunter + review + final verify)
→ Lens visual inspection loop (UI tasks only)
→ User Feedback (ALWAYS last)
```

### Auto-Continue Between Phases (30s Timeout)
After completing each phase, Cortex posts a brief phase summary and waits **30 seconds** for user feedback. If the user does not reply within 30s, Cortex automatically proceeds to the next phase.

## Verify → Fix Loop

### Verification Phase
1. **Sentinel** — tests against locked contracts + lint/typecheck/build
2. **Prism** — quality gate review (if risk >= medium)

### Post-Verify Routing
- **PASS** → proceed to Prism gauntlet or wrap
- **FAIL** → enter fix sub-loop

### Fix Sub-Loop
1. Track loop count internally (max 3)
2. **Cortex** triages failures and creates fix packet (classifies: build/type/test/ui/integration)
3. Show fix packet to user for approval
4. Assign scoped repairs to Spark instances — only failing scope, no new features
5. After repairs → re-run Sentinel
6. If pass → exit loop
7. If fail → repeat from step 1

### Loop Stop Conditions
- **Max 3 loops** → escalate to user
- **Same failure twice** → write correction to `learnings/{domain}.md` + escalate
- **Contract must change** → return to contract phase
- **Scope expansion** → return to planning

## Visual Verify → Fix Loop (Lens)

After Prism clears the gauntlet, Lens runs visual inspection for **UI tasks only**.

### When to Include Lens

| Task Type | Include Lens? |
|-----------|-------------------|
| UI components, pages, layouts | **YES** |
| Figma implementation | **YES** |
| Style/theme changes | **YES** |
| API-only, domain logic, tests, docs, config | No |

### Visual Inspection Flow
1. Navigate to target routes via `browser_navigate`
2. Take screenshots — evidence for every route/state
3. Test interactions: clicks, form fills, tab switches
4. Analyze screenshots against task requirements
5. Produce visual inspection report with PASS/FAIL per route

### Visual Fix Sub-Loop
1. Lens creates visual fix packet (route, element, issue, severity, suggested fix)
2. Cortex assigns fixes to Spark instances (UI focus for styling, React Arch focus for data-driven bugs)
3. Fix agents make repairs (scoped to visual issues only)
4. Sentinel quick-verify — ensure fixes don't break build
5. Lens re-inspects same routes
6. Loop until visual PASS or max 3 loops

## Validation Scripts (`~/.claude/team/scripts/`)

| Script | When to Run | What it Checks |
|--------|-------------|----------------|
| `validate-plan.sh <session.json>` | Before execution | Phase order, Lens inclusion, file ownership, assignees |
| `validate-output.sh <agent> <files>` | After each agent completes | File ownership, copyright, tokens, barrel exports |
| `validate-session.sh <session.json>` | At phase transitions | JSON structure, status enums, verification blocks, loop counts |
