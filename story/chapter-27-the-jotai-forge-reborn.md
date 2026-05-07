# Chapter 27: The Jotai Forge Reborn

> **Season:** PhantomOS — The State Forge
> **Date:** 2026-04-10
> **Crew:** Luffy (solo)
> **Repo:** Phantom-OS

## Previously...

The Thousand Sunny's deck had been cleaned. Selectors promoted, dead code cut, menus made honest. The crew had done good work — the kind that made navigators' lives measurably easier.

But there was a second ship. A personal project. A dashboard Subash had been building alone in the hours between voyages — PhantomOS, the Solo Leveling-themed command center for tracking Claude Code sessions. It ran on Electron. It held tabs, panes, terminals, and worktrees in a grid of live state. It was, by any measure, ambitious.

And deep in its hull, something had been wrong for a long time.

---

## The Story

### The Stillness After the Switch

Every great problem announces itself simply.

When Luffy switched between worktrees in PhantomOS, the tabs did not change. The panes did not change. The UI showed what it had been showing before the switch — the old workspace, frozen in place like a portrait of a moment that had already passed.

He switched again. Nothing.

A third time. Still nothing.

The dashboard was receiving the command. The state was updating — technically. But the React components on screen had no idea. They continued rendering yesterday's truth. The UI was not broken. It was disconnected — a compass that still pointed north even after the ship had turned east.

He traced the wire.

---

### The Zustand Bridge

The pane system — the mechanism that tracked every tab, every split, every layout across every worktree — had been built on Zustand. A simple, trusted library. Imperative state. You called `switchWorkspace()` and the data changed.

But the rest of PhantomOS had moved to Jotai. Atoms. Reactive state. The kind where React watches and responds.

Someone had built a shim. A bridge between the two worlds. When a worktree switch was requested, the shim reached into Zustand's store directly: `store.getState().switchWorkspace()`. It updated the atom. Technically.

But it did so outside of React's awareness. It called the function as if the component tree were not there — as if the atoms floated in a void rather than living inside a running application. The atom changed. React never heard the knock.

The compass moved. The navigator's screen did not.

---

### The Parallel Universe

Luffy removed Zustand entirely. Pure Jotai atoms, all the way down. He called `useSetAtom(switchWorkspaceAtom)` from React directly — the correct invocation, the one React could hear.

He ran the application. The tabs still did not change.

He looked deeper.

Somewhere in the migration, a `<Provider store={jotaiStore}>` had appeared in the component tree. It had been added with care — `createStore()`, a clean reference, a proper Jotai pattern. Sensible on its face.

What it had actually done was create a second store. A parallel universe. Every atom in the application — not just the pane atoms, but the system atoms, the worktree atoms, everything — was now living in two places at once. The default store, which React knew about. And the Provider's store, which `useSetAtom` was writing to.

The call was landing. Just in the wrong universe. The atoms the components were reading from had never been touched.

The fix was a single function name. `getDefaultStore()` instead of `createStore()`. Then: remove the Provider wrapper entirely.

One import. The dashboard came alive.

---

### Four Attempts at the Terminal

There was still the matter of the terminals.

Every worktree had a terminal pane. A running shell. The question was what should happen to it when the user switched to a different worktree and then switched back. Should the shell remember where it was? Should it have died and been reborn?

Luffy made four attempts to answer this question.

The first kept no memory at all. Fresh terminal on every switch. Clean, reliable, stateless. It worked exactly as specified and satisfied no one. A navigator who had been deep in a build, a test run half-finished, would return to an empty prompt.

The second tried to hold the terminals across switches. Deferred detach — keep the process alive, hide the display, restore it when the worktree returned. The logic was sound. React was not.

React StrictMode mounts every component twice in development. It does this deliberately, to surface bugs. But this meant Luffy could not tell the difference between "component unmounted because worktree switched" and "component unmounted because StrictMode is testing it." The defer logic fired on both. The heuristic collapsed. The implementation became a game of probabilities no one could win cleanly.

The third attempt removed the overlay that had been hiding the terminal during initialization. Show it immediately. The visual flicker was gone. Better. Not enough.

The fourth attempt accepted the truth: the terminal would not persist shell state across worktree switches. Not yet. But it would at least mount once, mount correctly, and mount without StrictMode confusing it for something else. A guard — a simple `Set` tracking which terminals were already initializing — made the double-mount harmless.

