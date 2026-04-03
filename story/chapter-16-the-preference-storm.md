# Chapter 16: The Preference Storm

> **Season:** CP-39173 — The Preference Storm
> **Date:** 2026-03-31
> **Crew:** Luffy (coordinator), Franky (implementation analysis), Shanks (architecture review), Opus (change mapper)
> **Repo:** feature-web-apps

## Previously...

The crew had just emerged from the Infinite Loop — a day of untangling a recursive deadlock that nearly swallowed the ship whole. Roger had called it a near miss. The logs had been sealed, the loop broken, and everyone was finally catching their breath.

Then a new message arrived. A crewmate from another ship had sent over a hatch: a fully-built preferences system, meant to remember a navigator's favorite theme and sort order across every device they touched.

It looked ready to sail. Luffy wasn't so sure.

---

## The Story

The pull request arrived from Eric's ship already rigged and supposedly sea-tested. Two things it promised: the interface would remember whether you sailed in light or dark, and it would keep your preferred sort order wherever you docked.

Luffy read the description twice. "Before this goes in, I want the crew to walk every plank."

Franky was the first below deck.

He moved through the system methodically, the way an engineer does when he respects someone else's work but trusts nothing until he's touched it himself. The logic was clever. The structure was clean. And then, in a lower compartment, he found it.

The dark mode setting was being fetched from a distant server. The ship would paint itself — fully, completely — in the default light scheme. Then, half a second later, the server would reply and the whole hull would shift to dark.

Franky surfaced. "Every dark mode user sees a flash. Light first. Then dark. Every. Single. Page."

The name for it was FOUC — a flash of unstyled content. The crew had seen it before in older ships. It was the kind of bug that users noticed immediately and engineers often found last, because it happened in the gap between the browser's first paint and the moment the application finished thinking.

Shanks had been listening from the upper deck. He walked down slowly and put both hands on the railing.

"This is an architecture problem, not a fix problem," he said. "The preferences system is treating the server as the source of truth. But the server can't answer fast enough. You need the device to answer first."

Luffy asked the question that had been circling the conversation: "What happens when the server says one thing and the device remembers something different?"

The room went quiet.

Opus started mapping it on the board. If the API won, a recent local change could get silently erased — a user toggles dark mode on their laptop, then opens a tab, and the old server value overwrites it before they even see the page. If localStorage won blindly, a preference set months ago on a different device might block a newer cloud preference from ever arriving.

The answer, when they found it, was precise. Write to both the device and the server every time. Read from the device first, always. When the server responds, use it only to fill in preferences the device has never seen — never to overwrite ones it already holds.

Shanks named it: "Write-through on the way out. Merge-only-missing on the way in."

Franky pulled out the rest of his findings. Beyond the flash, there was a race condition when two browser tabs opened the same page simultaneously — both could try to run a first-time migration and collide. There was a stale closure in the sort preference handler, meaning rapid changes could be silently lost as earlier writes overwrote later ones. And the table sort flash mirrored the theme flash exactly — the grid rendered before the server had a chance to respond with the saved sort order.

Four bugs. Each one invisible until you knew where to stand.

Opus surveyed the full picture and returned with measured news: the PR was actually closer to the right architecture than it appeared. The heavy lifting was already done. What needed to change was the read priority — flip the order, reach for the device first, treat the server as backup — and add the protection that stops the API from winning when local data is newer.

The crew drafted the feedback carefully. Not a rejection. A set of changes. They described each bug, explained the architecture they were recommending, and drew out the sync direction clearly so there was no ambiguity about what "merge-only-missing" meant in practice.

Luffy posted the comment himself. Then he requested the changes.

The PR would wait. The preferences system would not ship with a flash.

---

## Key Panels

- **[PANEL]** Franky — "Every dark mode user sees the flash. Light first. Then dark. Every single page." — *surfacing from below deck with the FOUC bug in hand*
- **[PANEL]** Shanks — "The server can't answer fast enough. You need the device to answer first." — *declaring the architectural verdict from the upper railing*
- **[PANEL]** Luffy — "What happens when the server says one thing and the device remembers something different?" — *the question that cracked the sync problem open*
- **[PANEL]** Opus — "Write-through on the way out. Merge-only-missing on the way in." — *committing the solution to the board*

---

## Captain's Log

- The preferences system was well-built but treated the server as the authority over user experience — a role the server cannot fill at the speed of a page load.
- Flipping to device-first reads eliminates every visible flash at zero cost to cross-device sync.
- The sync direction rule — fill missing, never overwrite — protects against the API silently undoing a user's most recent choice.
- Feedback was posted as a clear, constructive comment. The author has everything needed to fix it.

---

## The Horizon

The PR sits with changes requested. Eric will need to flip the read order, add the missing-key merge guard, fix the stale closure, and protect against the concurrent-tab migration race.

Four bugs found. Zero shipped.

But the question Luffy asked — *what wins when two sources disagree?* — is older than this PR. Every preference system, every settings panel, every saved state that syncs across devices will eventually face it.

The answer the crew found today will be worth remembering.

---

*Chapter 16 of the Straw Hat Chronicles*
