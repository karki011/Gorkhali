// Author: Subash Karki
// render-brainstorm.js - deterministic brainstorm.json -> brainstorm.html renderer,
// the sibling artifact to scripts/render-plan.js for the diverge/converge step:
// a self-contained HTML page phantom:annotate can open. brainstorm.json is the
// source of truth; this file only presents it.
//
// Ownership decision (Gate-1, PLAN-HTML-UX): both gate renderers now share
// scripts/lib/html-kit.js for presentation - one CloudZero token sheet and one
// set of HTML primitives - so plan.html and brainstorm.html read as one branded
// document set. This reverses the earlier "disjoint ownership" stance in which
// this renderer deliberately re-implemented its own escaping/STYLE. Each renderer
// still OWNS its section logic; only the design language is shared. The comparison
// table and the visual sketches below are brainstorm-specific components, so their
// (token-based) component CSS lives here rather than in the shared kit.
//
// Design contract (unchanged):
//  - Input tolerance: approach shapes vary. We render what exists, skip what
//    doesn't, and NEVER throw on a missing or malformed field. Unclaimed keys on
//    the top-level document and on each approach fall through visibly through
//    kit.smartValue rather than vanishing or dumping raw JSON.
//  - Escaping is load-bearing: every string from brainstorm.json is UNTRUSTED and
//    is HTML-escaped (via the kit's canonical escapeHtml) before interpolation.
//  - Determinism: no Date/random anywhere in the output. Two runs on the same
//    input are byte-identical. Object keys iterate in insertion order; arrays in
//    their given order.
//  - Failure taxonomy via scripts/lib/axi-error.js: missing arg / unreadable file
//    / invalid JSON -> PhantomError(VALIDATION_ERROR) -> exit 2. We set
//    process.exitCode and return; never process.exit.
'use strict';

const fs = require('fs');
const path = require('path');
const { PhantomError, reportError, VALIDATION_ERROR } = require('./lib/axi-error');
const {
  escapeHtml,
  isPlainObject,
  isScalar,
  isNonEmptyScalar,
  chip,
  callout,
  section,
  kvRow,
  kvCard,
  prose,
  slugify,
  pageShell,
} = require('./lib/html-kit');

// ── comparison-table value + label helpers ──────────────────────────────────
const approachLabel = (approach, i) => {
  if (!isPlainObject(approach)) return `Approach ${i + 1}`;
  if (isNonEmptyScalar(approach.name)) return String(approach.name);
  if (isNonEmptyScalar(approach.id)) return String(approach.id);
  return `Approach ${i + 1}`;
};

const tradeoffCell = (approach, key) => {
  if (!isPlainObject(approach)) return '<span class="bs-muted">-</span>';
  const v = approach[key];
  if (v == null || (isScalar(v) && String(v) === '')) return '<span class="bs-muted">-</span>';
  if (isScalar(v)) return escapeHtml(v);
  if (Array.isArray(v) && v.every(isScalar)) return v.map((x) => escapeHtml(x)).join(', ');
  return `<code>${escapeHtml(JSON.stringify(v))}</code>`;
};

const TRADEOFF_ROWS = [
  ['Effort', 'effort'],
  ['Risk', 'risk'],
  ['Reversibility', 'reversibility'],
  ['When to pick', 'whenToPick'],
];

// Side-by-side criteria table, kept inside an overflow-x:auto wrapper so wide
// comparisons scroll rather than break the page column.
const renderTradeoffTable = (approaches) => {
  const head = approaches.map((a, i) => `<th>${escapeHtml(approachLabel(a, i))}</th>`).join('');
  const rows = TRADEOFF_ROWS.map(
    ([label, key]) =>
      `<tr><td class="bs-crit">${escapeHtml(label)}</td>${approaches
        .map((a) => `<td>${tradeoffCell(a, key)}</td>`)
        .join('')}</tr>`,
  ).join('\n');
  return [
    '<div class="kit-scroll bs-cmp">',
    '<table>',
    `<thead><tr><th>Criterion</th>${head}</tr></thead>`,
    `<tbody>${rows}</tbody>`,
    '</table>',
    '</div>',
  ].join('\n');
};

// ── lightweight visual sketches ─────────────────────────────────────────────
// No diagram content is provided in the schema - visualType is just a category
// marker. So each type gets a small static schematic, not a rendering of real
// data. Kept as plain divs/arrows (no SVG defs, no ids) so nothing can collide
// across cards and nothing depends on anything outside this file.
const VISUAL_LABEL = { diagram: 'Diagram sketch', flow: 'Flow sketch', sitemap: 'Sitemap sketch', mockup: 'Mockup sketch' };

