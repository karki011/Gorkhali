# Phantom roadmap

Author: Subash Karki

<!-- generated:roadmap-status:start -->
Package `0.3.2` publishes portable bundle `3.0.1` with 20 versioned contracts, 942 completed test cases, and 51 declared isolated evaluation cases.
<!-- generated:roadmap-status:end -->

Phantom is evolving into a deterministic, replayable AI engineering harness.
Probabilistic workers may recommend, implement, and evaluate; code owns the
control plane.

## Current release

The 0.3.0 branch establishes the first control-plane slice. It is not a
turnkey end-to-end deployment until a trusted host configures probe issuance
and any required external executors:

- versioned workflow-plan, workflow-event, aggregation, evaluation, and
  capability-request contracts;
- deterministic DAG compilation, transition reduction, transitive
  invalidation, bounded retries, budgets, and terminal states;
- parallel fan-out/fan-in with scope, baseline, conflict, and verification
  checks;
- append-only digest-chained journals, materialized state, strict replay, and
  optimistic concurrency;
- an explicit, bounded v1-to-v2 session-state migrator with read-only Doctor
  guidance, private inventory manifests, atomic journals, crash-safe durable
  publication, verification, and guarded rollback;
- a typed capability broker for workspace writes, commands, commits, pushes,
  draft pull requests, and tracker comments, with bundled native interception
  limited to workspace writes and trusted control-plane invocations;
- per-case materialized evaluation fixtures behind a fail-closed Claude
  tool-access boundary, plus review-attributed, digest-bound routing truth;
- direct portable skill actions with no command, agent-prompt, compatibility,
  alias, or legacy enforcement layer;
- risk-selected delegation and evaluation, complete finding retention,
  semantic compute profiles, and concise progress/artifact policy.

## Measurement status

The fresh workflow journal is the only source for control-plane metrics.
`scripts/workflow-metrics.mjs` currently derives:

- `verified_completion_rate`;
- `time_to_verified_completion_ms`;
- `workflow_replay_success_rate`.

Every result includes numerator, denominator, source, and coverage. Whole-task
cost and observed human-intervention metrics remain unavailable until their own
events exist. They are reported as unavailable, never inferred from mutable
sessions or model claims.

The previous evaluation baseline is not comparable because it ran in the
repository under test with ambient state and settings. The new per-case
environment and tool-access boundary are executable and covered; publish a new
score only after a complete live run whose candidate model, judge model,
timeout, case selection, CLI, fixtures, truth, harness, and plugin provenance
are recorded.

## Next priorities

### P0 — Prove the release

1. Run the complete tool-restricted live evaluation suite and publish the first
   baseline with full execution provenance and review-attributed truth digests.
2. Configure an external signed-probe issuer, sandboxed build/test executor,
   and explicit draft-PR executor, then exercise the plan → parallel
   implementation → aggregation → bounded evaluation → authorized draft-PR
   workflow and publish replay-success evidence.
3. Add journal events for whole-task cost and actual human interventions.

### P1 — Host parity and operations

1. Add adapter conformance fixtures that run the same workflow graph across
   supported hosts and compare artifacts and terminal decisions.
2. Surface unavailable capabilities and policy denials through the health
   action without weakening gates.
3. Add a read-only workflow/journal visualization after the underlying replay
   contract proves stable.
4. Add external-action adapters only when they can use the typed broker and
   provider idempotency keys.

### P2 — Advisory optimization

1. Record shadow recommendations for route, topology, compute profile, cost,
   duration, and verification-failure probability.
2. Compare those recommendations through counterfactual replay on
   review-attributed, digest-bound tasks.
3. Permit learned selection only among policy-approved options, with
   deterministic fallback for low confidence, missing features, disagreement,
   or distribution shift.

Reinforcement learning and autonomous self-editing remain out of scope until
Phantom has reproducible environments, reliable rewards, and a large body of
review-attributed, digest-bound examples. Merge rate is context, not a reward.

## Release gates

A release is ready only when:

- every published skill maps to one declared portable action;
- all workflow and capability contracts validate;
- journals replay to the recorded materialized state without model calls;
- external effects have authorized, idempotent decision and outcome events;
- the full suite, portable validator, generated metadata check, and synchronized
  plugin-version check pass;
- documentation contains no retired runtime path or implicit shipping policy.
