// Author: Subash Karki
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.join(__dirname, '..');
const SKILLS = path.join(ROOT, 'skills');
const PORTABLE = path.join(SKILLS, 'phantom');

function publicPromptFiles() {
  const actions = fs.readdirSync(SKILLS)
    .map((entry) => path.join(SKILLS, entry, 'SKILL.md'))
    .filter((file) => fs.existsSync(file));
  return [
    ...actions,
    path.join(PORTABLE, 'references', 'models.md'),
    path.join(PORTABLE, 'references', 'roles.md'),
    path.join(PORTABLE, 'references', 'verification.md'),
    path.join(PORTABLE, 'references', 'workflows.md'),
  ];
}

test('published prompts contain no retired orchestration doctrine', () => {
  const forbidden = [
    ['mandatory subagent', /(?:always|must) spawn|never implement|even 1-line/i],
    ['file-count fanout', /4\+ files|(?:when|if)[^.\n]*file count[^.\n]*(?:spawn|fan.?out)/i],
    ['universal effort', /uniform `?high`?|effort is high for every/i],
    ['fixed reviewer stack', /four (?:parallel )?(?:reviewers|review agents)|all four must pass/i],
    ['severity suppression', /P2\/P3 dropped|P2\+ = drop|do not report P[23]/i],
    ['alternate runtime prompt', /\.\.\/\.\.\/commands\/|codex-support|canonical preamble/i],
  ];

  for (const file of publicPromptFiles()) {
    const content = fs.readFileSync(file, 'utf8');
    for (const [label, pattern] of forbidden) {
      assert.doesNotMatch(content, pattern, `${path.relative(ROOT, file)} contains ${label}`);
    }
  }

  const workflows = fs.readFileSync(path.join(PORTABLE, 'references', 'workflows.md'), 'utf8');
  assert.match(workflows, /File count alone never justifies fan-out/i);
});

test('effort varies by semantic profile instead of using one universal value', () => {
  const presets = JSON.parse(fs.readFileSync(
    path.join(PORTABLE, 'references', 'model-presets.json'),
    'utf8',
  ));
  for (const [host, policy] of Object.entries(presets.hosts)) {
    const efforts = new Set(Object.values(policy.profiles).map((profile) => profile.effort));
    assert.ok(efforts.size > 1, `${host} must use profile-specific effort`);
    assert.equal(policy.profiles.balanced.effort, 'medium');
  }
});

test('wrap never embeds implicit external lifecycle commands', () => {
  const wrap = fs.readFileSync(path.join(SKILLS, 'wrap', 'SKILL.md'), 'utf8');
  assert.match(wrap, /separate `ship-draft-pr` authorization/i);
  assert.match(wrap, /idempotent capability request/i);
  assert.doesNotMatch(wrap, /git commit|git push|gh pr create|transitionJiraIssue/);
});
