// Author: Subash Karki
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { spawnSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const SCRIPT = path.join(ROOT, 'skills/gorkhali/scripts/sdlc-chain.mjs');

async function load() {
  return import(pathToFileURL(SCRIPT).href);
}

function run(args, options = {}) {
  return spawnSync(process.execPath, [SCRIPT, ...args], {
    encoding: 'utf8',
    cwd: options.cwd || ROOT,
  });
}

const PLAYBOOK_INTENT = `# Intent: claims status self-service
Author: J. Ortiz (claims operations). Status: draft.

## Problem
Customers phone the contact center to ask where their claim is.

## Proposed outcome
Customers see claim status, next step and expected date in the portal.

## Affected users and systems
Claims handlers, portal team, claims-core API.

## Constraints
No new PII in the portal session.

## Open questions
Do third-party loss adjusters need access too?
`;

test('parseIntentMarkdown captures playbook fields without inventing them', async () => {
  const { parseIntentMarkdown } = await load();
  const parsed = parseIntentMarkdown(PLAYBOOK_INTENT);
  assert.equal(parsed.title, 'claims status self-service');
  assert.equal(parsed.status, 'draft');
  assert.match(parsed.author, /J\. Ortiz/);
  assert.match(parsed.problem, /contact center/);
  assert.match(parsed.proposed_outcome, /claim status/);
  assert.match(parsed.summary, /claim status/);
  assert.match(parsed.constraints, /No new PII/);
});

test('parseIntentMarkdown marks missing sections instead of guessing', async () => {
  const { parseIntentMarkdown } = await load();
  const parsed = parseIntentMarkdown('# Intent: empty idea\n');
  assert.equal(parsed.problem, '_Not recorded');
  assert.equal(parsed.constraints, '_Not recorded');
  assert.equal(parsed.status, 'draft');
});

test('planCompliance is aligned, drift, wrong, or n/a — never a silent pass', async () => {
  const { planCompliance } = await load();
  const plan = {
    tasks: [
      { id: 'T1', description: 'Add panel', files: ['src/Status.tsx'] },
      { id: 'T2', description: 'Add route', files: ['api/status.py'] },
    ],
  };
  assert.equal(planCompliance(plan, ['src/Status.tsx', 'api/status.py']).status, 'aligned');
  assert.equal(planCompliance(plan, ['src/Status.tsx']).status, 'drift');
  assert.equal(planCompliance(plan, ['unrelated.ts']).status, 'wrong');
  assert.equal(planCompliance(null, ['src/Status.tsx']).status, 'n/a');
});

test('renderChain writes dual-readable files from session JSON and omits absent stages', async () => {
  const { renderChain } = await load();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sdlc-chain-'));
  fs.writeFileSync(path.join(dir, 'session.json'), JSON.stringify({
    task_id: 'CP-9',
    intent_summary: 'Show claim status in the portal',
  }));
  fs.writeFileSync(path.join(dir, 'intent.json'), JSON.stringify({
    task_id: 'CP-9',
    summary: 'Show claim status in the portal',
    problem: 'Status-only calls clog the contact center',
  }));
  fs.writeFileSync(path.join(dir, 'plan.json'), JSON.stringify({
    title: 'claims status self-service',
    tasks: [{ id: 'T1', description: 'Add endpoint', files: ['api/status.py'] }],
    risks: [{ risk: 'claims-core rate-limits at 50 rps' }],
    outcome: { doneWhen: ['test_status.py covers four claim states'] },
  }));

  const chain = renderChain(dir, { trackerId: 'CP-9', commitSha: 'abc123' });
  assert.ok(chain.files['intent.md'].includes('## Problem'));
  assert.ok(chain.files['plan.md'].includes('api/status.py'));
  assert.ok(chain.files['plan.md'].includes('claims-core rate-limits'));
  assert.equal(chain.files['spec.md'], undefined);
  assert.ok(chain.files['intent.md'].includes('Tracker: CP-9'));
  assert.doesNotMatch(chain.files['intent.md'], /\/tmp|\/home\//);
});

test('CLI ingest returns compact summary without absolute paths', () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'sdlc-ingest-'));
  const empty = run(['ingest', '--workspace', workspace, '--task', 'CP-1']);
  assert.equal(empty.status, 0, empty.stderr);
  assert.deepEqual(JSON.parse(empty.stdout), { found: false });

  fs.mkdirSync(path.join(workspace, '.gorkhali/sdlc/CP-1'), { recursive: true });
  fs.writeFileSync(path.join(workspace, '.gorkhali/sdlc/CP-1/intent.md'), PLAYBOOK_INTENT);
  const hit = run(['ingest', '--workspace', workspace, '--task', 'CP-1']);
  assert.equal(hit.status, 0, hit.stderr);
  const payload = JSON.parse(hit.stdout);
  assert.equal(payload.found, true);
  assert.equal(payload.relative, '.gorkhali/sdlc/CP-1/intent.md');
  assert.equal(payload.status, 'draft');
  assert.match(payload.summary, /claim status/);
  assert.equal(payload.absolute, undefined);
  assert.equal(payload.problem, undefined);
});