const visualBody = (type) => {
  switch (type) {
    case 'flow':
      return `<div class="bs-viz-row">
        <div class="bs-viz-box">Start</div><div class="bs-viz-arrow">&rarr;</div>
        <div class="bs-viz-box">Step</div><div class="bs-viz-arrow">&rarr;</div>
        <div class="bs-viz-box">Result</div>
      </div>`;
    case 'sitemap':
      return `<div class="bs-viz-tree">
        <div class="bs-viz-box bs-viz-root">Home</div>
        <div class="bs-viz-row bs-viz-children">
          <div class="bs-viz-box">Section A</div><div class="bs-viz-box">Section B</div><div class="bs-viz-box">Section C</div>
        </div>
      </div>`;
    case 'mockup':
      return `<div class="bs-viz-screen">
        <div class="bs-viz-screen-header"></div>
        <div class="bs-viz-screen-block"></div>
        <div class="bs-viz-screen-block bs-viz-screen-block-short"></div>
      </div>`;
    case 'diagram':
    default:
      return `<div class="bs-viz-row">
        <div class="bs-viz-box bs-round">A</div><div class="bs-viz-arrow">&rarr;</div>
        <div class="bs-viz-box bs-round">B</div><div class="bs-viz-arrow">&rarr;</div>
        <div class="bs-viz-box bs-round">C</div><div class="bs-viz-arrow bs-viz-arrow-back">&larr;</div>
      </div>`;
  }
};

// visualType is untrusted, so its label is escaped even though the sketch it
// selects is always one of the four static bodies above (unknown values fall
// through to the generic "diagram" body, never crash, never raw-interpolate).
const renderVisual = (visualType) => {
  const label = VISUAL_LABEL[visualType] ?? `${visualType} sketch`;
  return `<div class="bs-viz">
    <div class="bs-viz-title">${escapeHtml(label)}</div>
    ${visualBody(visualType)}
  </div>`;
};

// ── approach card ────────────────────────────────────────────────────────────
// Spine fields render as humanized key/value rows (kit.kvRow). The label strings
// below are passed as the "key" so kvRow's humanizer normalizes them to
// sentence-case ("Why this lens" -> "Why this lens"); the raw data key is what we
// mark consumed.
const SPINE = [
  ['whyLens', 'Why this lens'],
  ['effort', 'Effort'],
  ['risk', 'Risk'],
  ['reversibility', 'Reversibility'],
  ['whatBreaks', 'What breaks if wrong'],
  ['whenToPick', 'When to pick'],
  ['mutualExclusivity', 'Mutual exclusivity'],
];

const renderApproachCard = (approach, i) => {
  if (!isPlainObject(approach)) {
    return `<div class="kit-card">${chip(String(approach), 'kit-chip-strong')}</div>`;
  }

  const consumed = new Set();
  const chips = [];
  if (isNonEmptyScalar(approach.id)) {
    chips.push(chip(approach.id, 'kit-chip-strong'));
    consumed.add('id');
  }
  if (isNonEmptyScalar(approach.visualType)) {
    chips.push(chip(approach.visualType, 'kit-chip-brand'));
    // Only consumed when it actually rendered into the chip; a non-scalar
    // value falls through to Other fields instead of vanishing.
    consumed.add('visualType');
  }

  const heading = approachLabel(approach, i);
  if (isNonEmptyScalar(approach.name)) consumed.add('name');

  let thesisHtml = '';
  if (isNonEmptyScalar(approach.thesis)) {
    thesisHtml = `<p class="bs-thesis">${escapeHtml(approach.thesis)}</p>`;
    consumed.add('thesis');
  }

  let descriptionHtml = '';
  if (isNonEmptyScalar(approach.description)) {
    descriptionHtml = prose(approach.description);
    consumed.add('description');
  }

  const spineRows = SPINE.map(([key, label]) => {
    consumed.add(key);
    const v = approach[key];
    if (v == null || (isScalar(v) && String(v) === '')) return '';
    return kvRow(label, v);
  })
    .filter(Boolean)
    .join('');
  const spineHtml = spineRows ? `<div class="bs-rows">${spineRows}</div>` : '';

  const vizHtml =
    approach.visualType != null && String(approach.visualType) !== '' ? renderVisual(String(approach.visualType)) : '';

  const rest = Object.entries(approach).filter(([k]) => !consumed.has(k));
  const restHtml = rest.length
    ? `<div class="bs-rows">${rest.map(([k, v]) => kvRow(k, v)).join('')}</div>`
    : '';

  const chipsHtml = chips.length ? `<div class="bs-chips">${chips.join('')}</div>` : '';

  return [
    '<div class="kit-card bs-approach">',
    `<div class="bs-cardhead">${chipsHtml}<h3>${escapeHtml(heading)}</h3></div>`,
    thesisHtml,
    descriptionHtml,
    spineHtml,
    vizHtml,
    restHtml,
    '</div>',
  ]
    .filter(Boolean)
    .join('\n');
};

