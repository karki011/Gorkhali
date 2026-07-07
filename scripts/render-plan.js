// Author: Subash Karki
// render-plan.js - deterministic plan.json -> plan.html renderer for the PLAN
// gate. Reads a session's plan.json and emits a self-contained HTML artifact
// (inline CSS, zero external requests) beside it so phantom:annotate has a real
// surface to open. plan.json is the source of truth; this file only presents it.
//
// Design contract:
//  - Input tolerance: plan.json shapes vary session-to-session. We render what
//    exists, skip what doesn't, and NEVER throw on a missing field. Unknown keys
//    fall through visibly - top-level ones into an "Other fields" section, and
//    unclaimed task/wave keys (work, detail, design, acceptance_criteria, verify,
//    ...) into per-task/per-wave fall-through blocks. Absorption direction is
//    show, not hide, applied recursively so inner content can't vanish.
//  - Escaping is load-bearing: every string from plan.json is UNTRUSTED and is
//    HTML-escaped before interpolation. A field of `<script>alert(1)</script>`
//    renders inert as text.
//  - Determinism: no Date/random anywhere in the output. Two runs on the same
//    input are byte-identical. Object keys iterate in insertion order; arrays in
//    their given order.
//  - Failure taxonomy via scripts/lib/axi-error.js: missing arg / unreadable
//    file / invalid JSON -> PhantomError(VALIDATION_ERROR) -> exit 2. We set
//    process.exitCode and return; never process.exit (which truncates writes).
'use strict';

const fs = require('fs');
const path = require('path');
const { PhantomError, reportError, VALIDATION_ERROR } = require('./lib/axi-error');

// ── escaping ─────────────────────────────────────────────────────────────────
// & first so we never double-escape the entities we introduce. Covers the five
// characters that can break out of text or attribute context.
const escapeHtml = (value) =>
  String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const isPlainObject = (v) => v != null && typeof v === 'object' && !Array.isArray(v);
const isScalar = (v) => v == null || (typeof v !== 'object');

// Known agent models get a stable colour class; unknown models fall back to the
// neutral chip. Model text is never interpolated into a class name (untrusted).
const MODEL_CLASS = { opus: 'chip-opus', sonnet: 'chip-sonnet', haiku: 'chip-haiku', fable: 'chip-fable' };

// ── task + wave normalization ────────────────────────────────────────────────
// Field names vary session-to-session. We model a small set of known aliases,
// then let EVERYTHING else fall through visibly (renderOtherField) rather than
// vanish - show-don't-hide applied recursively, at the task and wave level, not
// just the top level.

// A task's prose body: first present of these aliases. `title` is rendered
// separately as a short lead line, so it is not in this list. Whatever wins is
// consumed; other body-ish keys still fall through so nothing is dropped.
const TASK_BODY_KEYS = ['detail', 'task', 'summary', 'description', 'action'];
const readTaskBody = (t) => {
  for (const k of TASK_BODY_KEYS) {
    const v = t[k];
    if (v != null && isScalar(v) && String(v) !== '') return { text: String(v), key: k };
  }
  return { text: '', key: null };
};

// A wave's display label: first present scalar of these. The winning key is
// consumed; the rest of the wave's keys fall through.
const WAVE_LABEL_KEYS = ['name', 'title', 'id'];
const readWaveLabel = (wave, i) => {
  for (const k of WAVE_LABEL_KEYS) {
    const v = wave[k];
    if (v != null && isScalar(v) && String(v) !== '') return { name: String(v), labelKey: k };
  }
  return { name: `Wave ${i + 1}`, labelKey: null };
};

