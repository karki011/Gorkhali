// Author: Subash karki
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const SKILL_ROOT = path.join(ROOT, 'skills', 'gorkhali');
const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), 'utf8');
const flat = (...parts) => read(...parts).replace(/\s+/g, ' ');

test('the review page contract documents both delivery targets', () => {
  const contract = flat('skills', 'gorkhali', 'references', 'review-html.md');
  assert.match(contract, /### `artifact` \(preferred\)/);
  assert.match(contract, /### `file`/);
  assert.match(contract, /\[--target file\|artifact\]/);
  // The artifact host owns the shell; the file target owns its own.
  assert.match(contract, /Write no `<!doctype>`, `<html>`, `<head>`, or `<body>` tag/);
  assert.match(contract, /default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'/);
  assert.match(contract, /fonts\.googleapis\.com/);
  assert.match(contract, /publishing failure falls back to the `file` target/i);
});

test('the review page contract carries a plain-English voice and a collapsed appendix rule', () => {
  const contract = flat('skills', 'gorkhali', 'references', 'review-html.md');
  assert.match(contract, /## Voice: plain English first/);
  assert.match(contract, /Lead with the conclusion/i);
  assert.match(contract, /Explain jargon where it appears/i);
  assert.match(contract, /Never simplify into something false/i);
  assert.match(contract, /Short sentences\. One idea each\./);
  // Identifiers survive the plain-English rule; they just stop derailing sentences.
  assert.match(contract, /carry the file, symbol, or line as a small inline code chip/i);
  assert.match(contract, /## Structure: decision on top, mechanics at the bottom/);
  assert.match(contract, /Collapsed in `<details>` at the bottom, never with an `open` attribute/);
  assert.match(contract, /Task and file inventories are never the main page/i);
  assert.match(contract, /## Design/);
  assert.match(contract, /Write the two elements the shell's grid expects/i);
  assert.match(contract, /One nav, never two, never hidden/i);
  assert.match(contract, /the validator rejects `display: none` and `visibility: hidden` outright/i);
  // Page CSS cannot define tokens, so the contract must not tell it to.
  assert.doesNotMatch(contract, /Define the light palette on bare `:root`/i);
  assert.match(contract, /Reach for the shell's tokens, never raw colors/i);
});

test('the shell owns the chassis and the page owns everything else', () => {
  const contract = flat('skills', 'gorkhali', 'references', 'review-html.md');
  assert.match(contract, /## Shell and extension/);
  assert.match(contract, /pastes it verbatim into its first `<style>` block/i);
  assert.match(contract, /second `<style>` block/i);
  assert.match(contract, /targets `:root`, `html`, `body`, `main`, `\*`, `\.doc`, or `\.rail` is rejected/i);
  assert.match(contract, /Wrapping one in `:is\(\)` or `:where\(\)` does not launder it/i);
  assert.match(contract, /merely begins with a reserved name, such as `\.doc-note`/i);

  const shell = read('skills', 'gorkhali', 'assets', 'review-shell.css');
  assert.match(shell, /gorkhali:shell v1 begin/);
  assert.match(shell, /gorkhali:shell v1 end/);
  // Both themes and the reserved chassis all live here, once.
  for (const rule of [/@media \(prefers-color-scheme: dark\)/, /:root\[data-theme="dark"\]/, /\.rail/, /\.doc/]) {
    assert.match(shell, rule);
  }
  // The shell must itself survive the page validator's CSS safety scan.
  assert.doesNotMatch(shell, /display\s*:\s*none|visibility\s*:\s*hidden|@import/i);
});

test('every HTML review surface is a validator type', () => {
  const validator = read('skills', 'gorkhali', 'scripts', 'validate-review-html.mjs');
  assert.match(validator, /'plan', 'brainstorm', 'visualflow', 'detective', 'review'/);
  // Only the two decision gates carry canonical-string checks.
  assert.match(validator, /const GATE_TYPES = new Set\(\['plan', 'brainstorm'\]\)/);

  for (const [file, type] of [
    [path.join('commands', 'visualflow.md'), 'visualflow'],
    [path.join('commands', 'detective.md'), 'detective'],
    [path.join('commands', 'review.md'), 'review'],
  ]) {
    const command = flat(file);
    assert.match(command, new RegExp(`validate-review-html\\.mjs ${type}`), file);
    assert.match(command, /--target artifact/, file);
    assert.match(command, /paste `?assets\/review-shell\.css`? verbatim/i, file);
    assert.match(command, /Artifact\(file_path:/, file);
  }
});

test('review.artifact is a declared capability with a local-file fallback', () => {
  const capabilities = flat('skills', 'gorkhali', 'references', 'capabilities.md');
  assert.match(capabilities, /"review\.artifact": "unknown"/);
  assert.match(capabilities, /\| Review artifact \|/);
  assert.match(capabilities, /falling back to the local file target/i);
  assert.match(capabilities, /never changes the review's voice, structure, validation, or approval gate/i);
});

test('both portable protocols pick the delivery target from the capability ledger', () => {
  const planning = flat('skills', 'gorkhali', 'references', 'planning.md');
  assert.match(planning, /validate-review-html\.mjs --target artifact\|file/);
  assert.match(planning, /a failed publish falls back to `file`/i);
  assert.match(planning, /plain-English voice of \[review-html\.md\]/i);

  const brainstorming = flat('skills', 'gorkhali', 'references', 'brainstorming.md');
  assert.match(brainstorming, /`artifact` when the runtime exposes an artifact publishing tool, otherwise `file`/);
  assert.match(brainstorming, /quoted verbatim onto the human gate, so write it in plain English/i);
});

test('both native gates validate for the artifact target and publish the accepted page', () => {
  for (const [file, artifactFile] of [
    [path.join('commands', 'start.md'), 'plan.html'],
    [path.join('commands', 'brainstorm.md'), 'brainstorm.html'],
  ]) {
    const gate = flat(file);
    assert.match(gate, new RegExp(`validate-review-html\\.mjs \\w+ --source [^ ]*${artifactFile.replace('.html', '\\.json')}[^|]*--target artifact`), file);
    assert.match(gate, new RegExp(`Artifact\\(file_path: "\\{[A-Z_]+\\}[^"]*${artifactFile.replace('.', '\\.')}"`), file);
    assert.match(gate, /omit `favicon` on a republish/i, file);
    assert.match(gate, /never present a URL a publish result did not return/i, file);
    assert.match(gate, /regenerate with `--target file`/i, file);
  }
});

test('the planner authors the review page but never publishes it', () => {
  const planning = flat('reference', 'planning.md');
  assert.match(planning, /Do NOT publish it; Chief owns the artifact URL/);
  assert.match(planning, /Republish the same `file_path` on every revision round so the URL is stable/i);
});

test('the bundled review-page contract stays a required portable resource', () => {
  const validator = read('scripts', 'validate-portable-skill.mjs');
  assert.match(validator, /references\/review-html\.md/);
  assert.ok(fs.existsSync(path.join(SKILL_ROOT, 'references', 'review-html.md')));
  // Every artifact-target page embeds the shell, so an install that ships without
  // it must fail loudly rather than produce unstyled pages.
  assert.match(validator, /'assets\/review-shell\.css'/);
  assert.ok(fs.existsSync(path.join(SKILL_ROOT, 'assets', 'review-shell.css')));
});

test('an unreadable shell fails validation instead of silently passing', () => {
  const source = read('skills', 'gorkhali', 'scripts', 'validate-review-html.mjs');
  assert.match(source, /cannot read the bundled review shell to compare against/);
  // The comparison must be gated on an explicit null, never on a falsy shell that
  // would let any embedded text through.
  assert.match(source, /if \(expected !== null && embedded !== expected\)/);
  assert.doesNotMatch(source, /catch \{ expected = null; \}/);
});

test('the findings page never becomes the review record', () => {
  const command = flat('commands', 'review.md');
  assert.match(command, /`auditor\.json` stays the artifact the verdict is read from/i);
  assert.match(command, /never parsed back/i);
  assert.match(command, /a page that failed to generate never turns a `fail` into a `pass`/i);
  // A clean review has nothing to show, so it does not get a page.
  assert.match(command, /Skip it entirely on a clean review/i);
});

// End-to-end regression on a real page that was rendered and visually checked,
// rather than on a minimal synthetic one. The shell is spliced in at test time so
// this fixture cannot drift from the bundled chassis.
test('a real, browser-verified page still satisfies the whole contract', () => {
  const fixture = read('test', 'fixtures', 'review-page', 'plan.example.html');
  assert.match(fixture, /__GORKHALI_SHELL__/, 'fixture must not inline the shell');
  const shell = fs.readFileSync(
    path.join(SKILL_ROOT, 'assets', 'review-shell.css'), 'utf8',
  ).replace(/\r\n/g, '\n').trim();
  const page = fixture.replace('__GORKHALI_SHELL__', shell);

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gorkhali-review-fixture-'));
  const candidate = path.join(dir, 'candidate.html');
  const out = path.join(dir, 'accepted.html');
  fs.writeFileSync(candidate, page);

  const result = spawnSync(process.execPath, [
    path.join(SKILL_ROOT, 'scripts', 'validate-review-html.mjs'), 'plan',
    '--source', path.join(ROOT, 'test', 'fixtures', 'review-page', 'plan.json'),
    '--candidate', candidate,
    '--out', out,
    '--target', 'artifact',
  ], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);

  // The properties the page is supposed to have, asserted on the page itself.
  assert.match(page, /<nav class="rail"/, 'section rail');
  assert.match(page, /<div class="doc">/, 'reading column');
  assert.equal((page.match(/<h1/g) || []).length, 1);
  assert.equal((page.match(/<main/g) || []).length, 1);
  assert.doesNotMatch(page, /<details[^>]*\sopen/, 'appendix must start collapsed');
  // The decision text leads; the mechanics follow it.
  const lead = page.slice(0, page.indexOf('<details'));
  assert.ok(lead.includes('Approve building this as 8 equal cards'), 'approval question in the lead');
  assert.ok(page.indexOf('Wave 1') > page.indexOf('<details'), 'waves live in the appendix');
});