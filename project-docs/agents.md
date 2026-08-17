# Shadows, Models and Effort

The agent roster, the single policy file that routes each role to a model, and the effort rules that apply to every run.

## Shadows

| Agent | Role |
|-------|------|
| Apex | Orchestrator - plans, decomposes, coordinates, runs router, routes models |
| Blade | Implementation - parallel execution with ROLE FOCUS directives |
| Ward | QA - lint, build, test verification |
| Gaze | Quality gate - power level (scored, P0-P3) |
| Sage | Advisory - guidance for stuck agents (<100 words) |
| Lens | Explicit opt-in visual inspection - advisory screenshots and observations |
| Archer | Cross-file review - pre-PR structural analysis |
| Rival | The one plan critic - adversarial challenge plus pre-execution validation (learnings collisions, blast radius, coverage gaps, scope creep, dependency order) |
| Hound | Forensic investigator - 7-step protocol, HTML reports |
| Sweep | Code clarity - simplify changed files post-verify |
| Warden | Mechanical session-lifecycle executor - ship/close plumbing: git, gh PR, Jira transitions, cost scripts, artifact writes |

Role-to-profile mapping lives in `skills/phantom/references/model-policy.json`, and profile-to-model per host lives in `skills/phantom/references/model-presets.json`.
`scripts/gen-agent-frontmatter.js` generates each `agents/*.md` `model:` pin from that policy, and a drift test fails CI on a hand-edited pin.

Everything Apex delegates runs `sonnet`: on this host `model-presets.json` maps every delegated profile - `economy` through `frontier` - onto the same model, so opus is reserved for the orchestrating session.
That is a property of the preset file, not a runtime check: `hooks/blade-model-gate.js` denies only a retired Fable-tier pin on an implementer and a `blade` spawn that set no explicit model.
The escalation ladder is therefore just **re-decompose**. There is no richer model to hand a struggling subtask to, so scoping that fails is fixed by splitting the assignment, not by re-routing it.
The profiles in `model-policy.json` still matter, and are unchanged: **Gaze** and **Archer** sit at the review tier and **Sage** at the top rung, which now sets how tightly Apex briefs each role rather than what it costs. They also still spread across distinct models on hosts whose presets are not flat.
**Effort is uniform `high`**, inherited from the session - there is no per-spawn effort param.
Use bare aliases only; never pin dated or prior-generation model IDs.

## Models & Effort

The portable skill keeps role policy semantic in
`skills/phantom/references/model-policy.json` and confines concrete defaults to
`skills/phantom/references/model-presets.json`. Resolution is explicit user
choice, optional external override, bundled host preset, then active-model
inheritance.

Every resolution diagnostic includes the canonical bundle version from
`skills/phantom/manifest.json`. This attributes routing results to the exact
portable bundle without changing existing resolver fields or precedence.

| Profile | Claude Code | Codex |
|---|---|---|
| `economy` | `sonnet` | `gpt-5.6-luna` |
| `balanced` | `sonnet` at high effort | `gpt-5.6-terra` at high effort |
| `deep` | `sonnet` at high effort | `gpt-5.6-sol` at high effort |
| `frontier` | `sonnet` at high effort | `gpt-5.6-sol` at max effort |

On Claude Code every profile resolves to the same model on purpose: Opus is
reserved for the orchestrating session, and everything Phantom delegates runs
Sonnet. Codex is untouched — its preset ladder still spreads across three
models, which is why the profiles stay semantic rather than collapsing into one.

The profiles therefore keep doing the job that survives a flat mapping: Apex
still requests `frontier` for planning, decomposition, and synthesis, and
delegated work still selects the lowest sufficient profile — `economy` for
mechanical tasks, `balanced` for well-scoped implementation, `deep` for
ambiguity or cross-cutting risk. On Claude Code that choice now sets the
seniority a role is briefed at rather than the model it costs. If a bundled
model is unavailable, the host retries without a selector and inherits the
active model. Explicit user choices are never silently replaced.

For the native compatibility plugin, `scripts/gen-agent-frontmatter.js` generates
each `agents/*.md` `model:` pin from this policy (and `model-presets.json` for
the host); a drift test fails CI on any hand-edited pin.

The following policy describes the existing native compatibility plugin only.

Phantom runs every agent at **`high`** effort - that part is universal; effort is inherited from the session and there is no per-spawn effort param.
**Scope is the per-task lever** - not effort, and no longer model either.
Only the session and **Apex** (orchestration) leave model unset and inherit the session model - run your session on **Opus 5** (`/model opus`) for the best orchestration experience.
Delegated roles never inherit the session model; they pin `sonnet` (see above), so an Opus session buys you a stronger orchestrator without spreading Opus across the whole shadow team.
See `reference/agents.md` → Model Routing.

**Run at `/effort high`, not `ultracode`.** Ultracode lets the runtime wrap a phase in a background workflow that takes no mid-run input, which can silently bypass Phantom's approval gates. Use `high` for all gated phantom work.

Opus 5 (`claude-opus-5`, the recommended session model) is a step change on long-horizon agentic work - stronger instruction-following, built-in self-verification, and fewer steers - reinforcing the subagent-driven law.
It is Phantom's top tier, and it is now orchestration-only: the session and **Apex** run on it, while every delegated role - Gaze, Archer, Hound, and Sage included - resolves to `claude-sonnet-5`.
