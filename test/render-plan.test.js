// Author: Subash Karki
// render-plan.test.js - golden-fixture, determinism, XSS escaping, missing-field
// tolerance, wave-shape normalization, and CLI-contract (exit codes / --out /
// --help) coverage for scripts/render-plan.js. Structural assertions target the
// shared html-kit markup (kit-h2 sections, kit-* primitive classes, humanized
// fall-through). Portable invariants (byte-determinism, self-containment, XSS
// escaping, {}/42/malformed tolerance, exit codes 0/2) are unchanged.
// Conventions match test/render-output.test.js: node:test + node:assert/strict,
// spawnSync for the CLI harness, no mocks; temp fixtures under os.tmpdir().
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const SCRIPT = require.resolve('../scripts/render-plan');
const { renderPlanHtml, collectWaves, loadPlanCheck, loadIntent, loadWiring, escapeHtml } = require(SCRIPT);

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

  assert.ok(html.includes('Render plan.json to a self-contained'), 'renders goal as headline');
  assert.ok(html.includes('>PLAN<'), 'renders route badge');
  assert.ok(html.includes('<h3>Parallel blades</h3>'), 'renders wave name as an h3');
  assert.ok(html.includes('B1-renderer'), 'renders task id');
  assert.ok(html.includes('scripts/render-plan.js'), 'renders task files');
  assert.ok(html.includes('XSS-safe escaping'), 'renders task text as prose body');
  assert.ok(html.includes('annotate takes an HTML path'), 'renders assumptions');
  assert.ok(html.includes('plan.json is the source of truth'), 'footer states source of truth');
});

