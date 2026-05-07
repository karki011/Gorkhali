# Chapter 25: The Nested Curse

> **Season:** CP-39829 — Preferences Cleanup
> **Date:** 2026-04-09
> **Crew:** Luffy (solo)
> **Repo:** feature-web-apps

## Previously...

The observation deck had been polished — labels surfaced, tooltips placed, a broken layout mended with a single property. The navigator could finally read what was selected before opening anything. The crew had been careful. The code had been honest.

But honesty in the present cannot fix what was broken in the past. And something in the past had broken badly — not in a way that crashed the ship, but in a way that quietly poisoned the records it left behind.

---

## The Story

Every navigator on the Thousand Sunny keeps a personal log. Preferences: which way they like the charts, how they want the colors, what they have decided about the interface over time. The system was built to remember these things so the navigator would never have to choose again.

Subash opened the log. And what he found looked like a mirror pointed at another mirror.

---

### The Corrupted Record

The preferences API returned a structure that should not exist. Nested inside the preferences was another copy of preferences — a reflection caught inside the original. Wrapped around both were fields that belonged to the envelope, not the contents: identifiers, timestamps, organizational markers. The wrapper had leaked into the letter.

And there was one ghost that refused to leave. The old name for the color setting — `colorMode` — still appeared alongside the new name, `theme`. Two keys for the same drawer. The old one should have been gone for months.

This was not a crash. The ship still sailed. But every time the system read a navigator's settings, it was reading from a corrupted scroll — data that had folded back on itself, filled with residue from an older iteration of the code.

Luffy stood at the records table and understood the shape of what had happened. An earlier version of the code had not been careful enough when writing preferences back to storage. It had included fields it should not have. Those writes had gone into the permanent ledger, and there they had stayed.

---

### The Script That Was Already Waiting

Luffy crossed to the back of the ship — the secondary repository, the engine room of the user session gateway — and found a migration script already built for exactly this problem. Someone had anticipated the corruption pattern. The cure existed. It had never been run.

The script's job was methodical: open each navigator's record, inspect the structure, strip anything that did not belong, collapse the nesting, remove the ghost key. Leave only what was true.

But before running anything against the real logs, Luffy had to find the right door.

---

### The Naming Traps

The system lived in AWS. Two names had to be correct before anything could begin.

The first: the profile. Not `dev-core.Engineering` — that was the obvious reading, the name that looked right. The actual name was `cz-dev-core.Engineering`. One prefix, two letters. Wrong, and the door did not open.

The second: the table. Not `cz-dev-user-session-gateway-data` for the development environment — that name did not exist. The development environment was called Alfa, and the table was `cz-alfa-user-session-gateway-data`. A different word entirely. Wrong, and the script found nothing.

These were not cryptographic locks. They were the ordinary traps of systems built by many hands over many months — names that accumulated their own logic, their own deviations from what seemed intuitive. Luffy found them both. Verified them. Wrote them down.

---

### The Cleaning

The script ran in Alfa first. Eleven records examined. Six cleaned. Zero errors. The nesting was gone. The ghost key was gone. The envelope fields had been stripped back to where they belonged.

Luffy looked at the result for a long moment, then ran it in production.

Sixty-eight records examined. Twenty-two cleaned. Zero errors.

The remaining forty-six records had never been written with the old code. They were already correct. Only the records from the earlier period had carried the corruption forward. Time had bounded the damage without eliminating it.

Now it was eliminated.

---

### Why the Corruption Would Not Return

One question remained: could the current frontend code reproduce this problem? Could a navigator's next write re-introduce the nesting, re-summon the ghost key?

Luffy traced the path. The function responsible for writing preferences used an allowlist — a defined set of known fields, and only those fields. Anything outside the list was discarded before it could be saved. The wrapper fields could not leak in. The old key had no place on the list.

The corruption had been from an older iteration of the code. That code was gone. The allowlist approach meant the new code was structurally incapable of re-creating the same mistake. The migration was not a patch — it was a conclusion.

The records were clean. The mechanism that had dirtied them no longer existed. The story was closed.

---

## Key Panels

- **[PANEL]** Subash — looking at the API response — *"It's nested inside itself. The wrapper is inside the content. How long has this been here?"*
- **[PANEL]** Luffy — finding the migration script already written — *the cure existed before anyone had come looking for it*
- **[PANEL]** Luffy — correcting the profile name — *"cz-dev-core.Engineering, not dev-core.Engineering. Two letters. That was the whole door."*
- **[PANEL]** Luffy — watching the Alfa run complete — *six cleaned, zero errors; the first confirmation that the script knew what it was doing*
- **[PANEL]** Luffy — watching production complete — *twenty-two records reclaimed, forty-six already clean, nothing broken*

---

## Captain's Log

| Decision | Why It Mattered |
|---|---|
| Run Alfa before production | Proof of correctness before touching real navigator records; the cost of caution was minutes |
| Verify the profile and table names before running | A wrong name against live data is not a recoverable error — certainty first |
| Confirm the frontend could not re-introduce the corruption | Cleaning the records once is not enough if the mechanism that dirtied them still exists |
| Trust the allowlist approach | Structural prevention is stronger than procedural caution; the code cannot write what the list does not include |

---

## The Horizon

The records are clean. Twenty-two navigators who had been reading from corrupted scrolls will now find their preferences coherent. The ghost of `colorMode` has been laid to rest beside the old code that created it.

But there are other logs. Other systems that write preferences in other ways. The migration script answers the question for this table, this gateway, this pattern. It does not answer whether similar corruption exists elsewhere — in other environments, in other services that touch the same data model.

Cleanup that works once is a tool. The question is whether anyone will look for the next place to use it.

The ledger is honest again. For now, that is enough.

---

*Chapter 25 of the Straw Hat Chronicles*
