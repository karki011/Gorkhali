// Author: Subash Karki
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const SCRIPT = path.join(__dirname, '..', 'skills', 'phantom', 'scripts', 'validate-review-html.mjs');
const BRAINSTORM_COMMAND = path.join(__dirname, '..', 'commands', 'brainstorm.md');
const CSP = "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'";
const CSP_META = `<meta http-equiv="Content-Security-Policy" content="${CSP}">`;

const plan = () => ({
  decision: {
    question: 'Approve the decision-first review?',
    recommendation: 'Generate the review page directly from canonical JSON.',
  },
  outcome: { goal: 'A concise, safe plan review.' },
});

const brainstorm = () => ({
  decision: { question: 'Which review approach should we use?' },
  approaches: [{ id: 'direct-html', name: 'Direct AI HTML' }],
  recommendedDefault: { id: 'direct-html', reason: 'It removes the renderer layer.' },
  directionGate: { question: 'Choose the direct HTML approach?' },
});

const page = (content, extraHead = '') => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
${CSP_META}<title>Review</title>${extraHead}</head>
<body><main><h1>Review</h1>${content}</main></body></html>`;

const planPage = (extra = '', extraHead = '') => page(`<p>${plan().decision.question}</p><p>${plan().decision.recommendation}</p><p>${plan().outcome.goal}</p>${extra}`, extraHead);
const brainstormPage = () => page(`<p>${brainstorm().decision.question}</p><p>Direct AI HTML</p><p>${brainstorm().recommendedDefault.reason}</p><p>${brainstorm().directionGate.question}</p>`);
const fixtureDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'phantom-review-html-'));

const run = (dir, type, source, candidate, output = 'accepted.html') => {
  const sourcePath = path.join(dir, 'source.json');
  const candidatePath = path.join(dir, 'candidate.html');
  const outputPath = path.join(dir, output);
  fs.writeFileSync(sourcePath, JSON.stringify(source));
  fs.writeFileSync(candidatePath, candidate);
  const result = spawnSync(process.execPath, [SCRIPT, type, '--source', sourcePath, '--candidate', candidatePath, '--out', outputPath], { encoding: 'utf8' });
  return { ...result, outputPath };
};

test('promotes a valid plan candidate without changing its authored markup', () => {
  const dir = fixtureDir();
  const html = planPage('<details><summary>Execution appendix</summary><p>Task details</p></details>');
  const result = run(dir, 'plan', plan(), html);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.readFileSync(result.outputPath, 'utf8'), html);
  assert.equal(fs.statSync(result.outputPath).mode & 0o777, 0o600);
  assert.deepEqual(fs.readdirSync(dir).filter((name) => name.endsWith('.tmp')), []);
});

test('accepts a valid brainstorm candidate', () => {
  const result = run(fixtureDir(), 'brainstorm', brainstorm(), brainstormPage());
  assert.equal(result.status, 0, result.stderr);
});

test('accepts a canonical payload inside a portable state envelope', () => {
  const source = { schema_version: 1, artifact_type: 'plan', evidence: plan() };
  const result = run(fixtureDir(), 'plan', source, planPage());
  assert.equal(result.status, 0, result.stderr);
});

test('accepts policy-equivalent CSP meta attribute order, quotes, and extra attributes', () => {
  const escapedPolicy = CSP.replaceAll("'", '&apos;');
  const flexibleMeta = `<meta data-review="plan" content='${escapedPolicy}' http-equiv='Content-Security-Policy'>`;
  const result = run(fixtureDir(), 'plan', plan(), planPage().replace(CSP_META, flexibleMeta));
  assert.equal(result.status, 0, result.stderr);
});

test('allows URL-attribute-like prose in canonical review content', () => {
  const source = plan();
  source.decision.question = 'Should src=generated/output.json remain visible?';
  source.decision.recommendation = 'Keep action=deploy as plain review prose.';
  source.outcome.goal = 'Document poster=review and ping=disabled without creating attributes.';
  const html = page(`<p>${source.decision.question}</p><p>${source.decision.recommendation}</p><p>${source.outcome.goal}</p>`);
  const result = run(fixtureDir(), 'plan', source, html);
  assert.equal(result.status, 0, result.stderr);
});

test('rejects CSP metadata hidden inside a quoted head attribute', () => {
  const escapedPolicy = CSP.replaceAll("'", '&apos;');
  const fakeHead = `<head data='><meta charset="utf-8"><meta name="viewport" content="x"><meta http-equiv="Content-Security-Policy" content="${escapedPolicy}"><title>Review</title>'></head>`;
  const html = `<!doctype html><html lang="en">${fakeHead}<body background="https://example.test/pixel"><main><h1>Review</h1><p>${plan().decision.question}</p><p>${plan().decision.recommendation}</p><p>${plan().outcome.goal}</p></main></body></html>`;
  const result = run(fixtureDir(), 'plan', plan(), html);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /missing required restrictive Content Security Policy/);
  assert.match(result.stderr, /contains a URL-bearing attribute/);
});

test('rejects a CSP head placed after the body has started', () => {
  const html = `<!doctype html><html lang="en"><body><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">${CSP_META}<title>Review</title></head><main><h1>Review</h1><p>${plan().decision.question}</p><p>${plan().decision.recommendation}</p><p>${plan().outcome.goal}</p></main></body></html>`;
  const result = run(fixtureDir(), 'plan', plan(), html);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /head element must precede body/);
});

