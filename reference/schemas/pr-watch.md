# `pr-watch.json` Schema

Tiny standing-watch state written by `/gorkhali:greploop` Phase 2 and updated
each `CHIEF_PING` tick (`reference/pr-watch.md`, codec `scripts/lib/chief-ping.js`).

This is **not** a full Gorkhali session artifact: it does **not** carry `_meta`.
The five keys below are the entire file. Extra keys are illegal. Comment bodies
and transcripts do not belong here.

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| pr | number | yes | PR number being watched |
| status | `"watching"` \| `"paused"` \| `"stopped"` | yes | Watch standing. `"paused"` includes a ceiling pause; do not invent extra status words. |
| tick | number | yes | Last completed tick (non-negative integer) |
| watermark | RFC3339 string | yes | Newest seen comment timestamp; idle ticks still advance `lastPingAt` but only bump this when something newer arrived |
| lastPingAt | RFC3339 string | yes | When the last `CHIEF_PING` was emitted |

**Example:**
```json
{
  "pr": 1234,
  "status": "watching",
  "tick": 12,
  "watermark": "2026-08-25T21:40:00Z",
  "lastPingAt": "2026-08-25T21:42:00Z"
}
```
