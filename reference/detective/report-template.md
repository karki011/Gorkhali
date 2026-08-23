# HTML Investigation Report Template

Author: Subash Karki

Full HTML template for `investigation.html`. Replace `{placeholders}` with actual data. See [protocol.md](protocol.md) for the 7-step flow that populates each section. See the placeholder reference at the bottom for substitution values.

---

## Template

```html
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Investigation: {TICKET}</title>
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
  .badge-high { background: rgba(248,81,73,0.15); color: var(--red); border: 1px solid var(--red); }
  .badge-medium { background: rgba(210,153,34,0.15); color: var(--yellow); border: 1px solid var(--yellow); }
  .badge-low { background: rgba(63,185,80,0.15); color: var(--green); border: 1px solid var(--green); }

  .symptoms {
    background: var(--surface);
    border-left: 3px solid var(--red);
    padding: 1rem 1.5rem;
    border-radius: 0 8px 8px 0;
    margin-bottom: 1rem;
  }
  .symptoms code {
    background: var(--surface-2);
    padding: 0.1rem 0.4rem;
    border-radius: 4px;
    font-family: var(--font-mono);
    font-size: 0.85rem;
  }

  .timeline {
    border-left: 2px solid var(--border);
    margin-left: 1rem;
    padding-left: 1.5rem;
  }
  .timeline-entry {
    position: relative;
    margin-bottom: 0.75rem;
    font-size: 0.9rem;
  }
  .timeline-entry::before {
    content: '';
    position: absolute;
    left: -1.85rem;
    top: 0.5rem;
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: var(--accent);
    border: 2px solid var(--bg);
  }
  .timeline-entry.suspect::before { background: var(--red); }
  .timeline-entry .sha {
    font-family: var(--font-mono);
    color: var(--purple);
    font-size: 0.8rem;
  }
  .timeline-entry .date { color: var(--text-muted); font-size: 0.8rem; }

  .suspect-card {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 1rem 1.5rem;
    margin-bottom: 1rem;
  }
  .suspect-card .filename {
    font-family: var(--font-mono);
    color: var(--accent);
    font-weight: 600;
  }
  .suspect-card .stats {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
    gap: 0.75rem;
    margin-top: 0.75rem;
  }
  .stat-item { font-size: 0.85rem; }
  .stat-label { color: var(--text-muted); font-size: 0.75rem; text-transform: uppercase; }
  .stat-value { font-weight: 600; font-size: 1rem; }

  .risk-bar {
    height: 6px;
    background: var(--surface-2);
    border-radius: 3px;
    margin-top: 0.5rem;
    overflow: hidden;
  }
  .risk-bar-fill {
    height: 100%;
    border-radius: 3px;
    transition: width 0.3s;
  }
  .risk-bar-fill.high { background: var(--red); }
  .risk-bar-fill.medium { background: var(--yellow); }
  .risk-bar-fill.low { background: var(--green); }

  .ownership-list {
    list-style: none;
    padding: 0;
  }
  .ownership-list li {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 0.4rem 0;
    font-size: 0.9rem;
  }
  .ownership-bar {
    flex: 1;
    max-width: 200px;
    height: 8px;
    background: var(--surface-2);
    border-radius: 4px;
    overflow: hidden;
  }
  .ownership-bar-fill {
    height: 100%;
    background: var(--accent);
    border-radius: 4px;
  }
  .ownership-pct { color: var(--text-muted); font-size: 0.8rem; min-width: 3rem; }

  .coupling-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.85rem;
  }
  .coupling-table th, .coupling-table td {
    padding: 0.5rem 0.75rem;
    border-bottom: 1px solid var(--border);
    text-align: left;
  }
  .coupling-table th {
    color: var(--text-muted);
    font-size: 0.75rem;
    text-transform: uppercase;
  }
  .coupling-table .strength {
    font-weight: 600;
  }
  .coupling-table .strength.violation { color: var(--red); }
  .coupling-table .strength.warning { color: var(--yellow); }
  .coupling-table .strength.normal { color: var(--green); }

  .hypothesis-box {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 1.5rem;
  }
  .confidence-meter {
    display: flex;
    align-items: center;
    gap: 1rem;
    margin: 1rem 0;
  }
  .confidence-track {
    flex: 1;
    height: 8px;
    background: var(--surface-2);
    border-radius: 4px;
    overflow: hidden;
  }
  .confidence-fill {
    height: 100%;
    border-radius: 4px;
  }
  .confidence-label { font-size: 0.85rem; font-weight: 600; min-width: 4rem; }

  .evidence-list {
    list-style: none;
    padding: 0;
  }
  .evidence-list li {
    padding: 0.5rem 0;
    border-bottom: 1px solid var(--border);
    font-size: 0.9rem;
    display: flex;
    gap: 0.5rem;
  }
  .evidence-list li::before {
    content: '>';
    color: var(--accent);
    font-family: var(--font-mono);
    font-weight: bold;
  }

  .actions {
    background: var(--surface);
    border: 1px solid var(--green);
    border-radius: 8px;
    padding: 1.5rem;
  }
  .actions ol {
    padding-left: 1.5rem;
  }
  .actions li {
    padding: 0.25rem 0;
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
  <h1>Investigation Report</h1>
  <div><span class="ticket">{TICKET}</span></div>
  <div class="meta">
    Investigator: Detective Agent &middot; Date: {DATE} &middot; Depth: {DEPTH}
    &middot; Confidence: <span class="badge badge-{CONFIDENCE_CLASS}">{CONFIDENCE}</span>
  </div>
</div>

<h2>Symptoms</h2>
<div class="symptoms">
  <!-- One div per symptom -->
  <p>{SYMPTOM_1}</p>
  <p>{SYMPTOM_2}</p>
  <!-- Add <code> tags for error messages, file paths, etc. -->
</div>

<h2>Timeline</h2>
<div class="timeline">
  <!-- Repeat for each relevant commit. Add class="suspect" for the suspected commit -->
  <div class="timeline-entry suspect">
    <div><span class="sha">{COMMIT_SHA_SHORT}</span> &mdash; {COMMIT_MESSAGE}</div>
    <div class="date">{COMMIT_DATE} by {AUTHOR}</div>
  </div>
  <div class="timeline-entry">
    <div><span class="sha">{COMMIT_SHA_SHORT}</span> &mdash; {COMMIT_MESSAGE}</div>
    <div class="date">{COMMIT_DATE} by {AUTHOR}</div>
  </div>
</div>

<h2>Suspects</h2>
<!-- Repeat for each suspect file -->
<div class="suspect-card">
  <div class="filename">{FILE_PATH}</div>
  <div class="stats">
    <div class="stat-item">
      <div class="stat-label">Change Freq</div>
      <div class="stat-value">{CHANGE_FREQ}</div>
    </div>
    <div class="stat-item">
      <div class="stat-label">Complexity</div>
      <div class="stat-value">{COMPLEXITY}</div>
    </div>
    <div class="stat-item">
      <div class="stat-label">Hotspot Risk</div>
      <div class="stat-value">{RISK_SCORE}</div>
    </div>
    <div class="stat-item">
      <div class="stat-label">Bus Factor</div>
      <div class="stat-value">{BUS_FACTOR}</div>
    </div>
  </div>
  <div class="risk-bar">
    <div class="risk-bar-fill {RISK_CLASS}" style="width: {RISK_PCT}%"></div>
  </div>
</div>

<h2>Ownership</h2>
<ul class="ownership-list">
  <!-- Repeat for each contributor to suspect files -->
  <li>
    <span style="min-width: 120px">{AUTHOR_NAME}</span>
    <div class="ownership-bar">
      <div class="ownership-bar-fill" style="width: {OWNERSHIP_PCT}%"></div>
    </div>
    <span class="ownership-pct">{OWNERSHIP_PCT}%</span>
  </li>
</ul>

<h2>Coupling</h2>
<table class="coupling-table">
  <thead>
    <tr>
      <th>File A</th>
      <th>File B</th>
      <th>Co-Changes</th>
      <th>Strength</th>
      <th>Status</th>
    </tr>
  </thead>
  <tbody>
    <!-- Repeat for each coupling pair -->
    <tr>
      <td><code>{FILE_A}</code></td>
      <td><code>{FILE_B}</code></td>
      <td>{CO_CHANGE_COUNT}</td>
      <td class="strength {STRENGTH_CLASS}">{STRENGTH_VALUE}</td>
      <td>{CO_CHANGED_STATUS}</td>
      <!-- CO_CHANGED_STATUS: "Both changed" or "MISSING co-change" (the red flag) -->
    </tr>
  </tbody>
</table>

<h2>Hypothesis</h2>
<div class="hypothesis-box">
  <p><strong>{HYPOTHESIS_DESCRIPTION}</strong></p>
  <div class="confidence-meter">
    <span class="confidence-label">{CONFIDENCE_PCT}%</span>
    <div class="confidence-track">
      <div class="confidence-fill" style="width: {CONFIDENCE_PCT}%; background: var(--{CONFIDENCE_COLOR})"></div>
    </div>
  </div>
  <p style="color: var(--text-muted); font-size: 0.85rem;">{HYPOTHESIS_REASONING}</p>
</div>

<h2>Evidence</h2>
<ul class="evidence-list">
  <!-- Repeat for each piece of evidence -->
  <li>{EVIDENCE_DESCRIPTION}</li>
</ul>

<h2>Recommended Actions</h2>
<div class="actions">
  <ol>
    <li><strong>{ACTION_1}</strong></li>
    <li>{ACTION_2}</li>
    <li>{ACTION_3}</li>
  </ol>
</div>

<div class="footer">
  Generated by Detective Mode &middot; Gorkhali Shadows &middot; {DATE}
</div>

<!-- Self-audit: the generator inlines `node scripts/layout-audit.js --source` in
     place of {LAYOUT_AUDIT_SCRIPT}, keeping this artifact self-contained (no
     external requests). After load, window.__lavishAudit() returns the structured
     layout report so the report can be checked for clipped/overflowing sections. -->
<script>{LAYOUT_AUDIT_SCRIPT}</script>

</body>
</html>
```