test('rejects canonical decision text hidden inside a quoted main attribute', () => {
  const hidden = [plan().decision.question, plan().decision.recommendation, plan().outcome.goal]
    .map((value) => `<p>${value}</p>`)
    .join('');
  const html = page('<p>No decision details.</p>').replace('<main>', `<main data='>${hidden}'>`);
  const result = run(fixtureDir(), 'plan', plan(), html);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /missing canonical review text/);
});

test('keeps brainstorm candidate and accepted HTML inside the ticket session directory', () => {
  const command = fs.readFileSync(BRAINSTORM_COMMAND, 'utf8');
  assert.match(command, /--candidate \{TEAM_DIR\}\/sessions\/\{TICKET\}\/brainstorm\.candidate\.html/);
  assert.match(command, /--out \{TEAM_DIR\}\/sessions\/\{TICKET\}\/brainstorm\.html/);
  assert.doesNotMatch(command, /<(?:brainstorm\.candidate|brainstorm)\.html>/);
});

test('requires static document structure and canonical review text', () => {
  const noMain = planPage().replace('<main>', '<div>').replace('</main>', '</div>');
  const result = run(fixtureDir(), 'plan', plan(), noMain.replace(plan().outcome.goal, 'A shortened outcome'));
  assert.equal(result.status, 1);
  assert.match(result.stderr, /exactly one main/);
  assert.match(result.stderr, /missing canonical review text: A concise, safe plan review\./);
});

test('requires canonical review text in main content rather than document metadata', () => {
  const metadata = [plan().decision.question, plan().decision.recommendation, plan().outcome.goal].join(' — ');
  const html = page('<p>No decision details.</p>').replace('<title>Review</title>', `<title>${metadata}</title>`);
  const result = run(fixtureDir(), 'plan', plan(), html);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /missing canonical review text/);
});

test('requires decision text before collapsible details', () => {
  const content = `<details><summary>Decision</summary><p>${plan().decision.question}</p><p>${plan().decision.recommendation}</p><p>${plan().outcome.goal}</p></details>`;
  const result = run(fixtureDir(), 'plan', plan(), page(content));
  assert.equal(result.status, 1);
  assert.match(result.stderr, /missing canonical review text/);
});

