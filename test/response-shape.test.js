// Author: Subash Karki
// response-shape.test.js — pins the response-shape contract to the surfaces
// that carry it. Two classes of check:
//   1. Wiring: the contract is present in the one file every preamble tier
//      loads, and it agrees with the reference it points at. i-have-adhd's
//      mechanism is not a runtime gate either — it is guaranteeing the rules
//      are in context. Here, `_shared.md` is that guarantee, so the test
//      protects the guarantee rather than the generated prose.
//   2. Drift: no command's own example output demonstrates what the contract
//      forbids. A 30-command surface drifts one banned opener at a time.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const SHARED = path.join(ROOT, 'commands', '_shared.md');
const REFERENCE = path.join(ROOT, 'reference', 'response-shape.md');
const COMMANDS_DIR = path.join(ROOT, 'commands');

const read = (file) => fs.readFileSync(file, 'utf8');

// The openers/closers the contract forbids. Kept in one place so the reference,
// _shared.md, and this test cannot disagree about what "banned" means.
const BANNED_OPENERS = [
  'Great question',
  "I'll go ahead and",
  'Sure!',
  'Looking at your',
  'Perfect!',
  "I'm going to start by",
];
const BANNED_CLOSERS = [
  'Let me know if you need anything else',
  'Hope this helps',
  'Feel free to ask',
  'Happy to dig deeper',
];

test('the response-shape reference exists and covers every rule _shared.md advertises', () => {
  const reference = read(REFERENCE);
  for (const heading of [
    'Decision first',
    'Name where the run is',
    'Quantities are measured',
    'Findings ranked, then capped',
    'Errors state cause, then fix',
    'Blockers surface before their explanation',
    'Tangents wait',
    'No preamble, no recap, no closers',
    'When these rules yield',
    'Pre-send check',
  ]) {
    assert.ok(reference.includes(heading), `reference is missing the "${heading}" rule`);
  }
});

test('_shared.md carries the contract, so every preamble tier loads it', () => {
  // T1 commands (status, health) load _shared.md and nothing else. Putting the
  // contract anywhere else would exempt exactly the leaf commands whose whole
  // output is a report.
  const shared = read(SHARED);
  assert.ok(shared.includes('## Response Shape'), '_shared.md must carry the inline contract');
  assert.ok(
    shared.includes('reference/response-shape.md'),
    '_shared.md must point at the full reference',
  );
  assert.match(
    shared,
    /16\. \*\*Response shape\*\*/,
    'Response shape must be listed as a Core Discipline',
  );
});

test('Core Discipline numbering stays contiguous after the addition', () => {
  const shared = read(SHARED);
  const numbers = [...shared.matchAll(/^(\d+)\. \*\*/gm)].map((m) => Number(m[1]));
  for (let n = 1; n <= 16; n++) {
    assert.ok(numbers.includes(n), `Core Discipline ${n} is missing from the list`);
  }
});

test('the contract does not contradict the rules that already own other output', () => {
  const reference = read(REFERENCE);
  // Final Status Block owns the last line; output-contract.md owns script output.
  // The reference must defer to both by name rather than restating them.
  assert.ok(reference.includes('Final Status Block'), 'must defer to the Final Status Block');
  assert.ok(reference.includes('output-contract.md'), 'must defer to the script output contract');
});

test('no command demonstrates a banned opener or closer in its own example output', () => {
  const files = fs.readdirSync(COMMANDS_DIR).filter((f) => f.endsWith('.md'));
  assert.ok(files.length > 20, 'command surface should be present');
  const violations = [];
  for (const file of files) {
    const body = read(path.join(COMMANDS_DIR, file));
    for (const [index, line] of body.split('\n').entries()) {
      // The contract file itself quotes these to forbid them; skip the lines
      // that are naming a banned phrase rather than using one.
      if (/Forbidden|forbidden|banned|not "Great question"/.test(line)) continue;
      for (const phrase of [...BANNED_OPENERS, ...BANNED_CLOSERS]) {
        if (line.includes(phrase)) violations.push(`${file}:${index + 1} — "${phrase}"`);
      }
    }
  }
  assert.deepEqual(violations, [], `banned phrasing in command output:\n  ${violations.join('\n  ')}`);
});

