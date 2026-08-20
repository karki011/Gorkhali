# Seat provenance design (F11)

This document specifies the implementation-ready design for ROADMAP F11: recording which model actually SERVED each Agent-tool dispatch, without trusting a subagent's self-report of its own identity.
It is an investigation-first design doc, not a code change.
No code in this repository was modified to produce it.

## 0. The headline finding

F11 already prints numbers that look like served-model proof: `auditor deep opus opus match` alongside `opus:18 sonnet:7` for OBSERVED, and ROADMAP.md line 257 calls that OBSERVED column "the real signal."
It is not.

`scripts/baseline-report.js`'s `observedModels()` (line 584) reads its numbers from the `timing` object, which is `hooks/timing-capture.js`'s NDJSON log.
That log's `model` field is resolved as param over frontmatter pin over session-inherited, entirely from the tool call the harness was ASKED to make.
It never touches anything the runtime actually served.
So the F11 finding is real drift in what got requested spawn to spawn, which is worth knowing, but it is not evidence of runtime seat substitution, and the two are not the same claim.
A caller passing an explicit `model` param on some calls and relying on the frontmatter pin on others produces the exact same `opus:18 sonnet:7` shape as a runtime silently swapping seats behind an unchanged request would.
Today's data cannot tell those two apart.
That is the actual gap F11 needs closed, and it is narrower and more specific than "the auditor sometimes runs cheap."

## 1. Evidence sources investigated

Every source below was inspected directly in this repository and against live transcript data, not assumed from documentation.

### 1a. `hooks/timing-capture.js`, spawn event (PreToolUse, matcher `Agent|Task`)

This is the only source in the harness that currently writes anything about model identity for an Agent dispatch.
Observed sample line from `~/.phantom/timing/research-phantom-skills-490f3d276e.jsonl` (captured under pre-0.8.0 role naming; `agent` reads the old subagent_type `blade`, which is `engineer` post-rename; every sample quoted verbatim in this document is left exactly as recorded, for the same reason):

```json
{"event":"spawn","ts":"2026-08-19T04:52:15.455Z","sid":"6af5f5ab-63e7-4060-990c-52952b278d1c","id":"toolu_014Avr7TCjn1dG6vMGG5HgNk","agent":"blade","model":"sonnet","modelSource":"param","bg":false}
```

Fields: `event`, `ts`, `sid` (session id), `id` (tool_use_id when the harness supplies one), `agent` (subagent_type), `model`, `modelSource` (`param` / `pinned` / `session`), `bg` (background flag).
`model` is resolved in this order, read directly from `hooks/timing-capture.js:63-90`: an explicit `model` param on the Agent tool call, else a `model:` line in the target agent's frontmatter, else `inherited` from the calling session.
**Tier: REQUESTED.** This is exactly what was asked for, nothing about what ran.

### 1b. `hooks/timing-capture.js`, stop event (SubagentStop)

Observed sample: `{"event":"stop","ts":"2026-08-19T04:46:38.647Z","sid":"6af5f5ab-63e7-4060-990c-52952b278d1c","id":null}`.
No model field of any kind.
`id` is frequently `null` because SubagentStop's payload does not reliably carry the originating tool_use_id back, which is also why `scripts/timing-report.js` documents its spawn/stop pairing as FIFO-approximate rather than exact.

### 1c. SubagentStart payload, as read by `hooks/engineer-marker-state.js`

The `start()` function (`hooks/engineer-marker-state.js:59-75`) reads `payload.agent_id`, `payload.tool_use_id`, `payload.id`, `payload.agent_type`, `payload.name`, `payload.session_id`, `payload.cwd`.
No code path in this file references anything model-related.
This does not prove the raw payload carries no model field; it proves no script in this repository currently looks for one.
That is an open question in section 4, not a closed one.

### 1d. SubagentStop payload, as read by `hooks/wake-classifier.js`

