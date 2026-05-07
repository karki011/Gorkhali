# Chapter 28: The Favorite Scroll

> **Arc:** Explorer Enhancement Saga
> **Date:** April 10, 2026
> **Crew:** Luffy (Captain), Nami (UI), Zoro (Testing), Chopper (Verify), Roger (Review), Robin (Chronicles)
> **Repo:** feature-web-apps

---

The sea was calm that morning when the Thousand Sunny docked at Explorer Harbor. Captain Luffy stood at the helm, studying a weathered scroll covered in URLs — the favorites of a thousand navigations, each one labeled with the cold precision of a machine. "Services, Daily, Last 30 Days." "Accounts, Monthly, Last 7 Days." Useful, but utterly soulless.

"What if a navigator could name their own stars?" Luffy mused aloud.

The crew assembled. The mission was clear: let users rename their favorite Explorer queries with custom labels — a small thing, perhaps, but the kind of small thing that turns a tool into a companion.

Nami went to work first, her fingers dancing across the keyboard. She added a `customLabel` field to the sacred `UrlHistoryEntry` type — a new optional string that would coexist peacefully with the auto-generated label, never overwriting it. "The original name stays," she explained, "like a ship's true name carved into its hull. The custom label is the name the captain gives it."

She wove the `updateFavoriteLabel` callback into the hook, following the established pattern — optimistic cache updates, PATCH mutations, the whole dance the crew had perfected during the URL History arc. Un-favoriting would strip the custom label clean, like barnacles scraped from a hull before dry dock.

Then came the great debate of the pencil.

Nami's first design was elegant in theory: a tiny pencil icon that materialized on hover, ghostly and inviting. But when Luffy tested it, he squinted at the screen. "I don't see anything," he said flatly. The `_groupHover` opacity trick — reliable in open waters — failed in the confined quarters of a Popover panel.

"A kebab menu," Luffy decided, pulling up the namespace-actions-cell for reference. "Like the one Subash built for Dimension Studio. Three dots. Click. Options. No guessing."

But the nested-floating-element curse struck again. The Menu, rendered inside a Popover, found its Portal stealing focus from the parent. `preventDefault` blocked the Menu from opening. Remove it, and the Popover thought clicks were escaping. The crew fought through three iterations — each time Chopper running the build, each time the tests staying green while the UX stayed broken.

"Controlled state," Nami finally said, studying the namespace pattern more carefully. Explicit `open` + `onOpenChange`. Portal wrapping the Positioner. The same pattern that had already been battle-tested across the codebase. And with that, the menu snapped into place — "Rename" with a pencil icon, "Open in new tab" with an arrow, styled in teal on hover, grouped under a "FAVORITE OPTIONS" header.

Roger appeared for his review, as he always does. He found a subtle bug — the `handleSave` function compared against the wrong label, risking silent data loss when a user typed back the exact original text. "Compare against what the user *sees*," Roger advised, "not what the machine generated." One line changed. One bug killed before it could breed.

The Simplifier swept through next, replacing nested ternaries with `renderContent()`, stripping redundant type annotations, collapsing `handleCancel` into a direct `setIsEditing(false)`. The code emerged leaner, as code always should.

Finally, Luffy extracted the `FavoriteActionsMenu` into its own component — a clean separation that kept `history-list-item.tsx` from growing unwieldy. Eight files changed. 398 lines added. 71 removed. Fourteen tests, all green.

The scroll could be named now. "Monday Standup View." "Q2 Budget Check." "That Weird Spike Last Tuesday." Each name a small act of ownership in a sea of data.

## Key Moments

> "I don't see anything." — *Luffy, discovering hover-reveal icons don't work inside Popovers*

> "Compare against what the user sees, not what the machine generated." — *Roger, catching the handleSave bug*

> "The original name stays, like a ship's true name carved into its hull." — *Nami, on the customLabel/label dual-field design*

## Decisions

1. **Kebab menu over hover-reveal** — Discoverability wins over minimalism in floating panels
2. **Portal + controlled state for nested floating elements** — The namespace-actions-cell pattern is the canonical solution
3. **Separate `customLabel` field** — Never mutate auto-generated data; overlay with user intent
4. **Favorites tab only** — Actions menu gated by tab context, not just entry.favorite flag

## Horizon

The favorite labels are named, but they could be more. Drag-to-reorder favorites. Favorite folders. Shared team favorites. Each one a chapter waiting to be written.

But for now, PR #695 sails toward review, and the crew rests easy knowing that a navigator's bookmarks are finally, truly, their own.

---

*Chapter 28 of the Straw Hat Chronicles*
