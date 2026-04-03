# Chapter 3: The Teal Mark

> **Season:** CP-39342 — Contrast & Visibility
> **Date:** 2026-03-27
> **Crew:** Luffy (coordinator), Nami (implementation), Roger (review), Chopper (verify), Sengoku (quality gate)
> **Repo:** feature-web-apps

## Previously...

The blade had been reforged. The Jotai Forge stood complete — 50 tests green, Ace's fire having burned away the dead code, Sengoku offering five corrections that made the crew wince in exactly the right ways. The adapter layer sat ready with a single door, waiting for the real API to knock.

But before the Log Pose could point to live data, a scout report arrived. Short. Urgent.

*"You can't tell which categories you've selected."*

## The Story

The note was unsigned, terse, and correct.

Luffy held up one of the selection cards and squinted. The selected state was technically present — a subtle background shift, barely a suggestion. In a dark room it vanished. In a bright one it blurred into the panel behind it. A user could make five choices and feel nothing. No confirmation. No mark. Just silence where acknowledgment should be.

*"The Forge gave us a clean engine,"* Luffy said. *"But a ship that doesn't show its heading is still dangerous."*

He turned to Nami. She was already at her drafting table.

She reached for a technique the crew had learned earlier on the Grand Line — a pattern from a past port where they'd solved the same problem for a different card. Selected state should have three qualities: **a border** that boxes the choice like a blade's edge, **an indicator** that announces the decision without shouting it, and **a shadow lift** that gives the selected card physical presence, like an object being picked up off a flat surface.

Not just color. Not just a background twitch. Something a user could *feel*.

Nami applied the treatment to both card variants — the full card and the compact pill. A colored border appeared at the edge. A small checkmark circle dropped into the top corner. The hover shadow lifted instead of pressing flat. Where before the selection was invisible, now it declared itself.

She stepped back. *"The pattern is clean. Three surfaces carry it now."*

Roger reviewed before anyone breathed. No critical issues — but he flagged something for the horizon: *"This mark appears in three places. One more and it gets its own home. Watch it."* Approved.

Chopper ran the build. Everything green. He exhaled.

Then Greptile arrived.

The bounty hunter system doesn't sleep. Two P1s, filed fast.

The first one stopped Nami cold. The linting guardian — the same automated hook that kept the codebase clean — had silently transformed the design system's teal token into a raw CSS color keyword. Not a semantic value. Not something that adapts to themes or darkness. A flat crayon color with no intelligence behind it.

*"The hook turned our teal into a crayon,"* Nami said, voice flat.

The lesson: automated tools operate on syntax, not semantics. When the hook doesn't recognize a token, it will helpfully replace it with something it does know. Which was wrong.

One line. The semantic token was restored.

The second P1: the hover shadow had shrunk instead of grown. A shadow that contracts reads as a press — the opposite of a lift. One property. Fixed.

Both corrections posted before the hour turned.

Chopper ran the build again. Sengoku reviewed the full diff in silence. Nothing to simplify. Nothing to question.

*"This is what a focused mission looks like,"* Sengoku said, and folded his coat.

## Key Panels

- **[PANEL]** Nami — *"Border, mark, lift — the user sees it now."* — *Sets down the finished card, teal border catching the light, checkmark precise in the corner*
- **[PANEL]** Greptile — *"P1: raw color keyword. P2: shadow shrinks."* — *The bounty hunter's report lands like a knife — two marks, both circled*
- **[PANEL]** Nami — *"The hook rewrote our token."* — *Said without heat, pen already moving, the fix applied before the sentence finishes*
- **[PANEL]** Sengoku — *"Nothing to simplify."* — *Reviews the diff in silence, folds the scroll, walks away — the highest praise this crew receives from him*

## Captain's Log

- **Visible selection is now a named pattern.** Border plus indicator plus shadow lift. Any card that can be selected follows this standard.
- **Automated tools have limits.** The linting hook operates on syntax, not intent. New design tokens need post-hook verification.

## The Horizon

Small mission. Clean return. The selected-state pattern is now canon.

But the Cutting Board still waits on mock data. Three chapters in, the adapter's single door has not received a knock. The question Ace raised — *what's waiting on the other side of that door?* — hasn't been answered.

The Log Pose moves. The crew is ready either way. The teal mark says so.

---
*Chapter 3 of the Straw Hat Chronicles*
