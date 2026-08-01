# Capability broker

Author: Subash Karki

The capability broker is Phantom's only policy boundary for consequential operations. A model, role, host adapter, or workflow node may request an operation; none of them may authorize itself or execute through an undocumented alternate path.

## Contract

Every request validates exactly against
`../schemas/capability-request.schema.json`. Request schema version 1 is the
current fresh contract, not a compatibility format: omitted bindings,
snake-case aliases, legacy shapes, and unknown fields are invalid. Supported
request types are:

- `workspace.write`;
- `process.exec`;
- `git.commit`;
- `git.push`;
- `github.openDraftPr`;
- `tracker.comment`.

An authorized request produces a version 2 capability reservation bound to:

- the active session and workflow;
- one active workflow node;
- the exact current worktree fingerprint;
- the node's allowed paths, commands, and working directories;
- an available runtime capability;
- the applicable native interception or signed host-adapter evidence;
- remaining cost and duration budgets;
- the current signed lifecycle authority decision;
- one immutable idempotency key, decision digest, execution nonce, and
  reservation digest.

Critical-risk work may not execute through a `direct` route. A draft PR additionally requires both `ship-draft-pr` authorization and a current `ready` ship gate. Tracker comments require their own external authorization; draft-PR authority never implies tracker authority.

A draft-PR request binds the exact `baseRef`, `headSha`, `titleDigest`, and
`bodyDigest`. The broker derives the provider-result expectations from that
authorized request. A host attestation cannot substitute the base branch,
title, or body and then make its own substituted values authoritative.

External requests run only from a matching `external-action` node: `git-push`
for `git.push`, `draft-pr` for `github.openDraftPr`, and `tracker-comment` for
`tracker.comment`. A task node cannot acquire external authority merely by
constructing the request shape.

## Authorization and reservation lifecycle

1. Compile and start the workflow node.
2. Construct the typed request from recorded artifacts, never from an unvalidated model claim.
3. Call:

   ```text
   node scripts/authorize-capability.mjs authorize \
     --workspace <repo> --task <task> --input <request.json>
   ```

4. Execute only when the returned status is `authorized`. `duplicate` means the
   identical effect already has authoritative evidence and must not execute
   again. `denied` fails the node closed.

The broker creates an independent `0600`, single-link reservation using an
exclusive create. Its legal lifecycle is:

```text
staged -> pending -> consuming -> completed
                                -> indeterminate
indeterminate -> consuming -> completed
```

Transitions validate the complete version 2 envelope. A claim cannot replace
or mutate an earlier file generation, and a repeated nonce, reservation,
decision, attestation, or successful idempotency key is rejected across nodes,
retries, and invalidation. A crash that leaves a claim in `consuming` fails
closed and requires reconciliation; it never silently returns to `pending`.

Capability decisions and outcomes are immutable version 2 payloads in the
canonical digest-chained `workflow/events.jsonl` journal. Missing outcome
evidence is never treated as success, and invalidating node-local evidence does
not erase the workflow's global replay history. Each request declares its exact
maximum cost and duration. Authorization reserves and deducts that full amount;
the first outcome moves the same amount from node-reserved to node-consumed
budget without a second workflow deduction. Reconciliation retains the original
charge and cannot charge it again.

The journal payload never substitutes digest strings for evidence. Each
decision carries immutable references to its canonical request and, for an
authorization, its reservation binding plus every applicable trust,
registration, policy, and baseline snapshot artifact. A signed outcome adds
the exact attestation, result, execution-evidence, and workspace-after artifacts.
The event must name the complete evidence set and no extras. Capability
artifacts are private `0600`, single-link files whose content-addressed path
hashes the canonical JSON value and whose bytes must be exactly that canonical
JSON followed by one newline. Append and replay reject missing, mutated,
reformatted, rebound, symlinked, or hard-linked evidence.

One unresolved authorized effect freezes the complete workflow. Until its
matching final outcome is recorded, the only legal transition is that outcome;
an indeterminate result similarly permits only its one bound reconciliation.
The broker may return a denial during this freeze but cannot append a new
decision. An invalidated external-action node retains its exact successful
decision and outcome, allowing deterministic completion without executing the
effect again only when its dependency input references are unchanged. Changed
input artifact digests make that evidence stale even if the worktree fingerprint
string is unchanged.

