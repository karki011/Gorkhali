# Chapter 29: The Heart of the GroupBy

> **Season:** CP-40131 — Favorite Dimensions
> **Date:** 2026-04-10
> **Crew:** Luffy (orchestrator), Franky (foundation + wiring), Sanji (domain), Nami (design system), Zoro (tests), Roger (quality), Chopper (verify), Greptile (external ally)
> **Repo:** feature-web-apps

## Previously...

The crew had just finished a brutal showdown with the Explorer's collapsed menu — thirty moving parts reorganized in a single afternoon. Roger had sent the work through his sharpest lens and Chopper had declared the ship seaworthy. But before the crew could rest, Luffy unrolled a new map on the table. "Users are drowning," he said. "Every time someone opens the GroupBy dropdown, they're wading through thirty dimensions just to find the three they always use." He tapped the map. "We're giving them a shortcut."

## The Story

It started with a problem everyone on the crew recognized from experience: a list so long it defeated its own purpose.

The GroupBy dropdown — the panel where users chose which dimension to slice their cost data by — had grown unwieldy. Thirty categories, sometimes more. Engineers, finance teams, platform owners: everyone scrolled past the same irrelevant entries every single time. There was no memory, no shortcut. Every session started from zero.

Luffy's answer was a heart.

A small icon, tucked beside each dimension in the list. Press it, and the item would move to a Favorites category pinned at the top of the dropdown, waiting the next time you opened it. Simple in concept. Complex in execution.

He split the work into waves and sent the crew in parallel.

Franky dove into the foundations. He built the data structures to store which dimensions a user had marked as favorites, and the hook that would read and write those preferences. Sanji attacked the domain layer simultaneously, teaching the dimension-loading logic how to accept a list of favorites and weave them into a dedicated category. Nami worked on the dropdown itself in parallel, opening space for an action icon beside each item and adding support for a collapsible top section. Three agents, three separate corners of the codebase, zero collisions.

Wave one landed clean.

Wave two, Franky wired the favorites preference into the Explorer's central context so the whole page could access it, then built the star button component itself — the small heart that would appear on hover and respond to a click.

Wave three, Zoro took over. Twenty-one tests across three files. Every edge case covered: adding, removing, enforcing the ten-item cap, handling empty states, verifying that the Favorites category only appeared when it contained something.

Then Roger arrived.

He found the critical bug before any user could. The optimistic update — the trick where the UI jumps ahead of the server to feel instant — was firing twice. Every favorite click was writing to the preferences store double, creating a ghost. Roger excised it cleanly and then flagged three places where the same dimension-shaping logic had been written out three separate times. Luffy read the note, extracted the shared helper, and collapsed the redundancy in minutes.

That should have been the end. It was not.

The user opened the feature.

Nine rounds of feedback followed, each one precise.

The heart icon went through three names — a star, a pin, finally a heart — before it matched the language the URL history feature had established. The hover animation was too dramatic; it was removed. All categories should start collapsed so the dropdown didn't feel overwhelming on open. The pin should hold position while the dropdown was open so clicking it didn't jump the cursor. The collapse state should reset when the dropdown closed so every session started fresh. During search, Favorites should hide entirely — it would only confuse filtering. The heart icon itself was a button nested inside a button, a violation the browser quietly resented; it was rebuilt as a span with a keyboard role instead. The dropdown should close the moment an option was selected. And the cap was raised from five favorites to ten.

Nine rounds. Each one smaller than the last.

Then Greptile — the crew's external reviewer — read the finished pull request and found three things the team had missed. A Kubernetes dimension pinned to Favorites would lose its original category context, causing the cluster filter to skip it silently. The defaultExpanded prop Nami had built in wave one was never actually used anywhere. And in rare cases, the Favorites group would appear where it shouldn't during filtering.

All three fixed. The replies to Greptile carried a tone the crew had started to cultivate over recent sessions: honest, a little self-deprecating, genuinely amused. *We handed you a loaded gun and called it a feature,* Sanji wrote in one reply. *Thank you for the reminder that things that look correct can still be wrong.*

220 tests passed. 13 files changed.

The heart icon sat quietly beside every dimension in the list, waiting.

## Key Panels

- **[PANEL]** Luffy, pointing at a thirty-item scroll — "If we make them search for the same thing every day, we're not building tools. We're building obstacles." — *the spark that opened the ticket*

- **[PANEL]** Roger, stylus in hand, circling the double-write in red — "Looks instant. Writes twice. That's not a feature, that's a haunting." — *the optimistic ghost caught before it reached users*

- **[PANEL]** Zoro, after the ninth round of feedback — "Twenty-one tests. All green. Nine revisions. Still green." — *quiet pride in a test suite that bent without breaking*

- **[PANEL]** Greptile's report arriving mid-celebration — "Your Kubernetes dimensions are losing their coordinates." — *the external eye that found the silent skip*

## Captain's Log

- **Inject, don't import.** The domain layer that handles dimensions sits below the layer that handles user preferences. It cannot reach up and import from above. Rather than break the architecture, the crew passed `favoriteDimensionIds` in as a parameter. The callers — living in the UI layer where both are visible — compose the two hooks themselves. The boundary held.

- **Nine rounds is not failure.** Each iteration sharpened something real. The feature that shipped was not the feature that was designed. It was better, because real hands touched it and told the truth.

## The Horizon

The heart icon is live, but it only lives in the GroupBy dropdown. The same problem exists elsewhere — everywhere users face long, unfiltered lists of dimensions with no memory between sessions. The infrastructure Franky built can be used again. Sanji's injection pattern is already documented.

The question the crew hasn't asked yet: which other dropdowns deserve a heart?

---
*Chapter 29 of the Straw Hat Chronicles*
