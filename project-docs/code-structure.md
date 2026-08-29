# Code Structure

Where everything lives: the portable skill tree, the native compatibility plugin tree, and the mutable state tree outside both.

## Folder Structure

The canonical portable skill and the existing native compatibility plugin live
side-by-side. The portable directory is self-contained and never imports the
native plugin tree:

```
skills/gorkhali/          # canonical provider-neutral Agent Skill
├── SKILL.md             # intent router and invariant workflow
├── manifest.json        # bundle and portable contract versions
├── references/          # capabilities, profiles, roles, state, workflows, QA
└── scripts/             # portable state, profile, impact-analysis, and SDLC-chain helpers

{PLUGIN_ROOT}/           # native compatibility plugin
├── .claude-plugin/    # Plugin manifest + self-hosted marketplace
│   ├── plugin.json        # Native Claude Code plugin manifest
│   └── marketplace.json   # Marketplace entry (install source)
├── .codex-plugin/     # Codex plugin manifest (exposes ./skills/)
├── .kimi-plugin/      # Kimi Code plugin manifest (skills + agents + hook gates)
├── host-support/      # host-neutral compatibility contract + --host resolver
├── codex-support/     # backward-compat shims pointing at host-support/
├── commands/          # 30 command directives (+ 9 _shared partials)
├── reference/         # reference files (on-demand, injected by hooks)
│   ├── router.md          # Classification algorithm, deliberation protocol
│   ├── brainstorm.md      # Diverge/converge protocol, question-asking rules
│   ├── wiring.md          # Dependency topology, wave assignments
│   ├── planning.md        # Machine-checkable criteria, anti-placeholder rules
│   ├── detective-protocol.md  # 7-step investigation with HTML reports
│   ├── _base-agent.md     # Template for spawning new agent types
│   └── ...
├── agents/            # 12 agent personas
├── bin/               # thin executable entry shims; logic lives in scripts/ (e.g., bin/gorkhali-preflight → scripts/preflight.js)
├── scripts/           # deterministic helpers (no LLM needed)
│   ├── validate-artifact.js   # JSON schema validation
│   ├── check-learnings-index.js
│   ├── session-health.sh
│   ├── preamble-tier.js   # canonical tier registry (command blockquotes + _shared.md table render from it)
│   ├── repo-detect.js     # repo facts (id, stack, package manager, monorepo, has_ui, verify commands) as JSON
│   ├── timing-report.js       # per-model agent timing (wall-clock by model)
│   ├── gorkhali-config.js      # config CLI: get/set/list (see Configuration)
│   ├── baseline-report.js     # read-only retrospective miner: PR/merge rates, spawn counts, policy-vs-observed model
│   ├── outcome-write.js       # writes the per-ticket outcome record (closed pr_state enum); called from wrap and close
│   ├── route-report.js        # read-only route-effectiveness miner: per-session-route outcome aggregates with attribution caveats + priced cost join
│   ├── route-bias.js          # proposes the router correction.bias from measured per-route outcomes (dry-run first, --apply writes learnings)
│   ├── run-guard.js           # unattended-run guard: spend ceiling + stuck detection
│   ├── gen-agent-frontmatter.js  # regenerates agents/*.md model pins from model-policy.json; --check is the CI drift gate
│   └── release-version.js     # keeps the four plugin manifests' versions in sync; --check / --set <semver>
├── evals/             # 55 test cases for skill triggering verification
├── hooks/             # Structural enforcement
│   ├── hooks.json         # Plugin-owned hook registrations
│   └── timing-capture.js  # records agent spawn/stop + model (PreToolUse Agent + SubagentStop)
└── templates/         # Reusable contract templates
```

Portable mutable state lives outside the skill under
`${GORKHALI_DATA:-~/.gorkhali}`. Set `GORKHALI_DATA` to use an explicit root;
otherwise every supported runtime uses `~/.gorkhali`:

```
${GORKHALI_DATA:-~/.gorkhali}/
├── state/current-session/{repo-id}.json
├── repos/{repo-id}/
│   ├── sessions/{task-id}/       # active portable artifacts and run evidence
│   ├── completed/{task-id}/      # completed sessions are retained, not deleted
│   └── learnings/                # provider-neutral corrections and patterns
├── global/patterns/
├── audit/
└── locks/
```
