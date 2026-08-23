# HTML Eval Template

Author: Subash Karki

Full HTML template for `eval.html`. Replace `{placeholders}` with actual data. See [eval.md](../../commands/eval.md) for the per-agent criterion lists and [evaluation.md](../../.claude/evals/evaluation.md) for the scale, confidence levels, anti-fabrication rule, and the five session-level dimensions that populate each section. See the placeholder reference at the bottom for substitution values.

Design source: gorkhali's default dark aesthetic (tier 3 of the design-inference priority in `reference/output-contract.md`) — this artifact is about gorkhali's own session quality, not a subject project, so there's no project design system to defer to. Matches `reference/detective/report-template.md`, `reference/visualflow/flow-template.md`, and `reference/contract/contract-template.md` so all four read as one system.

Every scored row MUST carry its evidence line (`{criterion}: {score}/{confidence} — {artifact-path-or-command} :: {fact}`) per evaluation.md's anti-fabrication rule — a score with no evidence line is invalid and must not be rendered. A criterion with no citable evidence renders `n/e`, never a guessed number.

---

## Template

```html
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Eval: {TICKET}</title>
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
    max-width: 1000px;
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
  .badge-high { background: rgba(63,185,80,0.15); color: var(--green); border: 1px solid var(--green); }
  .badge-medium { background: rgba(210,153,34,0.15); color: var(--yellow); border: 1px solid var(--yellow); }
  .badge-low { background: rgba(248,81,73,0.15); color: var(--red); border: 1px solid var(--red); }
  .badge-ne { background: rgba(139,148,158,0.15); color: var(--text-muted); border: 1px solid var(--text-muted); }

  .overall-box {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 1.5rem;
    display: flex;
    align-items: center;
    gap: 1.5rem;
  }
  .overall-score {
    font-size: 2.2rem;
    font-weight: 700;
    color: var(--accent);
    font-family: var(--font-mono);
  }
  .overall-meta { color: var(--text-muted); font-size: 0.85rem; }

  .dim-table, .agent-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.88rem;
  }
  .dim-table th, .dim-table td, .agent-table th, .agent-table td {
    padding: 0.55rem 0.75rem;
    border-bottom: 1px solid var(--border);
    text-align: left;
    vertical-align: top;
  }
  .dim-table th, .agent-table th {
    color: var(--text-muted);
    font-size: 0.72rem;
    text-transform: uppercase;
    letter-spacing: 0.03em;
  }
  .score-cell {
    font-family: var(--font-mono);
    font-weight: 600;
  }
  .evidence-line {
    font-family: var(--font-mono);
    font-size: 0.78rem;
    color: var(--text-muted);
    display: block;
    margin-top: 0.25rem;
  }

  .notes-columns {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 1.25rem;
  }
  @media (max-width: 640px) { .notes-columns { grid-template-columns: 1fr; } }
  .notes-card {
    background: var(--surface);
    border-radius: 8px;
    padding: 1rem 1.5rem;
  }
  .notes-card.went-well { border-left: 3px solid var(--green); }
  .notes-card.to-improve { border-left: 3px solid var(--yellow); }
  .notes-card ul { list-style: none; padding: 0; }
  .notes-card li {
    padding: 0.4rem 0;
    border-bottom: 1px solid var(--border);
    font-size: 0.88rem;
  }
  .notes-card li:last-child { border-bottom: none; }

  .coord-notes {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 1rem 1.5rem;
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
  <h1>Session Eval</h1>
  <div><span class="ticket">{TICKET}</span></div>
  <div class="meta">
    Date: {DATE} &middot; n/e criteria: {NE_COUNT}
  </div>
</div>

<h2>Overall Score</h2>
<div class="overall-box">
  <div class="overall-score">{OVERALL_SCORE}</div>
  <div class="overall-meta">
    Confidence: <span class="badge badge-{OVERALL_CONFIDENCE_CLASS}">{OVERALL_CONFIDENCE}</span><br>
    {OVERALL_CONFIDENCE_NOTE}
  </div>
</div>

<h2>Session Dimensions</h2>
<table class="dim-table">
  <thead>
    <tr>
      <th>Dimension</th>
      <th>Weight</th>
      <th>Score</th>
      <th>Confidence</th>
    </tr>
  </thead>
  <tbody>
    <!-- Repeat for each of the 5 session-level dimensions (outcome, plan fidelity,
         review efficacy, loop discipline, evidence hygiene). Use score "n/e" and
         badge-ne when a dimension has no citable evidence. -->
    <tr>
      <td>{DIMENSION_NAME_1}</td>
      <td>{DIMENSION_WEIGHT_1}</td>
      <td class="score-cell">{DIMENSION_SCORE_1}
        <span class="evidence-line">{DIMENSION_EVIDENCE_1}</span>
      </td>
      <td><span class="badge badge-{DIMENSION_CONFIDENCE_CLASS_1}">{DIMENSION_CONFIDENCE_1}</span></td>
    </tr>
  </tbody>
</table>

<h2>Per-Agent Scores</h2>
<table class="agent-table">
  <thead>
    <tr>
      <th>Agent</th>
      <th>Mean Score</th>
      <th>n/e</th>
      <th>Confidence</th>
    </tr>
  </thead>
  <tbody>
    <!-- Repeat for each active shadow (Chief, Engineer per focus, Inspector per mode, Auditor).
         Each row's evidence-line repeats per scored criterion for that agent. -->
    <tr>
      <td>{AGENT_NAME_1}</td>
      <td class="score-cell">{AGENT_SCORE_1}
        <span class="evidence-line">{AGENT_EVIDENCE_1}</span>
      </td>
      <td>{AGENT_NE_COUNT_1}</td>
      <td><span class="badge badge-{AGENT_CONFIDENCE_CLASS_1}">{AGENT_CONFIDENCE_1}</span></td>
    </tr>
  </tbody>
</table>

<h2>Retrospective</h2>
<div class="notes-columns">
  <div class="notes-card went-well">
    <strong>What went well</strong>
    <ul>
      <!-- Repeat for each item -->
      <li>{WENT_WELL_1}</li>
      <li>{WENT_WELL_2}</li>
    </ul>
  </div>
  <div class="notes-card to-improve">
    <strong>What to improve</strong>
    <ul>
      <!-- Repeat for each item -->
      <li>{TO_IMPROVE_1}</li>
      <li>{TO_IMPROVE_2}</li>
    </ul>
  </div>
</div>

<h2>Coordination Notes</h2>
<div class="coord-notes">
  <p>{COORDINATION_NOTES}</p>
</div>

<div class="footer">
  Generated by /gorkhali:eval &middot; Gorkhali &middot; {DATE}
</div>

<!-- Self-audit: the generator inlines `node scripts/layout-audit.js --source` in
     place of {LAYOUT_AUDIT_SCRIPT}, keeping this artifact self-contained (no
     external requests). After load, window.__lavishAudit() returns the structured
     layout report so the eval can be checked for clipped/overflowing sections. -->
<script>{LAYOUT_AUDIT_SCRIPT}</script>

</body>
</html>
```

