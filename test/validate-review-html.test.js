// Author: Subash Karki
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const SCRIPT = path.join(__dirname, '..', 'skills', 'gorkhali', 'scripts', 'validate-review-html.mjs');
const CSP = "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'";
const CSP_META = `<meta http-equiv="Content-Security-Policy" content="${CSP}">`;

const page = (content, extraHead = '') => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
${CSP_META}<title>Review</title>${extraHead}</head>
<body><main><h1>Review</h1>${content}</main></body></html>`;

// visualflow, detective and review carry no canonical-string contract, so these
// fixtures are plain prose: their value is exercising the shell/safety/structure
// rules shared by all three types, not any particular field of a source JSON.
const reviewLead = () => '<p>The change touches the usage dashboard and why it matters.</p>';
const reviewAppendix = '<details><summary>Implementation</summary><p>Task details</p></details>';
const reviewPage = (extra = '', extraHead = '') => page(`${reviewLead()}${reviewAppendix}${extra}`, extraHead);

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
const artifactReviewPage = (extra = '', extraHead = '', pageCss = '') => artifactPage(`${reviewLead()}${reviewAppendix}${extra}`, extraHead, pageCss);
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

test('promotes a valid review candidate without changing its authored markup', () => {
  const dir = fixtureDir();
  const html = reviewPage('<details><summary>Execution appendix</summary><p>Task details</p></details>');
  const result = run(dir, 'review', {}, html);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.readFileSync(result.outputPath, 'utf8'), html);
  assert.equal(fs.statSync(result.outputPath).mode & 0o777, 0o600);
  assert.deepEqual(fs.readdirSync(dir).filter((name) => name.endsWith('.tmp')), []);
});

test('accepts policy-equivalent CSP meta attribute order, quotes, and extra attributes', () => {
  const escapedPolicy = CSP.replaceAll("'", '&apos;');
  const flexibleMeta = `<meta data-review="review" content='${escapedPolicy}' http-equiv='Content-Security-Policy'>`;
  const result = run(fixtureDir(), 'review', {}, reviewPage().replace(CSP_META, flexibleMeta));
  assert.equal(result.status, 0, result.stderr);
});

test('allows URL-attribute-like prose in review content', () => {
  const html = page(`<p>Should src=generated/output.json remain visible?</p><p>Keep action=deploy as plain review prose.</p><p>Document poster=review and ping=disabled without creating attributes.</p>${reviewAppendix}`);
  const result = run(fixtureDir(), 'review', {}, html);
  assert.equal(result.status, 0, result.stderr);
});

test('rejects CSP metadata hidden inside a quoted head attribute', () => {
  const escapedPolicy = CSP.replaceAll("'", '&apos;');
  const fakeHead = `<head data='><meta charset="utf-8"><meta name="viewport" content="x"><meta http-equiv="Content-Security-Policy" content="${escapedPolicy}"><title>Review</title>'></head>`;
  const html = `<!doctype html><html lang="en">${fakeHead}<body background="https://example.test/pixel"><main><h1>Review</h1><p>Some finding worth noting.</p></main></body></html>`;
  const result = run(fixtureDir(), 'review', {}, html);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /missing required restrictive Content Security Policy/);
  assert.match(result.stderr, /contains a URL-bearing attribute/);
});

test('rejects a CSP head placed after the body has started', () => {
  const html = `<!doctype html><html lang="en"><body><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">${CSP_META}<title>Review</title></head><main><h1>Review</h1><p>Some finding worth noting.</p></main></body></html>`;
  const result = run(fixtureDir(), 'review', {}, html);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /head element must precede body/);
});

test('requires static document structure', () => {
  const noMain = reviewPage().replace('<main>', '<div>').replace('</main>', '</div>');
  const result = run(fixtureDir(), 'review', {}, noMain);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /exactly one main/);
});

