# HTML Visual Flow Template

Author: Subash Karki

Full HTML template for `visualflow.html`. Replace `{placeholders}` with actual data. See [visualflow.md](../../commands/visualflow.md) for the flow that populates each section. See the placeholder reference at the bottom for substitution values. Self-contained: all CSS inline, zero external requests, no JS dependencies.

---

## Template

```html
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Visual Flow: {TICKET}</title>
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
    max-width: 1100px;
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
  .badge-approved { background: rgba(63,185,80,0.15); color: var(--green); border: 1px solid var(--green); }
  .badge-draft { background: rgba(210,153,34,0.15); color: var(--yellow); border: 1px solid var(--yellow); }

  /* Flow overview — sequence of screen nodes connected by arrows */
  .flow-overview {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 1.25rem;
  }
  .flow-node {
    background: var(--surface-2);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 0.5rem 0.9rem;
    font-size: 0.85rem;
    font-weight: 600;
    white-space: nowrap;
  }
  .flow-arrow {
    color: var(--accent);
    font-family: var(--font-mono);
    font-weight: bold;
  }

  /* Per-screen card grid */
  .screen-card {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 1.25rem 1.5rem;
    margin-bottom: 1.25rem;
  }
  .screen-card .screen-name {
    font-size: 1rem;
    font-weight: 600;
    color: var(--accent);
    margin-bottom: 0.75rem;
  }
  .screen-body {
    display: grid;
    grid-template-columns: 280px 1fr;
    gap: 1.25rem;
  }
  @media (max-width: 720px) { .screen-body { grid-template-columns: 1fr; } }

  /* Low-fidelity grayscale wireframe drawn with divs */
  .wireframe {
    background: var(--surface-2);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 0.75rem;
  }
  .wf-bar {
    background: #3a3f45;
    border-radius: 3px;
    height: 22px;
    margin-bottom: 0.6rem;
  }
  .wf-block {
    background: #2b2f35;
    border: 1px dashed #444a52;
    border-radius: 3px;
    height: 48px;
    margin-bottom: 0.6rem;
  }
  .wf-line {
    background: #33383e;
    border-radius: 3px;
    height: 10px;
    margin-bottom: 0.5rem;
  }
  .wf-line.short { width: 55%; }
  .wf-btn {
    display: inline-block;
    background: #44494f;
    border: 1px solid #555b62;
    border-radius: 4px;
    height: 26px;
    width: 90px;
    margin-top: 0.3rem;
  }

  .states-list { list-style: none; padding: 0; }
  .states-list li {
    padding: 0.4rem 0;
    border-bottom: 1px solid var(--border);
    font-size: 0.9rem;
  }
  .state-tag {
    display: inline-block;
    min-width: 64px;
    font-family: var(--font-mono);
    font-size: 0.75rem;
    font-weight: 600;
    text-transform: uppercase;
    margin-right: 0.5rem;
  }
  .state-tag.empty { color: var(--text-muted); }
  .state-tag.loading { color: var(--accent); }
  .state-tag.error { color: var(--red); }
  .state-tag.success { color: var(--green); }
  .state-tag.edge { color: var(--purple); }

  .transitions { margin-top: 0.9rem; }
  .transitions .label {
    color: var(--text-muted);
    font-size: 0.75rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }
  .transitions ul { list-style: none; padding: 0; margin-top: 0.4rem; }
  .transitions li {
    font-size: 0.88rem;
    padding: 0.2rem 0;
  }
  .transitions li::before {
    content: '\2192';
    color: var(--accent);
    font-family: var(--font-mono);
    font-weight: bold;
    margin-right: 0.5rem;
  }

  /* Open questions — decisions needing a human */
  .open-questions {
    background: var(--surface);
    border-left: 3px solid var(--yellow);
    border-radius: 0 8px 8px 0;
    padding: 1rem 1.5rem;
  }
  .open-questions ul { list-style: none; padding: 0; }
  .open-questions li {
    padding: 0.5rem 0;
    border-bottom: 1px solid var(--border);
    font-size: 0.9rem;
    display: flex;
    gap: 0.5rem;
  }
  .open-questions li::before {
    content: '?';
    color: var(--yellow);
    font-family: var(--font-mono);
    font-weight: bold;
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
  <h1>{FEATURE_TITLE}</h1>
  <div><span class="ticket">{TICKET}</span></div>
  <div class="meta">
    Visual Flow &mdash; pre-implementation &middot; Date: {DATE}
    &middot; Status: <span class="badge badge-{STATUS_CLASS}">{STATUS}</span>
  </div>
</div>

<h2>Flow Overview</h2>
<div class="flow-overview">
  <!-- Repeat node + arrow for each screen in order; omit trailing arrow -->
  <div class="flow-node">{SCREEN_NAME}</div>
  <span class="flow-arrow">&rarr;</span>
  <div class="flow-node">{SCREEN_NAME}</div>
  <span class="flow-arrow">&rarr;</span>
  <div class="flow-node">{SCREEN_NAME}</div>
</div>

<h2>Screens</h2>
<!-- Repeat one screen-card per screen -->
<div class="screen-card">
  <div class="screen-name">{SCREEN_NAME}</div>
  <div class="screen-body">

    <!-- (a) low-fidelity grayscale wireframe -->
    <div class="wireframe">
      <div class="wf-bar"></div>
      <div class="wf-line"></div>
      <div class="wf-line short"></div>
      <div class="wf-block"></div>
      <div class="wf-btn"></div>
    </div>

    <div>
      <!-- (b) states with one-line behavior each -->
      <ul class="states-list">
        <li><span class="state-tag empty">empty</span>{STATE_EMPTY}</li>
        <li><span class="state-tag loading">loading</span>{STATE_LOADING}</li>
        <li><span class="state-tag error">error</span>{STATE_ERROR}</li>
        <li><span class="state-tag success">success</span>{STATE_SUCCESS}</li>
        <li><span class="state-tag edge">edge</span>{STATE_EDGE}</li>
      </ul>

      <!-- (c) transitions out -->
      <div class="transitions">
        <span class="label">Transitions</span>
        <ul>
          <li>{TRANSITION_1}</li>
          <li>{TRANSITION_2}</li>
        </ul>
      </div>
    </div>

  </div>
</div>

<h2>Open Questions</h2>
<div class="open-questions">
  <ul>
    <!-- Repeat for each decision needing human input -->
    <li>{OPEN_QUESTION_1}</li>
    <li>{OPEN_QUESTION_2}</li>
  </ul>
</div>

<div class="footer">
  Generated by /phantom:visualflow &middot; Phantom &middot; {DATE}
</div>

<!-- Self-audit: the generator inlines `node scripts/layout-audit.js --source` in
     place of {LAYOUT_AUDIT_SCRIPT}, keeping this artifact self-contained (no
     external requests). After load, window.__lavishAudit() returns the structured
     layout report so the flow can be checked for clipped/overflowing wireframes. -->
<script>{LAYOUT_AUDIT_SCRIPT}</script>

</body>
</html>
```