---

## Placeholder Reference

| Placeholder | Source | Example |
|------------|--------|---------|
| `{TICKET}` | Session ticket ID | `CP-1234` |
| `{DATE}` | ISO date | `2026-07-05` |
| `{NE_COUNT}` | Total `n/e`-scored criteria across the session | `2` |
| `{OVERALL_SCORE}` | Weighted mean of the 5 session dimensions | `4.1` |
| `{OVERALL_CONFIDENCE}` / `{OVERALL_CONFIDENCE_CLASS}` | Lowest confidence among contributing dimensions | `medium` / `medium` |
| `{OVERALL_CONFIDENCE_NOTE}` | Confidence-cap note when 2+ dimensions are `n/e` | `Capped at low: 2 of 5 dimensions n/e` |
| `{DIMENSION_NAME_N}` | One of the 5 session dimensions | `Outcome quality`, `Plan fidelity`, `Review efficacy`, `Loop discipline`, `Evidence hygiene` |
| `{DIMENSION_WEIGHT_N}` | Dimension weight | `30%`, `20%`, `20%`, `15%`, `15%` |
| `{DIMENSION_SCORE_N}` | 1-5 or `n/e` | `5`, `n/e` |
| `{DIMENSION_CONFIDENCE_N}` / `{DIMENSION_CONFIDENCE_CLASS_N}` | high/medium/low/n/e | `high` / `high` |
| `{DIMENSION_EVIDENCE_N}` | Required evidence line | `Outcome quality: 5/high — sessions/CP-1234/verification.json :: verdict "pass", 409/409 tests` |
| `{AGENT_NAME_N}` | Scored shadow | `Engineer (UI focus)` |
| `{AGENT_SCORE_N}` | Mean of evaluable criteria | `4.3` |
| `{AGENT_EVIDENCE_N}` | Required evidence line(s) for that agent | `a11y checks: 4/high — review-panel.json :: 2 findings fixed pre-ship` |
| `{AGENT_NE_COUNT_N}` | `n/e`-scored criteria for that agent | `1` |
| `{AGENT_CONFIDENCE_N}` / `{AGENT_CONFIDENCE_CLASS_N}` | high/medium/low | `medium` / `medium` |
| `{WENT_WELL_N}` | Retrospective positive | `Fix loop converged in one pass` |
| `{TO_IMPROVE_N}` | Retrospective gap | `Contract lacked a non-goals section, caused scope drift` |
| `{COORDINATION_NOTES}` | Free-text on agent handoffs, timing, blockers | `Engineer (API) blocked 12min waiting on contract revision` |
| `{LAYOUT_AUDIT_SCRIPT}` | Output of `node scripts/layout-audit.js --source` | zero-dep auditor; defines `window.__lavishAudit()` |