## Native workspace writes

Provider-neutral PreToolUse hooks normalize supported native write, edit, and
patch events. Before allowing bytes to change they validate the full
reservation binding, append bounded `write_preflight` inode evidence, and claim
the reservation into `consuming/`. PostToolUse verifies the resulting stable
file generations, appends the typed outcome, and finalizes the reservation.

The native finalization command is reserved for the claimed native-write lane:

```text
node scripts/authorize-capability.mjs outcome \
  --workspace <repo> --task <task> \
  --input <request.json> \
  --decision-digest <sha256:...> --status succeeded
```

Existing targets and postflight generations must be canonical regular files
with one physical link. `.git`, `.gitconfig`, `.gitattributes`, `.gitmodules`,
`.phantom`, and active Phantom data, session, and control roots are protected
at every workspace-relative depth. Unknown write or execution tools fail
closed while a governed workflow is active. Native shell commands remain
blocked except for exact trusted Phantom control-plane invocations.

Hook policy discovers governed roots from the stable host project, invocation
root, and canonical absolute targets. A caller-controlled event `cwd`, sibling
directory, or symlink alias cannot move an operation outside an active
repository's policy boundary.

Control inputs use the active session's one-shot `control-inputs/` channel.
PreToolUse exclusively reserves a safe new JSON name; PostToolUse stages only
the exact body and immutable generation. Existing names, byte-identical
replays, edits, symlinks, overwrites, arbitrary session paths, and workspace
files are denied.

## Signed host execution

`process.exec`, Git, GitHub, and tracker effects require a registered host
adapter rooted in pinned Ed25519 trust, a signed enforcement policy, a stable
baseline snapshot, and a fresh signed execution attestation. Registration
alone never enables execution. The attestation binds the exact request,
decision, reservation, nonce, argv/cwd or provider payload, pre/post workspace
evidence, and result.

`process.exec` is allowed only through the signed isolated-executor contract:
exact argv and cwd, declared writable paths, a bounded environment allowlist,
no provider credentials, no network, no control-state writes, no protected Git
targets, and verified filesystem deltas. Shells, wrappers, interpreters, or
different arguments do not inherit authority from an allowed command.

The host submits execution evidence with:

```text
node scripts/authorize-capability.mjs attest \
  --workspace <repo> --task <task> \
  --input <signed-attestation.json>
```

An `indeterminate` attestation preserves the original result and workspace
evidence and permits exactly one signed `reconciled` attestation for the same
reservation. The broker re-verifies the original registration, trust, policy,
and attestation at their recorded historical time, then authenticates the
reconciliation with a currently live trusted registration for the same adapter
identity, host instance, session scope, and unchanged capability policy. Key
rotation is therefore allowed, but adapter, scope, trust, or policy substitution
is not. Reconciliation cannot execute the effect again, expand authority, or
bind new execution evidence. It must resolve to `succeeded` or `failed`;
otherwise the workflow remains fail-closed.

## Runtime readiness

The trusted host adapter must issue and refresh
`<session>/capability-probe.json` whenever the repository fingerprint or the
short evidence lifetime changes. The probe is an Ed25519-signed
`native-tool-interception` record bound to the pinned host key/source,
repository, task, fingerprint, `native-tool-gate-v1`, and enforced pre/post
hooks. Static plugin hook registration, a capabilities artifact, or the
presence of hook files is not interception evidence. Phantom bundles no probe
signer or private key and never self-attests; an absent, stale, expired, or
forged probe denies every consequential capability.

`phantom-doctor` derives a sanitized version 2 readiness report from the active
session. It verifies native interception, signed host registration/trust/policy,
and isolated-executor evidence without disclosing paths, commands, keys, or
credentials. Phantom bundles the schemas and verifiers, but not an execution
backend, signer, private key, provider credential, or network authority. When
required runtime evidence is unavailable, the workflow must fail closed or be
recompiled to a topology that does not require that capability.