// ── recommended-default block ────────────────────────────────────────────────
const renderRecommended = (recommendedDefault, approaches) => {
  if (!isPlainObject(recommendedDefault)) return '';
  const idIsScalar = isScalar(recommendedDefault.id);
  const reasonIsScalar = isScalar(recommendedDefault.reason);
  const id = idIsScalar ? String(recommendedDefault.id ?? '') : '';
  const reason = reasonIsScalar ? String(recommendedDefault.reason ?? '') : '';
  const consumed = new Set();
  if (idIsScalar) consumed.add('id');
  if (reasonIsScalar) consumed.add('reason');

  const match = id ? approaches.find((a) => isPlainObject(a) && String(a.id) === id) : null;
  const label = match ? approachLabel(match, approaches.indexOf(match)) : id;

  const rest = Object.entries(recommendedDefault).filter(([k]) => !consumed.has(k));
  const restHtml = rest.length ? `<div class="bs-rows">${rest.map(([k, v]) => kvRow(k, v)).join('')}</div>` : '';

  const inner = [
    `<p class="kit-p"><strong>Recommended: ${
      label ? escapeHtml(label) : '<span class="bs-muted">unspecified</span>'
    }</strong></p>`,
    reason ? prose(reason) : '',
    restHtml,
  ]
    .filter(Boolean)
    .join('\n');
  return callout(inner, 'success');
};

// ── brainstorm-specific component styling ────────────────────────────────────
// Layered on the shared CZ tokens (var(--*) from html-kit's CZ_TOKENS); covers
// only components the kit does not ship: the comparison table and the sketch
// schematics. Sentence-case throughout - no text-transform:uppercase field labels.
const BRAINSTORM_STYLE = `
  .bs-muted { color:var(--text-dim); }

  .bs-cardhead { display:flex; align-items:baseline; gap:var(--sp-3); flex-wrap:wrap; margin-bottom:var(--sp-3); }
  .bs-cardhead h3 { margin:0; }
  .bs-chips { display:flex; gap:var(--sp-2); flex-wrap:wrap; }
  .bs-thesis { color:var(--heading); font-weight:600; margin:0 0 var(--sp-3); overflow-wrap:anywhere; }
  .bs-rows { margin-top:var(--sp-2); }

  .bs-cmp table { width:100%; border-collapse:collapse; font-size:.9rem; }
  .bs-cmp th, .bs-cmp td {
    text-align:left; padding:var(--sp-2) var(--sp-3);
    border-bottom:1px solid var(--border); vertical-align:top; overflow-wrap:anywhere;
  }
  .bs-cmp thead th { color:var(--text-dim); font-weight:600; border-bottom:1px solid var(--border-strong); white-space:nowrap; }
  .bs-cmp td.bs-crit { color:var(--text-dim); font-weight:600; white-space:nowrap; }
  .bs-cmp code {
    background:var(--surface-2); border:1px solid var(--border);
    border-radius:var(--r-md); padding:1px 6px; font-size:.85em;
  }

  .bs-viz { margin-top:var(--sp-3); border-top:1px dashed var(--border); padding-top:var(--sp-3); }
  .bs-viz-title { font-size:.75rem; color:var(--text-dim); margin-bottom:var(--sp-2); }
  .bs-viz-row { display:flex; align-items:center; gap:var(--sp-2); flex-wrap:wrap; }
  .bs-viz-box {
    background:var(--surface-2); border:1px solid var(--border);
    border-radius:var(--r-md); padding:var(--sp-1) var(--sp-3); font-size:.8rem; color:var(--text);
  }
  .bs-viz-box.bs-round { border-radius:var(--r-pill); }
  .bs-viz-arrow { color:var(--text-dim); }
  .bs-viz-arrow-back { color:var(--warn-fg); }
  .bs-viz-tree { display:flex; flex-direction:column; gap:var(--sp-2); align-items:center; }
  .bs-viz-children { justify-content:center; }
  .bs-viz-screen { border:1px solid var(--border); border-radius:var(--r-lg); padding:var(--sp-2); background:var(--surface-2); }
  .bs-viz-screen-header { height:.7rem; background:var(--border-strong); border-radius:3px; margin-bottom:var(--sp-2); width:40%; }
  .bs-viz-screen-block { height:1.2rem; background:var(--border); border-radius:3px; margin-bottom:var(--sp-1); }
  .bs-viz-screen-block-short { width:60%; margin-bottom:0; }
`;