This hook does not classify from the live payload's own fields beyond identity (`agent_id` / `tool_use_id` / `name`, per the comment at line 79).
It resolves those identity fields against a stub file Chief writes at spawn time, `<sessions>/<ticket>/agent-records/<agent-name>.json`.
Observed sample, redacted, from this session's own `agent-records/blade-pravo.json`:

```json
{
  "status": "done",
  "task": "fix-AR1",
  "wave": { "index": 7, "isLastInWave": true },
  "spawnedAt": "2026-08-19T03:58:56.651Z",
  "completedAt": "2026-08-19T04:04:57.094Z",
  "filesChanged": ["hooks/engineer-model-gate.js"],
  "testResult": { "passed": true, "summary": "AR1 fixed: 6 identifier/comment sites + line-90 article; 43/43" }
}
```

No model field, in this record or any other sampled from the same directory.
Even if one were added here, it would be Chief transcribing whatever the agent claimed about itself in its final report, which is precisely the self-report-is-worthless case the foreman digest calls out: a model's self-identification tracks its prompt and system context, not its weights.
This source must never become a provenance input regardless of what fields it eventually grows.

### 1e. Claude Code transcript JSONL (`~/.claude/projects/<project>/<session-id>.jsonl`)

This is the one place in the whole stack where genuine post-resolution model identity is known to exist.
Main-chain `assistant` records carry `message.model`, populated by the Anthropic API response itself, not by the model describing itself.
Observed sample (redacted to structure), from this very session's own transcript:

```json
{"type":"assistant","message":{"model":"claude-fable-5","usage":{"input_tokens":"...","output_tokens":"...","cache_read_input_tokens":"...","cache_creation_input_tokens":"..."}},"requestId":"...","isSidechain":false,"sessionId":"6af5f5ab-63e7-4060-990c-52952b278d1c","effort":"..."}
```

**Tier: SERVED, for the lead turn.** This is real, artifact-level, post-resolution evidence exactly matching the foreman digest's SERVED definition.

`scripts/cost-report.js` (lines 16, 75) states as fact that subagent turns also land in this same file as `isSidechain: true` assistant records, carrying their own `model` and `usage`, and that cost accounting counts them.
If that is true, SERVED-tier evidence for Agent-tool dispatches already exists in the harness and simply needs to be read.

**This claim did not hold up under direct test.** I searched 80 of the most recently modified transcript files across every project directory under `~/.claude/projects/`, including this exact session's transcript file while it had roughly two dozen concurrent Engineer, Auditor, Inspector, Justice, Scout, and Opposition agents actively dispatched through the Agent tool.
Zero `isSidechain: true` records of any type were found, in this file or any other sampled.
`cost-report.js`'s own transcript locator (`transcriptsFor()`) looks for a file literally named `<session_id>.jsonl`, meaning if subagent turns shared the parent's session id the way the comment implies, they would land in the exact file I searched.
They were not there.

So: either `cost-report.js`'s comment describes a different dispatch mechanism than what actually runs Agent-tool subagents in this harness today (a real possibility, given `timing-capture.js`'s own comment distinguishing "native Claude Code" from "the internal router" as two different payload-delivery paths), or subagent transcripts are written somewhere this search did not reach.
Either way, this is not something the design can assume works.
It needs a direct, deliberate probe (section 4) before v2 gating can depend on it.

### 1f. Anything else Phantom writes

`~/.phantom/state/session-telemetry/<repo>.json` was checked and holds only `{session_id, cwd, ts}`, no model data.
`~/.phantom/timing/<repo>.jsonl` is 1a and 1b above, the only real source.
Agent-record stubs under `sessions/<ticket>/agent-records/` are 1d above.
No other agent-record, telemetry, or ledger file in this repository carries model identity in any form.

## 2. Tier model, adapted to Phantom

The foreman digest's tiers are SERVED > BILLED > ROUTED > REQUESTED.
BILLED does not apply here: it exists in foreman to catch a provider's own billing envelope (Grok's `modelUsage` key) being mistaken for served-tier proof, and Phantom dispatches nothing but native Claude subagents, with no external billed CLI in the loop.
Dropping BILLED, Phantom's tiers and what actually yields each one today:

