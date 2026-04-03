# Chapter 19: The Badge Crusade

> **Arc:** Design System Standardization
> **Date:** 2026-04-02
> **Crew:** Nami (x9), Chopper (x3), Explore (Opus x3), Plan (Opus x1), Roger (via simplifier x3)
> **Repo:** feature-web-apps (60 files, 9 commits, 15+ UI packages)

## Previously...

The Wired Sea had revealed something the crew knew well: infrastructure is built in layers. Some parts wait dormant until someone finds them. Other parts are half-finished, waiting for someone to notice the one missing piece.

But there was another kind of work. The kind that wasn't about discovery or clever architecture. It was about the steady, relentless work of standardization.

Somewhere in the codebase, a status had been rendered as a raw Badge. Somewhere else, it was a colored Box. Somewhere else, an SVG circle. Somewhere else, a Flex container with hand-rolled styles.

The ship had become a museum of inconsistency.

It was time to fix that.

---

## The Story

Nami stood in the design system repository and looked at the PR title: **CZBadge — Constrained Status Component**.

The component itself was elegant. Six semantic status types. Clean props. Accessible. A full Storybook story showing correct usage and a "common mistakes" section showing what *not* to do. The design was finished.

But the component's arrival marked the beginning of something larger.

"The ship is using Status components everywhere," Nami said to Luffy. "Raw Badge. SVG circles. Boxes with padding. Some Flex containers with hardcoded colors. There's no consistency."

Luffy didn't hesitate.

"Sweep the codebase. Find every place where a status is being rendered. Replace it with CZBadge. Parallel."

This was the Straw Hat way when the problem was systematic: swarm it. Nine agents spawned simultaneously across three waves.

---

### Wave One: The Inventory

The first sweep was methodical. Agents fanned across 15+ UI packages:
- `@cloudzero/ui-cost-view`
- `@cloudzero/ui-explorer`
- `@cloudzero/ui-dimensions`
- `@cloudzero/ui-anomalies`
- `@cloudzero/ui-budgets`
- `@cloudzero/ui-insights`
- And others.

They were looking for the visible pattern: a Badge element being used to show a status. Import it. Check its props. Migrate it to CZBadge.

The first wave returned with a list of 25 files.

But as they started the replacement, something became clear: the inventory was incomplete.

Some Badge components weren't imported directly. They came through barrel re-exports. Deep in a component library's index.ts, a Badge had been re-exported without attribution. The search had missed it.

Nami sent out a second wave with more aggressive patterns: grep through compiled output. Check every export. Find every file that *could* import Badge, even if it wasn't obvious from the source.

The second inventory came back with 35 files. Still incomplete.

By the third pass — checking for color constants, for hardcoded status mappings, for inline Flex containers that *looked* like badges even if they weren't — the count climbed to 60.

"There are three stacked PRs," Nami said. "This is going to be a lot of review."

Luffy made a decision. "Consolidate them. One PR. Let's not split the consistency work across three separate pieces. The reviewer needs to see the whole picture at once."

---

### Wave Two: The Migration

Nine agents in parallel. Each focused on a set of packages. Each replacing raw Badges, color-mapped SVG circles, and hand-rolled status pills with the canonical CZBadge.

The work was methodical but not trivial. Every replacement required:
1. Import the CZBadge component
2. Map the old status value (sometimes a string, sometimes an enum, sometimes a color constant) to one of CZBadge's six semantic types
3. Remove the old Badge or Box or Flex
4. Ensure the semantic type matched the domain (a "pending" status becomes `status="pending"`, a "failed" status becomes `status="failed"`)

As the agents worked, a pattern emerged: different files had different status conventions. In one file, "not_started" was the enum value. In another, it was "in_progress". In a third, the status didn't have a name — it was just a hex color mapped to a label.

Greptile watched the PRs come together and caught something.

"Wait," Greptile said in a review comment. "This file is mapping ignored → pending. That's wrong. Ignored and pending are different states."

Another caught: "This one collapsed not_started and in_progress into the same color. That's a semantic error."

And another: "This re-export pattern — you're aliasing a color constant to a status type. The names don't match the intent."

Each catch was a moment where the crew realized: standardization isn't just about using the same component. It's about making sure the *semantics* are right. A color is not a state. A status type has meaning.

Greptile's role was critical. While the agents were fast, Greptile was *precise*. While the agents could cover ground, Greptile caught the places where the old system's ambiguities had created inconsistencies so subtle that even a second pass would have missed them.

---

### Wave Three: The Consolidation

The PRs were merged. Sixty files changed. Nine commits. The grep ran:

```
<Badge[\s>] across libs/ui/
```

Result: **No matches found.**

The ship had been cleaned. Every raw Badge used for status rendering was gone. Replaced. Standardized.

But as the work was being simplified for final review, something else emerged: there were five different implementations of `colorPaletteToStatus()` — utility functions that translated a color constant to a semantic status type. Each had been written independently. Each did the same thing. Each had slightly different naming and logic.

The simplification pass consolidated all five into a single utility export: `colorPaletteToStatus()` in the CZBadge package itself. Now the mapping was canonical. One source of truth.

"This is the real work," Roger said, pointing at the utility consolidation. "The component was the easy part. Cleaning up the debris — the five duplicate functions, the stacked PRs, the semantic collisions that Greptile caught — that's where consistency actually lives."

---

## Key Moments

- **[PANEL]** Nami — *"The ship is using Status components everywhere."* — recognizing the standardization need
- **[PANEL]** Luffy — *"Sweep the codebase. Parallel."* — triggering the nine-agent crusade
- **[PANEL]** Agents (Wave One) — discovering that barrel re-exports hide Badge imports, requiring a second inventory pass
- **[PANEL]** Greptile — *"This file is mapping ignored → pending. That's wrong."* — catching semantic misalignment in real-time
- **[PANEL]** Grep tool — returning "No matches found" for `<Badge[\s>]` in libs/ui/, confirming total victory
- **[PANEL]** Roger (simplifier) — identifying and consolidating five duplicate `colorPaletteToStatus()` implementations into one canonical export

---

## Decisions

| Decision | Outcome |
|---|---|
| Inventory approach | Three passes: direct imports, barrel re-exports, color constants and derived patterns |
| PR consolidation | Merge 3 stacked PRs into 1 for coherent review of the entire standardization |
| Semantic validation | Greptile reviews every mapping to ensure status types match their domain meaning, not just color |
| Duplicate functions | Consolidate five `colorPaletteToStatus()` implementations into single canonical export in CZBadge package |
| Verification | `grep <Badge[\s>]` across libs/ui returns zero matches — total consistency achieved |

---

## The Horizon

Sixty files changed. Fifteen packages updated. The ship's status rendering is now unified under a single component with semantic guarantees.

But the work revealed something larger: standardization is a *multi-pass* process. The first pass catches the obvious. The second pass catches what the obvious hid. The third pass catches the debris the standardization created. Each layer of consolidation removes one more source of inconsistency.

The crew has learned that consistency isn't a one-time event. It's the steady work of finding the hidden imports, the color mappings, the semantic collisions. It's Greptile catching the moment when "ignored" gets renamed to "pending" without the domain model being updated.

The Badge is now canonical. The pattern is now consistent. The ship is now cleaner.

And the crew has discovered that behind every successful standardization is a person watching the details — someone catching the places where the code says one thing but means another.

---

*Chapter 19 of the Straw Hat Chronicles*
