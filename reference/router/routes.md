# Route Flows

## LITE
```
Context -> Router(LITE) -> status report -> Spawn Engineer -> Inspector-only verify -> Done
```
- 0 questions. Human sees: `"[LITE] Fix typo in README.md -- executing"`
- Selected by the router only (never by the user): trivial scope, <=2 files,
  known pattern, very high confidence (see router/algorithm.md step 5)
- Opposition plan gate SKIPPED — known pattern = no value, so no plan-check.json
- ONE Engineer spawn (subagent law still absolute — Chief never edits project files)
- Inspector-only verification: one Inspector spawn writes verification.json.
  Does NOT chain into `phantom:verify --chained` (Steward/Justice/Auditor skipped)
- Records the portable lifecycle transitions it performed (authorize implementation,
  execute, record --type verification) via phantom-state.mjs CLI writes — status,
  resume, and wrap must see the LITE pass; see commands/start.md's LITE section
- If Inspector FAILS -> chain to `phantom:fix` (fix-loop ceiling unchanged)
- On PASS -> report and stop; no auto-wrap. `/phantom:wrap` still requires the
  full `/phantom:verify` review pass first (its ship gate needs an Auditor review)
- Bug/defect keywords route through the defect-proof gate instead — never LITE
- Artifacts: context.json, route-decision.json (route: "LITE"), verification.json,
  plus the portable lifecycle record (`runs/<run>/verification.json` via phantom-state.mjs)

## DIRECT
```
Context -> Router(DIRECT) -> status report -> Spawn Engineer -> Inspector verify -> Done
```
- 0 questions. Human sees: `"[DIRECT] Fix typo in UserProfile.tsx -- executing"`
- Opposition plan gate SKIPPED — known pattern = no value, so no plan-check.json
- If verify FAILS -> auto-escalate to PLAN (not retry)
- If >3 files changed -> log routing correction to shadows.md, bias future similar tasks
- Artifacts: context.json, route-decision.json, execution.json, verification.json

## PLAN
```
Context -> Router(PLAN) -> Capture Intent -> Codebase Research
  -> Produce plan -> Deliberation (Planner <-> Challenger, max 2 rounds)
  -> Present to human (consensus or disagreement) -> Human OK
  -> Contracts -> [optional: Wire] -> Execute -> Verify -> Done
```
- 1 human gate: approve plan after deliberation
- Lightweight wiring auto-generated (wave assignments, no separate approval)
- **Optional wiring**: if plan touches >5 files, invoke `Skill(skill="phantom:wire")` for topology -- no human gate on PLAN route, wiring is informational only
- **Optional visual flow**: when `net_new_ui` is strong, before contracts -> `Skill(skill="phantom:visualflow")` (visual flow, user-gated) -- Chief recommends, user approves; no new hard gate
- Artifacts: + intent.json, plan.json, deliberation.json, wiring.json (auto or via phantom:wire), visualflow.json (when net_new_ui)

## BRAINSTORM
```
Context -> Router(BRAINSTORM) -> Skill(skill="phantom:brainstorm")
  -> Diverge (explore + questions + 2-3 approaches)
  -> Converge (human picks direction, decision locked)
-> [net_new_ui: Skill(skill="phantom:visualflow")] -> Standard PLAN flow (decompose -> deliberate -> approve -> execute -> verify)
```
- 2 human gates: approve direction (in brainstorm) + approve plan
- Brainstorm phase invoked via `Skill(skill="phantom:brainstorm")` -- see `commands/brainstorm.md`
- **Visual flow**: when `net_new_ui` fires, before contracts/plan -> `Skill(skill="phantom:visualflow")` (visual flow, user-gated) -- Chief recommends, user approves; no new hard gate
- Artifacts: + decisions.json (from brainstorm), intent.json (updated with chosen approach), visualflow.json (when net_new_ui)

## FULL
```
Context -> Router(FULL) -> Skill(skill="phantom:brainstorm") (diverge/converge)
-> Direction locked -> [net_new_ui: Skill(skill="phantom:visualflow")] -> PLAN (decompose/deliberate) -> Plan approved
-> Skill(skill="phantom:wire") (dependency topology, wave assignments, risk points) -> Human approves wiring
-> EXECUTE (wave-based dispatch) -> VERIFY -> Done
```
- 3 human gates: direction + plan + wiring
- Brainstorm invoked via `Skill(skill="phantom:brainstorm")` -- see `commands/brainstorm.md`
- **Visual flow**: when `net_new_ui` fires, before contracts/plan -> `Skill(skill="phantom:visualflow")` (visual flow, user-gated) -- Chief recommends, user approves; no new hard gate
- Wiring invoked via `Skill(skill="phantom:wire")` -- see `commands/wire.md` and `reference/wiring.md`
- Artifacts: + decisions.json (from brainstorm), wiring.json (gated), visualflow.json (when net_new_ui)

## Route Decision Artifact

Written to `{TEAM_DIR}/sessions/{TICKET}/route-decision.json`. See `artifact-schemas.md` for full schema.
