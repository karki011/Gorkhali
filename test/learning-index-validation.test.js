// Author: Subash Karki
// learning-index-validation.test.js -- regression guard for validateLearningIndex's
// domain-reference detection in skills/phantom/scripts/phantom-learning.mjs.
//
// The break this file exists to prevent: the old detector treated ANY `.md` token
// anywhere in INDEX.md as a domain reference (`/\b([\w-]+\.md)\b/g`), including
// tokens inside entry BODY PROSE (an auto-captured correction mentioning
// "docs/model-policy.md:40", or a path "ending in review.md"). That produced two
// false ERRORs on the real, healthy INDEX.md for this repo. The fix restricts a
// reference to two real shapes: a markdown link `[label](file.md)`, or a bare
// `file.md` anchored at the START of an entry line (`- file.md ...`). A token
// carrying a path separator or one appearing mid-sentence is never a reference.
//
// Every fixture line below is copied verbatim (not paraphrased) from the real,
// on-disk /learnings/INDEX.md for this repo, per the realworld-fixture-keeps-
// awkward-shape learning: real fixtures keep their awkward shape.
//
// The em dash that two real lines use as a separator is built from an escape
// (never typed as a literal glyph in this file's source), matching the existing
// no-em-dash convention in this repo.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const LEARNING = path.join(__dirname, '..', 'skills', 'phantom', 'scripts', 'phantom-learning.mjs');
// Built from an escape, never typed as a literal glyph, per this repo's no-em-dash convention.
const EM = '\u2014';

function makeLearningsDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'learn-idx-'));
}

function writeIndex(dir, body) {
  fs.writeFileSync(path.join(dir, 'INDEX.md'), body);
}

function writeDomain(dir, name, content) {
  fs.writeFileSync(path.join(dir, name), content);
}

async function validate(dir, knownDomains) {
  const { validateLearningIndex } = await import(pathToFileURL(LEARNING).href);
  return validateLearningIndex(dir, { knownDomains });
}

// --- real INDEX.md line-3 shape: bare bullet reference ----------------------

