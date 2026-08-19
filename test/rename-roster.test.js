// Author: Subash Karki
// rename-roster.test.js - fixture tests for scripts/migrations/rename-roster.mjs.
// Every test runs against in-memory strings or a temp fixture directory
// (os.tmpdir()) - never against the live repo. See rename-roster.mjs's own
// header comment for the mode/EXCEPTIONS design this exercises.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

let mod;
test.before(async () => {
  const url = 'file://' + path.join(__dirname, '..', 'scripts', 'migrations', 'rename-roster.mjs');
  mod = await import(url);
});

function mkTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'rename-roster-fixture-'));
}

function rmTmpDir(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

function writeFixture(root, relPath, content) {
  const abs = path.join(root, ...relPath.split('/'));
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
}

// ---------------------------------------------------------------------------
// Token map shape.
// ---------------------------------------------------------------------------

test('TOKEN_MAP has exactly 75 entries (11 roles + 64 characters)', () => {
  assert.equal(Object.keys(mod.ROLE_MAP).length, 11);
  assert.equal(Object.keys(mod.CHARACTER_MAP).length, 64);
  assert.equal(Object.keys(mod.TOKEN_MAP).length, 75);
});

test('NOT_RENAMED tokens never appear as TOKEN_MAP keys', () => {
  for (const tok of mod.NOT_RENAMED) {
    assert.ok(!(tok in mod.TOKEN_MAP), `${tok} must never be a rename source`);
  }
});

// ---------------------------------------------------------------------------
// Word-boundary safety.
// ---------------------------------------------------------------------------

test('word-boundary safety: forward/backward/toward/awards never match ward', () => {
  for (const word of ['forward', 'backward', 'toward', 'awards', 'awarded']) {
    const { text, count } = mod.replaceLine(`The word is ${word} in this sentence.`);
    assert.equal(count, 0, `${word} must not trigger a ward replacement`);
    assert.equal(text, `The word is ${word} in this sentence.`);
  }
});

test('word-boundary safety: sweeping never matches sweep', () => {
  const { text, count } = mod.replaceLine('The changes need sweeping review.');
  assert.equal(count, 0);
  assert.equal(text, 'The changes need sweeping review.');
});

test('word-boundary safety: apex-active DOES match apex at the hyphen boundary', () => {
  const { text, count } = mod.replaceLine('touch .apex-active before editing');
  assert.equal(count, 1);
  assert.equal(text, 'touch .chief-active before editing');
});

// ---------------------------------------------------------------------------
// Case triplet.
// ---------------------------------------------------------------------------

test('case triplet: blade/Blade/BLADE -> engineer/Engineer/ENGINEER', () => {
  assert.equal(mod.replaceLine('blade').text, 'engineer');
  assert.equal(mod.replaceLine('Blade').text, 'Engineer');
  assert.equal(mod.replaceLine('BLADE').text, 'ENGINEER');
});

// ---------------------------------------------------------------------------
// Compounds.
// ---------------------------------------------------------------------------

test('compound: blade-model-gate -> engineer-model-gate', () => {
  assert.equal(mod.replaceLine('blade-model-gate.js').text, 'engineer-model-gate.js');
});

test('compound: subagent_type: "blade" -> subagent_type: "engineer"', () => {
  assert.equal(
    mod.replaceLine('subagent_type: "blade"').text,
    'subagent_type: "engineer"',
  );
});

test('compound: phantom:blade -> phantom:engineer', () => {
  assert.equal(mod.replaceLine('phantom:blade').text, 'phantom:engineer');
});

test('compound: multi-token line sage-blade-kaze -> advisor-engineer-varek', () => {
  assert.equal(mod.replaceLine('sage-blade-kaze').text, 'advisor-engineer-varek');
});

test('the five real kept-prefix council-* compounds', () => {
  const cases = [
    ['council-kirran', 'council-ostrem'],
    ['council-mossa', 'council-pellam'],
    ['council-ellow', 'council-rendal'],
    ['council-tavric', 'council-senwick'],
    ['council-sorne', 'council-tarvel'],
  ];
  for (const [before, after] of cases) {
    assert.equal(mod.replaceLine(before).text, after, `${before} -> ${after}`);
  }
});

// ---------------------------------------------------------------------------
// Exceptions.
// ---------------------------------------------------------------------------

test('exception: "the generating lens for this approach" is left unchanged', () => {
  const line = 'State the generating lens for this approach, never a vague "be creative".';
  const { text, count } = mod.replaceLine(line);
  assert.equal(count, 0);
  assert.equal(text, line);
});

test('exception: Dual-Lens Protocol -> Dual-Auditor Protocol (special phrase, case-preserving)', () => {
  assert.equal(mod.replaceLine('## Dual-Lens Protocol').text, '## Dual-Auditor Protocol');
  assert.equal(
    mod.replaceLine('the dual-lens protocol and re-review details').text,
    'the dual-auditor protocol and re-review details',
  );
});

test('exception: a plain lens line elsewhere in the same file still replaces normally', () => {
  // Sanity check that EXCEPTIONS are line-scoped, not token-global: a line
  // that does NOT match any lens exception pattern still replaces lens.
  const { text, count } = mod.replaceLine('Spawn exactly one read-only Lens named `lens-yara`.');
  assert.equal(count, 3); // Lens, lens, yara
  assert.equal(text, 'Spawn exactly one read-only Surveyor named `surveyor-meridan`.');
});

test('FILE_EXEMPT: sweep is never replaced in the whole-file-exempt migration/session files', () => {
  const line = 'the repo-dirs sweep must NOT run while the lock is held';
  const exempt = mod.replaceLine(line, 'scripts/migrate-repo-dirs.js');
  assert.equal(exempt.count, 0);
  assert.equal(exempt.text, line);

  // The same line in a non-exempt file DOES replace (sanity check the
  // exemption is file-scoped, not a blanket skip of the phrase).
  const notExempt = mod.replaceLine(line, 'commands/verify.md');
  assert.equal(notExempt.count, 1);
});

test('FILE_EXEMPT: apex is never replaced in the .apex-active legacy-sentinel files', () => {
  const line = "const MARKER_NAMES = ['.chief-active', '.apex-active'];";
  const exempt = mod.replaceLine(line, 'hooks/greploop-gate.js');
  assert.equal(exempt.count, 0);
  assert.equal(exempt.text, line);

  // Same line in a non-exempt file DOES replace (file-scoped, not a blanket
  // skip of the .apex-active sentinel string).
  const notExempt = mod.replaceLine(line, 'commands/verify.md');
  assert.equal(notExempt.count, 1);
  assert.equal(notExempt.text, "const MARKER_NAMES = ['.chief-active', '.chief-active'];");
});

test('FILE_EXEMPT: blade is never replaced in the .blade-editing legacy-sentinel files', () => {
  const line = "  assert.equal(liveStateReason(['.blade-editing']), 'stale-active-marker');";
  const exempt = mod.replaceLine(line, 'test/migrate-data.test.js');
  assert.equal(exempt.count, 0);
  assert.equal(exempt.text, line);

  // Same line in a non-exempt file DOES replace (file-scoped, not a blanket
  // skip of the .blade-editing sentinel string).
  const notExempt = mod.replaceLine(line, 'commands/verify.md');
  assert.equal(notExempt.count, 1);
  assert.equal(
    notExempt.text,
    "  assert.equal(liveStateReason(['.engineer-editing']), 'stale-active-marker');",
  );
});

test('FILE_EXEMPT: lens is never replaced in the brainstorm ideas[] schema-key file', () => {
  const line = "      requireTextFields(idea, `ideas[${index}]`, ['id', 'title', 'summary', 'lens', 'technique'], errors);";
  const exempt = mod.replaceLine(line, 'skills/phantom/scripts/lib/decision-contracts.mjs');
  assert.equal(exempt.count, 0);
  assert.equal(exempt.text, line);

  // Same line in a non-exempt file DOES replace (file-scoped, not a blanket
  // skip of the schema-key spelling).
  const notExempt = mod.replaceLine(line, 'commands/verify.md');
  assert.equal(notExempt.count, 1);
  assert.match(notExempt.text, /'surveyor'/);
});

// ---------------------------------------------------------------------------
// Lint.
// ---------------------------------------------------------------------------

test('lint: an exempted ambiguous token is not reported as a leftover', () => {
  const dir = mkTmpDir();
  try {
    writeFixture(dir, 'hooks/greploop-gate.js', "const MARKER_NAMES = ['.chief-active', '.apex-active'];\n");
    writeFixture(dir, 'commands/hound.md', 'Large-scope sweep means a broad investigative scan.\n');
    const report = mod.lint(dir);
    assert.deepEqual(report.leftovers, []);
  } finally {
    rmTmpDir(dir);
  }
});

test('lint: a genuine missed rename (non-exempt token) is still reported as a leftover', () => {
  const dir = mkTmpDir();
  try {
    writeFixture(dir, 'docs/stale.md', 'The blade agent handles this step.\n');
    const report = mod.lint(dir);
    assert.equal(report.leftovers.length, 1);
    assert.match(report.leftovers[0], /docs\/stale\.md:1:/);
  } finally {
    rmTmpDir(dir);
  }
});

test('lint: the same apex sentinel line outside its exempt file IS reported as a leftover', () => {
  const dir = mkTmpDir();
  try {
    writeFixture(dir, 'docs/stale.md', "const MARKER_NAMES = ['.chief-active', '.apex-active'];\n");
    const report = mod.lint(dir);
    assert.equal(report.leftovers.length, 1);
  } finally {
    rmTmpDir(dir);
  }
});

test('lint: the same blade sentinel line outside its exempt file IS reported as a leftover', () => {
  const dir = mkTmpDir();
  try {
    writeFixture(
      dir,
      'docs/stale.md',
      "  assert.equal(liveStateReason(['.blade-editing']), 'stale-active-marker');\n",
    );
    const report = mod.lint(dir);
    assert.equal(report.leftovers.length, 1);
  } finally {
    rmTmpDir(dir);
  }
});

test('lint: article error in backtick form (a `engineer`) is flagged', () => {
  const dir = mkTmpDir();
  try {
    writeFixture(dir, 'docs/stale.md', 'Prefer spawning a `engineer` for this change.\n');
    const report = mod.lint(dir);
    assert.equal(report.articleErrors.length, 1);
    assert.match(report.articleErrors[0], /docs\/stale\.md:1:/);
  } finally {
    rmTmpDir(dir);
  }
});

test('lint: clean text with correct article agreement is not flagged', () => {
  const dir = mkTmpDir();
  try {
    writeFixture(dir, 'docs/clean.md', 'Prefer spawning an `engineer` for this change.\n');
    const report = mod.lint(dir);
    assert.deepEqual(report.articleErrors, []);
  } finally {
    rmTmpDir(dir);
  }
});

// ---------------------------------------------------------------------------
// Rename derivation.
// ---------------------------------------------------------------------------

test('rename derivation: file basename blade-model-gate.js -> engineer-model-gate.js', () => {
  assert.equal(mod.basenameMatches('blade-model-gate.js'), true);
  assert.equal(mod.renameBasename('blade-model-gate.js'), 'engineer-model-gate.js');
});

test('rename derivation: directory basename hound -> detective', () => {
  assert.equal(mod.basenameMatches('hound'), true);
  assert.equal(mod.renameBasename('hound'), 'detective');
});

test('rename derivation: scout/council/explore/planner/hunter basenames never match', () => {
  for (const name of ['scout.md', 'council-mvp', 'explore', 'planner', 'hunter']) {
    assert.equal(mod.basenameMatches(name), false, `${name} must not be renamed`);
  }
});

// ---------------------------------------------------------------------------
// Fixture-directory tests: planRenames / apply / idempotence, against a temp
// dir, never the live repo.
// ---------------------------------------------------------------------------

test('planRenames finds file and directory renames in a fixture tree', () => {
  const root = mkTmpDir();
  try {
    writeFixture(root, 'agents/hound.md', '# Hound\nForensic investigator.\n');
    writeFixture(root, 'hooks/blade-model-gate.js', 'const FABLE_DENIED_WORKERS = new Set(["blade"]);\n');
    writeFixture(root, 'skills/hound/SKILL.md', 'Hound skill.\n');
    writeFixture(root, 'commands/scout.md', 'Scout is never renamed.\n');

    const renames = mod.planRenames(root);
    const byOld = Object.fromEntries(renames.map((r) => [r.oldRel, r]));

    assert.equal(byOld['agents/hound.md'].newRel, 'agents/detective.md');
    assert.equal(byOld['hooks/blade-model-gate.js'].newRel, 'hooks/engineer-model-gate.js');
    assert.equal(byOld['skills/hound'].newRel, 'skills/detective');
    assert.equal(byOld['skills/hound'].type, 'dir');
    assert.ok(!byOld['commands/scout.md'], 'scout.md must never be planned for rename');
  } finally {
    rmTmpDir(root);
  }
});

test('apply performs content replacement and file/dir renames on a fixture tree', () => {
  const root = mkTmpDir();
  try {
    writeFixture(root, 'agents/hound.md', '# Hound\nForensic investigator. subagent_type: "hound"\n');
    writeFixture(root, 'hooks/blade-model-gate.js', 'const FABLE_DENIED_WORKERS = new Set(["blade", "sweep", "ward"]);\n');
    writeFixture(root, 'skills/hound/SKILL.md', 'Hound skill for hound-fenrik.\n');

    const report = mod.apply(root);
    assert.ok(report.filesChanged >= 2);
    assert.ok(report.totalReplacements >= 4);
    assert.ok(report.renames.length >= 3);

    assert.ok(fs.existsSync(path.join(root, 'agents', 'detective.md')));
    assert.ok(!fs.existsSync(path.join(root, 'agents', 'hound.md')));
    assert.ok(fs.existsSync(path.join(root, 'hooks', 'engineer-model-gate.js')));
    assert.ok(fs.existsSync(path.join(root, 'skills', 'detective', 'SKILL.md')));
    assert.ok(!fs.existsSync(path.join(root, 'skills', 'hound')));

    const detectiveContent = fs.readFileSync(path.join(root, 'agents', 'detective.md'), 'utf8');
    assert.equal(detectiveContent, '# Detective\nForensic investigator. subagent_type: "detective"\n');

    const gateContent = fs.readFileSync(path.join(root, 'hooks', 'engineer-model-gate.js'), 'utf8');
    assert.equal(gateContent, 'const FABLE_DENIED_WORKERS = new Set(["engineer", "steward", "inspector"]);\n');

    const skillContent = fs.readFileSync(path.join(root, 'skills', 'detective', 'SKILL.md'), 'utf8');
    assert.equal(skillContent, 'Detective skill for detective-draget.\n');
  } finally {
    rmTmpDir(root);
  }
});

test('idempotence: applying twice equals applying once (second apply is a no-op)', () => {
  const root = mkTmpDir();
  try {
    writeFixture(root, 'agents/hound.md', '# Hound\nsubagent_type: "hound"\n');
    writeFixture(root, 'hooks/blade-model-gate.js', 'const x = "blade";\n');
    writeFixture(root, 'skills/hound/SKILL.md', 'Hound skill.\n');

    const first = mod.apply(root);
    assert.ok(first.filesChanged > 0);
    assert.ok(first.renames.length > 0);

    const second = mod.apply(root);
    assert.equal(second.filesChanged, 0, 'second apply must change zero files');
    assert.equal(second.totalReplacements, 0, 'second apply must make zero replacements');
    assert.equal(second.renames.length, 0, 'second apply must plan zero renames');
  } finally {
    rmTmpDir(root);
  }
});

test('apply aborts before any mutation when a planned destination already exists', () => {
  const root = mkTmpDir();
  try {
    writeFixture(root, 'agents/hound.md', '# Hound\nForensic investigator.\n');
    // Pre-existing destination: what a failed `git mv` falling through to a
    // raw fs.rename would otherwise silently overwrite.
    writeFixture(root, 'agents/detective.md', '# Detective\nDo not overwrite me.\n');
    writeFixture(root, 'hooks/blade-model-gate.js', 'const x = "blade";\n');

    assert.throws(() => mod.apply(root), /rename collision/);

    // Zero changes made anywhere in the tree, not just at the collision.
    assert.equal(
      fs.readFileSync(path.join(root, 'agents', 'detective.md'), 'utf8'),
      '# Detective\nDo not overwrite me.\n',
      'pre-existing destination must be untouched',
    );
    assert.equal(
      fs.readFileSync(path.join(root, 'agents', 'hound.md'), 'utf8'),
      '# Hound\nForensic investigator.\n',
      'colliding source must not have been renamed or rewritten',
    );
    assert.equal(
      fs.readFileSync(path.join(root, 'hooks', 'blade-model-gate.js'), 'utf8'),
      'const x = "blade";\n',
      'an unrelated file with its own (non-colliding) rename must also see zero changes',
    );
    assert.ok(!fs.existsSync(path.join(root, 'hooks', 'engineer-model-gate.js')), 'unrelated rename must not have run either');
  } finally {
    rmTmpDir(root);
  }
});

test('apply collision error names every colliding path', () => {
  const root = mkTmpDir();
  try {
    writeFixture(root, 'agents/hound.md', '# Hound\n');
    writeFixture(root, 'agents/detective.md', '# Detective\n');
    writeFixture(root, 'skills/ward/SKILL.md', 'Ward skill.\n');
    writeFixture(root, 'skills/inspector/SKILL.md', 'Inspector skill.\n');
    try {
      mod.apply(root);
      assert.fail('apply must throw on a rename collision');
    } catch (err) {
      assert.match(err.message, /agents\/hound\.md -> agents\/detective\.md/);
      assert.match(err.message, /skills\/ward -> skills\/inspector/);
    }
  } finally {
    rmTmpDir(root);
  }
});

test('census reports scanned files, replacement counts, and renames without mutating the tree', () => {
  const root = mkTmpDir();
  try {
    writeFixture(root, 'agents/hound.md', '# Hound\n');
    writeFixture(root, 'bin/tool', 'no tokens here\n');
    writeFixture(root, 'CHANGELOG.md', 'blade blade blade\n');

    const report = mod.census(root);
    assert.equal(report.filesWithMatches, 1);
    assert.equal(report.renames.length, 1);
    // CHANGELOG.md is excluded from scanning entirely, so it contributes
    // neither to filesScanned's content nor to any replacement count.
    assert.ok(!report.perFile.some((f) => f.file === 'CHANGELOG.md'));

    // dry-run: nothing on disk changed.
    assert.equal(fs.readFileSync(path.join(root, 'agents', 'hound.md'), 'utf8'), '# Hound\n');
    assert.ok(fs.existsSync(path.join(root, 'agents', 'hound.md')));
  } finally {
    rmTmpDir(root);
  }
});
