// Author: Subash Karki
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const SCRIPT = path.join(__dirname, '..', 'skills', 'gorkhali', 'scripts', 'validate-review-html.mjs');
const BRAINSTORM_COMMAND = path.join(__dirname, '..', 'commands', 'brainstorm.md');
const CSP = "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'";
const CSP_META = `<meta http-equiv="Content-Security-Policy" content="${CSP}">`;

const plan = () => ({
  briefing: {
    tackling: 'Decision-first review HTML',
    problem: 'Reviewers see tasks before the recommendation.',
    how: 'Lead with What, Problem, and How, then collapse implementation.',
  },
  decision: {
    question: 'Approve the decision-first review?',
    recommendation: 'Generate the review page directly from canonical JSON.',
  },
  outcome: { goal: 'A concise, safe plan review.' },
});

const brainstorm = () => ({
  briefing: {
    tackling: 'Which review approach to use',
    problem: 'Reviewers need a comparable set of approaches.',
    how: 'Lead with What, Problem, and How, then a comparison table.',
  },
  decision: { question: 'Which review approach should we use?' },
  approaches: [{ id: 'direct-html', name: 'Direct AI HTML' }],
  recommendedDefault: { id: 'direct-html', reason: 'It removes the renderer layer.' },
  directionGate: { question: 'Choose the direct HTML approach?' },
});