test('golden: leads with the shared kit + a sticky top bar and TOC chips', () => {
  const html = renderPlanHtml(GOLDEN_PLAN, { sourcePath: 'plan.json' });
  // A stable CZ token proves the shared kit stylesheet is inlined.
  assert.ok(html.includes('--brand-teal:#7FC2C8'), 'CZ design-kit token sheet present');
  assert.ok(html.includes('<header class="kit-topbar">'), 'sticky top bar rendered');
  assert.ok(html.includes('<nav class="kit-toc">'), 'TOC nav rendered');
  // Every TOC chip anchors a section id that is actually emitted on the page.
  const hrefs = [...html.matchAll(/<a class="kit-chip" href="#([^"]+)">/g)].map((m) => m[1]);
  assert.ok(hrefs.length > 0, 'at least one TOC chip');
  for (const id of hrefs) {
    assert.ok(html.includes(`<section id="${id}"`), `TOC chip #${id} anchors a real section`);
  }
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
  assert.ok(html.includes('<h1>Plan</h1>'), 'falls back to generic headline');
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

// ── headline preference (title > goal > ticket) ──────────────────────────────

test('headline: top-level title is the page headline; goal becomes the sub-line', () => {
  const html = renderPlanHtml(
    { ticket: 'CP-1', title: 'Ship the cost explorer', goal: 'Users can slice cost by tag' },
    { sourcePath: 'p.json' },
  );
  assert.ok(html.includes('<h1>Ship the cost explorer</h1>'), 'title wins the headline');
  assert.ok(html.includes('<p class="kit-sub">Users can slice cost by tag</p>'), 'goal shown as sub-line, not dropped');
  assert.ok(!html.includes('<h2 class="kit-h2">Other fields</h2>'), 'title/goal/ticket all consumed, no Other fields');
});

test('headline: goal is the headline when no title is present', () => {
  const html = renderPlanHtml({ ticket: 'CP-2', goal: 'Only a goal' }, { sourcePath: 'p.json' });
  assert.ok(html.includes('<h1>Only a goal</h1>'), 'goal is the headline');
  assert.ok(!html.includes('<p class="kit-sub">'), 'no sub-line when title absent');
});

// ── first-class real-world sections ──────────────────────────────────────────

test('real-world fields: title/summary/verified_facts/decisions/test_plan/conventions/risks/estimate/assumptions each get a section; unknown keys humanize under Other fields', () => {
  const plan = {
    ticket: 'CP-3',
    title: 'Big headline',
    summary: 'A one-paragraph lead.',
    verified_facts: ['fact one', 'fact two'],
    decisions_for_approval: [{ id: 'D1', question: 'which lib?', recommendation: 'use the kit' }],
    test_plan: { unit: 'run node --test' },
    conventions_contract: { style: 'sentence case headings' },
    risks: [{ risk: 'markup drift', severity: 'low' }],
    estimate: { prs: 'one PR, a paragraph-length rationale that must not be a stat strip' },
    assumptions: ['tokens are stable'],
    mystery_key: { nested: 1 },
    waves: [{ name: 'W', tasks: [{ id: 'T', title: 't', text: 'task body prose', output: 'a file' }] }],
  };
  const html = renderPlanHtml(plan, { sourcePath: 'p.json' });

  assert.ok(html.includes('<h1>Big headline</h1>'), 'title is the headline');
  assert.ok(html.includes('<h2 class="kit-h2">Summary</h2>') && html.includes('A one-paragraph lead.'), 'summary section');
  assert.ok(html.includes('<h2 class="kit-h2">Verified facts</h2>') && html.includes('fact one'), 'verified facts checklist');
  assert.ok(html.includes('<h2 class="kit-h2">Decisions for approval</h2>') && html.includes('use the kit'), 'decisions section');
  assert.ok(html.includes('<h2 class="kit-h2">Test plan</h2>') && html.includes('run node --test'), 'test plan section');
  assert.ok(html.includes('<h2 class="kit-h2">Conventions</h2>') && html.includes('sentence case headings'), 'conventions section');
  assert.ok(html.includes('<h2 class="kit-h2">Risks</h2>') && html.includes('markup drift'), 'risks section');
  assert.ok(html.includes('<h2 class="kit-h2">Estimate</h2>') && html.includes('paragraph-length rationale'), 'estimate section');
  assert.ok(html.includes('<h2 class="kit-h2">Assumptions</h2>') && html.includes('tokens are stable'), 'assumptions section');

  // A bespoke unknown key surfaces under Other fields as a humanized label, no raw underscore key.
  assert.ok(html.includes('<h2 class="kit-h2">Other fields</h2>'), 'Other fields section for unknown keys');
  assert.ok(html.includes('Mystery key'), 'unknown key humanized');
  assert.ok(!/mystery_key/.test(html), 'raw underscore key never surfaces');
  assert.ok(!/of-pre/.test(html), 'no legacy of-pre JSON dump class');
});

test('task: prose body renders enumerated mega-paragraphs as an ordered list', () => {
  const html = renderPlanHtml(
    { waves: [{ name: 'W', tasks: [{ id: 'T', text: 'intro (1) alpha part; (2) beta part' }] }] },
    { sourcePath: 'p.json' },
  );
  assert.ok(/<ol/.test(html), 'enumeration becomes an ordered list');
  assert.ok(html.includes('beta part'), 'list item content preserved');
});

test('task: output renders as a labeled Outcome row, claimed (not repeated under Other fields)', () => {
  const html = renderPlanHtml(
    { waves: [{ name: 'W', tasks: [{ id: 'T', text: 'do the thing', output: 'a green build' }] }] },
    { sourcePath: 'p.json' },
  );
  assert.ok(html.includes('<div class="kit-kv-key">Outcome</div>'), 'Outcome label rendered');
  assert.ok(html.includes('a green build'), 'output value rendered');
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
  assert.ok(html.includes('wake queue port'), 'summary shown as task body');
  assert.ok(html.includes('axi-port-w5'), 'extra scalar key in Other fields');
  assert.ok(html.includes('disjoint'), 'fileOwnership in Other fields');
});

// ── malformed known-key fallthrough (consumed-Set) ──────────────────────────

test('malformed: string-typed constraints falls through to Other fields, not dropped', () => {
  const html = renderPlanHtml({ constraints: 'must not touch auth' }, { sourcePath: 'p.json' });
  assert.ok(html.includes('<h2 class="kit-h2">Other fields</h2>'), 'Other fields section present');
  assert.ok(html.includes('must not touch auth'), 'malformed value text is shown');
  assert.ok(!html.includes('<h2 class="kit-h2">Constraints</h2>'), 'dedicated Constraints section did not render');
});

test('malformed: object-typed waves falls through to Other fields, rendered readably', () => {
  const html = renderPlanHtml({ waves: { P: ['a', 'b'] } }, { sourcePath: 'p.json' });
  assert.ok(html.includes('<h2 class="kit-h2">Other fields</h2>'), 'Other fields section present');
  assert.ok(html.includes('<li>a</li>') && html.includes('<li>b</li>'), 'nested values shown as a readable list');
  assert.ok(!html.includes('<h2 class="kit-h2">Waves</h2>'), 'dedicated Waves section did not render');
});

test('malformed: object-typed ticket falls through to Other fields instead of "[object Object]"', () => {
  const html = renderPlanHtml({ ticket: { id: 'CP-1' } }, { sourcePath: 'p.json' });
  assert.ok(!html.includes('[object Object]'), 'never coerces object to string in the header');
  assert.ok(html.includes('<title>Plan</title>'), 'header falls back to generic title');
  assert.ok(html.includes('<h2 class="kit-h2">Other fields</h2>'), 'malformed ticket surfaced under Other fields');
  assert.ok(html.includes('CP-1'), 'ticket object shown readably');
});

test('golden: well-typed plan is unaffected by consumed-Set change (regression guard)', () => {
  const html = renderPlanHtml(GOLDEN_PLAN, { sourcePath: 'plan.json' });
  assert.ok(html.includes('<h2 class="kit-h2">Waves</h2>'), 'Waves section still renders for well-typed input');
  assert.ok(html.includes('<h2 class="kit-h2">Assumptions</h2>'), 'Assumptions section still renders for well-typed input');
  // The only unclaimed top-level key is cli_contract; it (and nothing else) surfaces humanized under Other fields.
  assert.ok(html.includes('<h2 class="kit-h2">Other fields</h2>') && html.includes('Cli contract'), 'unclaimed key surfaces humanized');
  assert.ok(!html.includes('<div class="kit-kv-key">Waves</div>'), 'consumed known keys never leak into Other fields');
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
  assert.ok(html.includes('nested agent work'), 'nested agents[].work shown');
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
  assert.ok(html.includes('T0'), 'dependsOn shown');
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

// ── plan-check section ───────────────────────────────────────────────────────
// Modeled on the REAL plan-check.json shape (menu-bar-claude-status):
//   { _meta, checks: { <name>: { result, details:[...] } }, additionalFindings:[],
//     verdict, summary }. A sibling plan-check.json renders a "Plan check" section;
//   absence => no section; a malformed file => a loud note, never a throw.
const PLAN_CHECK = {
  _meta: { ticket: 'AXI-DEMO', checker: 'plan-checker', planFile: 'plan.json' },
  checks: {
    learnings_collision: { result: 'pass', details: ['no corrections to collide with'] },
    blast_radius: { result: 'warn', details: ['MetricIconCard.swift not in plan T6', 'DataStore.swift is safe'] },
    scope_creep: { result: 'pass', details: ['all files on-domain'] },
  },
  additionalFindings: ['XCODE MECHANICS: file-system-synchronized groups, no pbxproj edits'],
  verdict: 'PROCEED',
  summary: 'No FAILs; 3 WARNs worth acting on before wave 2/3.',
};

test('plan-check: real-shape sibling renders a Plan check section with verdict + findings', () => {
  const html = renderPlanHtml(GOLDEN_PLAN, { sourcePath: 'plan.json', planCheck: { data: PLAN_CHECK } });

  assert.ok(html.includes('<h2 class="kit-h2">Plan check</h2>'), 'Plan check heading rendered');
  assert.ok(html.includes('>PROCEED<'), 'verdict badge rendered');
  assert.ok(html.includes('No FAILs; 3 WARNs'), 'summary rendered');
  assert.ok(html.includes('Learnings collision'), 'check name humanized');
  assert.ok(html.includes('Blast radius'), 'warn check name humanized');
  assert.ok(html.includes('MetricIconCard.swift not in plan T6'), 'check detail rendered');
  assert.ok(html.includes('DataStore.swift is safe'), 'second check detail rendered');
  assert.ok(html.includes('XCODE MECHANICS'), 'additionalFindings rendered');
  assert.ok(html.includes('kit-badge-success') && html.includes('kit-badge-warn'), 'result badges get colour classes');
});

test('plan-check: verdict badge also appears in the sticky top bar', () => {
  const html = renderPlanHtml(GOLDEN_PLAN, { sourcePath: 'plan.json', planCheck: { data: PLAN_CHECK } });
  const topbar = html.slice(html.indexOf('<header class="kit-topbar">'), html.indexOf('</header>'));
  assert.ok(topbar.includes('Plan check: PROCEED'), 'plan-check verdict badge in the top bar');
});

test('plan-check: BLOCKED verdict (plan-checker producer casing) gets the fail badge class', () => {
  const html = renderPlanHtml(GOLDEN_PLAN, {
    sourcePath: 'plan.json',
    planCheck: { data: { ...PLAN_CHECK, verdict: 'BLOCKED', checks: {} } },
  });
  assert.ok(html.includes('>BLOCKED<'), 'verdict badge rendered');
  assert.ok(html.includes('kit-badge-error'), 'BLOCKED verdict gets the error colour class');
});

test('plan-check: score field renders a score badge when present', () => {
  const html = renderPlanHtml(GOLDEN_PLAN, {
    sourcePath: 'plan.json',
    planCheck: { data: { verdict: 'PROCEED', score: 4.5 } },
  });
  assert.ok(html.includes('Score:'), 'score label rendered');
  assert.ok(html.includes('4.5'), 'score value rendered');
});

test('plan-check: absent file (null) renders no section', () => {
  const html = renderPlanHtml(GOLDEN_PLAN, { sourcePath: 'plan.json', planCheck: null });
  assert.ok(!html.includes('<h2 class="kit-h2">Plan check</h2>'), 'no Plan check section when planCheck is null');
});

test('plan-check: no planCheck option at all renders no section (regression guard)', () => {
  const html = renderPlanHtml(GOLDEN_PLAN, { sourcePath: 'plan.json' });
  assert.ok(!html.includes('<h2 class="kit-h2">Plan check</h2>'), 'section only appears when planCheck is provided');
});

test('plan-check: malformed file surfaces a loud escaped note, not silence', () => {
  const html = renderPlanHtml(GOLDEN_PLAN, {
    sourcePath: 'plan.json',
    planCheck: { error: 'invalid JSON in plan-check file p.json: Unexpected token' },
  });
  assert.ok(html.includes('<h2 class="kit-h2">Plan check</h2>'), 'section still renders for a malformed file');
  assert.ok(html.includes('invalid JSON in plan-check file'), 'the note is shown, not hidden');
});

test('plan-check: hostile strings in plan-check fields render inert', () => {
  const hostile = {
    verdict: '<script>alert(1)</script>',
    summary: '</style><img src=x onerror=pwn()>',
    checks: {
      '<b>evil</b>': { result: '<script>bad()</script>', details: ['<iframe></iframe>'] },
    },
    additionalFindings: ['"><script>go()</script>'],
  };
  const html = renderPlanHtml(GOLDEN_PLAN, { sourcePath: 'p.json', planCheck: { data: hostile } });

  assert.ok(!html.includes('<script>alert(1)</script>'), 'no raw script from verdict');
  assert.ok(!html.includes('<script>bad()</script>'), 'no raw script from check result');
  assert.ok(!html.includes('<script>go()</script>'), 'no raw script from findings');
  assert.ok(!html.includes('<img src=x onerror'), 'no raw img handler from summary');
  assert.ok(!html.includes('<iframe>'), 'no raw iframe from details');
  assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'), 'verdict escaped');
});

test('plan-check: unknown top-level keys fall through, non-object check value not dropped', () => {
  const html = renderPlanHtml(GOLDEN_PLAN, {
    sourcePath: 'p.json',
    planCheck: { data: { verdict: 'PROCEED', novel_key: 'novel-value', checks: { odd: 'just-a-string' } } },
  });
  assert.ok(html.includes('Novel key'), 'unknown top-level key humanized');
  assert.ok(html.includes('novel-value'), 'unknown top-level value shown');
  assert.ok(html.includes('just-a-string'), 'non-object check value shown, not dropped');
});

test('plan-check: determinism with a sibling present — two renders byte-identical', () => {
  const opts = { sourcePath: 'plan.json', planCheck: { data: PLAN_CHECK } };
  assert.equal(renderPlanHtml(GOLDEN_PLAN, opts), renderPlanHtml(GOLDEN_PLAN, opts));
});

test('loadPlanCheck: absent file -> null (no section)', () => {
  assert.equal(loadPlanCheck(path.join(os.tmpdir(), 'no-such-plan-check-xyz.json')), null);
});

test('loadPlanCheck: absent file with explicit:true -> loud not-found note, not null', () => {
  const missing = path.join(os.tmpdir(), 'no-such-plan-check-xyz.json');
  const res = loadPlanCheck(missing, { explicit: true });
  assert.notEqual(res, null, 'an explicit expectation is never silently absorbed');
  assert.ok(res.error && res.error.includes(missing), 'note names the missing --check-file path');
});

test('loadPlanCheck: valid JSON -> { data }, malformed -> { error }', () => {
  const dir = mkTmpDir();
  const good = path.join(dir, 'good.json');
  fs.writeFileSync(good, JSON.stringify({ verdict: 'PROCEED' }));
  assert.deepEqual(loadPlanCheck(good), { data: { verdict: 'PROCEED' } });

  const bad = path.join(dir, 'bad.json');
  fs.writeFileSync(bad, '{ not json');
  const res = loadPlanCheck(bad);
  assert.ok(res.error && /invalid JSON in plan-check file/.test(res.error), 'malformed -> escaped note payload');
});

test('CLI: a plan-check.json sibling is picked up and rendered; exit 0', () => {
  const dir = mkTmpDir();
  const input = path.join(dir, 'plan.json');
  fs.writeFileSync(input, JSON.stringify(GOLDEN_PLAN));
  fs.writeFileSync(path.join(dir, 'plan-check.json'), JSON.stringify(PLAN_CHECK));

  const res = runCli([input]);
  assert.equal(res.status, 0, res.stderr);
  const html = fs.readFileSync(path.join(dir, 'plan.html'), 'utf8');
  assert.ok(html.includes('<h2 class="kit-h2">Plan check</h2>'), 'sibling plan-check rendered into plan.html');
  assert.ok(html.includes('>PROCEED<'), 'verdict from sibling shown');
});

test('CLI: no sibling plan-check.json -> no section, exit 0 (this session\'s own plan)', () => {
  const dir = mkTmpDir();
  const input = path.join(dir, 'plan.json');
  fs.writeFileSync(input, JSON.stringify(GOLDEN_PLAN));

  const res = runCli([input]);
  assert.equal(res.status, 0, res.stderr);
  const html = fs.readFileSync(path.join(dir, 'plan.html'), 'utf8');
  assert.ok(!html.includes('<h2 class="kit-h2">Plan check</h2>'), 'no section without a sibling');
});

test('CLI: --check-file overrides the sibling location', () => {
  const dir = mkTmpDir();
  const input = path.join(dir, 'plan.json');
  const check = path.join(dir, 'elsewhere-check.json');
  fs.writeFileSync(input, JSON.stringify(GOLDEN_PLAN));
  fs.writeFileSync(check, JSON.stringify({ verdict: 'BLOCK', summary: 'do not ship' }));

  const res = runCli([input, '--check-file', check]);
  assert.equal(res.status, 0, res.stderr);
  const html = fs.readFileSync(path.join(dir, 'plan.html'), 'utf8');
  assert.ok(html.includes('>BLOCK<'), 'verdict from --check-file shown');
  assert.ok(html.includes('do not ship'), 'summary from --check-file shown');
});

test('CLI: --check-file pointing at a missing path -> loud note in section, exit 0', () => {
  const dir = mkTmpDir();
  const input = path.join(dir, 'plan.json');
  const missingCheck = path.join(dir, 'does-not-exist-check.json');
  fs.writeFileSync(input, JSON.stringify(GOLDEN_PLAN));

  const res = runCli([input, '--check-file', missingCheck]);
  assert.equal(res.status, 0, 'an explicit-flag miss renders a note, not a validation error exit');
  const html = fs.readFileSync(path.join(dir, 'plan.html'), 'utf8');
  assert.ok(html.includes('<h2 class="kit-h2">Plan check</h2>'), 'section renders even though the explicit file is missing');
  assert.ok(html.includes(escapeHtml(missingCheck)), 'note names the missing --check-file path, escaped');
});

test('CLI: auto-discovered sibling absent (no --check-file) -> still no section, exit 0', () => {
  const dir = mkTmpDir();
  const input = path.join(dir, 'plan.json');
  fs.writeFileSync(input, JSON.stringify(GOLDEN_PLAN));

  const res = runCli([input]);
  assert.equal(res.status, 0, res.stderr);
  const html = fs.readFileSync(path.join(dir, 'plan.html'), 'utf8');
  assert.ok(!html.includes('<h2 class="kit-h2">Plan check</h2>'), 'auto-discovery absence stays silent — unlike an explicit --check-file miss');
});

test('CLI: malformed sibling plan-check.json -> note in section, still exit 0', () => {
  const dir = mkTmpDir();
  const input = path.join(dir, 'plan.json');
  fs.writeFileSync(input, JSON.stringify(GOLDEN_PLAN));
  fs.writeFileSync(path.join(dir, 'plan-check.json'), '{ not json');

  const res = runCli([input]);
  assert.equal(res.status, 0, 'a malformed plan-check never fails the render');
  const html = fs.readFileSync(path.join(dir, 'plan.html'), 'utf8');
  assert.ok(html.includes('<h2 class="kit-h2">Plan check</h2>') && html.includes('invalid JSON in plan-check file'), 'loud note rendered');
});

test('CLI: --check-file without a value -> exit 2', () => {
  const dir = mkTmpDir();
  const input = path.join(dir, 'plan.json');
  fs.writeFileSync(input, '{}');
  const res = runCli([input, '--check-file']);
  assert.equal(res.status, 2);
});

test('CLI: --help documents --check-file', () => {
  const res = runCli(['--help']);
  assert.equal(res.status, 0);
  assert.match(res.stdout, /--check-file/);
});

// ── intent section (narrative lead) ─────────────────────────────────────────
// Modeled on the real sibling intent.json shape (reference/schemas/intent.md):
// goal, problem, tradeoffs, nonNegotiables. Absence renders no section.
const INTENT = {
  goal: 'Make the plan gate substantially less thin.',
  problem: 'The plan page reads as a wall of tasks with no goal or pain.',
  tradeoffs: ['Tier C (scored rubric) deferred until A+B lands'],
  nonNegotiables: ['Blades never git commit/push'],
};

test('intent: goal banner + Why/Pain render ABOVE the first task when intent.json present', () => {
  const html = renderPlanHtml(GOLDEN_PLAN, { sourcePath: 'plan.json', intent: { data: INTENT } });

  assert.ok(html.includes('<h2 class="kit-h2">Goal</h2>'), 'Goal heading rendered');
  assert.ok(html.includes('Make the plan gate substantially less thin.'), 'goal text rendered');
  assert.ok(html.includes('<h2 class="kit-h2">Why</h2>'), 'Why heading rendered');
  assert.ok(html.includes('The plan page reads as a wall of tasks'), 'problem text rendered');
  assert.ok(html.includes('<h2 class="kit-h2">Tradeoffs</h2>'), 'Tradeoffs heading rendered');
  assert.ok(html.includes('Tier C (scored rubric) deferred'), 'tradeoff item rendered');
  assert.ok(html.includes('Non-negotiables'), 'nonNegotiables label rendered');
  assert.ok(html.includes('Blades never git commit/push'), 'nonNegotiable item rendered');

  const goalIdx = html.indexOf('<h2 class="kit-h2">Goal</h2>');
  const firstTaskIdx = html.indexOf('B1-renderer');
  assert.ok(goalIdx > -1 && firstTaskIdx > -1 && goalIdx < firstTaskIdx, 'goal appears above the first task in source order');
  const whyIdx = html.indexOf('<h2 class="kit-h2">Why</h2>');
  assert.ok(whyIdx > -1 && whyIdx < firstTaskIdx, 'why appears above the first task in source order');
});

test('intent: fields are independently optional - goal without problem/tradeoffs still renders', () => {
  const html = renderPlanHtml(GOLDEN_PLAN, { sourcePath: 'plan.json', intent: { data: { goal: 'Only a goal.' } } });
  assert.ok(html.includes('<h2 class="kit-h2">Goal</h2>') && html.includes('Only a goal.'));
  assert.ok(!html.includes('<h2 class="kit-h2">Why</h2>'), 'no Why section without problem');
  assert.ok(!html.includes('<h2 class="kit-h2">Tradeoffs</h2>'), 'no Tradeoffs section without tradeoffs/nonNegotiables');
});

test('intent: unknown fields (doneWhen, priority, _meta) fall through visibly', () => {
  const html = renderPlanHtml(GOLDEN_PLAN, {
    sourcePath: 'plan.json',
    intent: { data: { goal: 'g', doneWhen: ['thing works'], _meta: { phase: 'B' } } },
  });
  assert.ok(html.includes('<h2 class="kit-h2">Other intent fields</h2>'), 'Other intent fields section rendered');
  assert.ok(html.includes('thing works'), 'doneWhen item shown');
  assert.ok(html.includes('Phase'), '_meta shown readably, humanized');
});

test('intent: malformed sibling file surfaces a loud escaped note, not silence', () => {
  const html = renderPlanHtml(GOLDEN_PLAN, {
    sourcePath: 'plan.json',
    intent: { error: 'invalid JSON in intent file p.json: Unexpected token' },
  });
  assert.ok(html.includes('<h2 class="kit-h2">Intent</h2>'));
  assert.ok(html.includes('invalid JSON in intent file'));
});

test('intent: hostile strings render inert', () => {
  const html = renderPlanHtml(GOLDEN_PLAN, {
    sourcePath: 'plan.json',
    intent: { data: { goal: '<script>alert(1)</script>', problem: '<img src=x onerror=go()>' } },
  });
  assert.ok(!html.includes('<script>alert(1)</script>'));
  assert.ok(!html.includes('<img src=x onerror'));
  assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
});

test('intent: absent (null) renders no section', () => {
  const html = renderPlanHtml(GOLDEN_PLAN, { sourcePath: 'plan.json', intent: null });
  assert.ok(!html.includes('<h2 class="kit-h2">Goal</h2>') && !html.includes('<h2 class="kit-h2">Why</h2>'));
});

test('loadIntent: absent file -> null; valid file -> { data }; malformed -> { error }', () => {
  const dir = mkTmpDir();
  assert.equal(loadIntent(path.join(dir, 'no-such-intent.json')), null);

  const good = path.join(dir, 'intent.json');
  fs.writeFileSync(good, JSON.stringify({ goal: 'g' }));
  assert.deepEqual(loadIntent(good), { data: { goal: 'g' } });

  const bad = path.join(dir, 'bad-intent.json');
  fs.writeFileSync(bad, '{ not json');
  const res = loadIntent(bad);
  assert.ok(res.error && /invalid JSON in intent file/.test(res.error));
});

// ── wiring section (dependencies + risk) ────────────────────────────────────
// Modeled on the real wiring.json shape (reference/wiring.md).
const WIRING = {
  dependencies: [
    { task: 'B1-renderer', produces: ['scripts/render-plan.js'], consumes: [] },
    { task: 'V1', produces: [], consumes: ['scripts/render-plan.js'] },
  ],
  waves: [{ wave: 1, tasks: ['B1-renderer'], parallel: true }],
  riskPoints: [
    { type: 'interface', producer: 'B1-renderer', consumers: ['V1'], mitigation: 'Freeze render output shape before V1' },
  ],
};

test('wiring: sibling wiring.json renders Dependencies + Risk points sections', () => {
  const html = renderPlanHtml(GOLDEN_PLAN, { sourcePath: 'plan.json', wiring: { data: WIRING } });

  assert.ok(html.includes('<h2 class="kit-h2">Dependencies</h2>'), 'Dependencies heading rendered');
  assert.ok(html.includes('scripts/render-plan.js'), 'produces item rendered');
  assert.ok(html.includes('<h2 class="kit-h2">Risk points</h2>'), 'Risk points heading rendered');
  assert.ok(html.includes('interface'), 'risk type rendered');
  assert.ok(html.includes('B1-renderer'), 'risk producer rendered');
  assert.ok(html.includes('V1'), 'risk consumer rendered');
  assert.ok(html.includes('Freeze render output shape before V1'), 'mitigation rendered');
  assert.ok(html.includes('<h2 class="kit-h2">Other wiring fields</h2>') && html.includes('Parallel'), 'wiring.waves falls through visibly, humanized');
});

test('wiring: absent (null) renders no section', () => {
  const html = renderPlanHtml(GOLDEN_PLAN, { sourcePath: 'plan.json', wiring: null });
  assert.ok(!html.includes('<h2 class="kit-h2">Dependencies</h2>') && !html.includes('<h2 class="kit-h2">Risk points</h2>'));
});

test('wiring: malformed sibling file surfaces a loud escaped note, not silence', () => {
  const html = renderPlanHtml(GOLDEN_PLAN, {
    sourcePath: 'plan.json',
    wiring: { error: 'invalid JSON in wiring file p.json: Unexpected token' },
  });
  assert.ok(html.includes('<h2 class="kit-h2">Dependencies</h2>'));
  assert.ok(html.includes('invalid JSON in wiring file'));
});

test('wiring: hostile strings render inert', () => {
  const html = renderPlanHtml(GOLDEN_PLAN, {
    sourcePath: 'plan.json',
    wiring: { data: { riskPoints: [{ type: 'merge', mitigation: '<script>pwn()</script>' }] } },
  });
  assert.ok(!html.includes('<script>pwn()</script>'));
  assert.ok(html.includes('&lt;script&gt;pwn()&lt;/script&gt;'));
});

test('loadWiring: absent file -> null; valid file -> { data }; malformed -> { error }', () => {
  const dir = mkTmpDir();
  assert.equal(loadWiring(path.join(dir, 'no-such-wiring.json')), null);

  const good = path.join(dir, 'wiring.json');
  fs.writeFileSync(good, JSON.stringify({ dependencies: [] }));
  assert.deepEqual(loadWiring(good), { data: { dependencies: [] } });

  const bad = path.join(dir, 'bad-wiring.json');
  fs.writeFileSync(bad, '{ not json');
  const res = loadWiring(bad);
  assert.ok(res.error && /invalid JSON in wiring file/.test(res.error));
});

// ── outcome-first tasks + acceptance-criteria checklist ─────────────────────
// The canonical task template (reference/schemas/plan.md): the body prose is the
// headline, acceptance_criteria is a first-class checklist, everything else is
// tucked behind a collapsible <details> block.
const TASK_TEMPLATE_PLAN = {
  route: 'shadows',
  tasks: [
    {
      id: 'T1',
      description: 'Add useCostByTag hook that memoizes result',
      read_first: ['src/hooks/useCostData.ts'],
      acceptance_criteria: ['Hook returns { data, loading, error }', 'Existing tests still pass'],
      action: 'Create src/hooks/useCostByTag.ts',
      verify: 'npm test',
      files: ['src/hooks/useCostByTag.ts'],
      dependsOn: ['T0'],
      agent: 'backend',
    },
  ],
};

test('outcome-first: body prose is the headline; acceptance_criteria renders as a checklist, not a JSON dump', () => {
  const html = renderPlanHtml(TASK_TEMPLATE_PLAN, { sourcePath: 'p.json' });

  assert.ok(html.includes('<div class="task-body">'), 'task body rendered as prose block');
  assert.ok(html.includes('Add useCostByTag hook that memoizes result'), 'description is the body headline');
  assert.ok(html.includes('<div class="kit-kv-key">Acceptance criteria</div>'), 'acceptance criteria label rendered');
  assert.ok(html.includes('<ul class="kit-checklist">'), 'acceptance criteria renders as a kit checklist');
  assert.ok(html.includes('Hook returns'), 'acceptance criteria item 1 shown');
  assert.ok(html.includes('Existing tests still pass'), 'acceptance criteria item 2 shown');
  assert.ok(!/"acceptance_criteria"/.test(html), 'acceptance_criteria never appears as a raw JSON key');
});

test('outcome-first: files/action/verify/read_first/dependsOn are tucked into a collapsible <details> block', () => {
  const html = renderPlanHtml(TASK_TEMPLATE_PLAN, { sourcePath: 'p.json' });

  assert.ok(html.includes('<details class="task-details"><summary>Details</summary>'), 'details block present');
  const detailsStart = html.indexOf('<details class="task-details">');
  const detailsEnd = html.indexOf('</details>', detailsStart);
  const detailSlice = html.slice(detailsStart, detailsEnd);
  assert.ok(detailSlice.includes('src/hooks/useCostByTag.ts'), 'files inside details');
  assert.ok(detailSlice.includes('npm test'), 'verify inside details');
  assert.ok(detailSlice.includes('src/hooks/useCostData.ts'), 'read_first inside details');
  assert.ok(detailSlice.includes('T0'), 'dependsOn inside details');

  const bodyIdx = html.indexOf('<div class="task-body">');
  const acIdx = html.indexOf('kit-checklist');
  assert.ok(bodyIdx > -1 && bodyIdx < detailsStart, 'body prose comes before the collapsible detail');
  assert.ok(acIdx > -1 && acIdx < detailsStart, 'checklist comes before the collapsible detail');
});

test('outcome-first: a task with no acceptance_criteria and no extra fields renders without an empty checklist or empty details', () => {
  const html = renderPlanHtml({ tasks: [{ id: 'T1', description: 'bare task' }] }, { sourcePath: 'p.json' });
  assert.ok(html.includes('bare task'));
  assert.ok(!html.includes('<ul class="kit-checklist">'), 'no checklist rendered when acceptance_criteria absent');
  assert.ok(!html.includes('<details'), 'no empty details block when nothing to tuck away');
});

test('outcome-first: malformed (non-array) acceptance_criteria falls through, not dropped', () => {
  const html = renderPlanHtml({ tasks: [{ id: 'T1', description: 'x', acceptance_criteria: 'must pass' }] }, { sourcePath: 'p.json' });
  assert.ok(html.includes('must pass'), 'malformed value still shown');
  assert.ok(!html.includes('<ul class="kit-checklist">'), 'not rendered as a checklist when malformed');
});

// ── combined: intent + wiring + outcome-first tasks together ───────────────

test('combined: intent AND wiring both absent - no crash, sections omitted, tasks still render', () => {
  const html = renderPlanHtml(TASK_TEMPLATE_PLAN, { sourcePath: 'p.json' });
  assert.ok(html.startsWith('<!DOCTYPE html>'));
  assert.ok(!html.includes('<h2 class="kit-h2">Goal</h2>') && !html.includes('<h2 class="kit-h2">Why</h2>') && !html.includes('<h2 class="kit-h2">Tradeoffs</h2>'));
  assert.ok(!html.includes('<h2 class="kit-h2">Dependencies</h2>') && !html.includes('<h2 class="kit-h2">Risk points</h2>'));
  assert.ok(html.includes('Add useCostByTag hook that memoizes result'), 'task still renders');
});

test('combined: determinism with intent + wiring both present - two renders byte-identical', () => {
  const opts = { sourcePath: 'plan.json', intent: { data: INTENT }, wiring: { data: WIRING } };
  assert.equal(renderPlanHtml(GOLDEN_PLAN, opts), renderPlanHtml(GOLDEN_PLAN, opts));
});

test('CLI: sibling intent.json and wiring.json are auto-discovered and rendered; exit 0', () => {
  const dir = mkTmpDir();
  const input = path.join(dir, 'plan.json');
  fs.writeFileSync(input, JSON.stringify(GOLDEN_PLAN));
  fs.writeFileSync(path.join(dir, 'intent.json'), JSON.stringify(INTENT));
  fs.writeFileSync(path.join(dir, 'wiring.json'), JSON.stringify(WIRING));

  const res = runCli([input]);
  assert.equal(res.status, 0, res.stderr);
  const html = fs.readFileSync(path.join(dir, 'plan.html'), 'utf8');
  assert.ok(html.includes('<h2 class="kit-h2">Goal</h2>'), 'sibling intent.json rendered');
  assert.ok(html.includes('<h2 class="kit-h2">Dependencies</h2>'), 'sibling wiring.json rendered');
});

test('CLI: no sibling intent.json/wiring.json -> no sections, exit 0', () => {
  const dir = mkTmpDir();
  const input = path.join(dir, 'plan.json');
  fs.writeFileSync(input, JSON.stringify(GOLDEN_PLAN));

  const res = runCli([input]);
  assert.equal(res.status, 0, res.stderr);
  const html = fs.readFileSync(path.join(dir, 'plan.html'), 'utf8');
  assert.ok(!html.includes('<h2 class="kit-h2">Goal</h2>') && !html.includes('<h2 class="kit-h2">Dependencies</h2>'));
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