// Waves come in two shapes:
//  1. [{ id?, name?/title?, tasks?: [...], ...anything }]  (object wave)
//  2. [ ["id-a", "id-b"], "id-c" ]                          (id-refs into top-level tasks[])
// If there are no waves but a top-level tasks[] exists, synthesize one wave so
// the tasks still render. Returns [{ name, tasks: [task-object], rest }] where
// `rest` is every wave-level key we did NOT claim (work, files, design, tests,
// verify, agent, dependsOn, ...), preserved so renderWave can show them instead
// of dropping them.
const collectWaves = (plan) => {
  const topTasks = Array.isArray(plan.tasks) ? plan.tasks : [];
  const taskById = new Map();
  for (const t of topTasks) {
    if (isPlainObject(t) && t.id != null) taskById.set(String(t.id), t);
  }

  const waves = Array.isArray(plan.waves) ? plan.waves : [];
  if (waves.length === 0) {
    return topTasks.length ? [{ name: 'Tasks', tasks: topTasks, rest: {} }] : [];
  }

  return waves.map((wave, i) => {
    if (isPlainObject(wave)) {
      const tasksIsArray = Array.isArray(wave.tasks);
      const tasks = tasksIsArray ? wave.tasks : [];
      const { name, labelKey } = readWaveLabel(wave, i);
      // Only claim `tasks` when it's the array shape we actually render; a
      // malformed tasks value then falls through as raw instead of vanishing.
      const consumed = new Set();
      if (tasksIsArray) consumed.add('tasks');
      if (labelKey) consumed.add(labelKey);
      const rest = Object.fromEntries(Object.entries(wave).filter(([k]) => !consumed.has(k)));
      return { name, tasks, rest };
    }
    // id-ref shape: resolve each ref against top-level tasks[]; unknown refs
    // become a stub task carrying just the id so nothing is silently lost.
    const refs = Array.isArray(wave) ? wave : [wave];
    const tasks = refs.map((ref) => taskById.get(String(ref)) ?? { id: ref });
    return { name: `Wave ${i + 1}`, tasks, rest: {} };
  });
};

// ── HTML fragments ───────────────────────────────────────────────────────────
const chip = (text, cls = '') =>
  `<span class="chip${cls ? ' ' + cls : ''}">${escapeHtml(text)}</span>`;

const renderTask = (task) => {
  if (!isPlainObject(task)) return `<div class="task">${chip(String(task), 'chip-id')}</div>`;

  // Track which keys a dedicated element rendered; every unclaimed key falls
  // through below so acceptance_criteria / read_first / dependsOn / verify and
  // any other task field are shown, never dropped.
  const consumed = new Set();
  const chips = [];
  if (task.id != null) {
    chips.push(chip(task.id, 'chip-id'));
    consumed.add('id');
  }
  if (task.agent != null && String(task.agent) !== '') {
    chips.push(chip(task.agent, 'chip-agent'));
    consumed.add('agent');
  } else if (task.owner != null && String(task.owner) !== '') {
    chips.push(chip(task.owner, 'chip-agent'));
    consumed.add('owner');
  }
  if (task.model != null && String(task.model) !== '') {
    const cls = MODEL_CLASS[String(task.model).toLowerCase()] ?? '';
    chips.push(chip(task.model, cls));
    consumed.add('model');
  }

  // Short lead line, above the body prose (menu-bar shape: title + detail).
  let titleHtml = '';
  if (typeof task.title === 'string' && task.title !== '') {
    titleHtml = `<p class="task-title">${escapeHtml(task.title)}</p>`;
    consumed.add('title');
  }

  const body = readTaskBody(task);
  if (body.key) consumed.add(body.key);
  const textHtml = body.text ? `<p class="task-text">${escapeHtml(body.text)}</p>` : '';

  const filesIsArray = Array.isArray(task.files);
  if (filesIsArray) consumed.add('files');
  const filesHtml = filesIsArray && task.files.length
    ? `<ul class="files">${task.files.map((f) => `<li><code>${escapeHtml(f)}</code></li>`).join('')}</ul>`
    : '';

  const rest = Object.entries(task).filter(([k]) => !consumed.has(k));
  const restHtml = rest.length
    ? `<div class="task-extra">${rest.map(([k, v]) => renderOtherField(k, v)).join('\n')}</div>`
    : '';

  return [
    '<div class="task">',
    chips.length ? `<div class="chips">${chips.join('')}</div>` : '',
    titleHtml,
    textHtml,
    filesHtml,
    restHtml,
    '</div>',
  ]
    .filter(Boolean)
    .join('\n');
};

const renderWave = (wave) => {
  const restEntries = isPlainObject(wave.rest) ? Object.entries(wave.rest) : [];
  const restHtml = restEntries.length
    ? `<div class="wave-extra">${restEntries.map(([k, v]) => renderOtherField(k, v)).join('\n')}</div>`
    : '';
  const hasTasks = wave.tasks.length > 0;
  // Only show the placeholder when the wave is genuinely empty - a wave whose
  // substance lives in fall-through keys (work/design/verify...) is not empty.
  const emptyNote = !hasTasks && !restEntries.length ? '<p class="muted">No tasks in this wave.</p>' : '';
  return [
    '<div class="wave-card">',
    `<div class="wave-name">${escapeHtml(wave.name)}</div>`,
    hasTasks ? wave.tasks.map(renderTask).join('\n') : '',
    restHtml,
    emptyNote,
    '</div>',
  ]
    .filter(Boolean)
    .join('\n');
};

