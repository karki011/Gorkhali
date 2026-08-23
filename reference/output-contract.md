# Output Contract

Author: Subash Karki

Every script gorkhali runs, every skill summary it renders, and every artifact it generates is
read by an agent first — often the orchestrating agent itself, mid-session. Output written for
a human who scrolls and skims will burn an agent's context and mislead its next decision. This
contract retargets AXI's 10 CLI-ergonomics principles from "a CLI you build" to "output your
scripts print / summaries your skills render / artifacts you generate," plus one addition:
which deliverables must be HTML instead of markdown.

Internal logic stays on plain objects; render once, at the output boundary, the moment a script
or skill is about to print. Gorkhali uses plain key-value text, not TOON — the wire-format
optimization is skipped, the boundary discipline is not.

## 1. Minimal default schemas

Every field a script prints costs tokens, multiplied by row count. Default to 3-4 fields —
enough for the agent to decide the next action, not a full record dump.

```
tasks[3]{id,status,owner}:
  T1,done,engineer
  T2,in_progress,engineer
  T3,blocked,auditor
```

Long-form content (descriptions, full diffs, transcripts) belongs in a detail view or a file
the agent opens on demand, never inlined into a list.

## 2. Truncation with an escape hatch

Detail output containing large text fields must truncate by default and name the way to get the
rest. Omitting the field forces a second call; including it whole wastes the first one.

```
finding: 3 of 12 total
  1. race condition in useEffect cleanup (learnings/react.md:44)
  ... (truncated, see reference/output-contract.md#full for `--full`)
```

An agent that gets a silently-truncated blob without a size hint assumes it has the whole
thing and reasons on partial data.

## 3. Pre-computed aggregates

If a step already knows a count, include it — `count: N of M` — rather than making the caller
count rows or issue a follow-up to find out "how many." The expensive cost is the next call, not
a slightly longer line.

## 4. Definitive empty states

State a zero result explicitly, with the scope that produced it:

```
learnings: 0 corrections found for domain "auth" (searched INDEX.md, 14 domains)
```

An agent that reads a bare blank line cannot tell "confirmed empty" from "the check didn't run."

## 5. Structured errors, exit codes, fail-loud-on-unknown-flags

- Errors are structured text on the same channel as normal output — what went wrong, what to run
  next — never a raw stack trace or a wrapped tool's native error text.
- Reserve non-zero exit for genuine failure. An idempotent no-op (closing something already
  closed) reports the no-op and exits 0.
- Reject unrecognized flags/args by name instead of ignoring them. A silently dropped flag reads
  to the agent as "applied," and it proceeds confidently on the wrong scope.
- Progress goes to stderr, never stdout. **An agent that reads "Fetching data…" on the channel it
  parses will try to interpret it as data.**

## 6. Content first

A script or skill invoked with no further input should show current state, not a usage banner.
State lets the agent act in one turn; a manual costs it a second call to re-invoke with the args
it now knows it needs.

## 7. Contextual next-step hints (`help[N]:`)

Close output with a short, numbered list of next actions that follow from what was just shown —
not a fixed workflow, not one path enforced:

```
help[2]:
  Run `/gorkhali:fix` to repair the failing test named above
  Run `/gorkhali:learn` to record why this kept happening
```

Omit the block when the output is already self-contained (a confirmation, a single count) —
hints on a fully-answered query are noise, not guidance.

## 8. Consistent help

Every command/skill surface answers `--help` (or the skill's own help path) the same way:
its own concise flags/args and 2-3 examples, scoped to that surface — not the whole plugin's
manual dumped underneath it.

## Human-facing deliverables

Plans, research, specs, reports, and investigation/eval/session summaries are **self-contained
styled HTML** — never markdown. This is already load-bearing precedent in this repo: Detective's
`reference/detective/report-template.md` and the visualflow `reference/visualflow/flow-template.md`
are both HTML. This section makes the rule general, not feature-local. Contract
(`contracts/{type}.html`, `reference/contract/contract-template.md`) and eval (`eval.html`,
`reference/eval/eval-template.md`) are HTML-compliant producers alongside detective/plan/visualflow.

**Stays as-is** (unaffected by this rule): machine state (`intent.json`, `plan.json`, checkpoint
JSON), `learnings/INDEX.md` + `EDGES.md`, agent handoff output between gorkhali agents, portability
packets (`handoff.md`), and session logs (e.g. pause's `{date}_{slug}.md` resume records). Those
are consumed by other agents or scripts, not read visually by a human — HTML would be friction,
not value.

**Rationale:** an HTML deliverable can be opened directly while the existing conversation remains
the feedback and approval channel. A markdown wall of text is not.

## Design-inference priority for artifact authoring

When a script or skill has to pick a visual design for an HTML artifact, resolve in this order,
moving to the next step only when the current one truly yields nothing:

1. **User's explicit ask** — a named look, a named design system.
2. **Subject project's own design system** — the project the artifact is *about* (which may
   differ from the gorkhali checkout itself): its Tailwind/theme config, CSS variables/design
   tokens, component library, or brand assets.
3. **Gorkhali's default dark aesthetic** — only when both above come up empty.

State which of the three you used and why when you deliver the artifact.

## Direct review discipline

Open a validated review artifact directly, and keep feedback, decisions, and approval in the
existing conversation. Apply feedback to the artifact's canonical source rather than patching a
review HTML projection. Regenerate and revalidate only when another visual review is useful or
the user asks for it; routine status belongs in chat.

## Secrets

Secret values are never accepted via argv flags — they're visible in process listings on any
shared machine. If a script surface ever needs one, read it from stdin.

---

Adapted from [AXI](https://github.com/kunchenguid/axi) (MIT, Kun Chen / kunchenguid).
