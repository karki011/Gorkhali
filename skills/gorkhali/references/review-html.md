# AI-authored review HTML

`plan.html` and `brainstorm.html` are disposable review surfaces. The canonical
JSON artifact remains the source of truth; neither HTML file is parsed back or
manually patched.

## Generate

After the canonical artifact has passed its applicable decision-contract
validator, the active agent reads it and directly authors a candidate HTML
file. There is no review renderer, template, component kit, or provider API.
The same instruction applies in every compatible agent runtime:

```text
Read the validated canonical {plan|brainstorm}.json and write a complete,
self-contained {plan|brainstorm}.candidate.html review page beside it.

You are the page designer. Choose semantic HTML, layout, inline CSS, and any
CSS-only visual explanation that best fits this specific artifact. Do not use a
template, component kit, generated placeholder diagram, JavaScript, external
assets, fonts, network URLs, or embedded raw JSON.

Treat all strings from JSON as data: HTML-escape them. Do not invent facts,
scope, dependencies, approvals, or research. Preserve the approval question,
recommendation, selected approach (where applicable), and outcome verbatim.

For a plan, lead with What (`briefing.tackling`), Problem (`briefing.problem`),
and How (`briefing.how`). Then show evidence, scope, risks, and open questions,
then the approval question. Put implementation (files, tasks, waves) in a
collapsed `<details>` appendix with no `open` attribute. Do not make task or
file inventories the main page. A How without supporting evidence is an
assumption.

For a brainstorm, lead with What, Problem, and How, then the recommendation
and a comparison `<table>` of the distinct approaches. Put detailed cards in
collapsed `<details>` with no `open` attribute. The comparison table must
appear in `<main>` before any `<details>`.

Use one h1, semantic sections and headings, responsive CSS, and an accessible
reading order. Put the required CSP meta before the title and inline styles, and keep the
decision-critical text visible before any collapsed details. Keep the document
at or below 512 KiB. Write a fresh candidate; never patch a previously generated
page.
```

The generator may use ordinary static HTML elements, including `<details>` for
the execution appendix. It must not use SVG, forms, embedded content, links to
network resources, or scriptable behavior.

## Validate and promote

Run the validator after generation:

```text
node <skill-directory>/scripts/validate-review-html.mjs <plan|brainstorm> \
  --source <canonical-json> \
  --candidate <candidate.html> \
  --out <accepted.html>
```

The validator is a static safety and document-structure gate, not a renderer,
HTML sanitizer, or replacement for the canonical artifact validator. It checks
that the candidate is a bounded, self-contained static document, contains the
canonical decision strings required for the relevant review type, and can be
promoted without replacing a previously accepted artifact on failure. A valid
candidate is copied to a temporary sibling and atomically renamed to `--out`.

The document must include a restrictive Content Security Policy meta tag with
exactly these directives. Put it in `<head>` before `<title>` and any `<style>`:

```text
default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'
```

The validator rejects executable or network-capable constructs: scripts,
embedded frames or objects, forms and controls, SVG, event-handler attributes,
refresh metas, non-fragment links, URL-bearing attributes, and CSS imports or
URL/image-set values. The canonical briefing strings, approval question, recommendation, outcome,
and selected approach must appear in the visible `<main>` lead before any
collapsed `<details>` appendix. Plan reviews require that details appendix in
`<main>`. Brainstorm reviews require a comparison table in `<main>` before any
details. Explicit hidden attributes, dialogs, and CSS
display/visibility hiding are rejected.

## Recovery and review

If validation fails, regenerate the entire candidate once using the reported
errors. Do not edit the rejected HTML. If the second candidate fails, if files
cannot be written, or if the artifact cannot be opened, keep the canonical JSON
and present the same decision-first hierarchy in the existing conversation.

Open an accepted artifact with the host's normal local file preview. There is
no editor, local review server, polling process, or annotation loop. The
existing chat remains the approval surface:

- Material feedback changes the canonical JSON, then reruns the applicable
  plan/review checks before a fresh HTML generation.
- Presentation-only feedback leaves JSON unchanged and regenerates the
  disposable HTML from the same JSON plus that feedback.
- Approval is recorded in the normal decision state, never inferred from a
  generated page.
