# AI-authored review pages

Five surfaces share this contract: `plan` and `brainstorm` are decision gates,
and `visualflow`, `detective` and `review` are reading surfaces over an artifact
that carries no approval question. Everything below applies to all five; only the
decision gates have canonical strings the validator checks for.

`plan` and `brainstorm` review pages are disposable decision surfaces.
The canonical JSON artifact remains the source of truth; no review page is ever parsed back or manually patched.

A review page has one job: let a human decide.
It is read once, by a person who has not been in the session, who needs to understand what is being proposed and say yes or no.
Everything below serves that.

## Voice: plain English first

Write the page for a smart colleague from another team, not for the agent that wrote the plan.

- **Lead with the conclusion.** Say what this is and what you want, then explain.
- **Plain, everyday words.** Prefer "check" over "gate", "runs again" over "idempotent", "connect" over "wire", "fill in missing history" over "backfill".
- **Explain jargon where it appears.** An acronym or domain term is fine once it is defined in the same sentence, in ordinary words.
- **Short sentences. One idea each.** A sentence carrying three clauses and two file paths is the failure this rule exists to prevent.
- **Never simplify into something false.** Accuracy wins over simplicity every time. If a detail changes the decision, it belongs in the lead, said plainly.
- **Explain why, not only what.** The reader should finish knowing why this approach is right, not just what will be typed.
- **Concrete over abstract.** An example or a small before/after beats an adjective.
- **Bold sparingly.** If most of the page is bold, nothing is.
- No greetings, no filler, no restating the request, no "this document will".

Identifiers still matter, so do not delete them.
Move them out of the sentence instead: keep the prose plain and carry the file, symbol, or line as a small inline code chip beside the claim it supports.
"The delta guard blocks the 60-day window `derive-usage-kpis.ts:153`" reads; the same fact inlined mid-clause does not.

## Structure: decision on top, mechanics at the bottom

Visible, in `<main>`, before any collapsed section:

1. **What** (`briefing.tackling`), **Problem** (`briefing.problem`), **How** (`briefing.how`), each in plain English.
2. The recommendation and, for a brainstorm, the selected approach.
3. The evidence behind the How. A How with no supporting evidence is an assumption, and the page must show which it is.
4. Scope, risks, and open questions.
5. The approval question, last and unmissable.

For a brainstorm, a comparison `<table>` of the distinct approaches must appear in `<main>` before any collapsed section.

Collapsed in `<details>` at the bottom, never with an `open` attribute:

- The task list, file inventory, and wave or dependency order.
- Acceptance criteria, verify commands, and schema or contract detail.
- Anything a reader needs only after they have already decided yes.

Task and file inventories are never the main page.
Preserve the approval question, recommendation, selected approach, and outcome verbatim from the canonical JSON: the validator checks for them, and a reworded approval question is a different question.

## Shell and extension

The chassis is not authored per page. `assets/review-shell.css` owns the design tokens, both
themes, the rail-and-column grid, the type scale, and the base components, and every artifact-target
page pastes it verbatim into its first `<style>` block, sentinel comments included.
The validator compares the embedded text to the bundled file and rejects a page that edits it, so a
tweak to the chassis is a change to that one file, reviewed once, and every page inherits it.

Page-specific CSS goes in a **second `<style>` block** after the shell, and there the page is free:
add components, restyle the ones the shell ships, introduce a device this particular plan needs.
The one boundary is the chassis. A rule whose selector targets `:root`, `html`, `body`, `main`,
`*`, `.doc`, or `.rail` is rejected, because those are what make every review page recognizably the
same page and what keep both themes correct.

The shell gives you: `.eyebrow`, `.standfirst`, `.meta` with `.chip` (`.warn`, `.good`),
`.verdict` with `.word`, `.ev` for an inline citation, `.callout`, `.tablewrap` around a `table`
with `td.src`, `.risks` with `.risk`/`.r`/`.m`, `.ask` with `.label`, `details`/`summary`/`.body`,
and `footer`. Reach for those before inventing an equivalent.

## Design

Design within the shell: choose the sections, the words, the components, and any page-specific
device that earns its place. The shell has already settled the layout, so these are the judgments
left to you.

- **Write the two elements the shell's grid expects:** a `<nav class="rail">` holding a `<p>` label and an `<ol>` of fragment links to the page's `h2` sections, then a `<div class="doc">` wrapping everything else. The shell makes the rail sticky in the left gutter on a wide viewport and reflows the same nav into a horizontal chip strip below 1040px. Prose keeps a readable measure while tables, callouts and the appendix use the full column.
- **One nav, never two, never hidden.** The shell reflows a single `<nav>`; do not add a second duplicate for narrow screens. The validator rejects `display: none` and `visibility: hidden` outright, because that is how gate text gets hidden.
- **Masthead.** A small uppercase mono eyebrow (ticket, repo, date), one `h1`, then a larger muted standfirst paragraph that states the whole proposal in plain English. A reader who stops there should still know what is being asked.
- **A meta row of chips** for the handful of facts that frame the decision: verdict, rough size, blast radius, what is deliberately not being done.
- **A verdict block.** One colored left-border panel carrying the recommendation in one or two sentences.
- **Tables** (`.tablewrap` around a `table`) for real comparisons, with `td.src` carrying the citation.
- **Callouts** (`.callout`) for the one or two things a reader must not miss, especially what is deliberately out of scope.
- **A numbered list or a `.risks` rail** when there is a real sequence: phases, gates, risks, questions with owners.
- **A footer** carrying provenance: ticket, Opposition verdict, evidence source, date.
- **Reach for the shell's tokens, never raw colors.** Page CSS uses `var(--accent)`, `var(--warn)`, `var(--muted)`, `var(--line)` and the rest. A hard-coded hex is a bug in both themes at once: the shell already redefines every token for dark, and page CSS cannot redefine them because `:root` is reserved.

