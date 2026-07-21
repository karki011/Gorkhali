// Author: Subash Karki
// seam-integration.test.js — THE regression test for the layout-reconciliation seam.
//
// The bug: command-defs / agents WRITE corrections into per-repo learnings
// (<data>/repos/<repo>/learnings/), but the memory-reader hook used to READ from
// a FLAT <data>/learnings/ dir. The seam was open: failures recorded by one half
// were invisible to the other. Wave 1+2 closed it by routing both halves through
// the repo-aware learningsDir(). This test proves the closure end-to-end by
// spawning the REAL hook process (not a reimplementation of its parser) and
// asserting the [failed] correction surfaces.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const REPO_ROOT = path.resolve(__dirname, '..');
const HOOK = path.join(REPO_ROOT, 'hooks', 'memory-reader.js');
const EVO_RUNNER = path.join(REPO_ROOT, 'scripts', 'evolution-runner.js');

const REPO = 'testrepo';
// A real CORRECTION line, exactly the shape agents/command-defs write.
const CORRECTION =
  'CORRECTION [branch-compare]: assumed origin — must fetch correct remote [failed]';

// Spawn the real hook as Claude Code does: node hooks/memory-reader.js, JSON on
// stdin, env-driven path resolution. Returns { code, stdout, stderr }.
function runHook(env, payload) {
  try {
    const stdout = execFileSync('node', [HOOK], {
      input: JSON.stringify(payload),
      env,
      encoding: 'utf-8',
    });
    return { code: 0, stdout, stderr: '' };
  } catch (e) {
    return {
      code: typeof e.status === 'number' ? e.status : -1,
      stdout: (e.stdout || '').toString(),
      stderr: (e.stderr || '').toString(),
    };
  }
}

function shellSnippetThrough(content, markerCommand) {
  const snippet = [...content.matchAll(/`([^`\n]+)`/g)]
    .map(match => match[1])
    .find(candidate => candidate.includes(markerCommand));
  if (!snippet) return null;
  return snippet.slice(0, snippet.indexOf(markerCommand) + markerCommand.length);
}

function fencedShellSnippetContaining(content, markerCommand) {
  return [...content.matchAll(/```(?:bash)?\n([\s\S]*?)```/g)]
    .map(match => match[1])
    .find(candidate => candidate.includes(markerCommand)) || null;
}

function seedRepoLearnings(dataDir, repo) {
  const learnDir = path.join(dataDir, 'repos', repo, 'learnings');
  fs.mkdirSync(learnDir, { recursive: true });
  // git.md holds the [failed] correction under a ## Corrections section.
  fs.writeFileSync(
    path.join(learnDir, 'git.md'),
    `# Git learnings\n\n## Corrections\n\n- ${CORRECTION}\n`
  );
  // INDEX.md maps a hook-detectable domain ("data") to git.md. The prompt below
  // contains "fetch" (a `data` keyword), so the hook loads git.md via this row.
  fs.writeFileSync(
    path.join(learnDir, 'INDEX.md'),
    `# Learnings Index\n\n| Domain | File | Entries | Corrections |\n` +
      `|--------|------|---------|-------------|\n` +
      `| data | \`git.md\` | 1 | 1 |\n`
  );
  return learnDir;
}

test('SEAM: hook surfaces a [failed] correction written to PER-REPO learnings', () => {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'seam-good-'));
  try {
    seedRepoLearnings(data, REPO);
    const res = runHook(
      { ...process.env, PHANTOM_DATA: data, PHANTOM_REPO: REPO },
      { prompt: 'how do I fetch the correct remote for a branch compare?' }
    );

    assert.equal(res.code, 0, 'hook exits cleanly');
    // The whole point: the per-repo [failed] correction reaches the injection.
    assert.ok(
      res.stdout.includes('branch-compare'),
      `expected injected output to surface the correction keyword.\nstdout: ${JSON.stringify(res.stdout)}\nstderr: ${res.stderr}`
    );
    assert.ok(
      res.stdout.includes('memory-injection'),
      'output uses the memory-injection envelope the hook emits'
    );
  } finally {
    fs.rmSync(data, { recursive: true, force: true });
  }
});

