// Author: Subash Karki
// html-kit.js - the shared CloudZero design kit both gate renderers present
// through. render-plan.js and render-brainstorm.js each own their section logic
// but import ONE style source of truth (CZ_TOKENS) and one set of HTML
// primitives from here, so the two artifacts read as one branded document set.
//
// Design contract (inherited from the renderers this kit factors out of):
//  - Tolerant, never-throw: every helper accepts whatever the caller passes and
//    renders something visible. Bad input is shown, not swallowed, and never
//    raises - the error taxonomy (scripts/lib/axi-error.js) lives in the CLIs,
//    not here.
//  - Escaping is load-bearing: every UNTRUSTED string is HTML-escaped before it
//    is interpolated, and untrusted text never lands inside a class attribute
//    (badge maps a value to a class via a caller-supplied classMap; chip's `cls`
//    is caller-controlled, its text is escaped).
//  - Deterministic: no Date, no Math.random, no key sorting. Object entries
//    iterate in insertion order; two calls on the same input are byte-identical.
//  - Self-contained: CZ_TOKENS carries both the token sheet AND the component
//    CSS for these primitives, with zero external requests (no web fonts, no
//    @import, no URLs) so a consumer inlines exactly one <style>.
'use strict';

// ── escaping + shape helpers (single canonical copies) ───────────────────────
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
const isScalar = (v) => v == null || typeof v !== 'object';
// A present, scalar, non-empty field - the recurring "is there a real value to
// render" guard both renderers lean on.
const isNonEmptyScalar = (v) => v != null && isScalar(v) && String(v) !== '';

// ── key humanization + slugs ─────────────────────────────────────────────────
// Sentence-case a raw field key: underscores/hyphens and camelCase boundaries
// become spaces, then the whole thing is lowercased and its first letter
// capitalized. `verified_facts` -> "Verified facts";
// `how_to_send_otel_from_claude_code` -> "How to send otel from claude code";
// `whenToPick` -> "When to pick". Purely mechanical, so labels stay deterministic
// and a raw underscore key never surfaces in the UI.
const humanizeKey = (key) => {
  const spaced = String(key)
    .replace(/[_-]+/g, ' ')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim();
  if (spaced === '') return '';
  const lower = spaced.toLowerCase();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
};

// A stable anchor slug: lowercase, non-alphanumeric runs collapse to a single
// hyphen, edges trimmed. Derived from the humanized title so `verified_facts` and
// "Verified facts" both yield `verified-facts` and no raw key ever leaks into an
// id. The output is inherently attribute-safe ([a-z0-9-] only).
const slugify = (text) =>
  humanizeKey(text)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

// ── primitives ───────────────────────────────────────────────────────────────
// A pill. `text` is untrusted (escaped); `cls` is a caller-controlled extra
// class, never derived from untrusted input.
const chip = (text, cls = '') =>
  `<span class="kit-chip${cls ? ' ' + cls : ''}">${escapeHtml(text)}</span>`;

// A status pill. The untrusted `value` is displayed (escaped) but NEVER
// interpolated into the class name - the class is looked up from `classMap` by
// the value's normalized form; an unmapped value stays neutral. `label` is an
// optional caller-supplied prefix (e.g. "Score:").
const badge = (value, label = '', classMap = {}) => {
  const key = String(value).toLowerCase().trim();
  const cls =
    classMap && Object.prototype.hasOwnProperty.call(classMap, key) ? classMap[key] : '';
  return `<span class="kit-badge${cls ? ' ' + cls : ''}">${
    label ? escapeHtml(label) + ' ' : ''
  }${escapeHtml(value)}</span>`;
};

// A callout box. `html` is ALREADY-RENDERED markup (the caller escaped its
// content), so it is not re-escaped here. `tone` selects a status treatment;
// anything outside the known set is neutral.
const CALLOUT_TONES = new Set(['info', 'warn', 'error', 'success']);
const callout = (html, tone = '') => {
  const t = CALLOUT_TONES.has(tone) ? tone : '';
  return `<div class="kit-callout${t ? ' kit-callout-' + t : ''}">${html}</div>`;
};

