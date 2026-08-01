# Configuration

Phantom works without a config file. Configuration is created lazily and
controls defaults or integrations; it never grants implementation or external
action authority.

## Layered Config

Two optional JSON files are resolved with the per-repository layer winning:

- `${PHANTOM_DATA:-~/.phantom}/repos/<repo-id>/config.json`
- `${PHANTOM_DATA:-~/.phantom}/config.json`

Resolution order is explicit call override, repository config, global config,
detector, then unset. Every read reports provenance. An unset value remains
unset rather than acquiring an invented default.

Use the schema-backed CLI:

```bash
node scripts/phantom-config.js get tracker.provider --json
node scripts/phantom-config.js set tracker.provider github
node scripts/phantom-config.js set review.external none --global
node scripts/phantom-config.js list --json
```

The closed key set is:

| Key | Values or type |
|---|---|
| `tracker.provider` | `jira`, `linear`, `github`, `file`, or `none` |
| `tracker.ready_signal` | Non-empty string |
| `tracker.label` | Non-empty label without whitespace |
| `tracker.chosen` | `asked`, `detected`, or `explicit` |
| `tracker.chosen_at` | ISO 8601 timestamp |
| `jira.auto_transition` | Boolean integration preference |
| `review.external` | `greptile` or `none` |
| `spend.ceiling_usd` | Non-negative number |

Unknown keys, sections, types, and enum values are rejected. Tracker and review
settings select an integration only; the capability broker still requires a
matching node and explicit authorization before any remote mutation.

## User-Facing Environment Variables

| Variable | Default | Purpose |
|---|---|---|
| `PHANTOM_DATA` | `~/.phantom` | Neutral root for sessions, journals, learnings, audit data, and locks |
| `PHANTOM_REPO` | Automatic stable repository identity | Per-process repository shard override; must be one safe 1-120 character path segment |
| `PHANTOM_PROTECTED_BRANCHES` | `main,master,develop` plus detected default | Additional comma- or whitespace-separated protected branches |
| `PHANTOM_UNATTENDED` | unset | Set to `1` when a non-interactive host must not ask setup questions |

Workflow node budgets, retry limits, allowed paths, commands, and terminal
conditions belong in the compiled workflow plan. Environment variables do not
override those graph contracts or authorize an effect.

`PHANTOM_PROTECTED_BRANCHES` is additive. It cannot remove `main`, `master`,
`develop`, or the detected origin default. Provider-native mutation hooks
enforce the union before writes, and a missing branch or hook
capability cannot be treated as hard-enforcement evidence.

Lifecycle authority trust is separate from ordinary configuration:

```json
{
  "schema_version": 1,
  "key_id": "host-authority-2026-07",
  "source": "trusted-host-ui",
  "public_key": "-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----\n"
}
```

Store it at `${PHANTOM_DATA:-~/.phantom}/config/authority-trust.json` before
starting a session. Start pins the Ed25519 key/source identity into that
session. Changing or deleting the global file does not silently replace the
pin; approval and authorization fail closed until host trust matches.

The trusted host adapter uses that same key to issue and refresh the active
session's `capability-probe.json`. It must attest `native-tool-gate-v1`, both
enforced pre/post hooks, and the exact current repository fingerprint, with a
maximum 15-minute lifetime. Static hook registration or a declarative
capabilities artifact is insufficient. Phantom ships no private key, signer,
or automatic self-attestation path.

## Host Adapter Readiness

The Codex manifest points to `hooks/hooks.json`; the Claude plugin loads that
root file by convention. A host still has to load the hooks and issue the
signed probe; neither fact is inferred from installation.

Run the read-only status command for the current workspace:

```bash
node hooks/capability-gate.mjs doctor /path/to/workspace
node skills/phantom/scripts/phantom-doctor.mjs --workspace /path/to/workspace
```

The portable command reads the version-2 current-session pointer and active
session, then verifies any canonical native probe, signed host registration,
and isolated-executor probe in place. Runtime inputs must be private,
single-link, stable regular files. The report is schema version 2 and uses only
`not_applicable`, `not_registered`, `ready`, or `blocked`; problems are stable
codes with no paths, keys, signatures, artifacts, or raw verifier errors.
`verifier_bundled: true` and `backend_bundled: false` distinguish contract
verification from an externally provisioned executor.

The bundled native executor covers `workspace.write` only. Native Git, shell,
build, test, interpreter, and network tools are not alternate execution paths.
The portable broker can verify externally provisioned signed adapters for
sandboxed processes and typed Git/GitHub/tracker effects; each effect requires
the exact registered policy, reservation nonce, current evidence, and signed
result. Phantom bundles no backend, provider credentials, signer, or private
key. No environment flag converts an unavailable executor or probe into
authority.