for (const [name, html] of [
  ['script', reviewPage('<script>alert(1)</script>')],
  ['event handler', reviewPage('<p onclick="alert(1)">unsafe</p>')],
  ['external href', reviewPage('<a href="https://example.test">unsafe</a>')],
  ['source URL attribute', reviewPage('<img src="https://example.test/review.png" alt="unsafe">')],
  ['legacy background URL attribute', reviewPage('<table background="https://example.test/review.png"><tr><td>unsafe</td></tr></table>')],
  ['obscured external href', reviewPage('<a title=">" href=https://example.test>unsafe</a>')],
  ['CSS URL', reviewPage('', '<style>.x { background: url(https://example.test/x) }</style>')],
  ['escaped CSS URL', reviewPage('', '<style>.x { background: u\\72l(https://example.test/x) }</style>')],
  ['form', reviewPage('<form><input name="unsafe"></form>')],
  ['refresh meta', reviewPage('', '<meta http-equiv="refresh" content="0">')],
  ['hidden content', reviewPage('<p hidden>unsafe</p>')],
  ['hidden CSS', reviewPage('', '<style>.decision { display: none }</style>')],
  ['transparent CSS', reviewPage('', '<style>.decision { opacity: 0 }</style>')],
  ['dialog', reviewPage('<dialog open>unsafe</dialog>')],
  ['weakened CSP', reviewPage().replace(CSP, `${CSP}; img-src https:`)],
  ['commented CSP with image-set', reviewPage('', '<style>body { background: -webkit-image-set("https://example.test/pixel" 1x) }</style>').replace(CSP_META, `<!-- ${CSP_META} -->`)],
  ['late CSP', reviewPage('', '<style>body { color: black }</style>').replace(CSP_META, '').replace('</style>', `</style>${CSP_META}`)],
  ['fake title CSP with ping beacon', reviewPage('<a href="#review" ping="https://example.test/beacon">Review</a>').replace(CSP_META, '').replace('<title>Review</title>', `<title>Review ${CSP_META}</title>`)],
  ['fake attribute CSP', reviewPage().replace(CSP_META, '').replace('<meta charset="utf-8">', `<meta charset="utf-8" data-fake='${CSP_META}'>`)],
]) {
  test(`rejects ${name}`, () => {
    const result = run(fixtureDir(), 'review', {}, html);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Invalid review HTML/);
  });
}

test('rejects an oversized candidate', () => {
  const result = run(fixtureDir(), 'review', {}, reviewPage(`<p>${'x'.repeat(512 * 1024)}</p>`));
  assert.equal(result.status, 1);
  assert.match(result.stderr, /exceeds 524288 byte limit/);
});

test('does not replace a previously accepted page when the candidate fails', () => {
  const dir = fixtureDir();
  const outputPath = path.join(dir, 'accepted.html');
  fs.writeFileSync(outputPath, 'last accepted review');
  const result = run(dir, 'review', {}, reviewPage('<script>bad</script>'));
  assert.equal(result.status, 1);
  assert.equal(fs.readFileSync(outputPath, 'utf8'), 'last accepted review');
});

test('rejects invalid UTF-8 without replacing a previously accepted page', () => {
  const dir = fixtureDir();
  const sourcePath = path.join(dir, 'source.json');
  const candidatePath = path.join(dir, 'candidate.html');
  const outputPath = path.join(dir, 'accepted.html');
  fs.writeFileSync(sourcePath, JSON.stringify({}));
  fs.writeFileSync(candidatePath, Buffer.from([0xc3, 0x28]));
  fs.writeFileSync(outputPath, 'last accepted review');
  const result = spawnSync(process.execPath, [
    SCRIPT, 'review', '--source', sourcePath, '--candidate', candidatePath, '--out', outputPath,
  ], { encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /candidate is not valid UTF-8/);
  assert.equal(fs.readFileSync(outputPath, 'utf8'), 'last accepted review');
});

test('rejects slash-separated event handlers and unsafe CSS in an unclosed style block', () => {
  for (const html of [
    reviewPage('<details/ontoggle="alert(1)"><summary>Unsafe</summary></details>'),
    reviewPage('', '<style>@import "https://example.test/review.css"'),
  ]) {
    const result = run(fixtureDir(), 'review', {}, html);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Invalid review HTML/);
  }
});

test('requires a details element in the review main', () => {
  const html = page(reviewLead());
  const result = run(fixtureDir(), 'review', {}, html);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /review must include a details element in main/);
});

