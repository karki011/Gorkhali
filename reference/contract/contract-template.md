# HTML Contract Template

Author: Subash Karki

Full HTML template for `contracts/{type}.html`. Replace `{placeholders}` with actual data. See [contract.md](../../commands/contract.md) for the flow that populates each section. Covers all 5 contract types (feature/api/testing/ui/fix) with one shape — a type badge and the notes section carry the type-specific detail; the rest of the spine is common to every type. See the placeholder reference at the bottom for substitution values.

Design source: gorkhali's default dark aesthetic (tier 3 of the design-inference priority in `reference/output-contract.md`) — this artifact is about gorkhali's own session state, not a subject project, so there's no project design system to defer to. Matches `reference/detective/report-template.md` and `reference/visualflow/flow-template.md` so all three read as one system.

---

## Template

```html
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Contract: {TICKET}</title>
<style>
  :root {
    --bg: #0d1117;
    --surface: #161b22;
    --surface-2: #21262d;
    --border: #30363d;
    --text: #e6edf3;
    --text-muted: #8b949e;
    --accent: #58a6ff;
    --green: #3fb950;
    --yellow: #d29922;
    --red: #f85149;
    --orange: #db6d28;
    --purple: #bc8cff;
    --font-mono: 'SF Mono', 'Fira Code', 'JetBrains Mono', monospace;
    --font-sans: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: var(--font-sans);
    background: var(--bg);
    color: var(--text);
    line-height: 1.6;
    padding: 2rem;
    max-width: 960px;
    margin: 0 auto;
  }
  h1 { font-size: 1.5rem; margin-bottom: 0.25rem; }
  h2 {
    font-size: 1.1rem;
    color: var(--accent);
    border-bottom: 1px solid var(--border);
    padding-bottom: 0.5rem;
    margin: 2rem 0 1rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }
  .case-header {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 1.5rem;
    margin-bottom: 2rem;
  }
  .case-header .ticket { color: var(--accent); font-weight: 600; }
  .case-header .meta { color: var(--text-muted); font-size: 0.85rem; margin-top: 0.5rem; }

  .badge {
    display: inline-block;
    padding: 0.15rem 0.5rem;
    border-radius: 12px;
    font-size: 0.75rem;
    font-weight: 600;
    text-transform: uppercase;
  }
  .badge-type { background: rgba(88,166,255,0.15); color: var(--accent); border: 1px solid var(--accent); }
  .badge-draft { background: rgba(210,153,34,0.15); color: var(--yellow); border: 1px solid var(--yellow); }
  .badge-approved { background: rgba(63,185,80,0.15); color: var(--green); border: 1px solid var(--green); }

  .scope-box {
    background: var(--surface);
    border-left: 3px solid var(--accent);
    padding: 1rem 1.5rem;
    border-radius: 0 8px 8px 0;
    margin-bottom: 1rem;
    font-size: 0.92rem;
  }

  .criteria-list {
    list-style: none;
    padding: 0;
  }
  .criteria-list li {
    display: flex;
    gap: 0.6rem;
    padding: 0.5rem 0;
    border-bottom: 1px solid var(--border);
    font-size: 0.9rem;
  }
  .criteria-list li:last-child { border-bottom: none; }
  .criteria-check {
    font-family: var(--font-mono);
    color: var(--green);
    font-weight: bold;
  }

  .non-goals {
    background: var(--surface);
    border-left: 3px solid var(--red);
    border-radius: 0 8px 8px 0;
    padding: 1rem 1.5rem;
  }
  .non-goals ul { list-style: none; padding: 0; }
  .non-goals li {
    padding: 0.4rem 0;
    border-bottom: 1px solid var(--border);
    font-size: 0.9rem;
  }
  .non-goals li:last-child { border-bottom: none; }
  .non-goals li::before {
    content: '\2715';
    color: var(--red);
    font-family: var(--font-mono);
    font-weight: bold;
    margin-right: 0.5rem;
  }

  .interface-card {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 1rem 1.5rem;
    margin-bottom: 1rem;
  }
  .interface-card .signature {
    font-family: var(--font-mono);
    font-size: 0.85rem;
    color: var(--purple);
    background: var(--surface-2);
    border-radius: 6px;
    padding: 0.6rem 0.8rem;
    overflow-x: auto;
    white-space: pre;
  }
  .interface-card .note {
    color: var(--text-muted);
    font-size: 0.85rem;
    margin-top: 0.5rem;
  }

  .notes-box {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 1.5rem;
    font-size: 0.9rem;
  }

  .footer {
    margin-top: 3rem;
    padding-top: 1rem;
    border-top: 1px solid var(--border);
    color: var(--text-muted);
    font-size: 0.8rem;
    text-align: center;
  }
</style>
</head>
<body>

<div class="case-header">
  <h1>{TITLE}</h1>
  <div><span class="ticket">{TICKET}</span></div>
  <div class="meta">
    Contract type: <span class="badge badge-type">{TYPE}</span>
    &middot; Date: {DATE} &middot; Status: <span class="badge badge-{STATUS_CLASS}">{STATUS}</span>
  </div>
</div>

<h2>Scope</h2>
<div class="scope-box">
  <p>{SCOPE_DESCRIPTION}</p>
</div>

<h2>Acceptance Criteria</h2>
<ul class="criteria-list">
  <!-- Repeat for each criterion; mark satisfied ones with a checkmark, pending with a dash -->
  <li><span class="criteria-check">{CRITERION_MARK_1}</span> {CRITERION_1}</li>
  <li><span class="criteria-check">{CRITERION_MARK_2}</span> {CRITERION_2}</li>
</ul>

<h2>Non-Goals</h2>
<div class="non-goals">
  <ul>
    <!-- Repeat for each explicitly excluded item -->
    <li>{NON_GOAL_1}</li>
    <li>{NON_GOAL_2}</li>
  </ul>
</div>

<h2>Interfaces &amp; Signatures</h2>
<!-- Repeat one interface-card per interface/endpoint/component signature. Omit this
     section's cards entirely (leave the h2, drop the cards) for a contract type with
     nothing to sign, e.g. a testing contract with no new interface. -->
<div class="interface-card">
  <div class="signature">{SIGNATURE_1}</div>
  <div class="note">{SIGNATURE_NOTE_1}</div>
</div>

<h2>Notes</h2>
<div class="notes-box">
  <!-- Type-specific detail lives here: API request/response + caching/retry notes,
       testing coverage areas + out-of-scope, UI states + a11y + responsive, fix
       root-cause + regression-guard. Render as plain paragraphs/lists, escaped. -->
  <p>{NOTES}</p>
</div>

<div class="footer">
  Generated by /gorkhali:contract &middot; Gorkhali &middot; {DATE}
</div>

<!-- Self-audit: the generator inlines `node scripts/layout-audit.js --source` in
     place of {LAYOUT_AUDIT_SCRIPT}, keeping this artifact self-contained (no
     external requests). After load, window.__lavishAudit() returns the structured
     layout report so the contract can be checked for clipped/overflowing sections. -->
<script>{LAYOUT_AUDIT_SCRIPT}</script>

</body>
</html>
```

