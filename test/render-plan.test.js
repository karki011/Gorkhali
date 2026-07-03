// Author: Subash Karki
// render-plan.test.js - golden-fixture, determinism, XSS escaping, missing-field
// tolerance, wave-shape normalization, and CLI-contract (exit codes / --out /
// --help) coverage for scripts/render-plan.js. Conventions match
// test/render-output.test.js: node:test + node:assert/strict, spawnSync for the
// CLI harness, no mocks; temp fixtures under os.tmpdir().
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const SCRIPT = require.resolve('../scripts/render-plan');
const { renderPlanHtml, collectWaves } = require(SCRIPT);

// A representative plan exercising inline-task waves, models, files, and
// assumptions - the AXI-PLAN-HTML / AXI-PORT-W2 shape.
const GOLDEN_PLAN = {
  ticket: 'AXI-DEMO',
  goal: 'Render plan.json to a self-contained HTML artifact deterministically.',
  route: 'PLAN',
  cli_contract: 'node scripts/render-plan.js <path> writes plan.html beside input',
  waves: [
    {
      id: 'P',
      name: 'Parallel blades',
      tasks: [
        {
          id: 'B1-renderer',
          agent: 'blade',
          model: 'opus',
          files: ['scripts/render-plan.js', 'test/render-plan.test.js'],
          task: 'Deterministic renderer with XSS-safe escaping.',
        },
      ],
    },
    { id: 'V', name: 'Verify', tasks: [{ id: 'V1', task: 'verify then wrap' }] },
  ],
  assumptions: ['annotate takes an HTML path', 'plan.html lives outside the repo'],
};

const runCli = (args, opts = {}) =>
  spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8', ...opts });

const mkTmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'render-plan-'));

// ── golden fixture ─────────────────────────────────────────────────────────

