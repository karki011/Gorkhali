# Signal Dimensions

## Scope Signals
- **file_count_estimate** -- from graph blast radius or description keywords
- **package_span** -- how many packages/modules touched (derive from blast radius paths)
- **layer_span** -- FE only / BE only / cross-layer (path heuristic: `apps/` vs `packages/` vs `backend/` vs `infra/`)

## Uncertainty Signals
- **domain_novelty** -- no learnings matches + no similar past sessions (check INDEX.md)
- **ambiguity_markers** -- regex: `should we`, `might`, `explore`, `what if`, `not sure`, `maybe`, `consider`, `options`
- **competing_patterns** -- codebase has 2+ ways to do same thing (graph search or learnings note)
- **missing_acceptance_criteria** -- no Jira AC, or AC is generic/vague

## Risk Signals (hard overrides)
- **security_sensitive** -- auth, secrets, RBAC, input validation -> forces FULL
- **schema_migration** -- DB schema changes + application code -> forces FULL
- **public_api_change** -- external-facing contract changes -> forces FULL
- **high_churn_files** -- files with >20 changes in 6 months (from hound pre-scan)

## UI Signals (recommendation trigger, NOT a route)
Like `workflow_candidate`, orthogonal to route selection — does not feed the uncertainty/scope score.
Flags net-new UI work with no design to follow, so Apex RECOMMENDS a visual flow pass before
contracts/plan. Apex cannot self-launch — it recommends; the user gates the flow.
- **net_new_ui** -- fires when the work is a NET-NEW screen / route / major UI surface AND there is
  NO existing design/Figma to follow. Narrow on purpose: does NOT fire for tweaks to existing UI,
  backend-only work, or work where a Figma/design already exists.

## Confidence Signals (route DOWN)
- **known_pattern** -- learnings have `[validated:5+]` approach for this type
- **clear_spec** -- Jira AC present, explicit "done when"
- **single_concern** -- task addresses exactly one thing
- **past_routing_success** -- similar tasks routed this way succeeded (shadows.md routing-history)

## Workflow Candidate (`workflow_candidate`) — execution-mode signal, NOT a route
Orthogonal to the route (route = number of human gates). Flags a GATELESS phase whose fan-out is
big enough to RECOMMEND delegating to a Claude Code dynamic workflow instead of turn-by-turn
shadows. Apex cannot self-launch — it recommends; the user triggers. Full test + recommend pattern:
`reference/workflow-delegation.md`.
- **Primary lever: SCALE** — >= ~20 files blast radius, OR >= ~5 sources/angles, OR deep
  git-history sweep, OR "codebase-wide" / "every X" phrasing.
- Only when the phase is also gateless + read-mostly/generative + has synthesis payoff + workflows
  available.
- **Default: do NOT flag.** Small tasks stay turn-by-turn (workflows cost more tokens).

## Signal Extraction

| Signal | Source | Cost |
|--------|--------|------|
| file_count_estimate | `get_impact_radius` or the planned file list | 1 MCP call or free |
| package_span | Derived from blast radius file paths | Free |
| layer_span | Path heuristic on blast radius | Free |
| domain_novelty | `learnings/INDEX.md` match count | 1 file read |
| ambiguity_markers | Regex on task description + Jira body | Free |
| competing_patterns | `semantic_search_nodes` for task keywords | 1 MCP call |
| missing_acceptance_criteria | Jira parse result (already in context.json) | Free |
| past_routing_success | `learnings/shadows.md` routing-history section | 1 file read |
| net_new_ui | Description keywords ("new screen", "new page", "build a UI for", "flow for") + absence of a design/Figma reference + path heuristic (net-new route/component file) | low |

**Total cost:** 2-3 MCP calls + 2 file reads. Under 5 seconds.
