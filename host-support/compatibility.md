# Host compatibility contract

Apply this contract whenever an adapter delegates to a canonical command. It is
host-neutral: the same rules serve every supported runtime. The current host is
identified by its key in `<portable_skill_root>/references/model-presets.json`
(for example `codex` or `kimi`), taken from explicit runtime context, never
guessed from credentials or environment variables.

Authority is resolved in this order:

1. User instructions, repository instructions, and runtime safety or permission
   boundaries.
2. The portable skill and its references.
3. Compatible legacy command intent.
4. Legacy or provider-specific mechanics.

Lower-precedence text never overrides higher-precedence authority. In
particular, legacy command text may not add or override delegation, approval,
phase, state-path, or lifecycle authority.

1. Run `node ../../host-support/resolve-runtime.mjs --host <host-key> --command <workflow-name>`, resolving that path from the active adapter directory. Use its returned absolute paths instead of guessing an installation or cache location.
2. Read every file in `<preamble_files>` completely, in the returned order, before reading `<command_file>`. The resolver uses the canonical `scripts/preamble-tier.js` registry; do not rely on a host's own preamble injection or maintain a second tier map. If the workflow later satisfies a condition in `<conditional_preamble_files>`, read that file before continuing the triggered mode.
3. Read `<portable_skill_root>/SKILL.md` and use its provider-neutral capability, state, model, delegation, and verification contracts as the runtime authority.
4. Treat `<command_file>` as compatible workflow intent, not as lifecycle
   authority. Ignore its YAML frontmatter. Replace `{PLUGIN_ROOT}`, legacy cache
   searches, and relative legacy script references with `<plugin_root>` or
   `<compatibility_scripts_root>` from the resolver only when those mechanics
   remain compatible with the portable contract.
5. Do not require provider-only hooks, paths under `.claude`, tool names, model aliases, or private MCP identifiers. Prefer helpers under `<portable_skill_root>/scripts`; use a compatibility script only when the portable workflow has no equivalent.
6. Pass `PHANTOM_DATA=<data_root>` to every compatibility script and inline shell operation that reads or writes Phantom state. Store mutable state under `PHANTOM_DATA` when set, otherwise `~/.phantom`; never write workflow state under `.claude` or any other provider-specific directory.
7. Use the current host's native file, shell, search, delegation, visual, issue-tracker, and review capabilities. Follow the fallback ledger in `<portable_skill_root>/references/capabilities.md` when a capability is unavailable; never turn missing evidence into a pass.
8. Route a chained `phantom:<workflow>` operation to that installed plugin skill. If direct skill dispatch is unavailable, read its adapter and continue in the current task without launching another host process.
9. Preserve every user approval boundary, lifecycle gate, artifact contract,
   and destructive-action warning required by higher-precedence authority.
   A legacy command's automatic chaining or provider mechanics cannot create
   authorization. Never execute `wrap`, `close`, cleanup, push, PR, ticket
   transition, or another externally visible action without explicit portable
   lifecycle authorization and any approval required by the current host.