// ── page assembly ────────────────────────────────────────────────────────────
const renderBrainstormHtml = (data, { sourcePath = '' } = {}) => {
  // Tolerate a non-object top-level: preserve the raw value under Other fields
  // rather than throwing, so `{}`, arrays, and scalars all still render a page.
  const isObj = isPlainObject(data);
  const d = isObj ? data : {};
  const consumed = new Set();

  const readHeaderField = (key) => {
    const v = d[key];
    if (!isScalar(v)) return '';
    consumed.add(key);
    return v != null ? String(v) : '';
  };
  const title = readHeaderField('title') || 'Brainstorm';
  const problem = readHeaderField('problem');

  const approachesIsArray = Array.isArray(d.approaches);
  if (approachesIsArray) consumed.add('approaches');
  const approaches = approachesIsArray ? d.approaches : [];

  const recommendedIsObj = isPlainObject(d.recommendedDefault);
  if (recommendedIsObj) consumed.add('recommendedDefault');

  // Each entry drives both a rendered <section> (with a stable slug id) and the
  // matching TOC chip that anchors it - reference-with-referent by construction.
  const sections = [];
  const pushSection = (heading, body) => sections.push({ heading, body });

  if (approaches.length) {
    pushSection('Side-by-side', renderTradeoffTable(approaches));
    pushSection('Approaches', approaches.map((a, i) => renderApproachCard(a, i)).join('\n'));
  } else if (approachesIsArray) {
    pushSection('Approaches', '<p class="kit-p bs-muted">No approaches provided.</p>');
  }

  if (recommendedIsObj) {
    pushSection('Recommendation', renderRecommended(d.recommendedDefault, approaches));
  }

  // Fall-through: every unclaimed top-level key (e.g. _meta, rivalPass) renders
  // through the kit's smart-value definition lists - humanized labels, nested
  // lists/cards, never a raw JSON <pre> dump.
  const otherEntries = isObj ? Object.entries(d).filter(([k]) => !consumed.has(k)) : [['value', data]];
  if (otherEntries.length) {
    pushSection('Other fields', kvCard(Object.fromEntries(otherEntries)));
  }

  const tocChips = sections
    .map(
      (s) => `<a class="kit-chip kit-chip-strong" href="#${slugify(s.heading)}">${escapeHtml(s.heading)}</a>`,
    )
    .join('');

  const sectionsHtml =
    `<style>${BRAINSTORM_STYLE}</style>\n` + sections.map((s) => section(s.heading, s.heading, s.body)).join('\n');

  const metabar = approaches.length
    ? `\n<div class="kit-metabar">${chip(`${approaches.length} approaches`, 'kit-chip-strong')}</div>`
    : '';
  const headerHtml =
    `<h1>${escapeHtml(title)}</h1>` + (problem ? `\n<p class="kit-sub">${escapeHtml(problem)}</p>` : '') + metabar;

  const footerSource = sourcePath ? `Generated from <code class="kit-code">${escapeHtml(sourcePath)}</code> &middot; ` : '';
  const footerHtml = `${footerSource}brainstorm.json is the source of truth &mdash; this page is generated from it.`;

  return pageShell({ title, headerHtml, tocChips, sectionsHtml, footerHtml });
};

// ── CLI ──────────────────────────────────────────────────────────────────────
const HELP =
  'render-brainstorm - deterministic brainstorm.json -> brainstorm.html renderer\n\n' +
  'Usage: node scripts/render-brainstorm.js <path-to-brainstorm.json> [outfile]\n' +
  '       node scripts/render-brainstorm.js --help\n\n' +
  'Writes brainstorm.html beside the input file (or to [outfile] when given).\n' +
  'Exit 0 on success; missing arg / unreadable file / invalid JSON -> exit 2\n' +
  '(VALIDATION_ERROR).\n';

const run = (argv) => {
  const args = argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    process.stdout.write(HELP);
    return;
  }

  const positional = args.filter((a) => a !== '--help' && a !== '-h');
  const input = positional[0];
  const outfile = positional[1];
  if (!input) {
    throw new PhantomError('missing required <path-to-brainstorm.json> argument', VALIDATION_ERROR, [
      'node scripts/render-brainstorm.js <path-to-brainstorm.json> [outfile]',
    ]);
  }

  let raw;
  try {
    raw = fs.readFileSync(input, 'utf8');
  } catch (err) {
    throw new PhantomError(`cannot read brainstorm file: ${input} (${err.code || err.message})`, VALIDATION_ERROR, [
      'check the path exists and is readable',
    ]);
  }

  let data;
  try {
    data = JSON.parse(raw);
  } catch (err) {
    throw new PhantomError(`invalid JSON in ${input}: ${err.message}`, VALIDATION_ERROR, [
      'brainstorm.json must be valid JSON',
    ]);
  }

  const html = renderBrainstormHtml(data, { sourcePath: input });
  const target = outfile || path.join(path.dirname(input), 'brainstorm.html');
  fs.writeFileSync(target, html);
  process.stdout.write(`wrote ${target}\n`);
};

module.exports = { renderBrainstormHtml, escapeHtml, run };

if (require.main === module) {
  try {
    run(process.argv);
  } catch (err) {
    reportError(err);
  }
}