---

## Placeholder Reference

| Placeholder | Source | Example |
|------------|--------|---------|
| `{TICKET}` | Session ticket ID | `CP-1234` |
| `{DATE}` | ISO date | `2026-06-26` |
| `{FEATURE_TITLE}` | Feature/flow name | `Onboarding wizard` |
| `{STATUS}` | Flow status label | `Approved`, `Draft` |
| `{STATUS_CLASS}` | CSS class | `approved`, `draft` |
| `{SCREEN_NAME}` | Screen / step name | `Welcome`, `Account details` |
| `{STATE_EMPTY}` | Empty-state behavior | `No data yet — show prompt to start` |
| `{STATE_LOADING}` | Loading-state behavior | `Skeleton rows while fetching` |
| `{STATE_ERROR}` | Error-state behavior | `Inline banner + retry action` |
| `{STATE_SUCCESS}` | Success-state behavior | `Confirmation + advance to next` |
| `{STATE_EDGE}` | Edge-case behavior | `Partial input — disable submit` |
| `{TRANSITION_N}` | Transition out of screen | `on submit → Account details` |
| `{OPEN_QUESTION_N}` | Decision needing a human | `Should step 2 be skippable?` |
| `{LAYOUT_AUDIT_SCRIPT}` | Output of `node scripts/layout-audit.js --source` | zero-dep auditor; defines `window.__lavishAudit()` |
