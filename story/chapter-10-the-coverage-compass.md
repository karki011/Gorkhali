# Chapter 10: The Coverage Compass

> **Season:** The Quality Tide Arc
> **Date:** 2026-03-29
> **Crew:** Luffy (coordinator), Chopper (verification)
> **Repo:** feature-web-apps

## Previously...

The Log Pose had settled — briefly — after the FQDID Riddle was solved. A silent bug slain, one pattern applied, the fix logged in the journal. The machine had even performed the Jira ceremony on its own.

But the Horizon had whispered of something else. The Dimension Studio was vast, and other unmapped territories lay beneath it. Somewhere in the backlog, a different kind of danger had been growing — not a bug, not a missing identifier, but a broken instrument of the ship itself. The compass that measured the crew's test coverage had been lying to them. And now it was time to recalibrate it.

## The Story

There is a particular kind of trap built from good intentions.

PR #527 arrived carrying the Coverage Compass — a new CI job designed to enforce that every layer of the codebase met strict quality thresholds. Four tiers. Ambitious targets. Foundations at 80%. API layer at 60%. It looked impressive spread across the workflow YAML.

But Luffy pulled the numbers first, before celebrating.

Foundations: 52%. Target: 80%. *Miss.*
API layer: 6%. Target: 60%. *Miss.*
Two tiers. Four tiers. All four failing.

"We built a compass," he said, "that reads south when we're heading north."

The problem ran deeper than the numbers. The coverage job had been running tests *twice* — once in the standard CI pipeline, once again inside the coverage collection step. The fleet was paying the toll on the same bridge two times over. And the tooling was different from everything else aboard: different actions, different setup, different assumptions baked into the YAML. It was a foreign instrument on a ship that already had its own standards.

Luffy mapped the full failure before touching a single line. This was the habit the captain had drilled into him: understand the shape of the problem first. The ambition of the thresholds wasn't wrong — the implementation was wrong. Enforce what you can actually measure. Scope to what you actually own.

The rewrite was deliberate. Report-only coverage. Scoped to domain and foundations — the layers the crew actually controlled, not the API adapters that called upstream systems with near-zero test coverage by design. Shared actions aligned with the rest of the fleet's workflow. Unique PR comment IDs so coverage results didn't stack into an unreadable wall. Per-file visibility — not just aggregate numbers, but a line-by-line map showing exactly where the crew needed to plant their next Haki training flag.

Chopper ran verification when the rewrite was done.

2,091 tests. 8.35 seconds. Green.

Lines: 61%. Branches: 91%. Functions: 81%.

"The patient is stable," Chopper said, studying the readout with the focused calm of someone who had checked three times. "Actually — *better* than stable. Branches at 91% is strong."

The compass was honest now. It showed what was real, not what someone had hoped would be real by the time the job ran.

Then came the small correction.

The work was complete. The PR was clean. The board sat untouched.

Luffy had forgotten to mark it done.

The captain noticed. Said so plainly. Luffy updated the board — and the crew logged it as a habit: *the work is not finished until the board reflects it.* Not a punishment. A calibration. The same discipline that made the Coverage Compass honest applied to the log as well.

## Key Panels

- **[PANEL]** Luffy, staring at four failing percentage bars — *"Foundations: 52. API: 6. All four tiers. The compass wasn't calibrated — it was broken."* — *He taps the screen once. The plan forms immediately: no patching. Rebuild the instrument.*

- **[PANEL]** Chopper, test runner scrolling green in real time — *"2,091 tests. 8.35 seconds. Lines 61, Branches 91, Functions 81."* — *He reads each number aloud like a doctor reciting vitals. All clear. He does not spin in his chair this time. He just nods.*

- **[PANEL]** The before and after — left side: four tiers enforcing impossible thresholds, tests running twice, foreign tooling. Right side: report-only, scoped, shared actions, per-file visibility. *The compass, reforged.*

- **[PANEL]** Luffy at the board, updating the task status after the captain's reminder — *"The work isn't done until the log says it's done."* — *He writes it in the margin of his notes. A new rule. Filed next to "understand the shape first."*

## Captain's Log

- **Ambition without calibration is noise.** Four failing tiers were not a signal that the codebase was failing — they were a signal that the measurement was wrong. Report-only coverage scoped to the layers the crew owns gives an honest reading. Enforce what you actually control.
- **The fleet runs one set of instruments.** Coverage CI was using different tooling from the rest of the workflow. Alignment with shared actions is not bureaucracy — it is the difference between a foreign instrument and one the whole crew can read and maintain.
- **The board is the last word.** Writing code is not finishing work. Finishing work means the log reflects it. When Luffy forgot to update the board, the captain corrected him — and the habit was written down. It joins the list of small disciplines that keep a Grand Line crew alive.

## The Horizon

The Coverage Compass is honest now. 2,091 tests confirmed. 91% branch coverage in the layers the crew owns. Per-file visibility means the next time someone asks "where should we write tests?" — the answer is already on the map.

But the map is not complete. Lines at 61% is not a number to be proud of. It is a number to return to. Each future feature, each refactor, each new island discovered in this codebase — the compass will be watching. It will not lie anymore.

And somewhere in the backlog, the Cutting Board wizard still waits. Its adapter door still unknocked. The coverage the crew built today will matter when that feature finally ships — because the compass will be there, honest and calibrated, ready to measure what they build.

The Log Pose is still rotating.

But now the crew can trust the instruments.

---
*Chapter 10 of the Straw Hat Chronicles — The Grand Line continues...*
