#!/usr/bin/env node
// Author: Subash Karki
// response-shape.js — SessionStart hook that makes the response-shape contract
// apply to EVERY turn of a session, not only to /gorkhali:* command responses.
//
// Why a hook and not prose. `commands/_shared.md` carries the contract, but it
// is loaded per command, so it shapes a command's own report and then lapses:
// the follow-up question ("why did it pick PLAN?") is answered in default style.
// Session-wide persistence needs the rules resident in context, which is what
// this injects.
//
// Matcher `startup|resume|clear|compact` in hooks.json is doing real work.
// `compact` is the one that matters most: compaction drops the injected block,
// and without a re-injection the mode silently dies mid-session — the exact
// failure the contract's own persistence clause forbids.
//
// POLARITY: pure advisory. A SessionStart hook that throws would wedge session
// start, so every failure path exits 0 and the session simply starts unshaped.
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const REFERENCE = path.join(__dirname, '..', 'reference', 'response-shape.md');
const CONFIG_KEY = 'output.response_shape';

// Resolve the contract from this file's own location rather than a trusted env
// var, so a relocated plugin root cannot point the injection at another file.
function readContract() {
  const body = fs.readFileSync(REFERENCE, 'utf8');
  // Skip the two maintainer-facing sections at the top: which file owns which
  // output, and how to enable/disable this hook. Neither is actionable for the
  // model, and the injected header already states the persistence rule. Start
  // at the reader model, which IS actionable — it is why the rules are shaped
  // the way they are — and carry through the rules, overrides, and pre-send check.
  const start = body.indexOf('## Why orchestration output fails');
  return (start === -1 ? body : body.slice(start)).replace(/\s+$/, '');
}

// Reads the same layered config `scripts/gorkhali-config.js` writes, without
// importing it: this runs at session start, where a module-load failure would
// cost more than the feature is worth. Per-repo wins over global, matching the
// resolution order that module documents.
function enabled() {
  if (process.env.GORKHALI_RESPONSE_SHAPE) {
    return process.env.GORKHALI_RESPONSE_SHAPE === 'always';
  }
  // Repo directories are hashed ids (`<name>-<hash>`), not bare basenames, so
  // the per-repo config is only findable through the shared resolver. Matching
  // on basename(cwd) silently misses every per-repo setting.
  let gorkhaliData;
  let repoDir;
  let detectRepo;
  try {
    ({ gorkhaliData, repoDir, detectRepo } = require('../scripts/lib/gorkhali-paths'));
  } catch (_) {
    // fail open: global config only, same fallback shape as hooks/router-nudge.js.
    const home = os.homedir();
    const data = process.env.GORKHALI_DATA
      || (home ? path.join(home, '.gorkhali') : path.join(process.cwd(), '.gorkhali'));
    gorkhaliData = () => data;
  }

  // gorkhali-config.js stores `a.b` nested as {a: {b: value}} at the file root,
  // with no wrapper object. Reading it as a flat dotted key silently resolves
  // to undefined, which would read as "off" and disable the mode for everyone.
  const [section, leaf] = CONFIG_KEY.split('.');
  const readKey = (file) => {
    try {
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
      const group = parsed && typeof parsed === 'object' ? parsed[section] : undefined;
      const value = group && typeof group === 'object' ? group[leaf] : undefined;
      return typeof value === 'string' ? value : undefined;
    } catch (_) {
      return undefined;
    }
  };

  let repoValue;
  try {
    if (repoDir && detectRepo) {
      // detectRepo() returns the hashed repo id as a string, not a record.
      repoValue = readKey(path.join(repoDir(detectRepo()), 'config.json'));
    }
  } catch (_) { /* no per-repo config: fall through to global */ }

  // Per-repo wins over global, matching gorkhali-config.js's resolution order.
  const resolved = repoValue !== undefined
    ? repoValue
    : readKey(path.join(gorkhaliData(), 'config.json'));
  return resolved === 'always';
}

try {
  if (enabled()) {
    process.stdout.write(
      'GORKHALI RESPONSE SHAPE ACTIVE (session-wide). The contract below applies to '
      + 'every response for the rest of this session, including replies that are not '
      + '/gorkhali:* commands. It does not lapse when the topic changes. Turn it off with '
      + `\`gorkhali-config.js set ${CONFIG_KEY} off\`.\n\n${readContract()}\n`,
    );
  }
} catch (_) {
  // Never block session start.
}
process.exit(0);