const renderListCallout = (items) =>
  `<div class="callout"><ul>${items
    .map((it) => `<li>${isScalar(it) ? escapeHtml(it) : `<code>${escapeHtml(JSON.stringify(it))}</code>`}</li>`)
    .join('')}</ul></div>`;

// ── structured fallback (arrays of objects / plain objects) ────────────────
// Any plan section shape we don't have a dedicated renderer for used to dump
// as escaped pretty-printed JSON inside a <pre> - unreadable for anything
// richer than a couple of keys (e.g. a slices[] array of {id, title, files,
// constraints, ...}). This renders the same tolerant, recursive, always-shown
// contract (nothing vanishes, everything escaped) as actual HTML structure:
// object -> definition rows, array of objects -> a card per object, array of
// scalars -> bullet list (unchanged), long scalar -> paragraph. Only a leaf
// past MAX_STRUCT_DEPTH falls back to compact inline JSON, and only that leaf
// - never a whole-section <pre> dump.
const MAX_STRUCT_DEPTH = 4;

// snake_case / camelCase / kebab-case -> "Spaced Words, Capitalized".
const humanizeKey = (key) =>
  String(key)
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .trim()
    .replace(/\S+/g, (w) => w[0].toUpperCase() + w.slice(1).toLowerCase());

const hasScalar = (obj, key) => obj[key] != null && isScalar(obj[key]) && String(obj[key]) !== '';

// A card heading: first present of (id + title combined), title, name, id,
// label. Returns the source keys too, so the caller can exclude them from the
// card body instead of showing them twice.
const cardHeading = (obj) => {
  if (hasScalar(obj, 'id') && hasScalar(obj, 'title')) return { text: `${obj.id} - ${obj.title}`, keys: ['id', 'title'] };
  if (hasScalar(obj, 'title')) return { text: String(obj.title), keys: ['title'] };
  if (hasScalar(obj, 'name')) return { text: String(obj.name), keys: ['name'] };
  if (hasScalar(obj, 'id')) return { text: String(obj.id), keys: ['id'] };
  if (hasScalar(obj, 'label')) return { text: String(obj.label), keys: ['label'] };
  return null;
};

// Short scalars worth a header chip rather than a full definition row.
const CARD_CHIP_KEYS = ['size', 'complexity', 'risk', 'status', 'priority', 'severity'];

// Long scalar strings read as prose, not a squeezed-in code row.
const LONG_SCALAR = 60;
const renderScalarValue = (v) => {
  const raw = v == null ? String(v) : String(v);
  const escaped = escapeHtml(v);
  return raw.length > LONG_SCALAR ? `<p class="of-text">${escaped}</p>` : escaped;
};

const renderDefRows = (entries, depth) =>
  `<div class="def-rows">${entries
    .map(
      ([k, v]) =>
        `<div class="def-row"><div class="def-key">${escapeHtml(humanizeKey(k))}</div><div class="def-val">${renderStructuredValue(v, depth)}</div></div>`,
    )
    .join('')}</div>`;

const renderStructuredCard = (item, depth) => {
  if (!isPlainObject(item)) return `<div class="s-card">${renderStructuredValue(item, depth)}</div>`;

  const heading = cardHeading(item);
  const consumed = new Set(heading ? heading.keys : []);
  const chips = [];
  for (const k of CARD_CHIP_KEYS) {
    if (consumed.has(k) || !hasScalar(item, k)) continue;
    chips.push(chip(item[k]));
    consumed.add(k);
  }
  const rest = Object.entries(item).filter(([k]) => !consumed.has(k));
  const headHtml = heading || chips.length
    ? `<div class="s-card-head">${heading ? `<span class="s-card-title">${escapeHtml(heading.text)}</span>` : ''}${chips.join('')}</div>`
    : '';
  const bodyHtml = rest.length ? renderDefRows(rest, depth + 1) : '';
  return ['<div class="s-card">', headHtml, bodyHtml, '</div>'].filter(Boolean).join('\n');
};

