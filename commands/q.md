---
name: q
description: "Alias of /gorkhali:loop — start the Mission Control queue loop from any session. Use when user types /gorkhali:q or says 'q'."
allowed-tools: ["Agent", "Read", "Bash", "Grep", "Glob", "LS"]
# User-invocable (default) - typed /gorkhali:q resolves here. The same-named skill (skills/q/SKILL.md) carries user-invocable: false to stay off the / menu; this command remains the canonical procedure and the single menu surface. Do not flip without re-checking menu duplication.
---

> **Preamble Tier: T2** — shared contexts per the canonical registry (`scripts/preamble-tier.js`); `_shared-detective.md` also loads on the detective trigger

# /gorkhali:q

Alias of `/gorkhali:loop`. Run `/gorkhali:loop` — execute `commands/loop.md` as the procedure (behavior is defined there; this file only points at it so the two never drift).