Avoid: a card around every paragraph, a stat grid of numbers nobody asked for, a diagram that restates a list, decorative gradients, and any element that exists because the page looked empty.
One well-chosen visual device beats five.

## Delivery targets

Two targets, one contract.
Pick `artifact` when the runtime exposes an artifact publishing tool; otherwise use `file`.
The choice changes only where the page lands and what shell it ships with, never the voice, structure, or gate.

### `artifact` (preferred)

The host wraps the page in its own document shell and enforces its own policy, so the candidate is a fragment.

- Write no `<!doctype>`, `<html>`, `<head>`, or `<body>` tag.
- Open with `<title>` (a short noun-phrase name, not a summary), then optional font links, then the shell `<style>` block, then an optional page-CSS `<style>` block, then `<main>`.
- Web fonts may load from `https://fonts.googleapis.com/` with faces from `https://fonts.gstatic.com/`, each with a real fallback stack. Nothing else may reach the network.
- Inline `<svg>` is allowed when a diagram shows the mechanism. It is not allowed as decoration.
- No scripts, forms, controls, embedded content, or event handlers. The gate text must not be able to change after load.

Validate, then publish the accepted file with the host's artifact tool and give the user the URL.
Publishing sends the page content to the host's service, so treat it as an outward-facing action the first time in a session.

### `file`

A self-contained local page opened with the host's normal file preview.

- Full document: `<!doctype html>`, `<html lang>`, `<head>` with charset and viewport, `<title>`, `<body>`, `<main>`.
- A restrictive Content Security Policy meta must be the first tag in `<head>`, before `<title>` and any `<style>`:

```text
default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'
```

- No network references at all: no font links, no external assets, no SVG, no scripts.
  Use a system font stack and carry the design in layout, type scale, and color.

## Generate

After the canonical artifact has passed its applicable decision-contract validator, the active agent reads it and directly authors a candidate page beside it.
There is no review renderer, template, component kit, or provider API.
The same instruction applies in every compatible agent runtime:

```text
Read the validated canonical {plan|brainstorm}.json and write a complete
{plan|brainstorm}.candidate.html review page beside it, for the {artifact|file} target.

On the artifact target, paste assets/review-shell.css verbatim as the first style block,
sentinels included, and put any page-specific CSS in a second style block that does not
target :root, html, body, main, *, .doc or .rail. You choose the sections, the words, the
components, and any page-specific device; the shell has already settled the layout.
Follow the voice, structure, design, and target rules in references/review-html.md. Do not
use a component kit, a generated placeholder diagram, or JavaScript.

Treat all strings from JSON as data: HTML-escape them. Do not invent facts, scope,
dependencies, approvals, or research. Preserve the approval question, recommendation,
selected approach (where applicable), and outcome verbatim.

Use one h1, one main, semantic sections and headings, responsive CSS, and an accessible
reading order. Keep the decision-critical text visible before any collapsed details, and
the document at or below 512 KiB. Write a fresh candidate; never patch a previously
generated page.
```

## Validate and promote

Run the validator after generation:

```text
node <skill-directory>/scripts/validate-review-html.mjs <plan|brainstorm> \
  --source <canonical-json> \
  --candidate <candidate.html> \
  --out <accepted.html> \
  [--target file|artifact]
```

`--target` defaults to `file`.

The validator is a static safety and document-structure gate, not a renderer, HTML sanitizer, or replacement for the canonical artifact validator.
It checks that the candidate is a bounded, self-contained static document, contains the canonical decision strings required for the relevant review type, and can be promoted without replacing a previously accepted artifact on failure.
A valid candidate is copied to a temporary sibling and atomically renamed to `--out`.

Both targets reject executable or network-capable constructs: scripts, embedded frames or objects, forms and controls, event-handler attributes, refresh metas, URL-bearing attributes, and CSS imports or URL/image-set values.
Both require exactly one `h1` and one `main`, the canonical briefing strings, approval question, recommendation, outcome, and selected approach in the visible `<main>` lead before any collapsed `<details>` appendix, a details appendix in `<main>` for a `plan`, `detective` or `review` page, and a comparison table in `<main>` before any details for a brainstorm review.
Both reject explicit hidden attributes, dialogs, and CSS display/visibility hiding.

The `file` target additionally requires the full document shell and the CSP meta, and rejects SVG and every non-fragment href.
The `artifact` target instead rejects a doctype and the `html`, `head`, and `body` tags, requires a non-empty `<title>` within the first 8 KiB, narrows the network ban to an allowlist of the host's font CDN, requires `assets/review-shell.css` embedded verbatim, and rejects page CSS that restyles the chassis.

## Recovery and review

If validation fails, regenerate the entire candidate once using the reported errors.
Do not edit the rejected page.
If the second candidate fails, if files cannot be written, or if the page cannot be published or opened, keep the canonical JSON and present the same decision-first hierarchy in the existing conversation.
A publishing failure falls back to the `file` target before it falls back to chat.

There is no editor, local review server, polling process, or annotation loop.
The existing chat remains the approval surface:

- Material feedback changes the canonical JSON, then reruns the applicable plan/review checks before a fresh page generation.
- Presentation-only feedback leaves JSON unchanged and regenerates the disposable page from the same JSON plus that feedback.
- Approval is recorded in the normal decision state, never inferred from a generated page.
