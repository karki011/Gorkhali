// Author: Subash Karki
// Hour-one commands stay hidden so Claude Code / Cursor plugin menus list
// each name once via the matching skill; the command file remains the
// canonical procedure.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const USER_FACING = ['start', 'pause', 'resume', 'verify', 'review', 'pr-review', 'wrap'];

test('hour-one commands stay hidden; matching skills are the menu surface', () => {
  for (const name of USER_FACING) {
    const cmd = read(path.join('commands', `${name}.md`));
    assert.match(
      cmd,
      /^user-invocable:\s*false\s*$/m,
      `${name}.md must be hidden so /${name} is listed once via the matching skill`,
    );
    assert.doesNotMatch(
      cmd,
      /^user-invocable:\s*true\s*$/m,
      `${name}.md must not be user-invocable`,
    );
    assert.ok(
      fs.existsSync(path.join(ROOT, 'skills', name, 'SKILL.md')),
      `skills/${name}/SKILL.md must exist as the single menu surface`,
    );
  }
});