const renderStructuredValue = (value, depth) => {
  if (isScalar(value)) return renderScalarValue(value);
  if (depth >= MAX_STRUCT_DEPTH) return `<code class="of-inline-json">${escapeHtml(JSON.stringify(value))}</code>`;
  if (Array.isArray(value)) {
    if (value.length === 0) return '<span class="muted">(empty)</span>';
    if (value.every(isScalar)) {
      return `<ul class="of-list">${value.map((v) => `<li>${escapeHtml(v)}</li>`).join('')}</ul>`;
    }
    return `<div class="card-grid">${value.map((item) => renderStructuredCard(item, depth + 1)).join('')}</div>`;
  }
  const entries = Object.entries(value);
  return entries.length ? renderDefRows(entries, depth + 1) : '<span class="muted">(empty)</span>';
};

// Generic renderer for whatever top-level keys we didn't claim. Scalars become
// a key/value row; scalar arrays become a list (unchanged); anything
// structured (objects, arrays of objects) renders through the recursive
// structured renderer above so it never surfaces as a raw JSON dump.
const renderOtherField = (key, value) => {
  const label = `<div class="of-key">${escapeHtml(key)}</div>`;
  if (isScalar(value)) return `<div class="of-row">${label}<div class="of-val">${escapeHtml(value)}</div></div>`;
  if (Array.isArray(value) && value.every(isScalar)) {
    return `<div class="of-row">${label}<ul class="of-list">${value
      .map((v) => `<li>${escapeHtml(v)}</li>`)
      .join('')}</ul></div>`;
  }
  return `<div class="of-row">${label}${renderStructuredValue(value, 0)}</div>`;
};

// ── plan-check section ─────────────────────────────────────────────────────────
// A sibling plan-check.json (the plan-checker's verdict) is rendered as a "Plan
// Check" section when present. Same tolerance contract as the rest of the file:
// render what exists, escape everything, let unknown keys fall through visibly,
// NEVER throw. Real shape (see menu-bar-claude-status/plan-check.json):
//   { _meta, checks: { <name>: { result, details:[...] } }, additionalFindings:[],
//     verdict, summary }
// loadPlanCheck distinguishes the three outcomes the renderer cares about:
//   absent (ENOENT)     -> null            -> no section
//   unreadable / invalid -> { error: msg } -> a single loud, escaped note
//   valid JSON           -> { data }        -> the full section
// Absence means something different depending on how the path was chosen: a
// sibling plan-check.json is auto-discovered, so its absence is normal (null,
// no section). An explicit --check-file is a stated expectation, so a missing
// path there is loud (an error note), not silently absorbed like the sibling
// case - same mechanism as the existing malformed/EACCES note.
const loadPlanCheck = (checkPath, { explicit = false } = {}) => {
  let raw;
  try {
    raw = fs.readFileSync(checkPath, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') {
      return explicit ? { error: `--check-file path not found: ${checkPath}` } : null;
    }
    return { error: `cannot read plan-check file ${checkPath} (${err.code || err.message})` };
  }
  try {
    return { data: JSON.parse(raw) };
  } catch (err) {
    return { error: `invalid JSON in plan-check file ${checkPath}: ${err.message}` };
  }
};

// Known verdict/result words get a stable colour class; anything else is neutral.
// The word itself is never interpolated into a class name (untrusted).
const VERDICT_CLASS = {
  proceed: 'badge-pass', pass: 'badge-pass', go: 'badge-pass', ok: 'badge-pass',
  warn: 'badge-warn', revise: 'badge-warn', caution: 'badge-warn',
  fail: 'badge-fail', block: 'badge-fail', blocked: 'badge-fail', 'no-go': 'badge-fail', stop: 'badge-fail',
};
const verdictBadge = (value, label = '') => {
  const cls = VERDICT_CLASS[String(value).toLowerCase().trim()] ?? '';
  return `<span class="badge${cls ? ' ' + cls : ''}">${label ? escapeHtml(label) + ' ' : ''}${escapeHtml(value)}</span>`;
};

