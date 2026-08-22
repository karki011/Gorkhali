# Install

Installing Phantom as a portable Agent Skill or as a native plugin on Claude Code, Codex, and Kimi Code, plus upgrade paths.

Install the same canonical directory without modifying it. Project-scoped
examples:

```bash
# Shared Agent Skills discovery convention
mkdir -p .agents/skills
cp -R /path/to/research-phantom-skills/skills/phantom .agents/skills/phantom
```

Common project discovery locations are:

| Host | Project path |
|---|---|
| Claude Code | `.claude/skills/phantom/` |
| Codex | `.agents/skills/phantom/` |
| Kimi Code | `.agents/skills/phantom/` |
| Gemini CLI | `.agents/skills/phantom/` |

The copied `phantom` directory and every file inside it, including the canonical
`manifest.json`, remain byte-identical. The manifest versions the bundle and
its portable contracts without depending on a host-specific plugin manifest.
Use each host's user-level skills directory instead when you want Phantom in
every project.

Validate the source artifact with `npm run validate:skill`. The repository test
suite also copies it into three disposable discovery layouts, compares recursive
SHA-256 digests, exercises semantic model resolution, and runs the full portable
state lifecycle.

The continuous-integration gate also runs the pinned Agent Skills reference
validator. Authenticated live-model conformance is intentionally kept off
untrusted pull-request runners: run it from an isolated trusted environment with
the same skill bytes, a disposable workspace and home directory, and ephemeral
credentials. The copied skill includes the same validated preset registry used
locally; the runner may supply an optional external override when needed.

## Native compatibility plugin

The native plugin ships `.codex-plugin/plugin.json`, `.kimi-plugin/plugin.json`,
and the legacy-compatible `.claude-plugin` marketplace. It exposes every public
workflow under `skills/` for Codex and Kimi Code while retaining Claude Code
command, agent, and hook integrations.

In Codex, open the plugin browser and install Phantom from the repository
marketplace:

```bash
git clone git@github.com:Cloudzero/research-phantom-skills.git
cd research-phantom-skills
codex
# Then, inside Codex:
/plugins
```

Select the repository marketplace, open `phantom`, and choose **Install**. Codex
recognizes the repository's legacy-compatible `.claude-plugin/marketplace.json`
and installs the native `.codex-plugin/plugin.json` bundle from the repository
root.

For Kimi Code, install from GitHub in any session:

```
/plugins install https://github.com/Cloudzero/research-phantom-skills
/reload
```

Kimi Code reads `.kimi-plugin/plugin.json` from the repository root. The bundle
exposes `./skills/` (every `phantom:*` workflow), ships the 11-role roster under
`./agents/` as delegatable plugin agents (the Claude `model:` pins in those
files are ignored by Kimi, by design), and wires the two model-agnostic
mechanical gates as plugin hooks: the routing gate on `PreToolUse` edits and
the greploop gate on `Stop`. The engineer model gate is not wired on Kimi — the
CLI has no per-spawn model selector, so Phantom's profile resolution is
recorded as routing diagnostics and delegates inherit the session model; run
sessions on `k3` for the full-fidelity path. On Kimi Code versions without a
plugin manager, copy `skills/phantom` into `.agents/skills/phantom/` as shown
above. Authenticate API-backed features such as memory compression with
`MOONSHOT_API_KEY` (or `KIMI_API_KEY`).

For Claude Code, install it from the self-hosted marketplace in this repo:

```
/plugin marketplace add Cloudzero/research-phantom-skills
/plugin install phantom@phantom
```

Codex loads the plugin's bundled skills; Claude Code discovers its commands,
agents, and hooks directly. Phantom creates mutable state and per-repository
learnings lazily on first use. No setup command or symlink is required, and
the config file is optional and created lazily on first `set`. Optional
behavior is controlled by environment variables and the optional config file
(see [Configuration](configuration.md)).

After a new remote version is published, Codex users should pull the marketplace
checkout, open `/plugins`, uninstall and reinstall `phantom`, then start a new
task or CLI session so the new cached version and skills are loaded:

```bash
git pull --ff-only
```

Claude Code users can run `/plugin update phantom`.

Prerequisites: Codex CLI or the Codex desktop app for Codex installation;
Claude Code CLI for Claude installation; Kimi Code CLI for Kimi installation;
and git for any flow. Recommended: gh CLI and Atlassian MCP. Optional: Slack
MCP and code-review-graph MCP.

## Upgrading from a pre-plugin install

If you previously used the retired manual install, remove its exact
`~/.claude/commands/phantom` and `~/.claude/agents/phantom` entries so Claude
Code cannot discover a stale copy alongside the plugin. The old flow may also
have registered these four Phantom hooks in `~/.claude/settings.json`; remove
only those entries because `hooks/hooks.json` now owns them:

- `memory-writer.js`
- `chief-subagent-driven-law.sh`
- `memory-reader.js`
- `memory-consolidator.js`

Back up `settings.json` before editing and preserve every non-Phantom hook. If
you need data from an old `~/.claude/team`, `~/.claude/phantom`, or
`~/.claude/phantom-data` directory, the optional `scripts/migrate-data.js`
utility copies its data whitelist into `PHANTOM_DATA` (or `~/.phantom` when
unset) without modifying the source. Pre-existing destination entries always
win; otherwise legacy collisions use `phantom-data`, then `phantom`, then
`team` priority. The migrator reconstructs only a valid portable active-session
pointer whose session and workspace identity still match, and reports rather
than copying stale or unsupported root markers.
