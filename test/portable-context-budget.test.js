// Author: Subash karki
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const START = path.join(ROOT, 'skills', 'start', 'SKILL.md');
const PHANTOM = path.join(ROOT, 'skills', 'phantom');
const ROUTER = path.join(PHANTOM, 'SKILL.md');
const REFERENCES = path.join(PHANTOM, 'references');
const PHASES = ['planning.md', 'execution.md', 'verification.md', 'shipping.md'];

const read = (file) => fs.readFileSync(file, 'utf8');
const bytes = (file) => Buffer.byteLength(read(file), 'utf8');
const approximateTokens = (count) => Math.ceil(count / 4);

function directReferenceLinks(markdown) {
  return [...markdown.matchAll(/\]\(references\/([^)]+\.md)\)/g)].map((match) => match[1]);
}

test('portable router stays within its activated context budget', (t) => {
  const routerBytes = bytes(ROUTER);
  t.diagnostic(`router: ${routerBytes} bytes / ~${approximateTokens(routerBytes)} tokens`);
  // Raised 6000 -> 6500 when § Response shape landed in the router. The contract
  // governs every response, so it has to be resident wherever the router is, and
  // the four-phase-reference invariant below deliberately blocks a fifth file.
  // The extra ~1.1KB buys that; the ceiling still exists so it cannot creep.
  assert.ok(routerBytes <= 6_500, `router is ${routerBytes} bytes; budget is 6500`);
});

test('standard start closure stays below the mandatory context budget', (t) => {
  const components = [START, ROUTER, path.join(REFERENCES, 'planning.md')];
  const measured = components.map((file) => ({ file: path.relative(ROOT, file), bytes: bytes(file) }));
  const total = measured.reduce((sum, component) => sum + component.bytes, 0);
  t.diagnostic(`${measured.map(({ file, bytes: size }) => `${file}=${size}`).join(', ')}`);
  t.diagnostic(`standard start: ${total} bytes / ~${approximateTokens(total)} tokens`);
  // Raised 16000 -> 17500 for the same reason as the router budget above. The
  // closure sat at 15994 of 16000 before this, so the old ceiling had six bytes
  // of headroom and would have blocked any addition at all.
  assert.ok(total <= 17_500, `standard start closure is ${total} bytes; budget is 17500`);
});

test('router exposes exactly four direct one-hop phase references', () => {
  const links = directReferenceLinks(read(ROUTER));
  assert.deepEqual(links, PHASES);
  for (const phase of PHASES) {
    const file = path.join(REFERENCES, phase);
    assert.ok(fs.statSync(file).isFile(), `${phase} must exist`);
    assert.equal(directReferenceLinks(read(file)).length, 0, `${phase} must not chain phase references`);
  }
});

test('normal start adapter directly activates the portable router', () => {
  const adapter = read(START);
  assert.match(adapter, /\.\.\/phantom\/SKILL\.md/);
  assert.match(adapter, /\.\.\/phantom\/references\/planning\.md/);
  assert.doesNotMatch(adapter, /resolve-codex-runtime|commands\/start\.md|_shared|preamble/i);
});

test('legacy compatibility resources remain installed but outside normal activation', () => {
  for (const file of [
    path.join(ROOT, 'commands', 'start.md'),
    path.join(ROOT, 'codex-support', 'codex-compatibility.md'),
    path.join(ROOT, 'commands', '_shared.md'),
  ]) {
    assert.ok(fs.statSync(file).isFile(), `${path.relative(ROOT, file)} must remain installed`);
  }
});
