// Author: Subash Karki
// render-brainstorm.test.js - golden-fixture, determinism, XSS escaping,
// missing-field tolerance, and CLI-contract coverage for
// scripts/render-brainstorm.js. Conventions match test/render-plan.test.js:
// node:test + node:assert/strict, spawnSync for the CLI harness, no mocks;
// temp fixtures under os.tmpdir().
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const SCRIPT = require.resolve('../scripts/render-brainstorm');
const { renderBrainstormHtml, escapeHtml } = require(SCRIPT);

// Three approaches: one with a visualType (flow), one without, one deliberately
// missing most spine fields (malformed-but-tolerated).
const GOLDEN_BRAINSTORM = {
  title: 'Phantom Planning Upgrade Brainstorm',
  problem: 'Plan gate and brainstorm output feel thin.',
  approaches: [
    {
      id: 'A',
      name: 'Extend & enforce',
      thesis: 'reuse-first, ship the visible win',
      description: 'Teach render-plan.js to also read intent.json.',
      whyLens: 'reuse-first stance',
      effort: 'S-M',
      risk: 'low',
      reversibility: 'cheap',
      whatBreaks: 'stricter validator could reject old plans',
      whenToPick: 'want the biggest gate-visibility gain now',
      mutualExclusivity: 'none',
      visualType: 'flow',
    },
    {
      id: 'B',
      name: 'Brainstorm parity',
      thesis: 'bring brainstorm up to planning bar',
      description: 'A canonical brainstorm renderer with a tradeoff table.',
      effort: 'M-L',
      risk: 'medium',
      reversibility: 'medium',
      whenToPick: 'brainstorm quality is the felt pain',
    },
    { id: 'C' },
  ],
  recommendedDefault: { id: 'A', reason: 'Highest-visibility fix at lowest risk.' },
};

const runCli = (args, opts = {}) => spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8', ...opts });
const mkTmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'render-brainstorm-'));

// ── golden fixture ───────────────────────────────────────────────────────────