// A titled section with a stable slug id and a sentence-case <h2>. `id` is
// slugified (so a raw underscore key can be passed and still emits a clean
// anchor); `title` is displayed as given (escaped). `bodyHtml` is pre-rendered.
const section = (id, title, bodyHtml) =>
  `<section id="${slugify(id || title)}" class="kit-section">` +
  `<h2 class="kit-h2">${escapeHtml(title)}</h2>${bodyHtml}</section>`;

// One key/value row: the key becomes a humanized sentence-case label, the value
// is rendered via smartValue so a paragraph-length string, a list, or a nested
// object all read gracefully.
const kvRow = (key, value) =>
  `<div class="kit-kv-row"><div class="kit-kv-key">${escapeHtml(humanizeKey(key))}</div>` +
  `<div class="kit-kv-val">${smartValue(value)}</div></div>`;

// A definition-of-done / evidence list. Scalar items render as text; a
// structured item is rendered readably (never a raw JSON wall).
const checklist = (items) => {
  const list = Array.isArray(items) ? items : [];
  return `<ul class="kit-checklist">${list
    .map((it) => `<li>${isScalar(it) ? escapeHtml(it) : smartValue(it)}</li>`)
    .join('')}</ul>`;
};

// A card of key/value rows for an object (decision items, estimate fields, ...).
// kv rows - not a stat strip - because real values are paragraph-length.
const kvCard = (entries) => {
  const obj = isPlainObject(entries) ? entries : {};
  const rows = Object.entries(obj)
    .map(([k, v]) => kvRow(k, v))
    .join('');
  return `<div class="kit-card">${rows}</div>`;
};

// The universal fall-through renderer: turn any value into readable HTML.
//  - scalar            -> escaped text
//  - scalar array      -> bulleted list
//  - array of objects  -> one card per object
//  - object            -> definition-list card with humanized keys
//  - depth >= 4         -> escaped pretty JSON in an overflow-x:auto wrapper
// `depth` is the current nesting level; descending increments it, and once we
// reach 4 we stop humanizing and dump JSON so deeply-nested blobs stay bounded
// and visible rather than exploding into unreadable nested cards.
const smartValue = (value, depth = 0) => {
  if (isScalar(value)) return escapeHtml(value == null ? '' : value);
  if (depth >= 4) {
    return `<div class="kit-pre-wrap"><pre class="kit-pre">${escapeHtml(
      JSON.stringify(value, null, 2),
    )}</pre></div>`;
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return '';
    if (value.every(isScalar)) {
      return `<ul class="kit-list">${value
        .map((v) => `<li>${escapeHtml(v == null ? '' : v)}</li>`)
        .join('')}</ul>`;
    }
    // Mixed/object arrays: render each element (objects become cards, scalars
    // become their escaped text) so nothing is dropped and nothing is dumped raw.
    return value.map((v) => smartValue(v, depth + 1)).join('');
  }
  const rows = Object.entries(value)
    .map(
      ([k, v]) =>
        `<div class="kit-kv-row"><div class="kit-kv-key">${escapeHtml(humanizeKey(k))}</div>` +
        `<div class="kit-kv-val">${smartValue(v, depth + 1)}</div></div>`,
    )
    .join('');
  return `<div class="kit-card">${rows}</div>`;
};

