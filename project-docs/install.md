# Install

Phantom is distributed as one Agent Skills tree. Install the complete `skills/`
directory so the canonical `phantom` control plane and every direct public
action stay together.

## Project-Scoped Agent Skills

For a host that uses the shared Agent Skills convention:

```bash
mkdir -p .agents/skills
cp -R /path/to/research-phantom-skills/skills/. .agents/skills/
```

If the host uses a different discovery directory, copy the same `skills/`
contents there without modification. User-level discovery directories can be
used to make Phantom available across projects.

Do not copy only one action directory. Each direct action reads
`skills/phantom/SKILL.md` and its versioned references, schemas, and scripts.

Validate the source distribution before copying:

```bash
npm run validate:skill
```

The validator checks the canonical bundle, registry-derived contract resource
digest, complete and unique ownership of every public schema, direct action
registry, model policy, and absence of retired runtime roots.

## Plugin Distribution

The repository also includes `.claude-plugin/` and `.codex-plugin/` manifests.
Both distributions expose the same `skills/` tree and portable action
contracts; there is no separate command or persona implementation. The Codex
manifest explicitly registers `hooks/hooks.json`, using the host-provided
plugin root for executable paths.

For a local marketplace checkout:

```bash
git clone git@github.com:Cloudzero/research-phantom-skills.git
cd research-phantom-skills
npm run validate:skill
```

Then add or install that checkout with the host's plugin browser. For a
self-hosted marketplace that accepts the repository identifier:

```text
plugin marketplace add Cloudzero/research-phantom-skills
plugin install phantom@phantom
```

After installation or update, start a new task or host session so its skill
inventory reloads.

Hook installation is not a complete production adapter. Before consequential
work in an active Phantom session, a trusted host must provision
`authority-trust.json` and externally issue fresh signed
`capability-probe.json` records. The package contains no signing secret or
self-attestation mechanism. External process, Git, pull-request, and tracker
effects require a registry-signed session registration plus nonce-bound result
attestations; no backend, provider credential, signer, or private key is
bundled. Native command tools remain denied, and registration text without the
matching signed execution evidence cannot enable an effect.

Use `node hooks/capability-gate.mjs doctor <workspace>` to inspect these
requirements. A missing capability remains unavailable rather than falling
back to an unbrokered effect.

## Update

Update the source checkout, validate it, then refresh the installed skills or
reinstall the plugin:

```bash
git pull --ff-only
npm run validate:skill
```

Mutable sessions are not stored in the plugin cache. They remain under
`${PHANTOM_DATA:-~/.phantom}` and can be resumed after an update when their
contract versions remain supported. New workflow contracts fail closed rather
than converting unversioned historical events.

## Requirements

- An Agent Skills-compatible host or supported plugin browser
- Node.js for the deterministic helpers and validation
- Git when repository identity or Git effects are used

Issue trackers, review services, visual tools, native delegation, and native
dependency graphs are optional capabilities. Their absence is recorded and
uses the declared fallback; it does not change workflow meaning or approval
gates.
