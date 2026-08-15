# Route Flows

## DIRECT
```
Context -> Router(DIRECT) -> status report -> Spawn Blade -> Ward verify -> Done
```
- 0 questions. Human sees: `"[DIRECT] Fix typo in UserProfile.tsx -- executing"`
- Rival plan gate SKIPPED — known pattern = no value, so no plan-check.json
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
- **Optional visual flow**: when `net_new_ui` is strong, before contracts -> `Skill(skill="phantom:visualflow")` (visual flow, user-gated) -- Apex recommends, user approves; no new hard gate
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
- **Visual flow**: when `net_new_ui` fires, before contracts/plan -> `Skill(skill="phantom:visualflow")` (visual flow, user-gated) -- Apex recommends, user approves; no new hard gate
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
- **Visual flow**: when `net_new_ui` fires, before contracts/plan -> `Skill(skill="phantom:visualflow")` (visual flow, user-gated) -- Apex recommends, user approves; no new hard gate
- Wiring invoked via `Skill(skill="phantom:wire")` -- see `commands/wire.md` and `reference/wiring.md`
- Artifacts: + decisions.json (from brainstorm), wiring.json (gated), visualflow.json (when net_new_ui)

## Route Decision Artifact

Written to `{TEAM_DIR}/sessions/{TICKET}/route-decision.json`. See `artifact-schemas.md` for full schema.