---

## Placeholder Reference

| Placeholder | Source | Example |
|------------|--------|---------|
| `{TICKET}` | Session ticket ID | `CP-1234` |
| `{DATE}` | ISO date | `2026-05-23` |
| `{DEPTH}` | Investigation depth | `Full Investigation` |
| `{CONFIDENCE}` | Confidence label | `High` |
| `{CONFIDENCE_CLASS}` | CSS class | `high`, `medium`, `low` |
| `{CONFIDENCE_PCT}` | Numeric | `75` |
| `{CONFIDENCE_COLOR}` | CSS var suffix | `green`, `yellow`, `red` |
| `{SYMPTOM_N}` | Symptom descriptions | Test output, error messages |
| `{COMMIT_SHA_SHORT}` | First 7 chars | `abc1234` |
| `{FILE_PATH}` | Relative path | `src/services/auth.ts` |
| `{CHANGE_FREQ}` | Number of changes in 6mo | `47` |
| `{COMPLEXITY}` | Line count + branches | `342 lines / 28 branches` |
| `{RISK_SCORE}` | Hotspot risk 0-1 | `0.82` |
| `{RISK_PCT}` | Score as percent | `82` |
| `{RISK_CLASS}` | CSS class | `high` (>0.7), `medium` (0.4-0.7), `low` (<0.4) |
| `{BUS_FACTOR}` | Min contributors for 50% | `1` |
| `{STRENGTH_VALUE}` | Coupling 0-1 | `0.67` |
| `{STRENGTH_CLASS}` | CSS class | `violation` (>0.5), `warning` (0.3-0.5), `normal` (<0.3) |
| `{CO_CHANGED_STATUS}` | Did both change? | `MISSING co-change` (red flag) |
| `{LAYOUT_AUDIT_SCRIPT}` | Output of `node scripts/layout-audit.js --source` | zero-dep auditor; defines `window.__lavishAudit()` |
