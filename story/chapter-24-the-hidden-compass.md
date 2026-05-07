# Chapter 24: The Hidden Compass

> **Season:** CP-39831 — The Explorer Arc
> **Date:** 2026-04-05
> **Crew:** Luffy (orchestration), Nami (worktree agent)
> **Repo:** feature-web-apps

## Previously...

The Explorer had been given its memory — a ledger of visited waters, a system of favorites that kept its promises, real links that respected the navigator's hands. Greptile had caught the one wrong key before it could do harm. The prefetch system waited on the horizon, lit but not yet wired.

But before memory could be fully celebrated, another problem surfaced on the observation deck. Not a crash. Not a missing feature. Something quieter and more insidious: the deck was telling the navigator nothing about where they were.

---

## The Story

The observation deck on the Sunny had always offered a panel called the Additional Features Menu. A small ellipsis in the corner — three dots, an unassuming door. Press it and a list of controls would unfold: options for cost type, options for view, settings the navigator could adjust without leaving the deck.

The problem was the door showed nothing from the outside.

A navigator who had already selected a cost type — had deliberated, chosen, committed — would look at that ellipsis and see nothing. Press it open, and the current selection would appear somewhere inside a nested popover, one layer deeper. Every single time, the navigator had to push through the door to verify the choice they had already made. The menu remembered nothing that it showed.

The data had been there all along. Both the cost type system and the view system computed a `selectedLabel` — the name of whatever was currently active. This label sat in the code like a candle nobody had carried to the window. The hooks held the answer. Nobody had wired it to the display.

---

### Nami Takes the First Pass

Luffy dispatched Nami to the worktree — a parallel space where work could happen without disrupting the main deck. The task was clean: take the `selectedLabel` each hook already computed and surface it in the menu item itself. Make the door say what was behind it.

Nami moved fast. One pass. The selected label appeared beside each menu item, visible at a glance, no sub-menu required. The navigator could now read the current state of the deck without pressing anything.

153 tests ran. All of them passed. The build was clean.

Luffy reviewed and nodded. The data had been waiting. All it needed was a path to the surface.

---

### The Icon That Had No Purpose

With the first task closed, attention turned to the menu's header.

The header bore a small heart icon — decorative, friendly, but contextually meaningless. A heart on an analytical tool. Nobody knew why it had been placed there. It had survived through inertia, not intent.

Luffy removed it.

The title was also renamed. "Additional Features" was accurate in the way a ship manifest is accurate — it described the contents without telling you why you were there. The new name was "Details and Descriptions." Clearer. More honest about what the menu actually offered.

These were small changes. But small changes to the things a navigator sees constantly accumulate into the overall feeling of whether a tool respects them or merely tolerates them.

---

### The Weight of the Whole Room

The next instinct was reasonable: if the menu had descriptions, they should be accessible somewhere. A single information button was added to the header, holding all the explanations in one place — a card that opened when pressed, a guide to every option on the deck.

The captain looked at it.

*"Too heavy,"* came the verdict.

Not wrong. Not broken. Just wrong in proportion. A single button that opened a wall of text was a solution born from the desire to be complete, not from the desire to be useful. The navigator would click it once, feel overwhelmed, and never click it again.

The button was removed before it could ship.

---

### One Light Per Item

The pivot was immediate and precise.

Instead of one information button for the entire menu, each menu item would carry its own small guide: a tooltip icon, placed beside the label, that appeared only when the navigator needed it. Hover and the explanation arrived. Move away and it disappeared.

Nami wired the tooltips in. Each item in the menu now had its own quiet companion — a small question mark that knew only about the thing it stood beside.

The Cost Type item received special attention. A cost type is not a simple concept. The tooltip for it was not a single sentence but a structured explanation: a bold header naming what cost type meant, followed by a brief list of the types available and what distinguished them. The Figma design had specified this structure. The tooltip held JSX — not just a string, but a small formatted document that lived inside the hover.

This was the right weight. Not a room full of explanation. Not silence. Each item carrying only what it needed to be understood.

---

### The Name That Broke the Frame

One more problem remained, found before the work was complete.

A view with a long name — the kind of name that accumulates when systems are tested and administrators experiment — had broken the menu's layout. The selected label appeared next to the menu item label in a row. When the name was short, the row held its shape. When the name was long, the row stretched and pushed the tooltip icon outside the visible frame.

The fix was a single CSS property applied to the flex container: `minW="0"`.

This is a counterintuitive thing. Flex containers, by default, will not shrink a child below its content width. The container grows to fit the text, regardless of the available space, because the browser assumes you want the text to be fully readable. Setting `minW="0"` releases that assumption. The child is now permitted to be smaller than its content, allowing the text to truncate instead of overflow.

It is the kind of fix that sounds like a trick but is actually a principle. The principle is: tell the browser what you want, not what you assume it already knows.

The layout held. Long names truncated cleanly. The tooltip icon stayed in place.

---

## Key Panels

- **[PANEL]** Nami — *"The label was always there. I just opened a path for it."* — wiring `selectedLabel` to the menu surface in a single pass
- **[PANEL]** Luffy — removing the heart icon — *the moment a small decoration revealed how long inertia had held the wheel*
- **[PANEL]** Captain — *"Too heavy."* — calling the retreat on the single InfoButton before it could reach the navigator
- **[PANEL]** Nami — building the Cost Type tooltip — *a small structured document, JSX inside a hover, the right weight for the right concept*
- **[PANEL]** Nami — adding `minW="0"` — *the layout stopped stretching; the long name folded; the icon stayed*

---

## Captain's Log

| Decision | Why It Mattered |
|---|---|
| Surface `selectedLabel` without opening sub-menu | A navigator should never have to push through a door to verify a choice already made |
| Remove the heart icon | Inertia is not a reason; decoration without context is noise |
| Per-item tooltips over single InfoButton | Contextual help is useful; complete help delivered all at once is overwhelming |
| JSX tooltip for Cost Type | Some concepts require structure; a plain string would have been a disservice |
| `minW="0"` on the flex container | CSS defaults protect against content truncation — until they shouldn't |

---

## The Horizon

The observation deck is cleaner. The navigator can see what is selected before they open anything. The tooltips are waiting beside each item, patient and unobtrusive.

But the prefetch system is still waiting. The history menu can remember where the crew has been, but it cannot yet reach ahead — cannot pre-load the data before the navigator arrives, cannot make the return feel instant rather than recollected. That work was scoped, tested, and shelved. The domain functions sit in place like loaded cannons with no powder charge.

And there is another question the deck has not yet answered: as the cost type and view options grow, will the tooltip structure scale? JSX tooltips are expressive but they are not a contract. Each new item will need its own structured explanation, and there is no system yet to enforce consistency.

The navigator now sees clearly. But clarity in the present is not the same as order for the future.

The ellipsis still guards its corner of the deck. It is a better door than it was this morning.

---

*Chapter 24 of the Straw Hat Chronicles*
