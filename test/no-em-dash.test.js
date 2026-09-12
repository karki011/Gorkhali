// Author: Subash Karki
// no-em-dash.test.js - mechanical guard for the new tree: no U+2014 (em
// dash) character in any file under commands/, agents/, lib/, config/,
// hooks/, skills/ or test/. Historical note: eight wave-1 Engineers were told no
// em dashes and 11 of 14 new files had them anyway; prose rules do not
// hold, tests do.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SCAN_DIRS = ['commands', 'agents', 'lib', 'config', 'hooks', 'skills', 'test'];
const EM_DASH = '\u2014';

function walk(dir, out) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (_) {
    return out;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, out);
    } else if (entry.isFile()) {
      out.push(full);
    }
  }
  return out;
}

test('no em dash in commands, agents, lib, config, hooks, skills or test', () => {
  const offenders = [];
  for (const dirName of SCAN_DIRS) {
    const files = walk(path.join(ROOT, dirName), []);
    for (const file of files) {
      let contents;
      try {
        contents = fs.readFileSync(file, 'utf-8');
      } catch (_) {
        continue;
      }
      if (contents.includes(EM_DASH)) {
        offenders.push(path.relative(ROOT, file));
      }
    }
  }
  assert.deepEqual(offenders, [], `em dash found in: ${offenders.join(', ')}`);
});