test('golden: renders a valid, self-contained page with the brainstorm content', () => {
  const html = renderBrainstormHtml(GOLDEN_BRAINSTORM, { sourcePath: 'brainstorm.json' });

  assert.ok(html.startsWith('<!DOCTYPE html>'), 'has doctype');
  assert.ok(html.includes('<title>Phantom Planning Upgrade Brainstorm</title>'), 'title from top-level field');
  assert.ok(html.includes('<style>'), 'CSS is inlined');
  assert.ok(!/https?:\/\//.test(html), 'no external URLs - self-contained');
  assert.ok(!html.includes('<link') && !html.includes('src='), 'no external assets');
  assert.ok(html.includes('Plan gate and brainstorm output feel thin.'), 'renders problem line');
});

test('golden: side-by-side tradeoff table compares all approaches', () => {
  const html = renderBrainstormHtml(GOLDEN_BRAINSTORM, { sourcePath: 'p.json' });
  assert.ok(html.includes('<table>'), 'a comparison table is rendered');
  assert.ok(html.includes('Extend &amp; enforce') || html.includes('Extend & enforce'.replace('&', '&amp;')), 'approach A column header');
  assert.ok(html.includes('Brainstorm parity'), 'approach B column header');
  assert.ok(html.includes('Reversibility'), 'reversibility row label');
  assert.ok(html.includes('When to pick'), 'when-to-pick row label');
  assert.ok(html.includes('cheap'), 'approach A reversibility value in table');
  assert.ok(html.includes('medium'), 'approach B reversibility value in table');
});

test('golden: one card per approach with the spine fields labeled', () => {
  const html = renderBrainstormHtml(GOLDEN_BRAINSTORM, { sourcePath: 'p.json' });
  assert.ok(html.includes('reuse-first, ship the visible win'), 'thesis A');
  assert.ok(html.includes('Teach render-plan.js to also read intent.json.'), 'description A');
  assert.ok(html.includes('Why this lens'), 'whyLens label');
  assert.ok(html.includes('reuse-first stance'), 'whyLens value');
  assert.ok(html.includes('What breaks if wrong'), 'whatBreaks label');
  assert.ok(html.includes('stricter validator could reject old plans'), 'whatBreaks value');
  assert.ok(html.includes('Mutual exclusivity'), 'mutualExclusivity label');
  assert.ok(html.includes('bring brainstorm up to planning bar'), 'thesis B');
});

test('golden: visualType diagram block appears only for the approach that has it', () => {
  const html = renderBrainstormHtml(GOLDEN_BRAINSTORM, { sourcePath: 'p.json' });
  const vizBlocks = html.match(/<div class="bs-viz">/g) || [];
  assert.equal(vizBlocks.length, 1, 'exactly one diagram block rendered (approach A only)');
  assert.ok(html.includes('Flow sketch'), 'flow visual label present');
});

test('golden: recommendedDefault block highlights the chosen approach and reason', () => {
  const html = renderBrainstormHtml(GOLDEN_BRAINSTORM, { sourcePath: 'p.json' });
  assert.ok(html.includes('<h2 class="kit-h2">Recommendation</h2>'), 'recommendation section heading');
  assert.ok(html.includes('Recommended: Extend &amp; enforce') || html.includes('Recommended:'), 'recommended approach named');
  assert.ok(html.includes('Highest-visibility fix at lowest risk.'), 'reason rendered');
});

test('golden: malformed approach (missing every field but id) does not crash and still renders', () => {
  const html = renderBrainstormHtml(GOLDEN_BRAINSTORM, { sourcePath: 'p.json' });
  assert.ok(html.includes('>C<'), 'approach C id shown as heading/chip since no name');
});

// ── determinism ──────────────────────────────────────────────────────────────

test('determinism: two renders of the same input are byte-identical', () => {
  const a = renderBrainstormHtml(GOLDEN_BRAINSTORM, { sourcePath: 'p.json' });
  const b = renderBrainstormHtml(GOLDEN_BRAINSTORM, { sourcePath: 'p.json' });
  assert.equal(a, b);
});

test('determinism: no Date/timestamp leaks into output', () => {
  const html = renderBrainstormHtml(GOLDEN_BRAINSTORM, { sourcePath: 'p.json' });
  assert.ok(!/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(html), 'no ISO timestamp');
});

test('determinism: CLI run twice on same file produces identical brainstorm.html', () => {
  const dir = mkTmpDir();
  const input = path.join(dir, 'brainstorm.json');
  fs.writeFileSync(input, JSON.stringify(GOLDEN_BRAINSTORM));

  const first = runCli([input]);
  assert.equal(first.status, 0, first.stderr);
  const htmlA = fs.readFileSync(path.join(dir, 'brainstorm.html'), 'utf8');

  const second = runCli([input]);
  assert.equal(second.status, 0, second.stderr);
  const htmlB = fs.readFileSync(path.join(dir, 'brainstorm.html'), 'utf8');

  assert.equal(htmlA, htmlB);
});

// ── escaping (XSS) ───────────────────────────────────────────────────────────

test('escaping: hostile fields render inert as escaped text', () => {
  const hostile = {
    title: '<script>alert(1)</script>',
    problem: 'a & b < c > d "quote" \'apos\'',
    approaches: [
      {
        id: '"><script>bad()</script>',
        name: '<img src=x onerror=alert(2)>',
        thesis: '</style><script>pwn()</script>',
        whatBreaks: 'x & y',
        visualType: '<script>evil()</script>',
      },
    ],
    recommendedDefault: { id: 'ghost', reason: '<iframe></iframe>' },
    weird_key: '</style><script>pwn2()</script>',
  };

  const html = renderBrainstormHtml(hostile, { sourcePath: 'p.json' });

  assert.ok(!html.includes('<script>alert(1)</script>'), 'no raw script from title');
  assert.ok(!html.includes('<script>bad()</script>'), 'no raw script from approach id');
  assert.ok(!html.includes('<script>pwn()</script>'), 'no raw script from thesis');
  assert.ok(!html.includes('<script>pwn2()</script>'), 'no raw script from unknown key');
  assert.ok(!html.includes('<script>evil()</script>'), 'no raw script from visualType');
  assert.ok(!html.includes('<img src=x onerror'), 'no raw img handler');
  assert.ok(!html.includes('<iframe>'), 'no raw iframe');
  assert.ok(!html.includes('<script'), 'page contains zero script tags');

  assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'), 'title escaped');
  assert.ok(html.includes('&amp;'), 'ampersand escaped');
  assert.ok(html.includes('&quot;') && html.includes('&#39;'), 'quotes escaped');
});

// ── missing-field tolerance ──────────────────────────────────────────────────

test('tolerance: an empty {} document still renders a full page', () => {
  const html = renderBrainstormHtml({}, { sourcePath: 'p.json' });
  assert.ok(html.startsWith('<!DOCTYPE html>'));
  assert.ok(html.includes('<title>Brainstorm</title>'), 'falls back to generic title');
  assert.ok(html.includes('brainstorm.json is the source of truth'));
});

test('tolerance: non-object top-level is preserved under Other fields, never thrown', () => {
  const html = renderBrainstormHtml(42, { sourcePath: 'p.json' });
  assert.ok(html.includes('Other fields'));
  assert.ok(html.includes('42'));
});

test('tolerance: empty approaches array renders a muted note, not a crash', () => {
  const html = renderBrainstormHtml({ title: 'T', approaches: [] }, { sourcePath: 'p.json' });
  assert.ok(html.includes('No approaches provided.'));
  assert.ok(!html.includes('<table>'), 'no tradeoff table with zero approaches');
});

test('tolerance: non-object approach entry (a bare string) renders without throwing', () => {
  const html = renderBrainstormHtml({ approaches: ['just-a-string', { id: 'X' }] }, { sourcePath: 'p.json' });
  assert.ok(html.includes('just-a-string'));
  assert.ok(html.includes('>X<'));
});

test('tolerance: malformed recommendedDefault (a string, not an object) falls through to Other fields', () => {
  const html = renderBrainstormHtml({ recommendedDefault: 'A' }, { sourcePath: 'p.json' });
  assert.ok(!html.includes('Recommendation</h2>'), 'dedicated section did not render');
  assert.ok(html.includes('Other fields'));
  assert.ok(html.includes('Recommended default'), 'humanized key surfaces under Other fields');
});

test('tolerance: recommendedDefault pointing at an unknown id still shows the id and reason', () => {
  const html = renderBrainstormHtml(
    { approaches: [{ id: 'A' }], recommendedDefault: { id: 'ghost', reason: 'chosen anyway' } },
    { sourcePath: 'p.json' },
  );
  assert.ok(html.includes('ghost'), 'unresolved id still shown');
  assert.ok(html.includes('chosen anyway'), 'reason still shown');
});

test('tolerance: recommendedDefault.reason as an array falls through and still surfaces its content', () => {
  const html = renderBrainstormHtml(
    {
      approaches: [{ id: 'A' }],
      recommendedDefault: { id: 'A', reason: ['point one', 'point two'] },
    },
    { sourcePath: 'p.json' },
  );
  assert.ok(html.includes('point one'), 'first reason point shown');
  assert.ok(html.includes('point two'), 'second reason point shown');
  assert.ok(html.includes('Reason'), 'humanized reason label shown for the fall-through row');
});

test('malformed: unknown visualType value falls back to a generic sketch, never crashes', () => {
  const html = renderBrainstormHtml({ approaches: [{ id: 'A', visualType: 'holograph' }] }, { sourcePath: 'p.json' });
  assert.ok(html.includes('<div class="bs-viz">'), 'a viz block is still rendered');
  assert.ok(html.includes('holograph sketch'), 'unknown type escaped into a generic label');
});

test('tolerance: approach.visualType as an object falls through and still surfaces its content', () => {
  const html = renderBrainstormHtml(
    { approaches: [{ id: 'A', visualType: { kind: 'flow', detail: 'custom' } }] },
    { sourcePath: 'p.json' },
  );
  assert.ok(html.includes('flow'), 'nested visualType.kind value shown');
  assert.ok(html.includes('custom'), 'nested visualType.detail value shown');
  assert.ok(html.includes('Visual type'), 'humanized visualType label shown for the fall-through row');
});

test('fall-through: unclaimed approach keys are shown, not dropped', () => {
  const html = renderBrainstormHtml(
    { approaches: [{ id: 'A', costEstimate: '3 agent-days', spawnCount: 4 }] },
    { sourcePath: 'p.json' },
  );
  assert.ok(html.includes('Cost estimate'), 'unclaimed key shown as humanized label');
  assert.ok(html.includes('3 agent-days'), 'unclaimed key value shown');
  assert.ok(html.includes('Spawn count'), 'second unclaimed key shown as humanized label');
});

// ── CLI contract ─────────────────────────────────────────────────────────────

test('CLI: writes brainstorm.html beside the input and exits 0', () => {
  const dir = mkTmpDir();
  const input = path.join(dir, 'brainstorm.json');
  fs.writeFileSync(input, JSON.stringify(GOLDEN_BRAINSTORM));

  const res = runCli([input]);
  assert.equal(res.status, 0, res.stderr);
  assert.ok(fs.existsSync(path.join(dir, 'brainstorm.html')), 'brainstorm.html created beside input');
});

test('CLI: an [outfile] positional overrides the destination', () => {
  const dir = mkTmpDir();
  const input = path.join(dir, 'brainstorm.json');
  const out = path.join(dir, 'custom.html');
  fs.writeFileSync(input, JSON.stringify(GOLDEN_BRAINSTORM));

  const res = runCli([input, out]);
  assert.equal(res.status, 0, res.stderr);
  assert.ok(fs.existsSync(out), 'wrote to the given outfile');
  assert.ok(!fs.existsSync(path.join(dir, 'brainstorm.html')), 'did not write default when outfile given');
});

test('CLI: missing arg -> exit 2 (VALIDATION_ERROR)', () => {
  const res = runCli([]);
  assert.equal(res.status, 2);
  assert.match(res.stderr, /missing required/);
});

test('CLI: unreadable file -> exit 2', () => {
  const res = runCli([path.join(os.tmpdir(), 'does-not-exist-xyz.json')]);
  assert.equal(res.status, 2);
  assert.match(res.stderr, /cannot read/);
});

test('CLI: invalid JSON -> exit 2', () => {
  const dir = mkTmpDir();
  const input = path.join(dir, 'brainstorm.json');
  fs.writeFileSync(input, '{ not json');
  const res = runCli([input]);
  assert.equal(res.status, 2);
  assert.match(res.stderr, /invalid JSON/);
});

test('CLI: minimal {} document renders and exits 0', () => {
  const dir = mkTmpDir();
  const input = path.join(dir, 'brainstorm.json');
  fs.writeFileSync(input, '{}');
  const res = runCli([input]);
  assert.equal(res.status, 0, res.stderr);
  assert.ok(fs.existsSync(path.join(dir, 'brainstorm.html')));
});

test('CLI: --help -> exit 0 and prints usage', () => {
  const res = runCli(['--help']);
  assert.equal(res.status, 0);
  assert.match(res.stdout, /Usage: node scripts\/render-brainstorm\.js/);
});

test('module scope prints nothing merely on require', () => {
  const out = spawnSync(process.execPath, ['-e', `require(${JSON.stringify(SCRIPT)})`], { encoding: 'utf8' });
  assert.equal(out.stdout, '');
  assert.equal(out.status, 0);
});

test('escapeHtml is exported and escapes the five HTML-breaking characters', () => {
  assert.equal(escapeHtml(`&<>"'`), '&amp;&lt;&gt;&quot;&#39;');
});