for (const [name, html] of [
  ['script', planPage('<script>alert(1)</script>')],
  ['event handler', planPage('<p onclick="alert(1)">unsafe</p>')],
  ['external href', planPage('<a href="https://example.test">unsafe</a>')],
  ['source URL attribute', planPage('<img src="https://example.test/review.png" alt="unsafe">')],
  ['legacy background URL attribute', planPage('<table background="https://example.test/review.png"><tr><td>unsafe</td></tr></table>')],
  ['obscured external href', planPage('<a title=">" href=https://example.test>unsafe</a>')],
  ['CSS URL', planPage('', '<style>.x { background: url(https://example.test/x) }</style>')],
  ['escaped CSS URL', planPage('', '<style>.x { background: u\\72l(https://example.test/x) }</style>')],
  ['form', planPage('<form><input name="unsafe"></form>')],
  ['refresh meta', planPage('', '<meta http-equiv="refresh" content="0">')],
  ['hidden content', planPage('<p hidden>unsafe</p>')],
  ['hidden CSS', planPage('', '<style>.decision { display: none }</style>')],
  ['transparent CSS', planPage('', '<style>.decision { opacity: 0 }</style>')],
  ['dialog', planPage('<dialog open>unsafe</dialog>')],
  ['weakened CSP', planPage().replace(CSP, `${CSP}; img-src https:`)],
  ['commented CSP with image-set', planPage('', '<style>body { background: -webkit-image-set("https://example.test/pixel" 1x) }</style>').replace(CSP_META, `<!-- ${CSP_META} -->`)],
  ['late CSP', planPage('', '<style>body { color: black }</style>').replace(CSP_META, '').replace('</style>', `</style>${CSP_META}`)],
  ['fake title CSP with ping beacon', planPage('<a href="#review" ping="https://example.test/beacon">Review</a>').replace(CSP_META, '').replace('<title>Review</title>', `<title>Review ${CSP_META}</title>`)],
  ['fake attribute CSP', planPage().replace(CSP_META, '').replace('<meta charset="utf-8">', `<meta charset="utf-8" data-fake='${CSP_META}'>`)],
]) {
  test(`rejects ${name}`, () => {
    const result = run(fixtureDir(), 'plan', plan(), html);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Invalid review HTML/);
  });
}

test('rejects an oversized candidate', () => {
  const result = run(fixtureDir(), 'plan', plan(), planPage(`<p>${'x'.repeat(512 * 1024)}</p>`));
  assert.equal(result.status, 1);
  assert.match(result.stderr, /exceeds 524288 byte limit/);
});

test('does not replace a previously accepted page when the candidate fails', () => {
  const dir = fixtureDir();
  const outputPath = path.join(dir, 'accepted.html');
  fs.writeFileSync(outputPath, 'last accepted review');
  const result = run(dir, 'plan', plan(), planPage('<script>bad</script>'));
  assert.equal(result.status, 1);
  assert.equal(fs.readFileSync(outputPath, 'utf8'), 'last accepted review');
});

test('rejects invalid UTF-8 without replacing a previously accepted page', () => {
  const dir = fixtureDir();
  const sourcePath = path.join(dir, 'source.json');
  const candidatePath = path.join(dir, 'candidate.html');
  const outputPath = path.join(dir, 'accepted.html');
  fs.writeFileSync(sourcePath, JSON.stringify(plan()));
  fs.writeFileSync(candidatePath, Buffer.from([0xc3, 0x28]));
  fs.writeFileSync(outputPath, 'last accepted review');
  const result = spawnSync(process.execPath, [
    SCRIPT, 'plan', '--source', sourcePath, '--candidate', candidatePath, '--out', outputPath,
  ], { encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /candidate is not valid UTF-8/);
  assert.equal(fs.readFileSync(outputPath, 'utf8'), 'last accepted review');
});

test('rejects slash-separated event handlers and unsafe CSS in an unclosed style block', () => {
  for (const html of [
    planPage('<details/ontoggle="alert(1)"><summary>Unsafe</summary></details>'),
    planPage('', '<style>@import "https://example.test/review.css"'),
  ]) {
    const result = run(fixtureDir(), 'plan', plan(), html);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Invalid review HTML/);
  }
});

test('recognizes HTML-escaped canonical text in the visible page text', () => {
  const source = plan();
  source.decision.question = 'Approve A & B?';
  const html = page('<p>Approve A &amp; B?</p><p>Generate the review page directly from canonical JSON.</p><p>A concise, safe plan review.</p>');
  const result = run(fixtureDir(), 'plan', source, html);
  assert.equal(result.status, 0, result.stderr);
});
