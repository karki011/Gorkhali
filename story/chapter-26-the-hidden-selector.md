# Chapter 26: The Hidden Selector

> **Season:** CP-40010 — Explorer: Update Collapsed Menu
> **Date:** 2026-04-09
> **Crew:** Luffy (orchestration), Nami (UI implementation), Chopper (verification), Roger (quality review)
> **Repo:** feature-web-apps

## Previously...

The corrupted preference records had been cleaned. Twenty-two navigators were reading honest scrolls again. The ghost key had been laid to rest. The Thousand Sunny's ledger was orderly — for the first time in months, the records matched the truth.

But there was still something the observation deck was hiding. Not in the records. In the deck itself.

---

## The Story

Every navigator who worked the Explorer knew about the ellipsis. Three dots in the corner of the toolbar — the collapsed menu, the quiet door. They knew it the way sailors know about tides: not fondly, just as a fact of their working life.

Behind it, buried two layers deep, was the Cost Type selector. The thing a navigator needed to set before any analysis could mean anything. The choice that shaped every number on the screen.

And every time they needed it, they had to find the door, open the door, and find it inside.

---

### The Old Shape of Things

The Additional Features menu had grown like a storeroom nobody had cleaned. It held section headers — Access, Filter, Create — organized into categories that had made sense once, at an earlier moment in the ship's design. But the deck had evolved around those categories, and the headers now sat like furniture from a different era: technically present, structurally useless.

The View selector showed a label. Not the current view — just the word "View." A navigator who had already chosen a view had to open the menu to confirm what they already knew they had done.

The Cost Type selector did not appear in the toolbar at all. It was reachable, but not visible. A discovery that required exploration was not a tool — it was a puzzle.

Subash mapped the problem once and called the crew together.

---

### Luffy Sends the Scout

Luffy dispatched an Explorer agent before any work began — not to build, but to look.

The question was simple: did something already exist that could do this job? The toolbar needed a Cost Type selector. The question was whether the ship carried one.

The agent went into the codebase. Into the component library. Into the Explorer's own structure.

And it found one.

---

### The Discovery

The `CostTypeSelector` had been built completely. It lived in the UI package, tucked beside the Explorer's other components — a full component with a dropdown menu, an information button that linked to documentation, loading and error and empty states, and fourteen passing tests.

It had been built for this deck. It had never been placed on it.

The scout returned and Luffy looked at the report for a moment. Then the plan changed entirely.

There was nothing to build. There was only a wire to run.

---

### Nami Connects the Wire

Nami took the task. The work was not creative — it was precise.

Step one: lift the `CostTypeSelector` out of the collapsed menu and place it directly in the main toolbar, ahead of the history button. The selector was already built. It needed a position, not a purpose.

Step two: remove the section headers from the Additional Features menu. Access, Filter, Create — stripped. The items beneath them remained. The categories did not. The menu became a flat list.

Step three: make the View label honest. The hook that managed view state already computed a `selectedLabel` — the name of whatever was currently selected. It had been there for chapters. Nami wired it to the display. The menu item now read the actual view name.

Step four: move the Create View item directly beneath the View item. Proximity of function. No reorganization required — just gravity.

The toolbar was clean. The menu was honest. The most important selector on the deck was now visible before anything was opened.

---

### Greptile's Eye

The pull request went up. The automated reviewer arrived before the crew had finished reading their own work.

One observation: in the View label, a fallback had been left behind — `selectedLabel || 'View'`. If `selectedLabel` was ever empty, the label would fall back to the plain word. Reasonable caution. Standard defensive code.

Except `selectedLabel` was never empty. The hook that produced it always returned a non-empty string — either the name of the selected view, or a default that was already handled inside the hook itself. The fallback `|| 'View'` could never trigger. It was a guard protecting against a condition that could not occur.

Nami fixed it immediately. The fallback was removed. The code said what was true.

---

### Roger and the Dead Description

Roger ran the simplify pass.

The `MenuItem` component had accepted a `description` prop — a second line of text beneath the label, useful when a menu item needed explanation. The `CostTypePanel`, which had lived inside the collapsed menu, had used this prop to explain the cost type concept inline.

The `CostTypePanel` was gone now. Moved to the toolbar. The `description` prop on the remaining menu items had been vacated by its own use case.

Roger found it still sitting in the component interface — an optional field that nothing passed, that nothing read, that existed because it had once been useful. He marked it for removal. The prop was cut.

The menu items were leaner. The component surface matched the actual usage.

---

### The Final Count

When the dust settled, the numbers told the story plainly.

Two hundred and fifty-five lines deleted. Seventy-one lines added. A net reduction of one hundred eighty-four lines in a change that improved the deck, not degraded it.

The `CostTypePanel` was gone — not because it had failed, but because its function had been absorbed by a better-placed component that already existed. The section headers were gone. The dead props were gone. The fallback that could never trigger was gone.

What remained was the toolbar with a visible selector, a flat and honest menu, and a component that had waited patiently in the library for someone to realize it was already what the deck needed.

---

## Key Panels

- **[PANEL]** Luffy's scout — scanning the component library — *"It's already here. Fourteen tests, full documentation. We don't build this. We place it."*
- **[PANEL]** Nami — lifting the CostTypeSelector into the toolbar — *the moment a buried thing became the first thing a navigator would see*
- **[PANEL]** Greptile — marking the unreachable fallback — *"This guard protects against a condition that cannot happen. Remove it."*
- **[PANEL]** Nami — removing `|| 'View'` — *a line of code that had never run and never would; gone within minutes*
- **[PANEL]** Roger — finding the dead `description` prop — *the remnant of a panel that no longer existed, still listed in the interface as if expecting a call*

---

## Captain's Log

| Decision | Why It Mattered |
|---|---|
| Scout before building | Finding the existing component changed the entire plan; building a duplicate would have created debt instead of clarity |
| Promote CostTypeSelector to toolbar | Visibility is the first requirement for a tool the navigator must set; hiding it behind a door was not protection, it was obstruction |
| Remove section headers | Categories that no longer organize anything are noise; the flat list was more honest than the structured one |
| Accept Greptile's observation immediately | A fallback that can never trigger is a lie the code tells about its own possibilities; remove it |
| Cut the dead description prop | Unused interface surface accumulates confusion; a component should only offer what it actually does |

---

## The Horizon

The toolbar is cleaner. The Cost Type selector is where it belongs. The navigator no longer has to open a door to find the most important choice on the deck.

But the explorer's toolbar is a crowded place now. The history menu, the new selector, the view controls — each individually justified, collectively accumulating. There is no problem yet. There may be one soon.

And somewhere in the library, other components wait in the same condition the CostTypeSelector was in: fully built, correctly tested, never placed. The scout found one. There is no reason to believe it was the only one.

The wire has been run. The signal is live. The deck shows what it knows.

That is more than it showed yesterday.

---

*Chapter 26 of the Straw Hat Chronicles*