Four attempts. A reliable terminal. Not a persistent one.

Some problems accept partial solutions. The navigator knew where the frontier was now. That was worth something.

---

### The State That Outlived the Session

While the atom wires were being mended, Luffy looked at where the pane state was being stored.

localStorage. The browser's attic. Fast, convenient, and wrong for this use case — localStorage had no structure, no queryability, and no survivability across the kind of resets an Electron app might encounter.

He migrated it to SQLite. A `pane_states` table. Writes debounced to three hundred milliseconds — enough to batch rapid changes without hammering the disk. Reads synchronous on cold boot — no async startup stutter, no flash of empty panes while the load resolved.

The pane state now lived where data was supposed to live. It would outlast sessions. It could be queried. It was, for the first time, trustworthy.

---

### The Horizon Document

At the end of the session, Luffy wrote something down.

Not a commit. Not a comment in the code. A document that named what had been solved and what had not. The Provider trap: closed. The Zustand bridge: dissolved. The atom wiring: correct. The terminal persistence: still open. The StrictMode boundary: still a constraint.

A captain who could not name what remained undone was a captain sailing without a chart. The document was the chart.

He committed it alongside the fixes. Six commits. Six problems addressed, two fully resolved, one partially, one mapped for the next voyage.

The dashboard was honest now. The panes tracked the right worktree. The atoms lived in one universe. The terminals were reliable, if not yet persistent.

That was a different ship than the one he had started with that morning.

---

## Key Panels

- **[PANEL]** Luffy — switching worktrees, watching the screen stay frozen — *"The command is landing. The UI hasn't moved. Something between them is not listening."*
- **[PANEL]** Luffy — finding `store.getState().switchWorkspace()` in the shim — *the moment he understood: the call had been made into a void, outside React's hearing, every time*
- **[PANEL]** Luffy — reading `createStore()` in the Provider — *"There are two stores. Every atom in this system has been living in the wrong one."*
- **[PANEL]** Luffy — four terminal implementations laid out in sequence — *each attempt failing for a different reason, each failure teaching something the next attempt could use*
- **[PANEL]** Luffy — the StrictMode double-mount — *"I cannot tell the difference between a test and a real unmount. The framework is indistinguishable from the problem."*
- **[PANEL]** Luffy — writing the horizon document — *"What is solved. What is not. Where the frontier is. A captain names these things."*
- **[PANEL]** The dashboard — panes finally tracking the correct worktree — *everything reactive, everything live, the atoms in one home*

---

## Captain's Log

| Decision | Why It Mattered |
|---|---|
| Remove Zustand entirely, go pure Jotai | The bridge was the problem; any shim that crosses from imperative to reactive will eventually deliver state to nowhere |
| Use `getDefaultStore()`, remove the Provider | A Provider with `createStore()` is not a configuration — it is a fork; the entire application was reading from the unfed branch |
| Accept partial terminal solution | Four attempts taught the exact shape of the constraint; naming the boundary is more valuable than chasing a full solution into instability |
| Migrate pane state to SQLite | localStorage was a coincidence that had worked; SQLite is a commitment that will continue to work |
| Write the horizon document | Unsolved problems left unnamed become debt that the next session has to rediscover from scratch |

---

## The Horizon

The atoms are wired correctly. The panes track the right workspace. The terminals mount reliably and do not flicker.

But the shell state still dies on every switch. A navigator who has been running a test returns to a blank prompt. The work to fix this exists — persistent terminal processes, a mapping between worktree IDs and process handles, a way to distinguish StrictMode remounts from real unmounts in production. The path is visible. It has not been walked.

The multi-server dashboard is running. The worktree discovery is live. The sparkle sidebar marks what is fresh. These are features the navigator can use today.

The next hard question is distribution. PhantomOS runs on one machine — Subash's. To run on another machine, it must be packaged, signed, and shipped. That is a different kind of forge.

The dashboard watches the sessions. The sessions accumulate. Somewhere in the state, a pattern is forming that nobody has named yet.

The Jotai forge has been rebuilt from its foundations. What runs on it now is faster, cleaner, and correctly wired.

What gets built on it next is still being decided.

---

*Chapter 27 of the Straw Hat Chronicles*
