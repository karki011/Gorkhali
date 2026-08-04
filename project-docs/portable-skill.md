# Portable Agent Skill

What the provider-neutral skill bundle contains, how it negotiates host capabilities at runtime, and why it has no external plugin dependencies.

## Portable Agent Skill

The canonical product is one provider-neutral Agent Skill at
`skills/phantom/`. Copy that directory unchanged into any Agent
Skills-compatible discovery path. It contains no provider paths, proprietary
tool calls, or plugin manifests. Host-specific model identifiers are isolated
in one data-only preset registry; the workflow remains provider-neutral.

The skill negotiates capabilities at runtime. Delegation, parallel execution,
native dependency graphs, visual tools, hooks, issue trackers, and review
publishing are optional accelerators with explicit fallbacks. When no native
graph is exposed, the skill runs its bundled, read-only impact analyzer through
ordinary command execution. It builds a bounded import graph for that invocation,
returns JSON, and exits; it installs no server, daemon, hook, or host registration.
The workflow and artifact contracts remain the same when optional capabilities
are missing.

Apex makes the delegation decision automatically after routing and dependency
inspection. Users provide the goal; they do not need to request subagents,
choose a worker count, or maintain per-worker model settings. Phantom uses the
smallest useful topology, delegates only through native host capabilities, and
falls back to labeled sequential role passes when spawning is unavailable or
not worthwhile. It never recursively launches the current runtime through
command execution to imitate a native worker.

Phantom also applies a minimum-sufficient-solution ladder after it understands
the real code path: omit what is unnecessary, then prefer repository reuse,
the standard library, native platform capabilities, installed dependencies,
and direct expressions before writing the smallest custom implementation. The
same constraint is included in every delegated assignment and checked again by
Sweep. This policy is adapted from the ideas in
[Ponytail](https://github.com/dietrichgebert/ponytail); Phantom does not bundle
Ponytail's hooks, modes, adapters, or runtime dependency.

Phantom asks for semantic profiles - `inherit`, `economy`, `balanced`, `deep`,
or `frontier` - and ships maintained defaults for Claude Code and Codex. Users
do not need a `models.json`. An explicit user choice or optional external map
can override the defaults; unknown hosts inherit the active model. See
`skills/phantom/references/models.md`.

## Independence

**Zero external plugin dependencies.** Previously depended on superpowers (14 skills), feature-dev, and code-sweep plugins. All have been:
- Superpowers: disabled, all 6 references replaced with own implementations
- Feature-dev: disabled, reference removed from gaze.md
- Code-sweep: absorbed into `agents/sweep.md` (plugin still enabled as backup, can be disabled)