| Tier | Definition | Source found | Status |
|---|---|---|---|
| SERVED | Post-resolution artifact naming the model that answered | Transcript `message.model` on a main-chain assistant record | Confirmed real, for the lead session's own turns only |
| SERVED (subagent) | Same, for an Agent-tool dispatch | None confirmed reachable | Open question, section 4 |
| ROUTED | Proof the request took a given path without naming the served model | None found | No proxy, gateway, or router acknowledgment log exists in this harness |
| REQUESTED | What was asked for | `hooks/timing-capture.js` spawn record | Confirmed real, this is all F11 currently has |

Consequence, stated plainly: today, every seat Phantom dispatches through the Agent tool is REQUESTED-tier only, exactly as ROADMAP.md's own F11 fix already says ("Nothing WRITES `model` yet").
The gap is that `baseline-report.js` prints this REQUESTED-tier number under a column header that says OBSERVED, and F11's own prose at line 257 calls it "the real signal," both of which overstate what the data proves.
This design does not change that label (out of scope, no code touched here), but flags it as the first thing worth fixing once this doc is acted on.

## 3. Capture design

### 3a. Where it lands

Extend `hooks/timing-capture.js` rather than adding a new hook file.
It already fires on exactly the two right events (PreToolUse `Agent|Task` and SubagentStop), already resolves REQUESTED-tier data, and already owns the append-only NDJSON log that `scripts/timing-report.js` reads.
A second hook watching the same two events would duplicate wiring for no reason; one file staying the single source of truth for spawn provenance is the simpler design.

### 3b. New record

Add a third NDJSON event type, `seat`, written once per dispatch at SubagentStop time (paired to the spawn record's `id` when the harness supplies one, same caveat as today's stop/spawn pairing).
This is additive: the existing `spawn` and `stop` events are unchanged, so `scripts/timing-report.js`'s existing pairing and aggregation logic keeps working exactly as it does now.

```json
{
  "event": "seat",
  "ts": "2026-08-19T04:52:32.500Z",
  "sid": "6af5f5ab-63e7-4060-990c-52952b278d1c",
  "id": "toolu_014Avr7TCjn1dG6vMGG5HgNk",
  "agent": "engineer",
  "requested": { "model": "sonnet", "source": "param" },
  "tier": "requested",
  "served": null,
  "note": "no served-model source reachable from SubagentStop payload or transcript in this harness (probed 2026-08-19)"
}
```

`requested` mirrors the existing spawn record so a `seat` line is self-contained and does not require a join to be useful.
`tier` is `"requested"` today and becomes `"served"` only when the served-tier probe below (3c) actually resolves a model.
`served` is `null` until then, and `note` is present whenever the probe ran and found nothing, so a reader can tell "we looked and there was nothing" apart from "nobody wrote this yet."
Silence must never be read as REQUESTED-equals-SERVED.

### 3c. Served-tier probe (best-effort, optional)

