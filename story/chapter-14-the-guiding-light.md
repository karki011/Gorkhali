# Chapter 14: The Guiding Light

> **Season:** CP-39366 — Learn More Links
> **Date:** 2026-03-31
> **Crew:** Luffy (solo)
> **Repo:** feature-web-apps

## Previously...

The shift-click legend interaction went out quietly and cleanly — forty-nine lines, three review corrections, one automated board sync that no longer required anyone to remember. The crew had solved a small problem with great care.

But the chart interaction was only half the picture. Even with the best tools, a traveler who does not understand the map will still get lost.

## The Story

There is a word that shows up in the cost explorer — Cost Type — that stops new users cold.

It appears in a small popover when they hover over an information icon. The label makes grammatical sense. It is not a typo. The help text explains, in good faith, what the value represents. And yet, the question that comes back from support, from onboarding calls, from first-week users exploring the interface for the first time, is always some version of the same thing: what does this actually mean?

The information was there. It just did not go far enough.

Luffy looked at the ticket. Two popovers, two documentation links, one known pattern already in the codebase. No need to call the crew for this one.

He went looking for the pattern first — that discipline is worth noting. Before writing anything new, he read how the ship had solved the same problem before. In `view-selector.tsx`, buried in the component that handles how cost views are configured, there was already an answer: a `Button` rendered as a link, an external link icon from the Lucide set, and a clean anchor to the documentation site. The props sat on a single line. The structure was already established. The design language was already decided.

This is the quiet kind of craft that only reveals itself when you look at a second implementation and find it identical in shape to the first. The pattern had been laid once by someone who thought ahead. Luffy copied the mold.

The Cost Type popover now ends with a line: a link to the Explorer documentation, anchored at the cost-types section. The Explorer Details popover now ends with a link to the broader Explorer docs. Each link opens in a new tab. Each link is labeled honestly. Neither requires a user to leave the interface to go searching — the door is right there, in the moment they need it most.

One small formatting correction came up after the initial pass. The linter — Biome, the fast one — flagged that JSX props were spread across multiple lines where a single line would do. The fix was four lines of adjustment, no logic changed. Then the build ran clean across all eighty-four projects. The fourteen tests for the cost-type selector passed without complaint.

The work took less time than writing about it.

Luffy closed the ticket, pushed the branch, moved Jira to Reviewing, and tagged the automated reviewer. He did not call Chopper. He did not ask Roger to read it. Some work is exactly as simple as it looks — and the honest thing is to treat it that way.

That restraint is its own kind of judgment.

There is a version of this story where a captain delegates everything, even the small things, to prove that the crew is always busy. And there is a version where a captain carries the small things himself so the crew can rest their attention for the work that truly demands it.

Luffy knows the difference.

## Key Panels

- **[PANEL]** Luffy, reading `view-selector.tsx` before writing a single line — "Someone already built this door. I just need to put it in the right wall." — *The pattern was there. The discipline was reading before writing.*

- **[PANEL]** A new user, hovering over the Cost Type label in Explorer — "What does this mean?" — *The link is now right there. The question answers itself.*

- **[PANEL]** Biome, flagging the prop formatting — one correction, no logic changed, build green — *Craft is also keeping the lines tidy.*

- **[PANEL]** Luffy, pushing the branch alone — "The crew earned the rest." — *Some jobs belong to one person.*

## Captain's Log

- **Pattern first, then implementation.** The existing link component in `view-selector.tsx` was the correct reference. Using it meant the two popovers now speak the same visual language as the rest of the interface. Consistency is the thing users never notice, and immediately miss when it breaks.

- **Solo judgment.** This ticket touched two files and replicated a known pattern. Routing it through a full crew review would have cost more attention than the change warranted. Knowing when not to assemble the crew is as important as knowing when to call them.

- **Documentation as navigation, not explanation.** The links do not replace the help text — they extend it. The popover answers "what is this." The documentation link answers "tell me everything." Both are needed. Neither was sufficient alone.

## The Horizon

The links are live. Two popovers now point outward, toward the wider documentation. Users who have been stopping at the edge of the interface now have a path forward.

But links age. Documentation moves. The anchors that point to the right section today may drift when the documentation is reorganized. Someone will need to watch those paths.

The Explorer is a deep instrument. Cost Type is only one of its concepts that stops people. There are others — amortization, shared costs, allocation methods — all sitting behind their own small information icons, all waiting for the same guiding hand.

The lantern has been lit in two windows.

There are others still dark.

---
*Chapter 14 of the Straw Hat Chronicles*
