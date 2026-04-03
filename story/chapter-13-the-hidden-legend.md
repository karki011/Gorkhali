# Chapter 13: The Hidden Legend

> **Season:** CP-38760 — Legend Interaction
> **Date:** 2026-03-31
> **Crew:** Nami (implementation), Roger (review), Chopper (verification), Luffy (coordination)
> **Repo:** feature-web-apps

## Previously...

The crew had just finished wrestling with color tokens — a battle where the most dangerous enemy turned out to be values that looked correct but were not. They won by going smaller, not bigger. One clean file. Twenty-five verified colors.

Now the ship was moving again, and this time the problem was not hidden in a JSON export. It was sitting right on the deck, visible to every user who had ever tried to read a cost chart and found the landscape dominated by a single grey mountain.

## The Story

The charts on the cost explorer had a problem that nobody talked about directly, but everyone felt.

When you looked at a cost breakdown, the "Other" category — the catch-all for everything below the top few dimensions — often consumed seventy percent of the chart. It was a technical truth: aggregate everything that doesn't rank, and you get a dominant mass. But it made the chart almost useless for the people who needed to read the smaller lines. The ones that actually required attention.

The old solution was tedious. If you wanted to isolate a single series and hide everything else, you clicked it in the legend. Then you clicked the next one. Then the next. For a chart with twelve series, excluding "Other" to read the rest meant eleven clicks, each one a small admission that the interface was working against you.

Luffy looked at it and framed the problem simply: one gesture to hide everything except the thing you're pointing at.

The crew considered the options. Right-click opened a context menu — too heavyweight for something this fast. Double-click was already claimed by other chart gestures. Shift and drag let users pan and zoom across the canvas — that was a chart-level action. But Shift and click on a legend item lived in a different part of the interface entirely. The legend was its own world. No collision. Clean.

Shift-click it was.

Nami went to work. The change was narrow — two files, forty-nine lines added, twelve removed. She gave the chart legend an `onItemExclude` callback and wrote a state machine for `CostChart` to handle it. Three branches: if no series are hidden, shift-clicking one hides everything else and shows only that one. If a series is already isolated, clicking it again restores everything. And one guard: if shift-clicking would hide the last visible series — because someone had already hidden everything down to one — the action simply did nothing. No broken state. No blank chart. No crash.

The logic was clean. The implementation was clean. Forty-nine lines.

Roger read it the way Roger reads everything — slowly, with the attention of someone who has seen what "almost correct" costs you in production.

He found three things.

The first was a matter of courtesy: the aria-label that announced shift-click functionality was being applied unconditionally. If a chart didn't support excluding items, it would still announce that feature to screen readers. A small untruth, but an untruth. Conditional rendering, he suggested. Applied.

The second was about stability. The state machine tracked series using `seriesInfo` as its dependency — an object that rebuilt itself on every render. The correct anchor was `allSeriesKeys`, a stable list that only changed when the data actually changed. A subtle difference, but the kind that causes invisible, intermittent behavior in production. Swapped.

The third was the most dangerous. A function was being called before the constant it depended on had been declared. JavaScript's temporal dead zone: the code looked like it would work, felt like it would work, and would fail silently until someone hit the exact execution path that triggered the missing reference. Roger caught it in review. It never reached the build.

"WAHAHAHAHA! The dead zone claimed another one," he said, marking it in his notes. "Lucky we looked."

Nami made the corrections without ceremony. The diff tightened. The function was moved to its proper place. The dependency changed. The aria-label became conditional.

Chopper ran the checks. The files were clean. The build passed.

PR 577 went up.

And then there was the other story — the one that had been running in the background for weeks.

The board sync had failed again. Luffy had forgotten, again, to update the session JSON when milestones were reached. The board showed stale state. The user noticed. This was not the first time. It was not the fifth time. Luffy had promised to remember. He had not remembered.

There is a point in any recurring failure where the crew has to stop blaming the sailor and start looking at the rigging.

The board sync hook was rewritten. Not patched — rewritten. The new version matched tasks by their actual identifier, not by trying to guess which task description sounded closest to which line of work. It auto-created tasks when they were missing. It rolled up phase status automatically when subtasks completed. The system no longer depended on anyone remembering to update it. The update happened, or the hook failed loudly and asked for help.

Luffy, looking at the new code, was quiet for a moment.

"It shouldn't have taken this long," he said.

"No," Nami agreed. "But it's fixed now."

That is the difference between promising to do better and making it impossible to do worse.

## Key Panels

- **[PANEL]** Nami, finishing the state machine — "Three cases. Show-one, restore-all, do-nothing. Nothing else." — *Forty-nine lines. Twelve removed. The restraint is the craft.*

- **[PANEL]** Roger, pointing at the declaration order — "It calls the function before the constant exists. The code looks right. It isn't." — *The temporal dead zone: the bug that waits for the right execution path.*

- **[PANEL]** Luffy, after the third reminder about board sync — "I'll remember this time." — *He does not remember.*

- **[PANEL]** Luffy, reading the new hook code — "It shouldn't have taken this long." — *Some problems cannot be solved with discipline. They need to be made impossible.*

## Captain's Log

- **The Shift-Click decision.** Three interaction patterns were considered. Shift-click was chosen because it lived in a different DOM element from the canvas interactions, eliminating collision entirely. Choosing the right gesture is the same kind of decision as choosing the right data structure — correctness first, then elegance.

- **Roger's three catches.** Unconditional accessibility claims, unstable dependencies, temporal dead zones — none of them would have broken the build. All of them would have caused quiet problems in production. This is the value of a reviewer who reads slowly.

- **Automation over discipline.** The board sync had failed across five or more sessions. The fix was not another reminder or another promise. The fix was a hook that matched by ID, auto-created missing tasks, and rolled up status without human intervention. The lesson is older than software: if a process fails repeatedly when humans do it, make it a machine's responsibility.

## The Horizon

The chart interaction is live. Users can now shift-click any legend item and read the chart without the shadow of "Other" dominating the view. A small gesture. A meaningful change for anyone who has ever needed to find a signal in a noisy cost breakdown.

The board sync is automated. For the first time, the crew's board reflects reality without anyone having to remember.

But the token restructure from Chapter 12 is still waiting. The Figma export still has unresolved variables. And somewhere in the design system, a spacing value still reads "1" where it should read "4."

The Deep Reviewer left no forwarding address.

He will be back.

---
*Chapter 13 of the Straw Hat Chronicles*