// One row per named check. Known keys (result, details) get dedicated elements;
// everything else on the check object falls through so nothing is dropped, and a
// non-object check value is shown raw rather than vanishing.
const renderCheckRow = (name, c) => {
  if (!isPlainObject(c)) return renderOtherField(name, c);
  const consumed = new Set();
  const head = [`<span class="check-name">${escapeHtml(name)}</span>`];
  if (isScalar(c.result) && c.result != null && String(c.result) !== '') {
    head.push(verdictBadge(c.result));
    consumed.add('result');
  }
  const detailsIsArray = Array.isArray(c.details);
  if (detailsIsArray) consumed.add('details');
  const detailsHtml = detailsIsArray && c.details.length
    ? `<ul class="check-details">${c.details
        .map((d) => `<li>${isScalar(d) ? escapeHtml(d) : `<code>${escapeHtml(JSON.stringify(d))}</code>`}</li>`)
        .join('')}</ul>`
    : '';
  const rest = Object.entries(c).filter(([k]) => !consumed.has(k));
  const restHtml = rest.length ? rest.map(([k, v]) => renderOtherField(k, v)).join('\n') : '';
  return [
    '<div class="check-row">',
    `<div class="check-head">${head.join(' ')}</div>`,
    detailsHtml,
    restHtml,
    '</div>',
  ]
    .filter(Boolean)
    .join('\n');
};

// Renders the section from the loadPlanCheck result. null -> '' (no section).
// The section renders from file content only, so determinism is preserved.
const renderPlanCheckSection = (loaded) => {
  if (loaded == null) return '';
  const parts = ['<h2>Plan Check</h2>'];
  if (loaded.error) {
    parts.push(`<div class="callout callout-warn"><p class="muted">${escapeHtml(loaded.error)}</p></div>`);
    return parts.join('\n');
  }
  const check = loaded.data;
  // Tolerate a non-object plan-check.json: preserve the value rather than hide it.
  if (!isPlainObject(check)) {
    parts.push(renderOtherField('plan-check', check));
    return parts.join('\n');
  }

  const consumed = new Set();
  const badges = [];
  if (isScalar(check.verdict) && check.verdict != null && String(check.verdict) !== '') {
    badges.push(verdictBadge(check.verdict));
    consumed.add('verdict');
  }
  if (isScalar(check.score) && check.score != null && String(check.score) !== '') {
    badges.push(verdictBadge(check.score, 'Score:'));
    consumed.add('score');
  }
  if (badges.length) parts.push(`<div class="check-badges">${badges.join('')}</div>`);

  if (isScalar(check.summary) && check.summary != null && String(check.summary) !== '') {
    consumed.add('summary');
    parts.push(`<p class="check-summary">${escapeHtml(check.summary)}</p>`);
  }

  if (isPlainObject(check.checks)) {
    consumed.add('checks');
    const rows = Object.entries(check.checks).map(([name, c]) => renderCheckRow(name, c));
    if (rows.length) parts.push(`<div class="checks">${rows.join('\n')}</div>`);
  }

  if (Array.isArray(check.additionalFindings)) {
    consumed.add('additionalFindings');
    if (check.additionalFindings.length) {
      parts.push('<div class="check-findings-label">Additional findings</div>');
      parts.push(renderListCallout(check.additionalFindings));
    }
  }

  const rest = Object.entries(check).filter(([k]) => !consumed.has(k));
  if (rest.length) parts.push(rest.map(([k, v]) => renderOtherField(k, v)).join('\n'));

  return parts.join('\n');
};