test('rejects an expanded details element in the review main', () => {
  const html = page(`${reviewLead()}<details open><summary>Implementation</summary><p>Task details</p></details>`);
  const result = run(fixtureDir(), 'review', {}, html);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /details must not have an open attribute/);
});

test('rejects a review candidate whose details have an open attribute', () => {
  for (const open of ['open', 'open=""']) {
    const html = page(`${reviewLead()}<details ${open}><summary>Implementation</summary><p>Task details</p></details>`);
    const result = run(fixtureDir(), 'review', {}, html);
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, /details must not have an open attribute/);
  }
});

test('accepts a valid reviewPage whose details have no open attribute', () => {
  const result = run(fixtureDir(), 'review', {}, reviewPage());
  assert.equal(result.status, 0, result.stderr);
});

test('promotes a valid review candidate for the artifact target', () => {
  const dir = fixtureDir();
  const html = artifactReviewPage();
  const result = runArtifact(dir, 'review', {}, html);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.readFileSync(result.outputPath, 'utf8'), html);
});

test('rejects an unknown target', () => {
  const result = run(fixtureDir(), 'review', {}, reviewPage(), 'accepted.html', 'gist');
  assert.equal(result.status, 1);
  assert.match(result.stderr, /--target file\|artifact/);
});

test('rejects a document shell on the artifact target', () => {
  const result = runArtifact(fixtureDir(), 'review', {}, reviewPage());
  assert.equal(result.status, 1);
  assert.match(result.stderr, /must not declare a doctype/);
  assert.match(result.stderr, /forbidden executable, embedded, control, or vector tag/);
});

test('rejects an artifact candidate with no title', () => {
  const dir = fixtureDir();
  const html = `<style>\n${SHELL}\n</style><main><h1>Review</h1>${reviewLead()}${reviewAppendix}</main>`;
  const result = runArtifact(dir, 'review', {}, html);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /missing non-empty title element/);
});

test('rejects an artifact title pushed past the host title scan window', () => {
  const dir = fixtureDir();
  const filler = `<style>${'/* pad */'.repeat(1200)}</style>`;
  const html = `${filler}<title>Review</title><style>\n${SHELL}\n</style><main><h1>Review</h1>${reviewLead()}${reviewAppendix}</main>`;
  const result = runArtifact(dir, 'review', {}, html);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /title must appear within the first/);
});

test('admits a font stylesheet and its preconnect on the artifact target only', () => {
  const head = '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>'
    + '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans&display=swap">';
  const accepted = runArtifact(fixtureDir(), 'review', {}, artifactReviewPage('', head));
  assert.equal(accepted.status, 0, accepted.stderr);

  const rejected = run(fixtureDir(), 'review', {}, reviewPage('', head));
  assert.equal(rejected.status, 1);
  assert.match(rejected.stderr, /forbidden executable, embedded, control, or vector tag/);
});

test('rejects a stylesheet link outside the font allowlist on the artifact target', () => {
  const head = '<link rel="stylesheet" href="https://cdn.example.com/theme.css">';
  const result = runArtifact(fixtureDir(), 'review', {}, artifactReviewPage('', head));
  assert.equal(result.status, 1);
  assert.match(result.stderr, /not an allowed font stylesheet/);
  assert.match(result.stderr, /non-fragment href/);
});

test('admits a gstatic font url but no other css url on the artifact target', () => {
  const dir = fixtureDir();
  const good = artifactReviewPage('', '', "@font-face{font-family:Plex;src:url(https://fonts.gstatic.com/s/plex.woff2) format('woff2')}");
  const goodResult = runArtifact(dir, 'review', {}, good);
  assert.equal(goodResult.status, 0, goodResult.stderr);

  const bad = artifactReviewPage('', '', '.x{background:url(https://cdn.example.com/bg.png)}');
  const result = runArtifact(fixtureDir(), 'review', {}, bad);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /unsafe CSS/);
});