const page = (content, extraHead = '') => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
${CSP_META}<title>Review</title>${extraHead}</head>
<body><main><h1>Review</h1>${content}</main></body></html>`;

const planLead = (source = plan()) => `<p>${source.briefing.tackling}</p><p>${source.briefing.problem}</p><p>${source.briefing.how}</p><p>${source.decision.question}</p><p>${source.decision.recommendation}</p><p>${source.outcome.goal}</p>`;
const planAppendix = '<details><summary>Implementation</summary><p>Task details</p></details>';
const planPage = (extra = '', extraHead = '') => page(`${planLead()}${planAppendix}${extra}`, extraHead);
const brainstormLead = (source = brainstorm()) => `<p>${source.briefing.tackling}</p><p>${source.briefing.problem}</p><p>${source.briefing.how}</p><p>${source.decision.question}</p><p>Direct AI HTML</p><p>${source.recommendedDefault.reason}</p><p>${source.directionGate.question}</p>`;
const brainstormTable = '<table><thead><tr><th>Approach</th><th>Why</th></tr></thead><tbody><tr><td>Direct AI HTML</td><td>Removes the renderer</td></tr></tbody></table>';
const brainstormPage = () => page(`${brainstormLead()}${brainstormTable}`);

// The artifact host supplies the document shell, so a candidate for that target
// is a fragment that names itself with a title, pastes the bundled chassis, and
// keeps any page CSS in a second block.
const SHELL = fs.readFileSync(
  path.join(__dirname, '..', 'skills', 'gorkhali', 'assets', 'review-shell.css'),
  'utf8',
).replace(/\r\n/g, '\n').trim();
const artifactPage = (content, extraHead = '', pageCss = '') => `<title>Review</title>${extraHead}
<style>\n${SHELL}\n</style>
${pageCss ? `<style>${pageCss}</style>` : ''}
<main><h1>Review</h1>${content}</main>`;
const artifactPlanPage = (extra = '', extraHead = '', pageCss = '') => artifactPage(`${planLead()}${planAppendix}${extra}`, extraHead, pageCss);
const artifactBrainstormPage = () => artifactPage(`${brainstormLead()}${brainstormTable}`);
const fixtureDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'gorkhali-review-html-'));

const run = (dir, type, source, candidate, output = 'accepted.html', target = null) => {
  const sourcePath = path.join(dir, 'source.json');
  const candidatePath = path.join(dir, 'candidate.html');
  const outputPath = path.join(dir, output);
  fs.writeFileSync(sourcePath, JSON.stringify(source));
  fs.writeFileSync(candidatePath, candidate);
  const args = [SCRIPT, type, '--source', sourcePath, '--candidate', candidatePath, '--out', outputPath];
  if (target) args.push('--target', target);
  const result = spawnSync(process.execPath, args, { encoding: 'utf8' });
  return { ...result, outputPath };
};

const runArtifact = (dir, type, source, candidate, output = 'accepted.html') => (
  run(dir, type, source, candidate, output, 'artifact')
);

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

test('accepts a bare plan whose own canonical evidence field is an object', () => {
  const source = { ...plan(), evidence: { sources: ['ticket-123'], findings: ['root cause confirmed'] } };
  const result = run(fixtureDir(), 'plan', source, planPage());
  assert.equal(result.status, 0, result.stderr);
});

test('accepts a bare brainstorm whose own canonical evidence field is an object', () => {
  const source = { ...brainstorm(), evidence: { sources: ['ticket-123'], findings: ['root cause confirmed'] } };
  const result = run(fixtureDir(), 'brainstorm', source, brainstormPage());
  assert.equal(result.status, 0, result.stderr);
});

test('accepts a brainstorm canonical payload inside a portable state envelope', () => {
  const source = { schema_version: 1, artifact_type: 'brainstorm', evidence: brainstorm() };
  const result = run(fixtureDir(), 'brainstorm', source, brainstormPage());
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
  const html = page(`${planLead(source)}${planAppendix}`);
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

test('requires plan briefing strings in main before details', () => {
  const html = page(`<p>${plan().decision.question}</p><p>${plan().decision.recommendation}</p><p>${plan().outcome.goal}</p>${planAppendix}`);
  const result = run(fixtureDir(), 'plan', plan(), html);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /missing canonical review text/);
});

test('requires a details element in the plan main', () => {
  const html = page(planLead());
  const result = run(fixtureDir(), 'plan', plan(), html);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /plan review must include a details element in main/);
});

test('rejects an expanded details element in the plan main', () => {
  const html = page(`${planLead()}<details open><summary>Implementation</summary><p>Task details</p></details>`);
  const result = run(fixtureDir(), 'plan', plan(), html);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /details must not have an open attribute/);
});

test('requires a brainstorm comparison table before details', () => {
  const strings = brainstormLead();
  const missing = run(fixtureDir(), 'brainstorm', brainstorm(), page(strings + '<details><summary>Cards</summary><p>Detail</p></details>'));
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /brainstorm review must include a table in main/);
  const after = run(fixtureDir(), 'brainstorm', brainstorm(), page(strings + '<details><summary>Cards</summary><p>Detail</p></details>' + brainstormTable));
  assert.equal(after.status, 1);
  assert.match(after.stderr, /brainstorm comparison table must appear before details/);
});

test('rejects a plan candidate whose details have an open attribute', () => {
  for (const open of ['open', 'open=""']) {
    const html = page(`${planLead()}<details ${open}><summary>Implementation</summary><p>Task details</p></details>`);
    const result = run(fixtureDir(), 'plan', plan(), html);
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, /details must not have an open attribute/);
  }
});

test('rejects a brainstorm candidate whose details after the table have an open attribute', () => {
  const html = page(`${brainstormLead()}${brainstormTable}<details open><summary>Cards</summary><p>Detail</p></details>`);
  const result = run(fixtureDir(), 'brainstorm', brainstorm(), html);
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, /details must not have an open attribute/);
});

test('rejects a brainstorm candidate missing briefing.how', () => {
  const source = brainstorm();
  const html = page(`<p>${source.briefing.tackling}</p><p>${source.briefing.problem}</p><p>${source.decision.question}</p><p>Direct AI HTML</p><p>${source.recommendedDefault.reason}</p><p>${source.directionGate.question}</p>${brainstormTable}`);
  const result = run(fixtureDir(), 'brainstorm', source, html);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /missing canonical review text|briefing\.how/);
});

test('accepts a valid planPage whose details have no open attribute', () => {
  const result = run(fixtureDir(), 'plan', plan(), planPage());
  assert.equal(result.status, 0, result.stderr);
});

test('recognizes HTML-escaped canonical text in the visible page text', () => {
  const source = plan();
  source.decision.question = 'Approve A & B?';
  const html = page(`<p>${plan().briefing.tackling}</p><p>${plan().briefing.problem}</p><p>${plan().briefing.how}</p><p>Approve A &amp; B?</p><p>Generate the review page directly from canonical JSON.</p><p>A concise, safe plan review.</p>${planAppendix}`);
  const result = run(fixtureDir(), 'plan', source, html);
  assert.equal(result.status, 0, result.stderr);
});

test('promotes a valid plan candidate for the artifact target', () => {
  const dir = fixtureDir();
  const html = artifactPlanPage();
  const result = runArtifact(dir, 'plan', plan(), html);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.readFileSync(result.outputPath, 'utf8'), html);
});

test('promotes a valid brainstorm candidate for the artifact target', () => {
  const result = runArtifact(fixtureDir(), 'brainstorm', brainstorm(), artifactBrainstormPage());
  assert.equal(result.status, 0, result.stderr);
});

test('rejects an unknown target', () => {
  const result = run(fixtureDir(), 'plan', plan(), planPage(), 'accepted.html', 'gist');
  assert.equal(result.status, 1);
  assert.match(result.stderr, /--target file\|artifact/);
});

test('rejects a document shell on the artifact target', () => {
  const result = runArtifact(fixtureDir(), 'plan', plan(), planPage());
  assert.equal(result.status, 1);
  assert.match(result.stderr, /must not declare a doctype/);
  assert.match(result.stderr, /forbidden executable, embedded, control, or vector tag/);
});

test('rejects an artifact candidate with no title', () => {
  const dir = fixtureDir();
  const html = `<style>\n${SHELL}\n</style><main><h1>Review</h1>${planLead()}${planAppendix}</main>`;
  const result = runArtifact(dir, 'plan', plan(), html);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /missing non-empty title element/);
});

test('rejects an artifact title pushed past the host title scan window', () => {
  const dir = fixtureDir();
  const filler = `<style>${'/* pad */'.repeat(1200)}</style>`;
  const html = `${filler}<title>Review</title><style>\n${SHELL}\n</style><main><h1>Review</h1>${planLead()}${planAppendix}</main>`;
  const result = runArtifact(dir, 'plan', plan(), html);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /title must appear within the first/);
});

test('admits a font stylesheet and its preconnect on the artifact target only', () => {
  const head = '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>'
    + '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans&display=swap">';
  const accepted = runArtifact(fixtureDir(), 'plan', plan(), artifactPlanPage('', head));
  assert.equal(accepted.status, 0, accepted.stderr);

  const rejected = run(fixtureDir(), 'plan', plan(), planPage('', head));
  assert.equal(rejected.status, 1);
  assert.match(rejected.stderr, /forbidden executable, embedded, control, or vector tag/);
});

test('rejects a stylesheet link outside the font allowlist on the artifact target', () => {
  const head = '<link rel="stylesheet" href="https://cdn.example.com/theme.css">';
  const result = runArtifact(fixtureDir(), 'plan', plan(), artifactPlanPage('', head));
  assert.equal(result.status, 1);
  assert.match(result.stderr, /not an allowed font stylesheet/);
  assert.match(result.stderr, /non-fragment href/);
});

test('admits a gstatic font url but no other css url on the artifact target', () => {
  const dir = fixtureDir();
  const good = artifactPlanPage('', '', "@font-face{font-family:Plex;src:url(https://fonts.gstatic.com/s/plex.woff2) format('woff2')}");
  const goodResult = runArtifact(dir, 'plan', plan(), good);
  assert.equal(goodResult.status, 0, goodResult.stderr);

  const bad = artifactPlanPage('', '', '.x{background:url(https://cdn.example.com/bg.png)}');
  const result = runArtifact(fixtureDir(), 'plan', plan(), bad);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /unsafe CSS/);
});

test('admits inline svg on the artifact target but not on the file target', () => {
  const figure = '<figure><svg viewBox="0 0 10 10" role="img" aria-label="flow"><rect width="10" height="10"></rect></svg></figure>';
  const accepted = runArtifact(fixtureDir(), 'plan', plan(), artifactPlanPage(figure));
  assert.equal(accepted.status, 0, accepted.stderr);

  const rejected = run(fixtureDir(), 'plan', plan(), planPage(figure));
  assert.equal(rejected.status, 1);
  assert.match(rejected.stderr, /forbidden executable, embedded, control, or vector tag/);
});

test('still rejects scripts, hidden content, and open details on the artifact target', () => {
  const scripted = runArtifact(fixtureDir(), 'plan', plan(), artifactPlanPage('<script>alert(1)</script>'));
  assert.equal(scripted.status, 1);
  assert.match(scripted.stderr, /forbidden executable, embedded, control, or vector tag/);

  const hidden = runArtifact(fixtureDir(), 'plan', plan(), artifactPlanPage('<p hidden>hidden</p>'));
  assert.equal(hidden.status, 1);
  assert.match(hidden.stderr, /hidden review content/);

  const opened = artifactPage(`${planLead()}<details open><summary>Implementation</summary><p>Task details</p></details>`);
  // eslint-disable-next-line no-unused-expressions
  opened;
  const expanded = runArtifact(fixtureDir(), 'plan', plan(), opened);
  assert.equal(expanded.status, 1);
  assert.match(expanded.stderr, /details must not have an open attribute/);
});

test('still requires canonical review text before the appendix on the artifact target', () => {
  const buried = artifactPage(`<p>${plan().briefing.tackling}</p>${planAppendix}`);
  const result = runArtifact(fixtureDir(), 'plan', plan(), buried);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /missing canonical review text/);
});

test('requires the bundled shell verbatim on the artifact target', () => {
  const missing = runArtifact(fixtureDir(), 'plan', plan(),
    `<title>Review</title><main><h1>Review</h1>${planLead()}${planAppendix}</main>`);
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /missing the bundled review shell/);

  const edited = runArtifact(fixtureDir(), 'plan', plan(),
    artifactPlanPage().replace('--rail-w:232px', '--rail-w:300px'));
  assert.equal(edited.status, 1);
  assert.match(edited.stderr, /does not match assets\/review-shell\.css/);
});

test('page CSS may add components but never restyle the shell chassis', () => {
  const added = runArtifact(fixtureDir(), 'plan', plan(),
    artifactPlanPage('', '', '.trap-mark{color:var(--warn);letter-spacing:.1em}.verdict{border-left-width:6px}'));
  assert.equal(added.status, 0, added.stderr);

  for (const [css, selector] of [
    ['main{grid-template-columns:1fr}', 'main'],
    [':root{--accent:#f00}', ':root'],
    ['body{background:#000}', 'body'],
    ['.rail{top:0}', '.rail'],
    ['.doc>p{max-width:none}', '.doc'],
    ['@media (max-width:600px){main{column-gap:0}}', 'main'],
  ]) {
    const result = runArtifact(fixtureDir(), 'plan', plan(), artifactPlanPage('', '', css));
    assert.equal(result.status, 1, `expected ${selector} to be reserved`);
    assert.match(result.stderr, /may not restyle the shell chassis/);
  }
});

test('the file target is unaffected by the shell requirement', () => {
  const result = run(fixtureDir(), 'plan', plan(), planPage());
  assert.equal(result.status, 0, result.stderr);
});

test('the chassis guard survives :is()/:where() wrapping', () => {
  // Wrapping a reserved token in a functional pseudo-class must not launder it.
  for (const css of [
    ':is(main){grid-template-columns:1fr}',
    ':where(body){background:#000}',
    '.card:is(.doc){max-width:none}',
    ':is(:root){--accent:#f00}',
  ]) {
    const result = runArtifact(fixtureDir(), 'plan', plan(), artifactPlanPage('', '', css));
    assert.equal(result.status, 1, `expected ${css} to be rejected`);
    assert.match(result.stderr, /may not restyle the shell chassis/);
  }
});

test('a page class that merely starts with a reserved name is allowed', () => {
  // `.doc-note` is the page's own component, not the shell's `.doc` column.
  const css = '.doc-note{color:var(--muted)}.rail-badge{color:var(--accent)}.mainline{font-weight:600}';
  const result = runArtifact(fixtureDir(), 'plan', plan(), artifactPlanPage('', '', css));
  assert.equal(result.status, 0, result.stderr);
});

test('the title window is measured on published bytes, not comment-stripped text', () => {
  // Comments are blanked before scanning, so measuring the stripped text would let
  // a title the host cannot reach still pass.
  const dir = fixtureDir();
  const pad = `<!--${'x'.repeat(9000)}-->`;
  const html = `${pad}${artifactPlanPage()}`;
  const result = runArtifact(dir, 'plan', plan(), html);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /title must appear within the first 8192 bytes/);

  // A small comment leaves the title comfortably inside the window.
  const ok = runArtifact(fixtureDir(), 'plan', plan(), `<!-- generated -->${artifactPlanPage()}`);
  assert.equal(ok.status, 0, ok.stderr);
});
