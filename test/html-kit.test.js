// Author: Subash Karki
// html-kit.test.js - unit coverage for the shared CZ design kit
// (scripts/lib/html-kit.js): escaping, shape guards, key humanization + slugs,
// every primitive (chip/badge/callout/section/kvRow/checklist/kvCard), the
// universal smartValue renderer across scalar/array/object/nested/depth-cap
// shapes, the deterministic prose formatter, pageShell document assembly, and
// the self-containment of the token sheet. Conventions match
// test/render-plan.test.js: node:test + node:assert/strict, no mocks.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const kit = require('../scripts/lib/html-kit');

// ── escaping ─────────────────────────────────────────────────────────────────

test('escapeHtml: neutralizes the five breakout characters, & first', () => {
  assert.equal(
    kit.escapeHtml(`<script>"x" & 'y'</script>`),
    '&lt;script&gt;&quot;x&quot; &amp; &#39;y&#39;&lt;/script&gt;',
  );
  // & first so we never double-escape an entity we just introduced.
  assert.equal(kit.escapeHtml('&lt;'), '&amp;lt;');
  assert.equal(kit.escapeHtml(42), '42');
  assert.equal(kit.escapeHtml(null), 'null');
});

// ── shape guards ─────────────────────────────────────────────────────────────

test('shape guards: isPlainObject / isScalar / isNonEmptyScalar', () => {
  assert.equal(kit.isPlainObject({}), true);
  assert.equal(kit.isPlainObject([]), false);
  assert.equal(kit.isPlainObject(null), false);
  assert.equal(kit.isScalar('x'), true);
  assert.equal(kit.isScalar(null), true);
  assert.equal(kit.isScalar({}), false);
  assert.equal(kit.isNonEmptyScalar('x'), true);
  assert.equal(kit.isNonEmptyScalar(''), false);
  assert.equal(kit.isNonEmptyScalar(null), false);
  assert.equal(kit.isNonEmptyScalar({}), false);
});

// ── key humanization + slugs ─────────────────────────────────────────────────

test('humanizeKey: sentence-case from underscore and camelCase keys', () => {
  assert.equal(kit.humanizeKey('verified_facts'), 'Verified facts');
  assert.equal(
    kit.humanizeKey('how_to_send_otel_from_claude_code'),
    'How to send otel from claude code',
  );
  assert.equal(kit.humanizeKey('whenToPick'), 'When to pick');
  assert.equal(kit.humanizeKey('decisions-for-approval'), 'Decisions for approval');
});

test('slugify: hyphenated lowercase anchor, never the raw underscore key', () => {
  assert.equal(kit.slugify('verified_facts'), 'verified-facts');
  assert.equal(kit.slugify('Verified facts'), 'verified-facts');
  assert.equal(kit.slugify('Decisions for approval'), 'decisions-for-approval');
  // Attribute-safe: only [a-z0-9-] survives, so it is inert in id="".
  assert.match(kit.slugify('<script>x</script>'), /^[a-z0-9-]*$/);
});

// ── chip / badge ─────────────────────────────────────────────────────────────

test('chip: escapes untrusted text, appends caller class verbatim', () => {
  assert.equal(kit.chip('opus', 'kit-chip-brand'), '<span class="kit-chip kit-chip-brand">opus</span>');
  assert.ok(kit.chip('<x>').includes('&lt;x&gt;'));
});