test('admits inline svg on the artifact target but not on the file target', () => {
  const figure = '<figure><svg viewBox="0 0 10 10" role="img" aria-label="flow"><rect width="10" height="10"></rect></svg></figure>';
  const accepted = runArtifact(fixtureDir(), 'review', {}, artifactReviewPage(figure));
  assert.equal(accepted.status, 0, accepted.stderr);

  const rejected = run(fixtureDir(), 'review', {}, reviewPage(figure));
  assert.equal(rejected.status, 1);
  assert.match(rejected.stderr, /forbidden executable, embedded, control, or vector tag/);
});

test('still rejects scripts, hidden content, and open details on the artifact target', () => {
  const scripted = runArtifact(fixtureDir(), 'review', {}, artifactReviewPage('<script>alert(1)</script>'));
  assert.equal(scripted.status, 1);
  assert.match(scripted.stderr, /forbidden executable, embedded, control, or vector tag/);

  const hidden = runArtifact(fixtureDir(), 'review', {}, artifactReviewPage('<p hidden>hidden</p>'));
  assert.equal(hidden.status, 1);
  assert.match(hidden.stderr, /hidden review content/);

  const opened = artifactPage(`${reviewLead()}<details open><summary>Implementation</summary><p>Task details</p></details>`);
  const expanded = runArtifact(fixtureDir(), 'review', {}, opened);
  assert.equal(expanded.status, 1);
  assert.match(expanded.stderr, /details must not have an open attribute/);
});

test('requires the bundled shell verbatim on the artifact target', () => {
  const missing = runArtifact(fixtureDir(), 'review', {},
    `<title>Review</title><main><h1>Review</h1>${reviewLead()}${reviewAppendix}</main>`);
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /missing the bundled review shell/);

  const edited = runArtifact(fixtureDir(), 'review', {},
    artifactReviewPage().replace('--rail-w:232px', '--rail-w:300px'));
  assert.equal(edited.status, 1);
  assert.match(edited.stderr, /does not match assets\/review-shell\.css/);
});

test('page CSS may add components but never restyle the shell chassis', () => {
  const added = runArtifact(fixtureDir(), 'review', {},
    artifactReviewPage('', '', '.trap-mark{color:var(--warn);letter-spacing:.1em}.verdict{border-left-width:6px}'));
  assert.equal(added.status, 0, added.stderr);

  for (const [css, selector] of [
    ['main{grid-template-columns:1fr}', 'main'],
    [':root{--accent:#f00}', ':root'],
    ['body{background:#000}', 'body'],
    ['.rail{top:0}', '.rail'],
    ['.doc>p{max-width:none}', '.doc'],
    ['@media (max-width:600px){main{column-gap:0}}', 'main'],
  ]) {
    const result = runArtifact(fixtureDir(), 'review', {}, artifactReviewPage('', '', css));
    assert.equal(result.status, 1, `expected ${selector} to be reserved`);
    assert.match(result.stderr, /may not restyle the shell chassis/);
  }
});

test('the file target is unaffected by the shell requirement', () => {
  const result = run(fixtureDir(), 'review', {}, reviewPage());
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
    const result = runArtifact(fixtureDir(), 'review', {}, artifactReviewPage('', '', css));
    assert.equal(result.status, 1, `expected ${css} to be rejected`);
    assert.match(result.stderr, /may not restyle the shell chassis/);
  }
});

test('a page class that merely starts with a reserved name is allowed', () => {
  // `.doc-note` is the page's own component, not the shell's `.doc` column.
  const css = '.doc-note{color:var(--muted)}.rail-badge{color:var(--accent)}.mainline{font-weight:600}';
  const result = runArtifact(fixtureDir(), 'review', {}, artifactReviewPage('', '', css));
  assert.equal(result.status, 0, result.stderr);
});

test('the title window is measured on published bytes, not comment-stripped text', () => {
  // Comments are blanked before scanning, so measuring the stripped text would let
  // a title the host cannot reach still pass.
  const dir = fixtureDir();
  const pad = `<!--${'x'.repeat(9000)}-->`;
  const html = `${pad}${artifactReviewPage()}`;
  const result = runArtifact(dir, 'review', {}, html);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /title must appear within the first 8192 bytes/);

  // A small comment leaves the title comfortably inside the window.
  const ok = runArtifact(fixtureDir(), 'review', {}, `<!-- generated -->${artifactReviewPage()}`);
  assert.equal(ok.status, 0, ok.stderr);
});
