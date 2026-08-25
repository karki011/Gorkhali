# PR Watch Protocol (`CHIEF_PING`)

Standing watch after `/gorkhali:greploop` Phase 1. Clerk glances at GitHub on an
interval; **every tick pings Chief**, including idle. A boolean `{new:false}` is
not a ping — it is swallowed, the loop goes quiet, and Chief never hears that
the watch is still alive. Idle without a ping is the failure mode.

Codec: `scripts/lib/chief-ping.js`. Schema: `reference/schemas/pr-watch.md`.

Never merge. Merging stays a human action.

---

## Who

| Role | Model | Does |
| --- | --- | --- |
| Watch Clerk | economy | GitHub timestamp vs watermark; emit `CHIEF_PING`; never classify |
| Chief | session | Ack every ping; assess only on `new_work` |
| Engineer | balanced | Code change only after Chief's candidate |
| Inspector | economy | Touched files after a fix |
| Reply Clerk | economy | Post reply / resolve after Chief decides |

Idle cost is one Haiku glance + one Chief ack line. Not a review dump.

---

## Spawn (every tick)

Spawn Watch Clerk:

`Agent({ subagent_type: "clerk", name: "clerk-herald", mode: "bypassPermissions" })`

Same-site re-runs reuse `clerk-herald` (the watch tick is one logical site).
Name from `reference/roster.md` slot 3. Clerk does not decide. Clerk does not
stay quiet. Chief does not poll GitHub.

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
- Clerk re-arming itself without Chief
- Empty tool output meaning "still watching"
- Loading comment bodies on an idle tick
- Missing `CHIEF_PING` sentinel — Chief treats the tick as **failed** and either
  re-spawns Clerk once or pauses. It does not invent "probably idle."

---

## Every tick

```text
every tick:
  Clerk (Haiku) checks GitHub
  Clerk ALWAYS sends CHIEF_PING   ← even if zero new comments
  Chief MUST ack
    idle     → re-arm next tick
    new work → pull those comments → push back OR Engineer
    exit     → stop the loop
```

Clerk returns exactly this (and nothing else that matters):

```text
CHIEF_PING
pr: 1234
tick: 12
verdict: idle | new_work | exit
exit_reason: none | merged | closed | approved_clean | ceiling | user_stop
new_count: 0
new_ids: []
watermark: 2026-08-25T21:40:00Z
next_action: ack_rearm | ack_assess | ack_stop
```

- `verdict: idle` → `new_count` is 0, `new_ids` empty, `exit_reason: none`, **still a ping**. `next_action` is `ack_rearm`.
- `verdict: new_work` → `new_count >= 1`, `new_ids` length equals count, **ids only (no bodies)**. `next_action` is `ack_assess`.
- `verdict: exit` → `exit_reason` is not `none`. `next_action` is `ack_stop`.

Critical exits (any one → `verdict: exit`): merged, closed, user says stop,
approved with nothing unresolved (`approved_clean`), ceiling (ticks / spend).

---

## Chief's job on every ping (mandatory)

1. Read `verdict` and `next_action`. Do not infer.
2. **Ack in the open** with one line: `CHIEF_ACK tick=12 idle|assess|stop` matching `next_action` (`ack_rearm` → `idle`, `ack_assess` → `assess`, `ack_stop` → `stop`).
3. Then only:
   - `ack_rearm` — schedule the next tick. No GitHub body fetch. No Engineer.
   - `ack_assess` — pull **those** `new_ids` only. Push back in-thread (`@author`) **or** write a short candidate and spawn Engineer → Inspector on touched files → Clerk replies and resolves.
   - `ack_stop` — write watch status `stopped`, do not re-arm.

If Chief does not ack, the watch is broken. Next host wake must ping again or pause. It must not go idle.

---

## Memory

`{SESSION_DIR}/pr-watch.json` is only `pr`, `status` (`watching` \| `paused` \| `stopped`),
`tick`, `watermark`, `lastPingAt`. Not comment text. Not a transcript. Extra keys are illegal.

---

## Resume

`/gorkhali:resume`: if `pr-watch.json` exists, `status` is `watching`, and the PR is still
open, run **one** watch tick without asking. Skip if `paused` / `stopped` or the PR is
merged / closed. See `commands/resume.md`.