test('CLI parse-intent and plan-compliance speak JSON', () => {
  const file = path.join(os.tmpdir(), `intent-${Date.now()}.md`);
  fs.writeFileSync(file, PLAYBOOK_INTENT);
  const parsed = run(['parse-intent', '--file', file]);
  assert.equal(parsed.status, 0, parsed.stderr);
  assert.match(JSON.parse(parsed.stdout).proposed_outcome, /portal/);

  const planFile = path.join(os.tmpdir(), `plan-${Date.now()}.json`);
  fs.writeFileSync(planFile, JSON.stringify({
    tasks: [{ id: 'T1', files: ['a.ts'] }],
  }));
  const compliance = run(['plan-compliance', '--plan', planFile, '--changed', 'a.ts']);
  assert.equal(compliance.status, 0, compliance.stderr);
  assert.equal(JSON.parse(compliance.stdout).status, 'aligned');
});

test('CLI render --out writes only relative filenames', () => {
  const session = fs.mkdtempSync(path.join(os.tmpdir(), 'sdlc-session-'));
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'sdlc-out-'));
  fs.writeFileSync(path.join(session, 'session.json'), JSON.stringify({ task_id: 'T-1' }));
  fs.writeFileSync(path.join(session, 'intent.json'), JSON.stringify({ summary: 'Ship the chain' }));
  const rendered = run(['render', '--session', session, '--out', out, '--task', 'T-1']);
  assert.equal(rendered.status, 0, rendered.stderr);
  const payload = JSON.parse(rendered.stdout);
  assert.deepEqual(payload.written, ['intent.md']);
  assert.ok(fs.existsSync(path.join(out, 'intent.md')));
});

test('wrap and start treat the chain as a product-repo audit copy, not session state', () => {
  const wrap = fs.readFileSync(path.join(ROOT, 'commands/wrap.md'), 'utf8');
  const start = fs.readFileSync(path.join(ROOT, 'commands/start.md'), 'utf8');
  assert.match(wrap, /sdlc-chain\.mjs render/);
  assert.match(wrap, /Do not commit\nGorkhali session artifacts/);
  assert.doesNotMatch(wrap, /intent\.json/);
  assert.match(start, /sdlc-chain\.mjs ingest/);
  assert.doesNotMatch(start, /locate-intent|parse-intent/);
  assert.match(start, /not session state/);
  assert.match(start, /## Proto-spec/);
  assert.match(start, /--out \{SESSION_DIR\}/);
  assert.doesNotMatch(start, /Skill\(skill="gorkhali:intake"/);
});

test('locateIntentFile prefers .gorkhali/sdlc then intent/', async () => {
  const { locateIntentFile } = await load();
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'sdlc-ws-'));
  assert.equal(locateIntentFile(workspace, 'CP-1'), null);
  fs.mkdirSync(path.join(workspace, 'intent'), { recursive: true });
  fs.writeFileSync(path.join(workspace, 'intent/CP-1.md'), '# Intent: fallback\n');
  assert.equal(locateIntentFile(workspace, 'CP-1').relative, 'intent/CP-1.md');
  fs.mkdirSync(path.join(workspace, '.gorkhali/sdlc/CP-1'), { recursive: true });
  fs.writeFileSync(path.join(workspace, '.gorkhali/sdlc/CP-1/intent.md'), '# Intent: preferred\n');
  assert.equal(locateIntentFile(workspace, 'CP-1').relative, '.gorkhali/sdlc/CP-1/intent.md');
});
