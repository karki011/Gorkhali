# Route Flows

## DIRECT
```
Context -> Router(DIRECT) -> status report -> Spawn Blade -> Ward verify -> Done
```
- 0 questions. Human sees: `"[DIRECT] Fix typo in UserProfile.tsx -- executing"`
- Rival SKIPPED (known pattern = no value)
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
- Artifacts: + intent.json, plan.json, deliberation.json, wiring.json (auto or via phantom:wire)

## BRAINSTORM
```
Context -> Router(BRAINSTORM) -> Skill(skill="phantom:brainstorm")
  -> Diverge (explore + questions + 2-3 approaches)
  -> Converge (human picks direction, decision locked)
-> Standard PLAN flow (decompose -> deliberate -> approve -> execute -> verify)
```
- 2 human gates: approve direction (in brainstorm) + approve plan
- Brainstorm phase invoked via `Skill(skill="phantom:brainstorm")` -- see `commands/brainstorm.md`
- Artifacts: + decisions.json (from brainstorm), intent.json (updated with chosen approach)

## FULL
```
Context -> Router(FULL) -> Skill(skill="phantom:brainstorm") (diverge/converge)
-> Direction locked -> PLAN (decompose/deliberate) -> Plan approved
-> Skill(skill="phantom:wire") (dependency topology, wave assignments, risk points) -> Human approves wiring
-> EXECUTE (wave-based dispatch) -> VERIFY -> Done
```
- 3 human gates: direction + plan + wiring
- Brainstorm invoked via `Skill(skill="phantom:brainstorm")` -- see `commands/brainstorm.md`
- Wiring invoked via `Skill(skill="phantom:wire")` -- see `commands/wire.md` and `reference/wiring.md`
- Artifacts: + decisions.json (from brainstorm), wiring.json (gated)

## Route Decision Artifact

Written to `{TEAM_DIR}/sessions/{TICKET}/route-decision.json`. See `artifact-schemas.md` for full schema.