const STYLE = `
  :root {
    --bg:#0d1117; --surface:#161b22; --surface-2:#21262d; --border:#30363d;
    --text:#e6edf3; --text-muted:#8b949e; --accent:#58a6ff; --green:#3fb950;
    --yellow:#d29922; --red:#f85149; --orange:#db6d28; --purple:#bc8cff;
    --mono:'SF Mono','Fira Code','JetBrains Mono',monospace;
    --sans:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
  }
  * { margin:0; padding:0; box-sizing:border-box; }
  body { font-family:var(--sans); background:var(--bg); color:var(--text);
    line-height:1.6; padding:2rem; max-width:1000px; margin:0 auto; }
  h1 { font-size:1.5rem; margin-bottom:.4rem; }
  h2 { font-size:1.05rem; color:var(--accent); border-bottom:1px solid var(--border);
    padding-bottom:.5rem; margin:2rem 0 1rem; text-transform:uppercase; letter-spacing:.05em; }
  code, pre { font-family:var(--mono); }
  .muted { color:var(--text-muted); }
  .plan-header { background:var(--surface); border:1px solid var(--border);
    border-radius:8px; padding:1.5rem; margin-bottom:1rem; }
  .plan-header .meta { margin-top:.6rem; display:flex; gap:.5rem; flex-wrap:wrap; align-items:center; }
  .ticket { color:var(--accent); font-weight:600; font-family:var(--mono); }
  .badge { display:inline-block; padding:.15rem .55rem; border-radius:12px; font-size:.72rem;
    font-weight:600; text-transform:uppercase; letter-spacing:.03em;
    background:rgba(88,166,255,.15); color:var(--accent); border:1px solid var(--accent); }
  .wave-card { background:var(--surface); border:1px solid var(--border);
    border-radius:8px; padding:1.1rem 1.25rem; margin-bottom:1.1rem; }
  .wave-name { font-size:1rem; font-weight:600; color:var(--accent); margin-bottom:.9rem; }
  .task { background:var(--surface-2); border:1px solid var(--border);
    border-radius:6px; padding:.85rem 1rem; margin-bottom:.75rem; }
  .task:last-child { margin-bottom:0; }
  .chips { display:flex; gap:.4rem; flex-wrap:wrap; margin-bottom:.55rem; }
  .chip { display:inline-block; padding:.12rem .5rem; border-radius:5px; font-size:.72rem;
    font-weight:600; font-family:var(--mono); background:var(--surface);
    border:1px solid var(--border); color:var(--text-muted); }
  .chip-id { color:var(--text); }
  .chip-agent { color:var(--accent); border-color:var(--accent); }
  .chip-opus { color:var(--purple); border-color:var(--purple); }
  .chip-sonnet { color:var(--accent); border-color:var(--accent); }
  .chip-haiku { color:var(--green); border-color:var(--green); }
  .chip-fable { color:var(--orange); border-color:var(--orange); }
  .task-title { font-weight:600; font-size:.95rem; margin-bottom:.4rem; color:var(--text); }
  .task-text { font-size:.92rem; margin-bottom:.55rem; }
  .task-text:last-child { margin-bottom:0; }
  .task-extra, .wave-extra { margin-top:.7rem; }
  .task-extra .of-row, .wave-extra .of-row { background:var(--bg); }
  .files { list-style:none; padding:0; margin:0; }
  .files li { font-size:.82rem; padding:.12rem 0; }
  .files code { color:var(--text-muted); }
  .callout { background:var(--surface); border-left:3px solid var(--yellow);
    border-radius:0 8px 8px 0; padding:.75rem 1.25rem; }
  .callout ul { list-style:none; padding:0; }
  .callout li { padding:.4rem 0; border-bottom:1px solid var(--border); font-size:.9rem; }
  .callout li:last-child { border-bottom:none; }
  .callout li::before { content:'\\2022'; color:var(--yellow); font-weight:bold; margin-right:.6rem; }
  .of-row { background:var(--surface); border:1px solid var(--border); border-radius:6px;
    padding:.75rem 1rem; margin-bottom:.6rem; }
  .of-key { font-family:var(--mono); font-size:.78rem; color:var(--accent);
    text-transform:uppercase; letter-spacing:.03em; margin-bottom:.35rem; }
  .of-val { font-size:.9rem; word-break:break-word; }
  .of-list { margin:0; padding-left:1.2rem; font-size:.88rem; }
  .of-pre { background:var(--surface-2); border:1px solid var(--border); border-radius:6px;
    padding:.6rem .8rem; overflow-x:auto; font-size:.8rem; white-space:pre; }
  .of-text { font-size:.9rem; margin-top:.3rem; word-break:break-word; }
  .of-inline-json { font-family:var(--mono); font-size:.78rem; background:var(--surface-2);
    border:1px solid var(--border); border-radius:4px; padding:.05rem .35rem; }
  .card-grid { display:flex; flex-direction:column; gap:.6rem; }
  .s-card { background:var(--surface); border:1px solid var(--border); border-radius:6px;
    padding:.75rem 1rem; }
  .s-card-head { display:flex; gap:.4rem; align-items:center; flex-wrap:wrap; margin-bottom:.5rem; }
  .s-card-title { font-weight:600; font-size:.92rem; color:var(--text); }
  .def-rows { display:flex; flex-direction:column; gap:.5rem; }
  .def-row { padding-top:.45rem; border-top:1px solid var(--border); }
  .def-row:first-child { padding-top:0; border-top:none; }
  .def-key { font-family:var(--mono); font-size:.72rem; color:var(--text-muted);
    text-transform:uppercase; letter-spacing:.03em; margin-bottom:.2rem; }
  .def-val { font-size:.88rem; word-break:break-word; }
  .footer { margin-top:2.5rem; padding-top:1rem; border-top:1px solid var(--border);
    color:var(--text-muted); font-size:.8rem; text-align:center; }
  .check-badges { display:flex; gap:.5rem; flex-wrap:wrap; margin-bottom:.8rem; }
  .badge-pass { background:rgba(63,185,80,.15); color:var(--green); border-color:var(--green); }
  .badge-warn { background:rgba(210,153,34,.15); color:var(--yellow); border-color:var(--yellow); }
  .badge-fail { background:rgba(248,81,73,.15); color:var(--red); border-color:var(--red); }
  .check-summary { font-size:.92rem; margin-bottom:1rem; }
  .checks { display:flex; flex-direction:column; gap:.6rem; }
  .check-row { background:var(--surface); border:1px solid var(--border);
    border-radius:6px; padding:.75rem 1rem; }
  .check-head { display:flex; gap:.5rem; align-items:center; flex-wrap:wrap; }
  .check-name { font-family:var(--mono); font-size:.85rem; font-weight:600; color:var(--text); }
  .check-details { margin:.55rem 0 0; padding-left:1.2rem; font-size:.86rem; color:var(--text-muted); }
  .check-details li { padding:.15rem 0; }
  .callout-warn { border-left-color:var(--red); }
  .check-findings-label { font-size:.85rem; font-weight:600; color:var(--text);
    margin:1rem 0 .5rem; }
`;

