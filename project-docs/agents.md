# Shadows, Models and Effort

The agent roster, the single policy file that routes each role to a model, and the effort rules that apply to every run.

## Shadows

| Agent | Role |
|-------|------|
| Chief | Orchestrator - plans, decomposes, coordinates, runs router, routes models |
| Engineer | Implementation - parallel execution with ROLE FOCUS directives |
| Inspector | QA - lint, build, test verification |
| Auditor | Quality gate - power level (scored, P0-P3) |
| Advisor | Advisory - guidance for stuck agents (<100 words) |
| Surveyor | Explicit opt-in visual inspection - advisory screenshots and observations |
| Justice | Cross-file review - pre-PR structural analysis |
| Opposition | The one plan critic - adversarial challenge plus pre-execution validation (learnings collisions, blast radius, coverage gaps, scope creep, dependency order) |
| Detective | Forensic investigator - 7-step protocol, HTML reports |
| Steward | Code clarity - simplify changed files post-verify |
| Clerk | Mechanical session-lifecycle executor - ship/close plumbing: git, gh PR, Jira transitions, cost scripts, artifact writes |

Role-to-profile mapping lives in `skills/gorkhali/references/model-policy.json`, and profile-to-model per host lives in `skills/gorkhali/references/model-presets.json`.
`scripts/gen-agent-frontmatter.js` generates each `agents/*.md` `model:` pin from that policy, and a drift test fails CI on a hand-edited pin.

Delegated work runs on a ladder: on this host `model-presets.json` maps `economy` onto `haiku` and `balanced`/`deep` onto `sonnet` at high effort, while `frontier` inherits the session model — opus is reserved for the orchestrating session, and the mechanical rung (Inspector, Clerk) now costs haiku.
That is a property of the preset file, not a runtime check: `hooks/engineer-model-gate.js` denies only a retired Fable-tier pin on an implementer and an `engineer` spawn that set no explicit model.
The escalation ladder is therefore just **re-decompose**. There is no richer model to hand a struggling subtask to — `deep` resolves to the same sonnet-high as `balanced` here — so scoping that fails is fixed by splitting the assignment, not by re-routing it.
The profiles in `model-policy.json` still matter, and are unchanged: **Auditor** and **Justice** sit at the review tier and **Advisor** at the top rung, which sets both how tightly Chief briefs each role and — now that the ladder is live — what it costs. They also still spread across more distinct models on hosts whose presets spread further.
**Effort is uniform `high`**, inherited from the session - there is no per-spawn effort param.
Use bare aliases only; never pin dated or prior-generation model IDs.

## Models & Effort

The portable skill keeps role policy semantic in
`skills/gorkhali/references/model-policy.json` and confines concrete defaults to
`skills/gorkhali/references/model-presets.json`. Resolution is explicit user
choice, optional external override, bundled host preset, then active-model
inheritance.

Every resolution diagnostic includes the canonical bundle version from
`skills/gorkhali/manifest.json`. This attributes routing results to the exact
portable bundle without changing existing resolver fields or precedence.

| Profile | Claude Code | Codex | Kimi Code |
|---|---|---|---|
| `economy` | `haiku` | `gpt-5.6-luna` | `kimi-for-coding` (K2.7 Code tier) |
| `balanced` | `sonnet` at high effort | `gpt-5.6-terra` at high effort | `k3-256k` at high effort |
| `deep` | `sonnet` at high effort | `gpt-5.6-sol` at high effort | `k3` at high effort |
| `frontier` | session model (inherit) | `gpt-5.6-sol` at max effort | `k3` at max effort |

On Claude Code the ladder now costs what it says: Opus is reserved for the
orchestrating session (frontier inherits it), the mechanical rung drops to
Haiku, and balanced/deep keep Sonnet at high effort as the review quality
floor. Kimi Code spreads instead: routine mechanical work lands on the K2.7
Code tier, ordinary delegation on the half-quota 256k K3, and only deep or
frontier work on the full 1M `k3` — with K3's `reasoning_effort` mapping
directly onto Gorkhali's effort field (`high`/`max`). All four model IDs are
Kimi's own, so a Kimi-routed session cannot silently request Anthropic or
OpenAI compute. Codex is untouched — its preset ladder still spreads across
three models, which is why the profiles stay semantic rather than collapsing
into one.

Kimi caveat: the CLI's agent-file format has no per-agent `model` field
(foreign `model:` pins are ignored), and no per-spawn model selector is
documented for its Agent tool. Until one exists, the tiered Kimi preset records
routing intent in the delegation diagnostics while sub-agents inherit the
session model — `delegation.model_select` is `unavailable` on Kimi per the
capability ledger, and the engineer model gate is therefore not wired into the
Kimi plugin manifest (its no-model deny rule would fire on every spawn).

The profiles therefore keep doing their job under a partially shared mapping:
Chief still requests `frontier` for planning, decomposition, and synthesis, and
delegated work still selects the lowest sufficient profile — `economy` for
mechanical tasks, `balanced` for well-scoped implementation, `deep` for
ambiguity or cross-cutting risk. On Claude Code that choice sets both the
seniority a role is briefed at and the model it costs. If a bundled
model is unavailable, the host retries without a selector and inherits the
active model. Explicit user choices are never silently replaced.

For the native compatibility plugin, `scripts/gen-agent-frontmatter.js` generates
each `agents/*.md` `model:` pin from this policy (and `model-presets.json` for
the host); a drift test fails CI on any hand-edited pin.

The following policy describes the existing native compatibility plugin only.

Gorkhali runs every agent at **`high`** effort - that part is universal; effort is inherited from the session and there is no per-spawn effort param.
**Scope is the per-task lever** - not effort, and model only via the role's policy rung.
Only the session and **Chief** (orchestration) leave model unset and inherit the session model - run your session on **Opus 5** (`/model opus`) for the best orchestration experience.
Delegated roles never inherit the session model; they pin the resolved preset model (`haiku` for the economy rung, `sonnet` above it), so an Opus session buys you a stronger orchestrator without spreading Opus across the whole shadow team.
See `reference/agents.md` → Model Routing.

**Run at `/effort high`, not `ultracode`.** Ultracode lets the runtime wrap a phase in a background workflow that takes no mid-run input, which can silently bypass Gorkhali's approval gates. Use `high` for all gated gorkhali work.

Opus 5 (`claude-opus-5`, the recommended session model) is a step change on long-horizon agentic work - stronger instruction-following, built-in self-verification, and fewer steers - reinforcing the subagent-driven law.
It is Gorkhali's top tier, and it is now orchestration-only: the session and **Chief** run on it, while every delegated role - Auditor, Justice, Detective, and Advisor included - resolves to `claude-sonnet-5` or, for the economy rung (Inspector, Clerk), `claude-haiku`.
