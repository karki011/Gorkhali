// Author: Subash Karki
// Pins the seven user-facing hour-one commands on the slash menu. Cursor
// reads commands/*.md for /start /pause /resume /verify /review /pr-review
// /wrap; hiding them (the default for every other command, whose skill is
// the menu) made those commands uninvocable on that host.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const USER_FACING = ['start', 'pause', 'resume', 'verify', 'review', 'pr-review', 'wrap'];

test('hour-one commands are user-invocable', () => {
  for (const name of USER_FACING) {
    const cmd = read(path.join('commands', `${name}.md`));
    assert.match(
      cmd,
      /^user-invocable:\s*true\s*$/m,
      `${name}.md must be user-invocable so /${name} appears in the menu`,
    );
    assert.doesNotMatch(cmd, /^user-invocable:\s*false\s*$/m, `${name}.md must not stay hidden`);
  }
});
