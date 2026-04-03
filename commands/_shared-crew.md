# Straw Hat Engineering Crew -- Crew Context

> Loaded by commands that spawn agents. Always load `_shared.md` first.

---

## Agent Registry

### Core Crew

| Agent | Model | Owns |
|-------|-------|------|
| **Luffy** | opus | Planning, crew selection, contracts, orchestration |
| **Franky** | sonnet | Hooks, state, data flow, component architecture |
| **Nami** | sonnet | Layout, a11y, responsive, visual polish |
| **Sanji** | sonnet | API clients, data-fetching hooks, error handling |
| **Zoro** | sonnet | Tests, mocks, a11y audits, edge cases |
| **Chopper** | haiku | Lint, typecheck, build, integration pass |
| **Robin** | sonnet | Storybook, ADRs, READMEs, Captain's Log |
| **Usopp** | sonnet | Figma spec extraction (no code) |
| **Roger** | opus | Quality gate: KISS/DRY/YAGNI, strictness, verdict |
| **Sengoku** | sonnet | Full quality gauntlet: simplify -> Roger -> verify |
| **Smoker** | sonnet | Visual inspection via Playwright, screenshot loop |

### Allies (recruit on demand)

| Ally | Specialty |
|------|-----------|
| **Kureha** | Verification triage, fix packets, repair routing |
| **Jinbe** | Backend contracts, cross-stack coordination |
| **Jinbe-Data** | Large schema, analytics, data contracts |
| **Brook** | Design system consistency across surfaces |
| **Law** | Surgical refactor |
| **Shanks** | Architecture review for critical paths |
| **Yamato** | Spike or prototype |
| **Vivi** | Product/UX clarification |
| **Ace** | Performance investigation |
| **Sabo** | Migration from legacy paths |
| **Marco** | E2E or multi-page integration |
| **Dragon** | Plan stress-testing, devil's advocate (auto-recruited every planning session) |

### Agent Spawning Rules

- Set `subagent_type` matching agent name (e.g., `franky`, `nami`, `roger`)
- Set `model` to the agent's designated model
- Include in prompt: persona name, owned scope, assigned contract section, required skills, relevant learnings from `learnings/{domain}.md`
- Agents without a `subagent_type` -> spawn as `coder` with full persona from `.claude/agents/{name}.md`
- Run independent agents in parallel; chain dependent ones sequentially
- **Sengoku** always runs second-to-last (before final user review)
- **Max 5 active execution agents** — gains plateau beyond this; coordinate overhead eats benefits

### Lean Context Loading

Agents load ONLY what they need — Luffy holds the full picture.

| Agent Role | Gets | Does NOT Get |
|------------|------|-------------|
| **Luffy** (orchestrator) | All 5 shared tiers + all learnings | — |
| **Execution agents** (Franky, Nami, Sanji) | Their persona + their contract section + CLAUDE.md + relevant `learnings/{domain}.md` | _shared-crew, _shared-contracts, _shared-board, _shared-superpowers |
| **Zoro** (tester) | His persona + locked contracts (all) + `learnings/testing.md` | Board, superpowers tiers |
| **Chopper** (verifier) | His persona + verification commands only | All shared tiers |
| **Roger** (reviewer) | His persona + full diff + `coding-principles.md` | Board tier |

### Handoff Targets

Declared routing graph — Luffy uses this to chain agents predictably.

| Agent | Hands Off To | Why |
|-------|-------------|-----|
| **Franky** | Zoro, Chopper | Testing built components, then verification |
| **Nami** | Zoro, Smoker | Testing UI, then visual inspection |
| **Sanji** | Franky, Zoro | Architecture integration, then testing |
| **Zoro** | Chopper | Verification after tests pass |
| **Chopper** | Roger (if risk >= medium) | Quality gate after verification |
| **Roger** | Sengoku (if risk >= medium) | Full gauntlet after quality review |

### Crew Workflow Rules

| Rule | Enforcement |
|------|-------------|
| **Opus for orchestration & quality only** | Luffy, Roger use opus. All other agents use sonnet (Chopper uses haiku). Upgrade (never downgrade) if unusually complex. |
| **Roger before Chopper** | Every phase with risk >= low MUST have Roger review before Chopper verify. |
| **Parallel Roger + code-reviewer** | Always spawn `feature-dev:code-reviewer` alongside Roger for dual-lens coverage. |
| **User test as last phase** | Final phase in every session is always manual user testing + feedback. |