test('every banned phrase the reference lists is also enforced by this test', () => {
  // Guards the gap that makes a lint decorative: a phrase added to the prose
  // list but never to the checker would read as enforced and never be checked.
  const reference = read(REFERENCE);
  for (const phrase of [...BANNED_OPENERS, ...BANNED_CLOSERS]) {
    assert.ok(
      reference.includes(phrase),
      `"${phrase}" is enforced here but not listed in the reference`,
    );
  }
});

// ---------------------------------------------------------------------------
// Session-wide persistence. _shared.md shapes a command's own report and then
// lapses; the SessionStart hook is what carries the contract into ordinary
// conversational turns. These pin the mechanism, not the generated prose.
// ---------------------------------------------------------------------------

const { execFileSync } = require('node:child_process');
const os = require('node:os');

const HOOK = path.join(ROOT, 'hooks', 'response-shape.js');
const HOOKS_JSON = path.join(ROOT, 'hooks', 'hooks.json');

function runHook(env) {
  return execFileSync(process.execPath, [HOOK], {
    encoding: 'utf8',
    input: '',
    env: { ...process.env, ...env },
  });
}

test('the hook is registered on SessionStart for every context-losing source', () => {
  const hooks = JSON.parse(read(HOOKS_JSON));
  const sessionStart = hooks.hooks.SessionStart;
  assert.ok(Array.isArray(sessionStart) && sessionStart.length, 'SessionStart must be registered');
  const entry = sessionStart.find((e) => JSON.stringify(e).includes('response-shape.js'));
  assert.ok(entry, 'response-shape.js must be wired to SessionStart');
  // `compact` is the load-bearing one: compaction drops the injected block, and
  // a mode that dies at the first compaction is worse than one never enabled.
  for (const source of ['startup', 'resume', 'clear', 'compact']) {
    assert.ok(entry.matcher.includes(source), `matcher must cover "${source}"`);
  }
});

test('the hook stays silent unless the mode is explicitly enabled', () => {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'phantom-shape-off-'));
  assert.equal(runHook({ PHANTOM_DATA: data, PHANTOM_RESPONSE_SHAPE: '' }), '');
});

test('the hook injects the contract when the mode is on', () => {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'phantom-shape-on-'));
  const out = runHook({ PHANTOM_DATA: data, PHANTOM_RESPONSE_SHAPE: 'always' });
  assert.match(out, /applies to every response for the rest of this session/);
  assert.ok(out.includes('## Rules'), 'the rules themselves must be injected');
  assert.ok(out.includes('Pre-send check'), 'the pre-send check must be injected');
  // Maintainer-facing framing is not actionable for the model and is skipped.
  assert.ok(!out.includes('# Response Shape\n'), 'the file title should not be injected');
});

test('the hook never blocks session start on bad input', () => {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'phantom-shape-bad-'));
  fs.writeFileSync(path.join(data, 'config.json'), 'not json at all');
  assert.equal(runHook({ PHANTOM_DATA: data, PHANTOM_RESPONSE_SHAPE: '' }), '');
});

test('output.response_shape is a closed enum in the config schema', () => {
  const config = read(path.join(ROOT, 'scripts', 'phantom-config.js'));
  assert.match(
    config,
    /'output\.response_shape':\s*\{\s*type:\s*'enum',\s*values:\s*\['off',\s*'always'\]\s*\}/,
    'the key must exist as a closed off|always enum',
  );
});

test('the portable skill carries the contract too, since it loads no commands', () => {
  // skills/phantom/ is the provider-neutral distribution: it never reads
  // commands/_shared.md, so omitting the contract there would ship an unshaped
  // Phantom to every portable host.
  const router = read(path.join(ROOT, 'skills', 'phantom', 'SKILL.md'));
  assert.ok(router.includes('## Response shape'), 'portable router must carry the contract');
  assert.match(router, /every response for the rest of the session/);
});