test('bare workflow.md reference (real INDEX.md line-3 shape) is detected as a reference', async () => {
  const dir = makeLearningsDir();
  try {
    const line3 = `- workflow.md ${EM} em-dash-in-new-text [failed]; haiku-report-untrustworthy [failed]; start-jira-lifecycle-sync; grep-count-exit [failed]; worktree-loses-wip [failed]; realworld-fixture-keeps-awkward-shape [validated:1]; shared-html-kit [validated:1]; blade-marker sequencing [failed]; tilde-in-quotes [failed]; prose-needs-executable; delete-beats-lock; context-mode injection; idle-without-report pattern; subagentstop-identity; empirical-hook-capture; sync-waves [failed]; untrusted-message-parse; lockfile-create-write-window [failed]; takeover-single-winner; prose-tool-contract; no-greptile-this-repo; nul-byte-binary-diff [validated:1]; blade-marker-consumable; attribution-honesty; dev-stdin-enxio [failed]; dead-conditional-gate; gate-surface-absorption [validated:2]; explicit-flag-loudness; reference-without-referent; colocated-lib-resolution [failed]; mailbox-silent-final-text [failed]; release-version-bump [failed]; case-sensitive-verify-grep [failed]; pin-doc-loci-sweep; structural-over-prose-enforcement [validated:2]`;
    writeIndex(dir, `# Learnings Index\n\n${line3}\n`);
    writeDomain(dir, 'workflow.md', 'validated workflow content\n');

    const { problems, warnings } = await validate(dir, ['workflow.md']);

    assert.ok(!problems.some((p) => p.includes('references "workflow.md"')), 'workflow.md must not be reported missing');
    assert.ok(!warnings.some((w) => w.includes('workflow.md has content but is not referenced')),
      'the bare bullet must count as a reference so this warning never fires');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// --- real INDEX.md line-8 shape: markdown-link reference --------------------

test('markdown-link [infra](infra.md) reference (real INDEX.md line-8 shape) is detected as a reference', async () => {
  const dir = makeLearningsDir();
  try {
    const line8 = `- [infra](infra.md) ${EM} guards must cover run-failure not just preconditions; plugin version gates update detection (not content); vendor verbatim + provenance; installer migration auto-detect. (4 entries, 2026-06-09) [validated:1]`;
    writeIndex(dir, `# Learnings Index\n\n${line8}\n`);
    writeDomain(dir, 'infra.md', 'validated infra content\n');

    const { problems, warnings } = await validate(dir, ['infra.md']);

    assert.ok(!problems.some((p) => p.includes('references "infra.md"')), 'infra.md must not be reported missing');
    assert.ok(!warnings.some((w) => w.includes('infra.md has content but is not referenced')),
      'the markdown link must count as a reference so this warning never fires');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// --- real INDEX.md line-15/16 shapes: mid-prose is NOT a reference ----------

test('review.md appearing mid-prose (real INDEX.md line-15 shape) is NOT treated as a reference', async () => {
  const dir = makeLearningsDir();
  try {
    const line15 = 'auto: PATTERN [mutation-audit-over-green-suite]: a green suite proves nothing about whether assertions would CATCH a regression - 78 mutations on PR 97 found 15 assertions green while pinning nothing, incl. one satisfied by unrelated git text, one by a path merely ending in review.md, one where reverting the verdict enum cell left the suite passing; falsify each assertion (break it, confirm fail=1, restore, verify byte-identical) [proposed] v:0 q:0.95 u:2026-07-29';
    writeIndex(dir, `# Learnings Index\n\n## Auto-Captured\n\n${line15}\n`);
    // review.md deliberately does not exist on disk - if it were misdetected as a
    // reference, the existence check would raise the exact false ERROR this fixes.

    const { problems } = await validate(dir, []);

    assert.ok(!problems.some((p) => p.includes('review.md')),
      'a mid-sentence "review.md" token must never be treated as a domain reference');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('docs/model-policy.md:40 appearing mid-prose is NOT treated as a reference', async () => {
  const dir = makeLearningsDir();
  try {
    const line16 = 'auto: CORRECTION [scope-not-tier]: [routed nearly every subtask to an expensive profile, justified as subtle or high-consequence - the exact reason docs/model-policy.md:40 rejects] - [if acceptance criteria can be written precisely a balanced profile hits them; escalate only when DISCOVERING the criteria is the task. Evidence: an expensive worker shipped a validator rule with zero tests, the scoped balanced worker then wrote 11 falsified assertions] [proposed] v:0 q:0.9 u:2026-07-29';
    writeIndex(dir, `# Learnings Index\n\n## Auto-Captured\n\n${line16}\n`);
    // agents.md deliberately does not exist on disk (and the real token even carries
    // a path separator + line-number suffix, which is never a reference shape).

    const { problems } = await validate(dir, []);

    assert.ok(!problems.some((p) => p.includes('agents.md')),
      'a path-qualified, mid-sentence "agents.md" token must never be treated as a domain reference');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// --- coverage hole: the anchor must reject mid-prose even when BULLET_RE would
// accept the line, not only when the `auto:` prefix rejects it first -----------
//
// The two tests above both use `auto:`-prefixed lines, which never reach the
// bare-bullet anchor at all: they are rejected because the line does not start
// with `-`, not because the anchor evaluates a mid-sentence `.md` token and
// rejects it. That leaves the anchor's actual discriminating behavior - "is the
// `.md` token in reference POSITION, immediately after the bullet" - unpinned.
// A regex loosened from `/^\s*-\s+([\w-]+\.md)\b/` to `/^\s*-\s+.*?([\w-]+\.md)\b/`
// would still pass both tests above (the `auto:` prefix still rejects those lines
// first) while resolving any `.md` token anywhere on a bulleted line. These two
// fixtures reshape the same real prose bodies as an actual bullet so the anchor
// itself is exercised.

test('bulleted review.md mid-prose (BULLET_RE would accept this line) is NOT treated as a reference', async () => {
  const dir = makeLearningsDir();
  try {
    const line =
      '- a green suite proves nothing about whether assertions would CATCH a regression - 78 mutations on PR 97 found 15 assertions green while pinning nothing, incl. one satisfied by unrelated git text, one by a path merely ending in review.md, one where reverting the verdict enum cell left the suite passing';
    writeIndex(dir, `# Learnings Index\n\n${line}\n`);
    // review.md deliberately does not exist on disk - if the anchor matched this
    // mid-sentence token, the existence check would raise the exact false ERROR
    // the discriminating anchor exists to prevent.

    const { problems } = await validate(dir, []);

    assert.ok(!problems.some((p) => p.includes('review.md')),
      'a mid-sentence "review.md" token on a bulleted line must never be treated as a domain reference');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('bulleted docs/model-policy.md:40 mid-prose is NOT treated as a reference', async () => {
  const dir = makeLearningsDir();
  try {
    const line =
      '- routed nearly every subtask to an expensive profile, justified as subtle or high-consequence, the exact reason docs/model-policy.md:40 rejects';
    writeIndex(dir, `# Learnings Index\n\n${line}\n`);
    // agents.md deliberately does not exist on disk (and the real token even
    // carries a path separator + line-number suffix, which is never a reference
    // shape even before considering bullet position).

    const { problems } = await validate(dir, []);

    assert.ok(!problems.some((p) => p.includes('agents.md')),
      'a path-qualified, mid-sentence "agents.md" token on a bulleted line must never be treated as a domain reference');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// --- INDEX.md / EDGES.md self-reference exclusion ---------------------------

test('a bare EDGES.md bullet line is excluded even though it matches the bare-bullet anchor', async () => {
  const dir = makeLearningsDir();
  try {
    writeIndex(dir, '# Learnings Index\n\n- EDGES.md is the structural edge graph, not a domain file\n');
    // EDGES.md deliberately does not exist on disk - if the anchor did not exclude
    // it, the existence check would raise a false ERROR for the graph file.

    const { problems } = await validate(dir, []);

    assert.ok(!problems.some((p) => p.includes('EDGES.md')), 'EDGES.md must never be treated as a domain reference');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a bare INDEX.md bullet line is excluded even though it matches the bare-bullet anchor', async () => {
  const dir = makeLearningsDir();
  try {
    writeIndex(dir, '# Learnings Index\n\n- INDEX.md is the source of truth for domain routing\n');
    // knownDomains deliberately (if unusually) includes INDEX.md so the exclusion is
    // provable through the "has content but is not referenced" warning: since
    // INDEX.md must never count as self-referenced, this warning must still fire.

    const { warnings } = await validate(dir, ['INDEX.md']);

    assert.ok(warnings.some((w) => w.includes('INDEX.md has content but is not referenced')),
      'INDEX.md must never be added to referencedDomains via its own bare-bullet line');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// --- regression guard: a genuinely missing referenced file must still error --

test('a genuinely missing referenced domain file still produces the existence-check ERROR', async () => {
  const dir = makeLearningsDir();
  try {
    writeIndex(dir, `# Learnings Index\n\n- missing.md ${EM} some entry\n`);
    // missing.md is deliberately never created - this is the regression that
    // matters most: the fix must not weaken the check into uselessness.

    const { problems } = await validate(dir, []);

    assert.ok(problems.includes('ERROR: INDEX.md references "missing.md" but file does not exist'),
      'a real missing domain reference must still be caught');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
