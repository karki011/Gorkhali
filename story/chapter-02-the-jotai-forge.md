# Chapter 2: The Jotai Forge

> **Season:** The Cutting Board Saga
> **Date:** 2026-03-26 → 2026-03-27
> **Crew:** Luffy, Franky, Nami, Sanji, Zoro, Chopper, Roger, Sengoku (first appearance), Ace (Grand Fleet — first appearance)
> **Repo:** feature-web-apps

## Previously...

The Cutting Board wizard was born in fire — five steps built one island at a time, every pixel deliberate, every test green. The crew celebrated. But Franky couldn't sleep. He kept returning to the engine room, listening. The wizard *worked*. It just didn't *hold*. Step backward and half the choices vanished. The state was tangled rope, not a clean chain. He recognized what the crew had built: a beautiful blade with a rotten core.

The horizon from Chapter 1 had promised real API integration. What came first was harder: the forge.

## The Story

Franky spread no new chart on the navigation table. He spread the old one — and pointed to the engine room.

"We're not sailing a new island. We're reforging what's already in the hold."

The wizard was beautiful on the surface. Every card, every animation, every glowing green border — still perfect. But inside: seventeen tangled threads of state that didn't speak to each other, state that forgot itself the moment a user stepped backward, props passing through three layers to reach the person who actually needed them. A ship that *looked* fast. Under pressure, it would snap.

Luffy didn't hesitate. "Then we gut it."

**Franky descended first.** He went alone and came back with something new: an atomic state system. Nineteen precisely named pieces, each with one job and one home. Not a tangled rope — a chain of beads. When a user stepped backward, their choices stayed. The state remembered. *"SUPER! Every piece of state now has a name, a home, and a shape."*

While Franky worked the engine, **Sanji built the door.** One hook. One entrance for the outside world. The wizard didn't need to know whether its data came from mock tables or a live pipeline — it only needed to knock on that one door. *"When the real API arrives, this is the only place it needs to knock."*

**Roger reviewed both before a single migration began.** Two issues found. Both corrected. *"The foundation is sound."*

Then the hardest work: **Nami took the helm.** Five drawers, three modals, every step — all transplanted from the old tangle to the new atomic core. One by one, she cut the old roots and planted new ones. The wizard didn't break. It didn't even flinch. The outer hull looked identical. The engine room was transformed.

**Zoro arrived.** Twenty-nine tests. Every state transition covered. All green. He walked away without waiting to be thanked.

Then the deck fell quiet.

**Sengoku boarded without ceremony.** Fleet Admiral. Quality gate. He moved through thirty-three pieces of the wizard without a word. Five places marked. Logic that was *correct* but could not be understood at a glance. The crew winced. The code worked. He wasn't wrong.

Roger read every change. Approved every one. *"Correctness and readability are not the same island."*

They are now.

**Ace arrived** — Luffy's sworn brother from the Grand Fleet. Where Sengoku found simplifications, Ace found ghosts: dead code, files with old names that meant nothing, a deleted transform quietly existing in a corner no one visited. He burned it clean. Sanji watched a file get renamed to something that described its purpose, and exhaled. *"A chef names his dishes properly."*

The last blow came from outside the ship. **Greptile** flagged real infrastructure identifiers left in code comments — not malicious, still a liability. The crew moved immediately: IDs redacted, a bug patched, a shortcut replaced with the proper route. Three corrections. Clean.

Roger reviewed a fourth time in a single arc. The crew had never seen that before.

Ten phases. Fifty tests. The blade reforged.

## Key Panels

- **[PANEL]** Franky — *"SUPER! Nineteen atoms, one truth — the Forge is complete!"* — *Emerges from the engine room holding the new state system like a freshly cast weapon, steam still rising*
- **[PANEL]** Sengoku — *"Five simplifications. You will fix them."* — *His finger moves down the scroll without hesitation, each mark exact as a Marine seal*
- **[PANEL]** Ace — *"Your dead code was a fire hazard. It's handled."* — *Standing amid renamed files, the air still warm*
- **[PANEL]** Roger — *"Correctness and readability are not the same island."* — *Quiet. Final. Nobody argues.*

## Captain's Log

- **The single door held.** When real data shapes arrived later, the adapter absorbed every change without the wizard noticing. One hook. One entrance. The decision that saved the crew from seventeen rewrites.
- **Sengoku's changes were not requested.** The code worked without them. But Roger approved every correction. Code that works is not the same as code that endures.
- **Real identifiers in comments are a liability.** From this day: no real IDs leave the runtime. Comments get placeholders. Always.

## The Horizon

The blade is reforged. Ace and Sengoku walked the deck for the first time — and will be remembered.

But the wizard still runs on mock data. One door waits, ready for the real pipeline to knock. Somewhere in the infrastructure, the data already exists in the shape Sanji designed for.

*And somewhere ahead — a much smaller problem, hiding in plain sight. A mark too faint to see. The crew won't know it until a user points at their screen and asks: "Is this one selected?"*

---
*Chapter 2 of the Straw Hat Chronicles*
