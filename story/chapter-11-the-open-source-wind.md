# Chapter 11: The Open-Source Wind

> **Season:** The Quality Tide Arc
> **Date:** 2026-03-30
> **Crew:** Luffy (coordinator), Chopper (verification)
> **Repo:** feature-web-apps

## Previously...

The Coverage Compass had been reforged. Honest numbers. Scoped to the layers the crew owned. Chopper had read the vitals aloud — 2,091 tests, branches at 91% — and the crew had filed it under "instruments you can trust."

But the compass only showed totals. Aggregate scores. A single line that said *the ship is healthy* without saying which room had the leak. The crew returned to the work because one question remained unanswered: which files, specifically, needed attention? The map was missing its detail.

And Luffy had a plan. He always did. Sometimes the plan was exactly right. Sometimes the sea had already drawn the better map.

## The Story

There is a certain pride in building your own tools.

It is not arrogance. It is care. When the crew reaches for a hammer, they want to know every nail it was designed for. Custom-built means understood. Understood means trusted. And on the Grand Line, you only put your weight on things you trust.

So when Luffy sat down to add per-file coverage detail to the PR comments, he built it himself. He studied the existing script — the one that read `coverage-summary.json`, formatted aggregate totals, found the right PR comment to update. Solid. Legible. But blind to individual files.

He reached for the companion file: `coverage-final.json`. The deeper report. Line by line, function by function, branch by branch — all of it was there if you knew how to read it. And Luffy read it. He built a function that extracted uncovered line ranges, grouped them by file, cross-referenced the PR's changed files so the comment would only show what was relevant. Collapsible sections for the detail. Clean header for the summary. Deduplication logic so old comments wouldn't stack into a wall of noise.

Seventy lines. Growing. Careful.

He paused.

Not because something was wrong with the code. Because of a question he had learned to ask: *Is this something someone has already solved?*

"Maybe we just use vitest-coverage-report-action," Subash said.

Six words.

Luffy looked it up. The action was purpose-built: per-file coverage breakdown on every PR, collapsible detail sections, PR file diffing, comment management — everything he had spent an hour designing, already working, already maintained by the open-source sea. Not a workaround. Not a compromise. The better instrument.

He deleted his seventy lines.

He wrote six lines of YAML.

This is a different kind of discipline than building — and in some ways harder. The crew that writes its own tools owns them forever. Every bug, every edge case, every late-night update when a new Vitest version changes the report format. Seventy lines is not a lot of code until you are the one maintaining it through three major tool upgrades. Six lines of YAML is a community standing behind you.

"You don't get credit for complexity," Chopper said, reviewing the final diff. He had seen crews in sickbay before — engineers who built sprawling custom solutions because building felt like progress, and then spent months nursing them. "You get credit for the outcome."

The push did not go quietly. The remote had moved while Luffy was working — new commits had landed on the branch. A rebase was required before the sea would let the work through. The crew aligned their history with the upstream, resolved the divergence cleanly, and pushed again.

The second push landed.

The Coverage Compass now had eyes. Not just aggregate scores but per-file detail, surfaced directly in every PR, zero custom maintenance required. The crew had added information without adding burden.

Seventy lines became six. Nothing was lost. Something was gained.

## Key Panels

- **[PANEL]** Luffy, halfway through building `getUncoveredLines()` — *"Cross-reference the PR files. Collapsible sections. Deduplication logic..."* — *He is proud of the architecture. He pauses before line 71. He asks the question.*

- **[PANEL]** Six lines of YAML on the screen — `davelosert/vitest-coverage-report-action@v2`, four configuration keys, nothing else — *"That's it?"* — *The whole room gets quieter.*

- **[PANEL]** Chopper reviewing the deletion — seventy lines of custom JS, highlighted red, gone — *"You don't get credit for complexity. You get credit for the outcome."* — *He approves the diff without hesitation.*

- **[PANEL]** The rebase — commits arriving like ships that had left port while you were building — *"The sea moved. We realign and push again."* — *Luffy executes it without drama. The second push succeeds.*

## Captain's Log

- **The question before the code.** Luffy built the solution — and then asked whether someone had already built it better. That pause, that willingness to delete your own work, is the mark of engineering maturity. Not every problem needs a custom answer.
- **Complexity is not value.** Seventy lines is not more valuable than six lines. The crew is not rewarded for the volume of what they wrote. They are rewarded for per-file coverage appearing in every PR with zero maintenance overhead. The outcome is the measure.
- **The open-source sea carries weight.** When you drop in a well-maintained community action, you inherit the work of everyone who has filed issues, written tests, and handled edge cases before you. That is not laziness. That is knowing which allies to trust.

## The Horizon

The Coverage Compass now shows individual files. Every pull request will carry a breakdown — not just whether the ship is healthy, but which rooms need work. The crew has no excuse for blind spots anymore.

The debt at 61% line coverage remains. It does not disappear because the instrument improved. But now the instrument is honest *and* detailed. The next feature, the next refactor, the next island discovered — the compass will show exactly where the uncovered ground begins.

And the Cutting Board wizard still waits in the backlog. Its adapter door still unknocked. The coverage the crew built — calibrated, honest, and now file-aware — will be watching when that feature finally ships.

The Log Pose keeps turning.

Somewhere ahead, the next problem is already forming.

---
*Chapter 11 of the Straw Hat Chronicles*