---

## Placeholder Reference

| Placeholder | Source | Example |
|------------|--------|---------|
| `{TICKET}` | Session ticket ID | `CP-1234` |
| `{TITLE}` | Contract title | `Budgets create drawer` |
| `{TYPE}` | Contract type | `feature`, `api`, `testing`, `ui`, `fix` |
| `{DATE}` | ISO date | `2026-07-05` |
| `{STATUS}` | Contract status label | `Draft`, `Approved` |
| `{STATUS_CLASS}` | CSS class | `draft`, `approved` |
| `{SCOPE_DESCRIPTION}` | What this contract covers | `Add a Set Budget drawer to the budgets list page` |
| `{CRITERION_MARK_N}` | Satisfied vs pending marker | `\2713` (satisfied) or `-` (pending) |
| `{CRITERION_N}` | Acceptance criterion text | `Drawer opens from the row action menu` |
| `{NON_GOAL_N}` | Explicitly excluded item | `Bulk budget creation is out of scope` |
| `{SIGNATURE_N}` | Interface/endpoint/component signature | `PUT /budgets/{id} { threshold: number }` |
| `{SIGNATURE_NOTE_N}` | Consumer note for that signature | `Optimistic update not required; refetch on settle` |
| `{NOTES}` | Type-specific detail | Coverage areas, states, caching notes, root cause |
| `{LAYOUT_AUDIT_SCRIPT}` | Output of `node scripts/layout-audit.js --source` | zero-dep auditor; defines `window.__lavishAudit()` |
