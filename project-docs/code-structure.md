# Code Structure

Where everything lives: the portable skill tree, the native compatibility plugin tree, and the mutable state tree outside both.

## Folder Structure

The canonical portable skill and the existing native compatibility plugin live
side-by-side. The portable directory is self-contained and never imports the
native plugin tree:

```
skills/phantom/          # canonical provider-neutral Agent Skill
├── SKILL.md             # intent router and invariant workflow
├── manifest.json        # bundle and portable contract versions
├── references/          # capabilities, profiles, roles, state, workflows, QA
└── scripts/             # portable state, profile, and impact-analysis helpers

{PLUGIN_ROOT}/           # native compatibility plugin
├── .claude-plugin/    # Plugin manifest + self-hosted marketplace
│   ├── plugin.json        # Native Claude Code plugin manifest
│   └── marketplace.json   # Marketplace entry (install source)
├── commands/          # 28 command directives (+ 10 _shared partials)
├── reference/         # reference files (on-demand, injected by hooks)
│   ├── router.md          # Classification algorithm, deliberation protocol
│   ├── brainstorm.md      # Diverge/converge protocol, question-asking rules
│   ├── wiring.md          # Dependency topology, wave assignments
│   ├── planning.md        # Machine-checkable criteria, anti-placeholder rules
│   ├── detective-protocol.md  # 7-step investigation with HTML reports
│   ├── _base-agent.md     # Template for spawning new agent types
│   └── ...
├── agents/            # 12 agent personas
├── bin/               # thin executable entry shims; logic lives in scripts/ (e.g., bin/phantom-preflight → scripts/preflight.js)
├── scripts/           # deterministic helpers (no LLM needed)
│   ├── validate-artifact.js   # JSON schema validation
│   ├── check-learnings-index.js
│   ├── session-health.sh
│   ├── preamble-tier.js
│   ├── timing-report.js       # per-model agent timing (wall-clock by model)
│   ├── phantom-config.js      # config CLI: get/set/list (see Configuration)
│   ├── baseline-report.js     # read-only retrospective miner: PR/merge rates, spawn counts, policy-vs-observed model
│   ├── outcome-write.js       # writes the per-ticket outcome record (closed pr_state enum); called from wrap and close
│   ├── route-report.js        # read-only route-effectiveness miner: per-session-route outcome aggregates with attribution caveats
│   ├── run-guard.js           # unattended-run guard: spend ceiling + stuck detection
│   ├── gen-agent-frontmatter.js  # regenerates agents/*.md model pins from model-policy.json; --check is the CI drift gate
│   └── release-version.js     # keeps the three plugin manifests' versions in sync; --check / --set <semver>
├── evals/             # 55 test cases for skill triggering verification
├── hooks/             # Structural enforcement
│   ├── hooks.json         # Plugin-owned hook registrations
│   └── timing-capture.js  # records agent spawn/stop + model (PreToolUse Agent + SubagentStop)
└── templates/         # Reusable contract templates
```

Portable mutable state lives outside the skill under
`${PHANTOM_DATA:-~/.phantom}`. Set `PHANTOM_DATA` to use an explicit root;
otherwise every supported runtime uses `~/.phantom`:

```
${PHANTOM_DATA:-~/.phantom}/
├── state/current-session/{repo-id}.json
├── repos/{repo-id}/
│   ├── sessions/{task-id}/       # active portable artifacts and run evidence
│   ├── completed/{task-id}/      # completed sessions are retained, not deleted
│   └── learnings/                # provider-neutral corrections and patterns
├── global/patterns/
├── audit/
└── locks/
```
