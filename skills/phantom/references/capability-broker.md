# Capability broker

Author: Subash Karki

The capability broker is Phantom's only policy boundary for consequential operations. A model, role, host adapter, or workflow node may request an operation; none of them may authorize itself or execute through an undocumented alternate path.

## Contract

Every request must validate against `../schemas/capability-request.schema.json` and bind to:

- the active session and workflow;
- one active workflow node;
- the exact current worktree fingerprint;
- the node's allowed paths, commands, and working directories;
- an available runtime capability;
- a fresh signed host-interception probe;
- remaining cost and duration budgets;
- the current signed lifecycle authority decision;
- an idempotency reservation or prior execution.

`allowed_commands` entries are dormant exact-argv declarations in version 1.
The broker unconditionally denies every `process.exec` request, including
shells, interpreters, wrappers, and Git/GitHub commands. Registration or a
reported runtime capability cannot enable it. A later release must define a
separately versioned, signed sandbox-executor attestation and enforcement
contract before these declarations can become executable.

Supported request types are `workspace.write`, `process.exec`, `git.commit`,
`git.push`, `github.openDraftPr`, and `tracker.comment`. Version 1 is a fresh
contract: snake-case variants, omitted bindings, unknown fields, and legacy
request shapes are invalid.

Critical-risk work may not execute through a `direct` route. A draft PR additionally requires both `ship-draft-pr` authorization and a current `ready` ship gate. Tracker comments require their own external authorization; draft-PR authority never implies tracker authority.

External requests run only from a matching `external-action` node: `git-push`
for `git.push`, `draft-pr` for `github.openDraftPr`, and `tracker-comment` for
`tracker.comment`. A task node cannot acquire external authority merely by
constructing the request shape.

## Execution protocol

1. Compile and start the workflow node.
2. Construct the typed request from recorded artifacts, never from an unvalidated model claim.
3. Call:

   ```text
   node scripts/authorize-capability.mjs authorize \
     --workspace <repo> --task <task> --input <request.json>
   ```

4. Execute only when the returned status is `authorized`. A `duplicate` result points to the existing reservation or completed effect and must not execute again. `denied` fails the node closed.
5. Record the external outcome immediately:

   ```text
     node scripts/authorize-capability.mjs outcome \
     --workspace <repo> --task <task> \
     --input <request.json> \
     --decision-digest <sha256:...> --status succeeded \
     --external-id <provider-id>
   ```

Failed outcomes may retry the identical request within workflow limits. A succeeded outcome is immutable. Reusing an idempotency key for a different request is always denied.

Capability decisions and outcomes are node-bound events in the canonical,
digest-chained `workflow/events.jsonl` journal. Host adapters may project them
into their own UI, but must not rewrite them or infer success from a missing
outcome.

An authorized decision creates one durable reservation under
`capability/reservations/pending/`. Its hard-enforcement binding includes the
signed lifecycle-authority digest, signed interception-probe digest, worktree
fingerprint, branch and protected set, request/body/tree digests, exact
argv/cwd, and affected paths. A native
PreToolUse adapter must prove the complete binding and move that exact file
generation to `consuming/` before allowing the effect. PostToolUse records the
typed outcome and moves it to `completed/`. A second claim is denied. A crash
or missing outcome leaves the reservation consuming and requires explicit
reconciliation; it never silently returns to pending.

The bundled provider-neutral hooks enforce this protocol for common native
file-write, edit, and patch event shapes. Existing targets and stable postflight
generations must be canonical regular files with one physical link; host
workspace adapters must enforce the same no-hardlink contract because request
policy alone has no inode evidence. `.git`, `.gitconfig`, `.gitattributes`,
`.gitmodules`, `.phantom`, and the active Phantom data/session/control roots are
always protected at any workspace-relative depth, even under scope `.`.
Unknown write/exec-like tools fail closed while a compiled active workflow
exists. Native shell and process execution is blocked except for exact trusted
Phantom control-plane invocations. `process.exec` remains denied without the
versioned signed enforcement contract; adapter registration is insufficient.

Control inputs use the active session's one-shot `control-inputs/` channel.
PreToolUse atomically reserves a new safe `.json` name with an exclusive claim;
a second preflight loses even while the target is absent. PostToolUse stages
only the exact reserved body and immutable file generation. Existing names,
byte-identical replays, edits, symlinks, overwrites, arbitrary session paths,
and workspace files are denied. Trusted commands require both immutable claims
and single-open the still-matching staged generation.

The trusted host adapter must issue and refresh
`<session>/capability-probe.json` whenever the repository fingerprint or the
short evidence lifetime changes. The probe is an Ed25519-signed
`native-tool-interception` record bound to the pinned host key/source,
repository, task, fingerprint, `native-tool-gate-v1`, and enforced pre/post
hooks. Static plugin hook registration, a capabilities artifact, or the
presence of hook files is not interception evidence. Phantom bundles no probe
signer or private key and never self-attests; an absent, stale, expired, or
forged probe denies every consequential capability.