At SubagentStop, if the payload carries a `transcript_path` field (a documented native Claude Code hook field this repository's code has never inspected), attempt to read that file for the newest `assistant` record with `isSidechain: true` whose timestamp falls after this dispatch's spawn `ts`.
If one resolves, its `message.model` is SERVED-tier evidence and the `seat` record is written with `tier: "served"`.
If the payload carries no `transcript_path`, or the file has no matching record (today's confirmed reality per section 1e), the record stays `tier: "requested"` with the `note` populated.
This probe must be wrapped exactly like the rest of `timing-capture.js`: silent, never throws, degrades to `tier: "requested"` on any failure.
Building it as best-effort means it starts producing SERVED-tier data the moment (if) a future harness version makes subagent transcripts reachable, with no hook rewrite required.

### 3d. Classification helper

A new pure function, deterministic and side-effect free, belongs in `scripts/lib/` (e.g. `scripts/lib/seat-provenance.js`): `classifyTier(record)` returning one of `requested` / `served`, and `minimumTierFor(workClass)` returning the floor a given class of work needs.
Keeping this as a pure function rather than prose convention means the gate in section 3e is a lookup, not a judgment call, which is worth the small amount of code: a computed answer here is worth more than a well-written rule nobody enforces.

### 3e. Gate policy

Adapt, do not copy, the foreman precedence: economics (or measurement gaps) may never lower the quality bar, and unverified is a label, not a block, in v1.

- **Accepting verdicts and cross-seat comparisons** (Auditor/Inspector acceptance, B11's precision gate) require both sides at `served` tier or the comparison refuses as unmeasurable, exactly the pattern `precisionGate()` already ships for the reviewer-model confound. Since `served` is not confirmed reachable today, this floor is currently unmet for every Agent dispatch, which is the honest state, not a bug to route around.
- **FRONTIER-class judgment work** (Auditor, Justice, any review role) recorded from a spawn whose own `requested` tier shows drift against its policy pin is downgraded to advisory only, never accepting, until re-run at the pinned tier. This reuses data v1 already has; it needs no served-tier evidence to start working.
- **Everything else** (routine Engineer implementation, this document included) needs only `requested` tier to proceed. It must be visible and correctly labeled, never silently assumed to be more than it is.
- **v1 never blocks on an unverified seat.** It labels. This matches the shipped route-telemetry pattern of recording the router's choice before scoring it, and it matches the First-Law-style rule that measurement must land before enforcement, never the reverse.

## 4. Migration and rollout

**v1 (this doc's actionable scope, none of it implemented here):**
1. Add the `seat` event to `timing-capture.js`'s SubagentStop handler, per 3b and 3c, fail-open exactly like the existing code.
2. Add `scripts/lib/seat-provenance.js` with the tier constants and the two pure functions from 3d.
3. Relabel `baseline-report.js`'s OBSERVED column honestly (rename or footnote it as REQUESTED, sourced from `timing-capture.js`, not served-model proof), and correct ROADMAP.md line 257's "the real signal" claim to match. Flagged here as the first follow-up, not done in this pass since it touches code.
4. Document the new `seat` record shape in `reference/schemas/execution.md`, generated from `scripts/lib/seat-provenance.js` the same way F11's own fix generated reviewer-model prose from `scripts/lib/review-standard.js`, so this file cannot drift from the code the way F9 drifted across four prose restatements of one severity vocabulary.

**v2 (blocked on an open question, not scheduled):**
Wire `minimumTierFor()` into the accepting paths broadly (Auditor/Inspector acceptance, any cross-seat comparison) once served-tier evidence for Agent-tool dispatches is confirmed reachable by some concrete mechanism.
Until then v2 has nothing to gate on that isn't already covered by the existing reviewer-model confound refusal.

**Open questions, stated honestly rather than papered over:**
- Does the SubagentStop payload actually carry a `transcript_path` field in this harness, and if so, does it point at a file distinct from the one this investigation searched? No script in this repository currently inspects the raw payload for anything beyond identity fields, so this is unconfirmed in either direction and needs a one-time raw-payload dump to settle.
- `scripts/cost-report.js` asserts subagent `isSidechain: true` transcript lines exist and are billed for. Direct search across 80 recent transcripts, including this session's own file mid-flight with roughly two dozen concurrent agent dispatches, found none. If that comment is stale or describes a different dispatch path than what Phantom's Agent tool actually uses, cost accounting for subagent spend may itself be silently undercounting today; that is a real, separate risk worth its own follow-up, not something this doc's scope covers or fixes.
- Is there any ROUTED-tier signal obtainable by instrumenting Phantom's own dispatch path (the "internal router" `timing-capture.js` already distinguishes from native Claude Code), even short of full SERVED-tier proof? Worth a small spike before assuming SERVED is the only way forward.
- If SERVED-tier evidence for subagents never becomes reachable, does Phantom need its own equivalent of foreman's "reduced assurance" label, explicitly marking every acceptance as unverified-seat rather than silently treating REQUESTED as good enough forever? This design defers that decision to whoever picks up v2, since it is a product/policy call, not a mechanical one.