// ── page assembly ────────────────────────────────────────────────────────────
const renderPlanHtml = (plan, { sourcePath = '', planCheck = null } = {}) => {
  // Tolerate a non-object top-level: preserve the value under Other fields
  // rather than throwing, so `{}`, arrays, and scalars all still render a page.
  const isObj = isPlainObject(plan);
  const p = isObj ? plan : {};

  // Keys a dedicated section actually renders land here as it renders them.
  // A known key with the wrong shape (e.g. constraints as a string, waves as
  // an object) is never added, so it falls through to Other fields instead
  // of vanishing - malformed input is shown, not silently absorbed.
  const consumed = new Set();

  // A known header field only counts as consumed - and only prints - when
  // it's scalar-shaped. Object/array-typed ticket|goal|route would otherwise
  // coerce to "[object Object]"; better to surface the raw value below.
  const readHeaderField = (key) => {
    const v = p[key];
    if (!isScalar(v)) return '';
    consumed.add(key);
    return v != null ? String(v) : '';
  };
  const ticket = readHeaderField('ticket');
  const goal = readHeaderField('goal');
  const route = readHeaderField('route');
  const title = ticket ? `Plan: ${ticket}` : 'Plan';
  const heading = goal || ticket || 'Plan';

  const metaBits = [];
  if (ticket) metaBits.push(`<span class="ticket">${escapeHtml(ticket)}</span>`);
  if (route) metaBits.push(`<span class="badge">${escapeHtml(route)}</span>`);

  const sections = [];

  // Plan-checker verdict, when a sibling plan-check.json was loaded. Rendered
  // first - it's a gate verdict about the whole plan. Absent file => ''.
  const checkSection = renderPlanCheckSection(planCheck);
  if (checkSection) sections.push(checkSection);

  // collectWaves reads both waves and tasks; each is consumed only when it's
  // the array shape the renderer actually understands, independent of
  // whether the resulting wave list ends up empty.
  if (Array.isArray(p.waves)) consumed.add('waves');
  if (Array.isArray(p.tasks)) consumed.add('tasks');
  const waves = collectWaves(p);
  if (waves.length) {
    sections.push('<h2>Waves</h2>');
    sections.push(waves.map(renderWave).join('\n'));
  }

  if (Array.isArray(p.assumptions)) {
    consumed.add('assumptions');
    if (p.assumptions.length) {
      sections.push('<h2>Assumptions</h2>');
      sections.push(renderListCallout(p.assumptions));
    }
  }
  if (Array.isArray(p.constraints)) {
    consumed.add('constraints');
    if (p.constraints.length) {
      sections.push('<h2>Constraints</h2>');
      sections.push(renderListCallout(p.constraints));
    }
  }

  // Insertion-order iteration keeps output stable across runs.
  const otherEntries = isObj
    ? Object.entries(p).filter(([k]) => !consumed.has(k))
    : [['value', plan]];
  if (otherEntries.length) {
    sections.push('<h2>Other fields</h2>');
    sections.push(otherEntries.map(([k, v]) => renderOtherField(k, v)).join('\n'));
  }

  const footerSource = sourcePath ? `Generated from <code>${escapeHtml(sourcePath)}</code> &middot; ` : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(title)}</title>