test('badge: untrusted value is displayed but never lands in the class name', () => {
  const map = { proceed: 'kit-badge-success' };
  assert.equal(
    kit.badge('proceed', 'Verdict:', map),
    '<span class="kit-badge kit-badge-success">Verdict: proceed</span>',
  );
  // Unmapped value -> neutral class; the value itself is escaped, not in class.
  const evil = kit.badge('"><b>pwn</b>', '', map);
  assert.ok(evil.includes('&quot;&gt;&lt;b&gt;pwn'));
  assert.ok(!evil.includes('class="kit-badge "'));
  assert.equal((evil.match(/class="/g) || []).length, 1);
});

// ── callout ──────────────────────────────────────────────────────────────────

test('callout: known tone -> variant class, unknown tone -> neutral', () => {
  assert.equal(kit.callout('<p>hi</p>', 'warn'), '<div class="kit-callout kit-callout-warn"><p>hi</p></div>');
  assert.equal(kit.callout('<p>hi</p>', 'bogus'), '<div class="kit-callout"><p>hi</p></div>');
  assert.equal(kit.callout('<p>hi</p>'), '<div class="kit-callout"><p>hi</p></div>');
});

// ── section ──────────────────────────────────────────────────────────────────

test('section: stable slug id + sentence-case h2, raw key never in id', () => {
  const html = kit.section('verified_facts', 'Verified facts', '<p>body</p>');
  assert.ok(html.includes('id="verified-facts"'), 'slug id');
  assert.ok(!html.includes('verified_facts'), 'raw underscore key absent');
  assert.ok(html.includes('<h2 class="kit-h2">Verified facts</h2>'));
  assert.ok(html.includes('<p>body</p>'));
});

// ── kvRow / kvCard ───────────────────────────────────────────────────────────

test('kvRow: humanized key label + value', () => {
  const html = kit.kvRow('when_to_pick', 'a long paragraph value that should wrap');
  assert.ok(html.includes('When to pick'));
  assert.ok(html.includes('a long paragraph value'));
  assert.ok(!html.includes('when_to_pick'));
});

test('kvCard: object rows in insertion order; tolerates non-object', () => {
  const html = kit.kvCard({ question: 'q', recommendation: 'r' });
  assert.ok(html.indexOf('Question') < html.indexOf('Recommendation'), 'insertion order preserved');
  assert.equal(kit.kvCard('nope'), '<div class="kit-card"></div>');
});

// ── checklist ────────────────────────────────────────────────────────────────

test('checklist: scalar items escaped; structured items rendered readably', () => {
  const html = kit.checklist(['a < b', { k: 'v' }]);
  assert.ok(html.includes('a &lt; b'));
  assert.ok(html.includes('kit-checklist'));
  assert.ok(html.includes('K'), 'nested object humanized, not JSON-dumped');
  assert.ok(!/<pre[^>]*>\s*\{/.test(html), 'no raw JSON wall');
});

// ── smartValue ───────────────────────────────────────────────────────────────

test('smartValue: scalar -> escaped text', () => {
  assert.equal(kit.smartValue('a < b'), 'a &lt; b');
  assert.equal(kit.smartValue(null), '');
  assert.equal(kit.smartValue(7), '7');
});

test('smartValue: scalar array -> bulleted list', () => {
  const html = kit.smartValue(['one', 'two']);
  assert.ok(html.includes('<ul class="kit-list">'));
  assert.ok(html.includes('<li>one</li>') && html.includes('<li>two</li>'));
});

test('smartValue: array of objects -> one card per object', () => {
  const html = kit.smartValue([{ a: 1 }, { b: 2 }]);
  assert.equal((html.match(/kit-card/g) || []).length, 2);
});

test('smartValue: object -> humanized definition-list card', () => {
  const html = kit.smartValue({ verified_facts: ['x'], nested_thing: { a: 1 } });
  assert.ok(html.includes('Verified facts'));
  assert.ok(html.includes('Nested thing'));
  assert.ok(!html.includes('verified_facts'), 'raw key never shown');
});

test('smartValue: depth cap at 4 -> escaped JSON in an overflow-x wrapper', () => {
  const deep = { a: { b: { c: { d: { e: 'floor' } } } } };
  const html = kit.smartValue(deep);
  assert.ok(html.includes('kit-pre-wrap'), 'wrapper present at the cap');
  assert.ok(html.includes('kit-pre'));
  // Shallow levels stay as humanized cards, not JSON.
  assert.ok(html.includes('kit-card'));
});

test('smartValue: deterministic - two calls are byte-identical', () => {
  const v = { verified_facts: ['x'], n: { a: 1, b: [1, 2] } };
  assert.equal(kit.smartValue(v), kit.smartValue(v));
});

// ── prose ────────────────────────────────────────────────────────────────────

test('prose: blank-line chunks become paragraphs', () => {
  const html = kit.prose('first para\n\nsecond para');
  assert.equal((html.match(/<p class="kit-p">/g) || []).length, 2);
  assert.ok(html.includes('first para') && html.includes('second para'));
});

test('prose: 2+ inline (n) markers become an ordered list, markers stripped', () => {
  const html = kit.prose('intro (1) first thing; (2) second thing');
  assert.ok(html.includes('<ol class="kit-ol">'));
  assert.ok(html.includes('<li>first thing;</li>'));
  assert.ok(html.includes('<li>second thing</li>'));
  assert.ok(html.includes('<p class="kit-p">intro</p>'), 'preamble kept as lead paragraph');
  assert.ok(!html.includes('(1)') && !html.includes('(2)'), 'markers stripped');
});

test('prose: a single marker is NOT enough to trigger a list', () => {
  const html = kit.prose('only (1) one marker here');
  assert.ok(!html.includes('<ol'));
  assert.ok(html.includes('<p class="kit-p">'));
});

test('prose: escapes before wrapping and is empty-safe', () => {
  assert.ok(kit.prose('<script>').includes('&lt;script&gt;'));
  assert.equal(kit.prose(''), '');
  assert.equal(kit.prose(null), '');
});

// ── pageShell ────────────────────────────────────────────────────────────────

test('pageShell: self-contained document with sticky bar and escaped title', () => {
  const html = kit.pageShell({
    title: 'Plan <X>',
    headerHtml: '<h1>Heading</h1>',
    tocChips: '<a href="#s">s</a>',
    sectionsHtml: '<section id="s">body</section>',
    footerHtml: 'source of truth',
  });
  assert.ok(html.startsWith('<!DOCTYPE html>'));
  assert.ok(html.includes('<title>Plan &lt;X&gt;</title>'), 'title escaped');
  assert.ok(html.includes('<style>'), 'one inlined style');
  assert.ok(html.includes('kit-topbar') && html.includes('kit-main'));
  assert.ok(html.includes('<footer class="kit-footer">source of truth</footer>'));
  assert.ok(!/https?:\/\//.test(html), 'no external URLs');
  assert.ok(!html.includes('<link') && !html.includes('src='), 'no external assets');
});

test('pageShell: omits the footer and toc nav when not provided', () => {
  const html = kit.pageShell({ title: 't', sectionsHtml: '<p>x</p>' });
  // The class names live in the always-inlined stylesheet; assert the ELEMENTS
  // are absent, not the class strings.
  assert.ok(!html.includes('<footer'));
  assert.ok(!html.includes('<nav'));
  assert.ok(html.startsWith('<!DOCTYPE html>'));
});

// ── token-sheet self-containment ─────────────────────────────────────────────

test('CZ_TOKENS: theme-aware, self-contained, and carries the primitive CSS', () => {
  assert.ok(kit.CZ_TOKENS.includes('prefers-color-scheme'), 'dark via media query');
  assert.ok(kit.CZ_TOKENS.includes('[data-theme="dark"]'), 'dark via data-theme override');
  assert.ok(kit.CZ_TOKENS.includes('overflow-x:auto'), 'wide content scrolls');
  assert.ok(!/https?:\/\//.test(kit.CZ_TOKENS), 'no external URLs');
  assert.ok(!kit.CZ_TOKENS.includes('@import'), 'no @import');
  // Brand tokens + the radii the contract locks.
  assert.ok(kit.CZ_TOKENS.includes('#7FC2C8') && kit.CZ_TOKENS.includes('#002E44'));
  assert.ok(kit.CZ_TOKENS.includes('--r-pill:9999px') && kit.CZ_TOKENS.includes('--r-card:16px'));
  // Field labels must not be shouty (T4 asserts this cross-renderer too).
  assert.ok(!/text-transform:\s*uppercase/.test(kit.CZ_TOKENS), 'no uppercase field labels');
  // The component CSS ships in the same sheet consumers inline.
  assert.ok(kit.CZ_TOKENS.includes('.kit-chip') && kit.CZ_TOKENS.includes('.kit-card'));
});