test('SEAM REGRESSION GUARD: a FLAT-only learnings layout is NOT read (old bug stays fixed)', () => {
  // Reproduce the OLD broken layout: write the SAME learnings at the FLAT path
  // <data>/learnings/ (no repos/<repo>/). The repo-aware hook reads
  // <data>/repos/<repo>/learnings/, so it must NOT see the flat file. If a future
  // change reverts learningsDir() to the flat path, this assertion flips and fails.
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'seam-flat-'));
  try {
    const flatLearn = path.join(data, 'learnings'); // the old, wrong location
    fs.mkdirSync(flatLearn, { recursive: true });
    fs.writeFileSync(
      path.join(flatLearn, 'git.md'),
      `# Git learnings\n\n## Corrections\n\n- ${CORRECTION}\n`
    );
    fs.writeFileSync(
      path.join(flatLearn, 'INDEX.md'),
      `# Learnings Index\n\n| Domain | File |\n|--------|------|\n| data | \`git.md\` |\n`
    );

    const res = runHook(
      { ...process.env, PHANTOM_DATA: data, PHANTOM_REPO: REPO },
      { prompt: 'how do I fetch the correct remote for a branch compare?' }
    );

    assert.equal(res.code, 0, 'hook still exits cleanly (no per-repo dir to read)');
    assert.ok(
      !res.stdout.includes('branch-compare'),
      'flat-layout learnings must NOT surface — the seam routes reads through repos/<repo>/, ' +
        'so the only way this leaks is a regression to the flat path. ' +
        `stdout: ${JSON.stringify(res.stdout)}`
    );
  } finally {
    fs.rmSync(data, { recursive: true, force: true });
  }
});

test('SEAM: missing per-repo learnings dir -> hook exits cleanly, injects nothing', () => {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'seam-empty-'));
  try {
    // PHANTOM_DATA exists but no repos/<repo>/learnings was ever created.
    const res = runHook(
      { ...process.env, PHANTOM_DATA: data, PHANTOM_REPO: 'norepo' },
      { prompt: 'how do I fetch the correct remote for a branch compare?' }
    );
    assert.equal(res.code, 0, 'no crash when learnings dir is absent (fails open)');
    assert.equal(res.stdout.trim(), '', 'injects nothing when there is nothing to read');
  } finally {
    fs.rmSync(data, { recursive: true, force: true });
  }
});

test('evolution-runner: non-existent PHANTOM_DATA -> exit 0, no throw', () => {
  const ghost = path.join(os.tmpdir(), 'phantom-ghost-' + Date.now(), 'does-not-exist');
  let code, stderr = '';
  try {
    execFileSync('node', [EVO_RUNNER], {
      env: { ...process.env, PHANTOM_DATA: ghost },
      encoding: 'utf-8',
    });
    code = 0;
  } catch (e) {
    code = typeof e.status === 'number' ? e.status : -1;
    stderr = (e.stderr || '').toString();
  }
  assert.equal(code, 0, `evolution-runner must fail open (exit 0). stderr: ${stderr}`);
});

test('native plugin is zero-setup and marker commands create their data root', () => {
  for (const retiredPath of ['commands/setup.md', 'setup.sh', 'install.sh']) {
    assert.equal(
      fs.existsSync(path.join(REPO_ROOT, retiredPath)),
      false,
      `${retiredPath} must stay retired; native plugin discovery replaces setup and symlinks`,
    );
  }

  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'phantom-zero-setup-'));
  try {
    for (const command of ['start.md', 'execute.md', 'fix.md', 'visual.md', 'recruit.md']) {
      const content = fs.readFileSync(path.join(REPO_ROOT, 'commands', command), 'utf8');
      const snippet = shellSnippetThrough(content, 'touch "$D/.blade-editing"');
      assert.ok(snippet, `${command} must create PHANTOM_DATA before writing its blade marker`);

      const dataRoot = path.join(sandbox, command);
      execFileSync('/bin/sh', ['-c', snippet], {
        env: { ...process.env, PHANTOM_DATA: dataRoot },
      });
      assert.equal(fs.existsSync(path.join(dataRoot, '.blade-editing')), true);
    }

    const start = fs.readFileSync(path.join(REPO_ROOT, 'commands', 'start.md'), 'utf8');
    const snippet = shellSnippetThrough(start, 'touch "$ROOT/.apex-active"');
    assert.ok(snippet, 'start must create the state directory before activating a fresh session');

    const dataRoot = path.join(sandbox, 'apex');
    execFileSync('/bin/sh', ['-c', snippet], {
      env: { ...process.env, PHANTOM_DATA: dataRoot },
    });
    assert.equal(fs.existsSync(path.join(dataRoot, '.apex-active')), true);
    assert.equal(fs.statSync(path.join(dataRoot, 'state')).isDirectory(), true);

    fs.writeFileSync(path.join(dataRoot, '.blade-editing'), '');
    const wrap = fs.readFileSync(path.join(REPO_ROOT, 'reference', 'wrap', 'evolution.md'), 'utf8');
    const cleanup = fencedShellSnippetContaining(wrap, 'rm -f');
    assert.ok(cleanup, 'wrap must define lifecycle marker cleanup');
    execFileSync('/bin/sh', ['-c', cleanup], {
      env: { ...process.env, PHANTOM_DATA: dataRoot },
    });
    assert.equal(fs.existsSync(path.join(dataRoot, '.apex-active')), false);
    assert.equal(fs.existsSync(path.join(dataRoot, '.blade-editing')), false);
  } finally {
    fs.rmSync(sandbox, { recursive: true, force: true });
  }
});