<style>${STYLE}</style>
</head>
<body>

<div class="plan-header">
  <h1>${escapeHtml(heading)}</h1>
  <div class="meta">${metaBits.join('\n    ')}</div>
</div>

${sections.join('\n\n')}

<div class="footer">
  ${footerSource}plan.json is the source of truth &mdash; this page is generated from it.
</div>

</body>
</html>
`;
};

// ── CLI ──────────────────────────────────────────────────────────────────────
const HELP =
  'render-plan - deterministic plan.json -> plan.html renderer\n\n' +
  'Usage: node scripts/render-plan.js <path-to-plan.json> [--out <path>] [--check-file <path>]\n' +
  '       node scripts/render-plan.js --help\n\n' +
  'Writes plan.html beside the input file (or to --out). Exit 0 on success;\n' +
  'missing arg / unreadable file / invalid JSON -> exit 2 (VALIDATION_ERROR).\n\n' +
  'If a plan-check.json sibling exists next to the input plan.json, its verdict\n' +
  'is rendered as a "Plan Check" section. Use --check-file <path> to point at a\n' +
  'plan-check.json elsewhere. An absent auto-discovered sibling renders no section\n' +
  '(its absence is normal). A missing, unreadable, or invalid --check-file renders\n' +
  'a one-line note instead (an explicit flag is an explicit expectation) - never an\n' +
  'error exit.\n';

const parseArgs = (args) => {
  let out = null;
  let checkFile = null;
  const positional = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--out') {
      out = args[i + 1];
      i++;
      if (out == null) {
        throw new PhantomError('--out requires a path argument', VALIDATION_ERROR, [
          'node scripts/render-plan.js <path-to-plan.json> --out <path>',
        ]);
      }
    } else if (args[i] === '--check-file') {
      checkFile = args[i + 1];
      i++;
      if (checkFile == null) {
        throw new PhantomError('--check-file requires a path argument', VALIDATION_ERROR, [
          'node scripts/render-plan.js <path-to-plan.json> --check-file <path>',
        ]);
      }
    } else {
      positional.push(args[i]);
    }
  }
  return { out, checkFile, input: positional[0] };
};

const run = (argv) => {
  const args = argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    process.stdout.write(HELP);
    return;
  }

  const { out, checkFile, input } = parseArgs(args);
  if (!input) {
    throw new PhantomError('missing required <path-to-plan.json> argument', VALIDATION_ERROR, [
      'node scripts/render-plan.js <path-to-plan.json> [--out <path>] [--check-file <path>]',
    ]);
  }

  let raw;
  try {
    raw = fs.readFileSync(input, 'utf8');
  } catch (err) {
    throw new PhantomError(`cannot read plan file: ${input} (${err.code || err.message})`, VALIDATION_ERROR, [
      'check the path exists and is readable',
    ]);
  }

  let plan;
  try {
    plan = JSON.parse(raw);
  } catch (err) {
    throw new PhantomError(`invalid JSON in ${input}: ${err.message}`, VALIDATION_ERROR, [
      'plan.json must be valid JSON',
    ]);
  }

  const checkPath = checkFile || path.join(path.dirname(input), 'plan-check.json');
  const planCheck = loadPlanCheck(checkPath, { explicit: checkFile != null });

  const html = renderPlanHtml(plan, { sourcePath: input, planCheck });
  const target = out || path.join(path.dirname(input), 'plan.html');
  fs.writeFileSync(target, html);
  process.stdout.write(`wrote ${target}\n`);
};

module.exports = { renderPlanHtml, escapeHtml, collectWaves, loadPlanCheck, run };

if (require.main === module) {
  try {
    run(process.argv);
  } catch (err) {
    reportError(err);
  }
}