test('golden: renders a valid, self-contained page with the plan content', () => {
  const html = renderPlanHtml(GOLDEN_PLAN, { sourcePath: 'plan.json' });

  assert.ok(html.startsWith('<!DOCTYPE html>'), 'has doctype');
  assert.ok(html.includes('<title>Plan: AXI-DEMO</title>'), 'title uses ticket');
  assert.ok(html.includes('<style>'), 'CSS is inlined');
  assert.ok(!/https?:\/\//.test(html), 'no external URLs — self-contained');
  assert.ok(!html.includes('<link') && !html.includes('src='), 'no external assets');

  assert.ok(html.includes('Render plan.json to a self-contained'), 'renders goal');
  assert.ok(html.includes('>PLAN<'), 'renders route badge');
  assert.ok(html.includes('Parallel blades'), 'renders wave name');
  assert.ok(html.includes('B1-renderer'), 'renders task id');
  assert.ok(html.includes('scripts/render-plan.js'), 'renders task files');
  assert.ok(html.includes('XSS-safe escaping'), 'renders task text');
  assert.ok(html.includes('annotate takes an HTML path'), 'renders assumptions');
  assert.ok(html.includes('plan.json is the source of truth'), 'footer states source of truth');
});

// ── determinism ──────────────────────────────────────────────────────────────

test('determinism: two renders of the same input are byte-identical', () => {
  const a = renderPlanHtml(GOLDEN_PLAN, { sourcePath: 'plan.json' });
  const b = renderPlanHtml(GOLDEN_PLAN, { sourcePath: 'plan.json' });
  assert.equal(a, b);
});

test('determinism: no Date/timestamp leaks into output', () => {
  const html = renderPlanHtml(GOLDEN_PLAN, { sourcePath: 'plan.json' });
  assert.ok(!/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(html), 'no ISO timestamp');
});

test('determinism: CLI run twice on same file produces identical plan.html', () => {
  const dir = mkTmpDir();
  const input = path.join(dir, 'plan.json');
  fs.writeFileSync(input, JSON.stringify(GOLDEN_PLAN));

  const first = runCli([input]);
  assert.equal(first.status, 0);
  const htmlA = fs.readFileSync(path.join(dir, 'plan.html'), 'utf8');

  const second = runCli([input]);
  assert.equal(second.status, 0);
  const htmlB = fs.readFileSync(path.join(dir, 'plan.html'), 'utf8');

  assert.equal(htmlA, htmlB);
});

// ── escaping (XSS) ───────────────────────────────────────────────────────────

test('escaping: hostile fields render inert as escaped text', () => {
  const hostile = {
    ticket: '<script>alert(1)</script>',
    goal: 'a & b < c > d "quote" \'apos\'',
    waves: [
      {
        name: '<img src=x onerror=alert(2)>',
        tasks: [{ id: '"><script>bad()</script>', files: ['<b>evil.js</b>'], task: 'x & y' }],
      },
    ],
    assumptions: ['<iframe></iframe>'],
    weird_key: '</style><script>pwn()</script>',
  };

  const html = renderPlanHtml(hostile, { sourcePath: 'p.json' });

  assert.ok(!html.includes('<script>alert(1)</script>'), 'no raw script from ticket');
  assert.ok(!html.includes('<script>bad()</script>'), 'no raw script from task id');
  assert.ok(!html.includes('<script>pwn()</script>'), 'no raw script from unknown key');
  assert.ok(!html.includes('<img src=x onerror'), 'no raw img handler');
  assert.ok(!html.includes('<iframe>'), 'no raw iframe');
  // The only <script tokens permitted are none — the whole page is JS-free.
  assert.ok(!html.includes('<script'), 'page contains zero script tags');

  assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'), 'ticket escaped');
  assert.ok(html.includes('&amp;'), 'ampersand escaped');
  assert.ok(html.includes('&quot;') && html.includes('&#39;'), 'quotes escaped');
});

// ── missing-field tolerance ──────────────────────────────────────────────────

test('tolerance: an empty {} plan still renders a full page', () => {
  const html = renderPlanHtml({}, { sourcePath: 'p.json' });
  assert.ok(html.startsWith('<!DOCTYPE html>'));
  assert.ok(html.includes('<title>Plan</title>'), 'falls back to generic title');
  assert.ok(html.includes('plan.json is the source of truth'));
});

test('tolerance: non-object top-level is preserved under Other fields, never thrown', () => {
  const html = renderPlanHtml(42, { sourcePath: 'p.json' });
  assert.ok(html.includes('Other fields'));
  assert.ok(html.includes('42'));
});

test('tolerance: partial tasks (no model/files/text) render without error', () => {
  const html = renderPlanHtml({ waves: [{ name: 'W', tasks: [{ id: 'only-id' }] }] });
  assert.ok(html.includes('only-id'));
});

// ── wave-shape normalization ─────────────────────────────────────────────────

test('collectWaves: resolves id-ref waves against top-level tasks[] (W5 shape)', () => {
  const plan = {
    tasks: [
      { id: 'W5-1', owner: 'blade-wake', summary: 'wake queue' },
      { id: 'W5-3', owner: 'blade-prose', summary: 'prose wiring' },
    ],
    waves: [['W5-1', 'W5-3']],
  };
  const waves = collectWaves(plan);
  assert.equal(waves.length, 1);
  assert.equal(waves[0].tasks.length, 2);
  assert.equal(waves[0].tasks[0].summary, 'wake queue');
});

test('collectWaves: unknown id-ref becomes a stub task, not dropped', () => {
  const waves = collectWaves({ tasks: [], waves: [['ghost']] });
  assert.equal(waves[0].tasks[0].id, 'ghost');
});

test('collectWaves: top-level tasks[] with no waves synthesize a single wave', () => {
  const waves = collectWaves({ tasks: [{ id: 'a' }, { id: 'b' }] });
  assert.equal(waves.length, 1);
  assert.equal(waves[0].tasks.length, 2);
});

test('render: W5 id-ref plan surfaces owner + summary and its extra keys', () => {
  const plan = {
    ticket: 'AXI-PORT-W5',
    tasks: [{ id: 'W5-1', owner: 'blade-wake', files: ['scripts/lib/wake-queue.js'], summary: 'wake queue port' }],
    waves: [['W5-1']],
    branch: 'axi-port-w5',
    fileOwnership: 'disjoint',
  };
  const html = renderPlanHtml(plan, { sourcePath: 'p.json' });
  assert.ok(html.includes('blade-wake'), 'owner shown as agent chip');
  assert.ok(html.includes('wake queue port'), 'summary shown as task text');
  assert.ok(html.includes('axi-port-w5'), 'extra scalar key in Other fields');
  assert.ok(html.includes('disjoint'), 'fileOwnership in Other fields');
});

// ── malformed known-key fallthrough (consumed-Set) ──────────────────────────

test('malformed: string-typed constraints falls through to Other fields, not dropped', () => {
  const html = renderPlanHtml({ constraints: 'must not touch auth' }, { sourcePath: 'p.json' });
  assert.ok(html.includes('Other fields'), 'Other fields section present');
  assert.ok(html.includes('must not touch auth'), 'malformed value text is shown');
  assert.ok(!html.includes('<h2>Constraints</h2>'), 'dedicated Constraints section did not render');
});

test('malformed: object-typed waves falls through to Other fields as escaped JSON', () => {
  const html = renderPlanHtml({ waves: { P: ['a', 'b'] } }, { sourcePath: 'p.json' });
  assert.ok(html.includes('Other fields'), 'Other fields section present');
  assert.ok(html.includes('&quot;P&quot;'), 'object shown as escaped JSON, key visible');
  assert.ok(!html.includes('<h2>Waves</h2>'), 'dedicated Waves section did not render');
});

test('malformed: object-typed ticket falls through to Other fields instead of "[object Object]"', () => {
  const html = renderPlanHtml({ ticket: { id: 'CP-1' } }, { sourcePath: 'p.json' });
  assert.ok(!html.includes('[object Object]'), 'never coerces object to string in the header');
  assert.ok(html.includes('<title>Plan</title>'), 'header falls back to generic title');
  assert.ok(html.includes('Other fields'), 'malformed ticket surfaced under Other fields');
  assert.ok(html.includes('&quot;CP-1&quot;'), 'ticket object shown as escaped JSON');
});

test('golden: well-typed plan is unaffected by consumed-Set change (regression guard)', () => {
  const html = renderPlanHtml(GOLDEN_PLAN, { sourcePath: 'plan.json' });
  assert.ok(html.includes('<h2>Waves</h2>'), 'Waves section still renders for well-typed input');
  assert.ok(html.includes('<h2>Assumptions</h2>'), 'Assumptions section still renders for well-typed input');
  assert.ok(!html.includes('>waves<') && !html.includes('>ticket<') && !html.includes('>goal<') && !html.includes('>route<') && !html.includes('>assumptions<'),
    'well-typed known keys never leak into Other fields');
});

// ── real-shape fall-through (show-don't-hide, recursive) ─────────────────────
// Each fixture below is modeled on a REAL plan.json shape the renderer used to
// silently drop. Reverting the recursive fall-through makes these fail: the
// previously-vanishing content (work items, acceptance_criteria, task titles,
// wave design/tests/verify) would no longer appear in the output.

test('CP-44016 shape: wave.work[] items + wave.files are shown, not "No tasks in this wave."', () => {
  const plan = {
    ticket: 'CP-44016',
    route: 'PLAN',
    waves: [
      {
        wave: 1,
        name: 'Features / API layer',
        agent: 'blade (sonnet)',
        files: ['libs/features/pulse/api/src/ai-explorer/types.ts'],
        work: ['WORK-1 partition_by string|string[]', 'WORK-2 add 2D raw types', 'WORK-3 comma-join params'],
      },
      {
        wave: 2,
        name: 'Features / Domain layer',
        dependsOn: [1],
        files: ['libs/features/pulse/domain/src/ai-explorer/types.ts'],
        work: ['WORK-4 hierarchical row model', 'WORK-5 branch on Array.isArray', 'WORK-6 2D-aware merge', 'WORK-7 thread string|string[]'],
      },
      {
        wave: 3,
        name: 'UI layer',
        dependsOn: [2],
        agents: [{ agent: 'blade UI-A', files: ['apps/web/src/routes/ai-signals/explorer/index.tsx'], work: ['nested agent work'] }],
      },
      { wave: 4, name: 'Tests', work: ['WORK-8 transform matrix', 'WORK-9 toolbar flag'] },
      { wave: 5, name: 'Sengoku', work: ['WORK-10 simplify', 'WORK-11 ward verify'] },
      { wave: 6, name: 'User testing', work: ['WORK-12 manual verify', 'WORK-13 no auto-PR'] },
    ],
  };
  const html = renderPlanHtml(plan, { sourcePath: 'p.json' });

  for (let i = 1; i <= 13; i++) {
    assert.ok(html.includes(`WORK-${i} `), `work item WORK-${i} is present`);
  }
  assert.ok(html.includes('libs/features/pulse/api/src/ai-explorer/types.ts'), 'wave.files shown');
  assert.ok(html.includes('blade (sonnet)'), 'wave.agent shown');
  assert.ok(html.includes('nested agent work'), 'nested agents[].work shown (as escaped JSON)');
  assert.ok(!html.includes('No tasks in this wave.'), 'no misleading empty-wave placeholder');
});

test('canonical task template: acceptance_criteria + read_first + dependsOn + verify are shown', () => {
  // The extended Task Structure Template from reference/schemas/plan.md.
  const plan = {
    route: 'shadows',
    tasks: [
      {
        id: 'T1',
        description: 'Add useCostByTag hook that memoizes result',
        read_first: ['src/hooks/useCostData.ts', 'src/api/client.ts'],
        acceptance_criteria: [
          "grep -r 'export.*useCostByTag' src/hooks/ finds exactly one match",
          'Hook returns { data, loading, error } matching CostByTagResponse',
        ],
        action: 'Create src/hooks/useCostByTag.ts with memoized selector',
        verify: 'npm test && npm run lint',
        files: ['src/hooks/useCostByTag.ts'],
        dependsOn: ['T0'],
        agent: 'backend',
      },
    ],
  };
  const html = renderPlanHtml(plan, { sourcePath: 'p.json' });

  assert.ok(html.includes('src/hooks/useCostData.ts'), 'read_first shown');
  assert.ok(html.includes('finds exactly one match'), 'acceptance_criteria item 1 shown');
  assert.ok(html.includes('matching CostByTagResponse'), 'acceptance_criteria item 2 shown');
  assert.ok(html.includes('npm test &amp;&amp; npm run lint'), 'verify shown and escaped');
  assert.ok(html.includes('memoized selector'), 'action shown');
  assert.ok(html.includes('>T0<') || html.includes('T0'), 'dependsOn shown');
  assert.ok(html.includes('backend'), 'agent shown as chip');
  assert.ok(html.includes('Add useCostByTag hook'), 'description shown as body');
});

test('menu-bar shape: every task title + detail is shown (was 0/8)', () => {
  const mkTask = (n) => ({
    id: `T${n}`,
    title: `TITLE-${n}: table migration`,
    files: [`db/migrations/00${n}.sql`],
    detail: `DETAIL-${n} create table and index, follow conventions`,
  });
  const plan = {
    summary: 'Persist per-session turn tracing into a live_sessions table.',
    waves: [
      { wave: 1, name: 'Data layer', tasks: [mkTask(1), mkTask(2), mkTask(3)] },
      { wave: 2, name: 'App read path', tasks: [mkTask(4), mkTask(5), mkTask(6)] },
      { wave: 3, name: 'Popover card', tasks: [mkTask(7)] },
      { wave: 4, name: 'Verification', tasks: [mkTask(8)] },
    ],
  };
  const html = renderPlanHtml(plan, { sourcePath: 'p.json' });

  for (let n = 1; n <= 8; n++) {
    assert.ok(html.includes(`TITLE-${n}:`), `task ${n} title shown`);
    assert.ok(html.includes(`DETAIL-${n} `), `task ${n} detail shown`);
  }
  assert.ok(html.includes('db/migrations/001.sql'), 'task files shown');
});

test('orchestration shape: wave title/design/tests/verify/agent are shown (waves-as-tasks)', () => {
  const plan = {
    ticket: 'ORCHESTRATION-ENGINE',
    goal: 'Native orchestration engine gated behind a cargo feature.',
    waves: [
      {
        id: 'W1-O1',
        title: 'TITLE O1 hardcoded scaling-nudge scaffolding',
        agent: 'blade (Rust)',
        files: ['daemon/src/orchestration/strategy.rs'],
        design: 'DESIGN hardcoded thresholds const never LLM-decided',
        tests: 'TESTS unit tests for scaling_strategy boundaries',
        verify: 'VERIFY cargo test --features orchestration',
      },
      {
        id: 'W2-O2',
        title: 'TITLE O2 state-machine engine + v10 persistence',
        agent: 'blade (Rust)',
        depends_on: ['W1-O1'],
        files: ['daemon/src/orchestration/engine.rs'],
        design: 'DESIGN atomic transition single unchecked_transaction',
        tests: 'TESTS transition legality matrix',
        verify: 'VERIFY same 4 cargo commands',
      },
    ],
  };
  const html = renderPlanHtml(plan, { sourcePath: 'p.json' });

  assert.ok(html.includes('TITLE O1 hardcoded'), 'wave 1 title used as wave label');
  assert.ok(html.includes('TITLE O2 state-machine'), 'wave 2 title used as wave label');
  assert.ok(html.includes('DESIGN hardcoded thresholds'), 'wave.design shown');
  assert.ok(html.includes('TESTS unit tests'), 'wave.tests shown');
  assert.ok(html.includes('VERIFY cargo test'), 'wave.verify shown');
  assert.ok(html.includes('blade (Rust)'), 'wave.agent shown');
  assert.ok(html.includes('W1-O1'), 'wave id shown in fall-through');
  assert.ok(!html.includes('No tasks in this wave.'), 'no empty-wave placeholder for waves-as-tasks');
});

test('fall-through escaping: hostile value in an unclaimed task/wave key is inert', () => {
  const html = renderPlanHtml(
    { waves: [{ name: 'W', design: '<script>pwn()</script>', tasks: [{ id: 'T', verify: '<img src=x onerror=go()>' }] }] },
    { sourcePath: 'p.json' },
  );
  assert.ok(!html.includes('<script>pwn()</script>'), 'wave-level fall-through escaped');
  assert.ok(!html.includes('<img src=x onerror'), 'task-level fall-through escaped');
  assert.ok(html.includes('&lt;script&gt;pwn()&lt;/script&gt;'), 'design value shown as escaped text');
});

// ── CLI contract ─────────────────────────────────────────────────────────────

test('CLI: writes plan.html beside the input and exits 0', () => {
  const dir = mkTmpDir();
  const input = path.join(dir, 'plan.json');
  fs.writeFileSync(input, JSON.stringify(GOLDEN_PLAN));

  const res = runCli([input]);
  assert.equal(res.status, 0, res.stderr);
  assert.ok(fs.existsSync(path.join(dir, 'plan.html')), 'plan.html created beside input');
});

test('CLI: --out overrides the destination', () => {
  const dir = mkTmpDir();
  const input = path.join(dir, 'plan.json');
  const out = path.join(dir, 'custom.html');
  fs.writeFileSync(input, JSON.stringify(GOLDEN_PLAN));

  const res = runCli([input, '--out', out]);
  assert.equal(res.status, 0, res.stderr);
  assert.ok(fs.existsSync(out), 'wrote to --out path');
  assert.ok(!fs.existsSync(path.join(dir, 'plan.html')), 'did not write default when --out given');
});

test('CLI: unwritable --out path (parent is a file, not a dir) -> exit 1 via reportError', () => {
  const dir = mkTmpDir();
  const input = path.join(dir, 'plan.json');
  fs.writeFileSync(input, JSON.stringify(GOLDEN_PLAN));

  const blockerFile = path.join(dir, 'not-a-dir');
  fs.writeFileSync(blockerFile, 'x');
  const badOut = path.join(blockerFile, 'plan.html'); // parent segment is a file

  const res = runCli([input, '--out', badOut]);
  assert.equal(res.status, 1, 'write failure is not a VALIDATION_ERROR, so it hits the generic exit-1 branch');
  assert.ok(res.stderr.length > 0, 'stderr mentions the write error');
});

test('CLI: missing arg -> exit 2 (VALIDATION_ERROR)', () => {
  const res = runCli([]);
  assert.equal(res.status, 2);
  assert.match(res.stderr, /missing required/);
});

test('CLI: --out without a value -> exit 2', () => {
  const dir = mkTmpDir();
  const input = path.join(dir, 'plan.json');
  fs.writeFileSync(input, '{}');
  const res = runCli([input, '--out']);
  assert.equal(res.status, 2);
});

test('CLI: unreadable file -> exit 2', () => {
  const res = runCli([path.join(os.tmpdir(), 'does-not-exist-xyz.json')]);
  assert.equal(res.status, 2);
  assert.match(res.stderr, /cannot read/);
});

test('CLI: invalid JSON -> exit 2', () => {
  const dir = mkTmpDir();
  const input = path.join(dir, 'plan.json');
  fs.writeFileSync(input, '{ not json');
  const res = runCli([input]);
  assert.equal(res.status, 2);
  assert.match(res.stderr, /invalid JSON/);
});

test('CLI: minimal {} plan renders and exits 0', () => {
  const dir = mkTmpDir();
  const input = path.join(dir, 'plan.json');
  fs.writeFileSync(input, '{}');
  const res = runCli([input]);
  assert.equal(res.status, 0, res.stderr);
  assert.ok(fs.existsSync(path.join(dir, 'plan.html')));
});

test('CLI: --help -> exit 0 and prints usage', () => {
  const res = runCli(['--help']);
  assert.equal(res.status, 0);
  assert.match(res.stdout, /Usage: node scripts\/render-plan\.js/);
});

test('module scope prints nothing merely on require', () => {
  const out = spawnSync(process.execPath, ['-e', `require(${JSON.stringify(SCRIPT)})`], { encoding: 'utf8' });
  assert.equal(out.stdout, '');
  assert.equal(out.status, 0);
});