// Deterministic prose formatter for long body strings. Blank-line-separated
// chunks become <p> paragraphs. A chunk carrying two or more inline enumeration
// markers of the form "(1) " "(2) " is rendered as an <ol>, one <li> per marker,
// markers stripped and order preserved - purely mechanical, no other inference,
// so output stays byte-deterministic. Any text before the first marker is kept
// as a lead paragraph rather than folded into the first list item. Everything is
// escaped before it is wrapped.
const ENUM_MARKER = /\(\d+\)\s/g;
const prose = (text) => {
  const str = String(text == null ? '' : text);
  if (str.trim() === '') return '';
  const chunks = str
    .split(/\n\s*\n/)
    .map((c) => c.trim())
    .filter((c) => c !== '');
  return chunks
    .map((chunk) => {
      const markers = chunk.match(ENUM_MARKER) || [];
      if (markers.length >= 2) {
        const parts = chunk.split(ENUM_MARKER);
        const preamble = parts.shift().trim();
        const items = parts.map((p) => p.trim()).filter((p) => p !== '');
        const lead = preamble ? `<p class="kit-p">${escapeHtml(preamble)}</p>` : '';
        const lis = items.map((it) => `<li>${escapeHtml(it)}</li>`).join('');
        return `${lead}<ol class="kit-ol">${lis}</ol>`;
      }
      return `<p class="kit-p">${escapeHtml(chunk)}</p>`;
    })
    .join('\n');
};

// ── token + component sheet ──────────────────────────────────────────────────
// CloudZero visual identity. Light theme is the default (:root); dark theme is
// applied when the OS prefers it (unless an explicit light toggle wins) AND when
// a viewer stamps data-theme="dark". The two dark blocks are interpolated from
// one source so they can never drift. system font stacks only - Poppins can't
// ship under the zero-request rule, system-ui is the accepted brand degradation.
const LIGHT_VARS = `
    --bg:#fafafa; --surface:#ffffff; --surface-2:#f4f4f5;
    --border:#e4e4e7; --border-strong:#d4d4d8;
    --text:#18181b; --text-muted:#52525b; --text-dim:#71717a;
    --brand-teal:#7FC2C8; --brand-navy:#002E44;
    --heading:#002E44; --link:#0f5f73; --primary:#FE542E;
    --info-fg:#075985; --info-bg:#f0f9ff; --info-border:#bae6fd;
    --warn-fg:#92400e; --warn-bg:#fffbeb; --warn-border:#fde68a;
    --error-fg:#991b1b; --error-bg:#fef2f2; --error-border:#fecaca;
    --success-fg:#166534; --success-bg:#f0fdf4; --success-border:#bbf7d0;
    --shadow-sm:0 1px 2px rgba(0,46,68,.06);
    --shadow-card:0 1px 3px rgba(0,46,68,.08),0 1px 2px rgba(0,46,68,.05);
    --shadow-lg:0 6px 20px rgba(0,46,68,.12);`;

const DARK_VARS = `
    --bg:#0b1417; --surface:#101f26; --surface-2:#182a32;
    --border:#243740; --border-strong:#2f4650;
    --text:#eef2f4; --text-muted:#9fb1ba; --text-dim:#7c9099;
    --brand-teal:#7FC2C8; --brand-navy:#002E44;
    --heading:#bfeaee; --link:#7FC2C8; --primary:#FE542E;
    --info-fg:#7dd3fc; --info-bg:rgba(56,189,248,.10); --info-border:rgba(56,189,248,.30);
    --warn-fg:#fcd34d; --warn-bg:rgba(251,191,36,.10); --warn-border:rgba(251,191,36,.30);
    --error-fg:#fca5a5; --error-bg:rgba(248,113,113,.10); --error-border:rgba(248,113,113,.30);
    --success-fg:#86efac; --success-bg:rgba(74,222,128,.10); --success-border:rgba(74,222,128,.30);
    --shadow-sm:0 1px 2px rgba(0,0,0,.4);
    --shadow-card:0 1px 3px rgba(0,0,0,.5),0 1px 2px rgba(0,0,0,.4);
    --shadow-lg:0 6px 20px rgba(0,0,0,.55);`;

