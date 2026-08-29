# PR Watch Protocol (`CHIEF_PING`)

Standing watch after `/gorkhali:greploop` Phase 1. **Every tick is
`scripts/lib/pr-watch-tick.js`.** The script glances at GitHub, emits
`CHIEF_PING`, and writes `pr-watch.json`. A boolean `{new:false}` is not a ping
— it is swallowed, the loop goes quiet, and Chief never hears that the watch is
still alive. Idle without a ping is the failure mode.

Codec: `scripts/lib/chief-ping.js`. Schema: `reference/schemas/pr-watch.md`.

Never merge. Merging stays a human action.

The watch **stops as soon as** every review thread is resolved **or** Greptile
reports 5/5. It does not keep re-arming after that. Phase 1 still exits on
unresolved-item count, not on score alone; this early stop is Phase 2 only.

---

## Who

| Role | Model | Does |
| --- | --- | --- |
| Tick script | none | `pr-watch-tick.js` classifies GitHub; emits `CHIEF_PING`; writes watch status `stopped` on exit |
| Chief | session | Ack every ping; assess only on `new_work` |
| Engineer | balanced | Code change only after Chief's candidate |
| Inspector | economy | Touched files after a fix |
| Reply Clerk | economy | Post reply / resolve after Chief decides (`clerk-herald`) |

Idle cost is one script glance + one Chief ack line. Not a review dump. After
`threads_clean` or `greptile_max`, there is no next tick.

---

## Tick (every interval)

Do **not** invent a verdict. Do not have Clerk glance GitHub. Resolve `$PR`
the same way commands do (`commands/_shared.md` §Paths). Then:

```text
node "$PR/scripts/lib/pr-watch-tick.js" --watch-file "{SESSION_DIR}/pr-watch.json"
```

The script prints a `CHIEF_PING` block (pipe through
`scripts/lib/chief-ping.js` `format` is not required — the tick CLI already
emits the block). Empty `$PR` or a non-zero CLI is a **failed** tick. Do not
fall back to `{new:false}` or a hand-typed block.

`clerk-herald` is **not** spawned for the glance. Spawn
`Agent({ subagent_type: "clerk", name: "clerk-herald", mode: "bypassPermissions" })`
only after `ack_assess`, to post the reply / resolve. Same-site re-runs reuse
that name (roster slot 3).

---

## Interval and ceiling

From `scripts/lib/constants.js`:

- `PR_WATCH_INTERVAL_SECONDS` — default **120** (env `GORKHALI_PR_WATCH_INTERVAL_SECONDS`)
- `PR_WATCH_TICK_CEILING` — default **60** (env `GORKHALI_PR_WATCH_TICK_CEILING`)

Hitting the ceiling is `verdict: exit`, `exit_reason: ceiling`, `next_action: ack_stop`.
It does not keep polling.

---

## Illegal

- Returning `{new:false}` (or any boolean-only JSON) and ending the turn
- Sleeping until the next tick without a ping
- Clerk classifying GitHub or re-arming itself without Chief
- Empty tool output meaning "still watching"
- Loading comment bodies on an idle tick
- Missing `CHIEF_PING` sentinel — Chief treats the tick as **failed** and either
  re-runs the tick script once or pauses. It does not invent "probably idle."
- Re-arming after `threads_clean` or `greptile_max`

---

## Every tick

```text
every tick:
  node scripts/lib/pr-watch-tick.js --watch-file {SESSION_DIR}/pr-watch.json
  script ALWAYS emits CHIEF_PING   ← even if zero new comments
  on exit it writes status: stopped (threads_clean | greptile_max | merged | …)
  Chief MUST parse then ack via the codec CLI
    idle     → re-arm next tick
    new work → pull those comments → push back OR Engineer
    exit     → stop the loop (do not re-arm)
```

`$PING_JSON` shape (the script fills this; `--json` prints it):

```json
{
  "pr": 1234,
  "tick": 12,
  "verdict": "idle",
  "exit_reason": "none",
  "new_count": 0,
  "new_ids": [],
  "watermark": "2026-08-25T21:40:00Z",
  "next_action": "ack_rearm"
}
```

`verdict` is `idle | new_work | exit`. `exit_reason` is
`none | merged | closed | approved_clean | threads_clean | greptile_max | ceiling | user_stop`.
`next_action` is `ack_rearm | ack_assess | ack_stop`.

```text
printf '%s\n' "$CLERK_TURN" | node "$PR/scripts/lib/chief-ping.js" parse
```

- `verdict: idle` → `new_count` is 0, `new_ids` empty, `exit_reason: none`, **still a ping**. `next_action` is `ack_rearm`.
- `verdict: new_work` → `new_count >= 1`, `new_ids` length equals count, **ids only (no bodies)**. `next_action` is `ack_assess`.
- `verdict: exit` → `exit_reason` is not `none`. `next_action` is `ack_stop`.

Critical exits (any one → `verdict: exit`), first match in the script:

- merged / closed
- ceiling (ticks)
- every review thread resolved (`threads_clean`; `approved_clean` when GitHub `reviewDecision` is also `APPROVED`)
- Greptile confidence **5/5** (`greptile_max`)
- user says stop

Zero unresolved threads stops even if Greptile is still 4/5. Greptile 5/5
stops even if threads remain. Either condition is enough. Do not wait for
GitHub Approve, and do not keep watching after the PR is already clean.

Non-zero parse → failed tick, same as missing sentinel. Then ack with:

```text
printf '%s\n' '{"tick":12,"kind":"idle"}' | node "$PR/scripts/lib/chief-ping.js" ack
```

(`kind` matching `next_action` as already documented: `ack_rearm` → `idle`,
`ack_assess` → `assess`, `ack_stop` → `stop`).

---

## Chief's job on every ping (mandatory)

1. Read `verdict` and `next_action` from the CLI `parse` JSON. Do not infer.
2. **Ack in the open** with one line from the CLI: `CHIEF_ACK tick=12 idle|assess|stop` matching `next_action` (`ack_rearm` → `idle`, `ack_assess` → `assess`, `ack_stop` → `stop`).
3. Then only:
   - `ack_rearm` — schedule the next tick. No GitHub body fetch. No Engineer.
   - `ack_assess` — pull **those** `new_ids` only. Push back in-thread (`@author`) **or** write a short candidate and spawn Engineer → Inspector on touched files → Clerk replies and resolves.
   - `ack_stop` — do not re-arm. The tick script already wrote `status: stopped`.

If Chief does not ack, the watch is broken. Next host wake must ping again or pause. It must not go idle.

---

## Memory

`{SESSION_DIR}/pr-watch.json` is only `pr`, `status` (`watching` \| `paused` \| `stopped`),
`tick`, `watermark`, `lastPingAt`. Not comment text. Not a transcript. Extra keys are illegal.
The tick script is the writer on each tick.

---

## Resume

`/gorkhali:resume`: if `pr-watch.json` exists, `status` is `watching`, and the PR is still
open, run **one** watch tick without asking (`pr-watch-tick.js --watch-file`). Skip if
`paused` / `stopped` or the PR is merged / closed. See `commands/resume.md`.
