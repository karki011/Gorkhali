---
name: q
description: "Alias of /phantom:loop — start the Mission Control queue loop from any session. Use when user types /phantom:q or says 'q'."
allowed-tools: ["Agent", "Read", "Bash", "Grep", "Glob", "LS"]
---

> **Preamble Tier: T2** — shared contexts per the canonical registry (`scripts/preamble-tier.js`); `_shared-detective.md` also loads on the detective trigger

# /phantom:q

Alias of `/phantom:loop`. Run `/phantom:loop` — execute `commands/loop.md` as the procedure (behavior is defined there; this file only points at it so the two never drift).