const CZ_TOKENS = `
  :root {${LIGHT_VARS}
    --sp-1:4px; --sp-2:8px; --sp-3:12px; --sp-4:16px; --sp-5:20px; --sp-6:24px; --sp-8:32px;
    --r-md:6px; --r-lg:8px; --r-card:16px; --r-pill:9999px;
    --font-sans:system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;
    --font-mono:ui-monospace,'SF Mono',Menlo,Consolas,'Liberation Mono',monospace;
  }
  @media (prefers-color-scheme:dark) {
    :root:not([data-theme="light"]) {${DARK_VARS}}
  }
  :root[data-theme="dark"] {${DARK_VARS}}

  * { box-sizing:border-box; }
  html { -webkit-text-size-adjust:100%; }
  body {
    margin:0; background:var(--bg); color:var(--text);
    font-family:var(--font-sans); font-size:16px; line-height:1.65;
    -webkit-font-smoothing:antialiased; text-rendering:optimizeLegibility;
  }
  a { color:var(--link); text-decoration:none; }
  a:hover { text-decoration:underline; }
  code, pre { font-family:var(--font-mono); }

  .kit-topbar {
    position:sticky; top:0; z-index:10;
    background:var(--surface); border-bottom:1px solid var(--border);
    box-shadow:var(--shadow-sm); padding:var(--sp-4) var(--sp-6);
  }
  .kit-topbar h1 {
    font-size:1.375rem; line-height:1.3; margin:0; color:var(--heading);
    letter-spacing:-.01em; overflow-wrap:anywhere;
  }
  .kit-sub { color:var(--text-muted); font-size:.95rem; margin:var(--sp-2) 0 0; overflow-wrap:anywhere; }
  .kit-metabar { display:flex; gap:var(--sp-2); flex-wrap:wrap; align-items:center; margin-top:var(--sp-3); }
  .kit-toc { display:flex; gap:var(--sp-2); flex-wrap:wrap; margin-top:var(--sp-3); }

  .kit-main { max-width:76ch; margin:0 auto; padding:var(--sp-8) var(--sp-6); }

  .kit-section { margin:0 0 var(--sp-8); }
  .kit-section:last-child { margin-bottom:0; }
  .kit-h2 {
    font-size:1.15rem; font-weight:650; color:var(--heading);
    margin:0 0 var(--sp-4); padding-bottom:var(--sp-2);
    border-bottom:1px solid var(--border); scroll-margin-top:5rem;
  }
  .kit-section h3 { font-size:1rem; font-weight:600; margin:0 0 var(--sp-2); color:var(--text); }
  .kit-p { margin:0 0 var(--sp-3); overflow-wrap:anywhere; }
  .kit-p:last-child { margin-bottom:0; }
  .kit-ol { margin:0 0 var(--sp-3) 1.35rem; padding:0; }
  .kit-list { margin:0 0 var(--sp-3) 1.35rem; padding:0; }
  .kit-ol li, .kit-list li { margin:var(--sp-1) 0; overflow-wrap:anywhere; }

  .kit-chip {
    display:inline-block; padding:2px 10px; border-radius:var(--r-pill);
    font-size:.75rem; font-weight:600; font-family:var(--font-mono); line-height:1.5;
    background:var(--surface-2); border:1px solid var(--border); color:var(--text-muted);
    white-space:nowrap;
  }
  .kit-chip-strong { color:var(--text); border-color:var(--border-strong); }
  .kit-chip-brand { color:var(--heading); background:rgba(127,194,200,.18); border-color:var(--brand-teal); }
  .kit-chip-primary { color:var(--primary); background:rgba(254,84,46,.08); border-color:var(--primary); }

  .kit-badge {
    display:inline-block; padding:2px 10px; border-radius:var(--r-pill);
    font-size:.72rem; font-weight:600; letter-spacing:.01em; line-height:1.5;
    background:var(--surface-2); border:1px solid var(--border); color:var(--text-muted);
  }
  .kit-badge-info { color:var(--info-fg); background:var(--info-bg); border-color:var(--info-border); }
  .kit-badge-warn { color:var(--warn-fg); background:var(--warn-bg); border-color:var(--warn-border); }
  .kit-badge-error { color:var(--error-fg); background:var(--error-bg); border-color:var(--error-border); }
  .kit-badge-success { color:var(--success-fg); background:var(--success-bg); border-color:var(--success-border); }

  .kit-callout {
    background:var(--surface-2); border:1px solid var(--border);
    border-left:3px solid var(--border-strong); border-radius:var(--r-lg);
    padding:var(--sp-3) var(--sp-4); margin:0 0 var(--sp-3); overflow-wrap:anywhere;
  }
  .kit-callout > :last-child { margin-bottom:0; }
  .kit-callout-info { border-left-color:var(--info-fg); background:var(--info-bg); color:var(--info-fg); }
  .kit-callout-warn { border-left-color:var(--warn-fg); background:var(--warn-bg); color:var(--warn-fg); }
  .kit-callout-error { border-left-color:var(--error-fg); background:var(--error-bg); color:var(--error-fg); }
  .kit-callout-success { border-left-color:var(--success-fg); background:var(--success-bg); color:var(--success-fg); }

  .kit-card {
    background:var(--surface); border:1px solid var(--border); border-radius:var(--r-card);
    padding:var(--sp-4) var(--sp-5); margin:0 0 var(--sp-3); box-shadow:var(--shadow-card);
  }
  .kit-card:last-child { margin-bottom:0; }

  .kit-kv-row { padding:var(--sp-2) 0; border-bottom:1px solid var(--border); }
  .kit-kv-row:first-child { padding-top:0; }
  .kit-kv-row:last-child { padding-bottom:0; border-bottom:none; }
  .kit-kv-key { font-size:.8rem; font-weight:600; color:var(--text-dim); margin-bottom:var(--sp-1); }
  .kit-kv-val { font-size:.95rem; color:var(--text); overflow-wrap:anywhere; }
  .kit-kv-val > :last-child { margin-bottom:0; }

  .kit-checklist { list-style:none; margin:0 0 var(--sp-3); padding:0; }
  .kit-checklist li {
    padding:var(--sp-2) 0; border-bottom:1px solid var(--border);
    font-size:.95rem; overflow-wrap:anywhere;
  }
  .kit-checklist li:last-child { border-bottom:none; }
  .kit-checklist li::before { content:'\\2713'; color:var(--brand-teal); font-weight:700; margin-right:var(--sp-2); }

  .kit-scroll { overflow-x:auto; }
  .kit-pre-wrap { overflow-x:auto; border:1px solid var(--border); border-radius:var(--r-md); background:var(--surface-2); }
  .kit-pre { margin:0; padding:var(--sp-3) var(--sp-4); font-size:.82rem; line-height:1.5; white-space:pre; }
  .kit-code {
    background:var(--surface-2); border:1px solid var(--border);
    border-radius:var(--r-md); padding:1px 6px; font-size:.85em; overflow-wrap:anywhere;
  }

  .kit-footer {
    max-width:76ch; margin:0 auto; padding:var(--sp-6);
    border-top:1px solid var(--border); color:var(--text-dim); font-size:.85rem; text-align:center;
  }
`;

// ── document skeleton ────────────────────────────────────────────────────────
// Full self-contained page: sticky top bar (header + optional TOC chips), a
// centered 76ch content column, and an optional footer. `title` is escaped here;
// every *Html argument is pre-rendered markup the caller already escaped. The
// single inlined <style> is CZ_TOKENS - one source of truth for both consumers.
const pageShell = ({
  title = '',
  headerHtml = '',
  tocChips = '',
  sectionsHtml = '',
  footerHtml = '',
} = {}) =>
  `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(title)}</title>
<style>${CZ_TOKENS}</style>
</head>
<body>
<header class="kit-topbar">
${headerHtml}${tocChips ? `\n<nav class="kit-toc">${tocChips}</nav>` : ''}
</header>
<main class="kit-main">
${sectionsHtml}
</main>${footerHtml ? `\n<footer class="kit-footer">${footerHtml}</footer>` : ''}
</body>
</html>
`;

module.exports = {
  CZ_TOKENS,
  escapeHtml,
  isPlainObject,
  isScalar,
  isNonEmptyScalar,
  humanizeKey,
  slugify,
  chip,
  badge,
  callout,
  section,
  kvRow,
  checklist,
  kvCard,
  smartValue,
  prose,
  pageShell,
};
