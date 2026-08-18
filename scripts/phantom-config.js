#!/usr/bin/env node
// Author: Subash Karki
// phantom-config.js - the config layer: closed schema, two files, per-repo wins,
// PROVENANCE on every resolved value.
//
// Why this exists: commands/close.md and commands/start.md both said "Honor config
// `jira.auto_transition`" while no reader, no file, and no schema existed anywhere
// in the repo. A documented setting with no implementation is a dangling reference -
// a model reading that prose either invents a default or silently ignores it. This
// module is the reader those two lines now name.
//
// Storage (created LAZILY - a fresh install needs no setup step):
//   <data>/repos/<repo>/config.json   per-repo
//   <data>/config.json                global default
// Both paths come from lib/phantom-paths.js; nothing here hand-builds a path.
//
// Resolution order, first hit wins:
//   explicit (caller override) > per-repo > global > detect > unset
// Every result carries `provenance` so a caller (and phantom-doctor) can explain
// WHY a setting has its value. An unset key is reported unset with a reason - this
// module never fabricates a default.
//
// UNATTENDED RULE: nothing here ever prompts, reads stdin, or blocks. `/phantom:loop`
// runs with no human present (commands/loop.md: "Never ask the user a question"), so
// an unset setting is INACTIVE, not an error. askPlan() reports that a value is unset
// and what an interactive caller should ask; the asking itself belongs to that caller.
'use strict';

const path = require('path');
const codec = require('../skills/phantom/scripts/lib/shared-state.cjs');
const { phantomData, repoDir, detectRepo } = require('./lib/phantom-paths');
const { atomicUpdate, readFileSafe } = require('./lib/atomic');
const { PhantomError, exitCodeForError, reportError, VALIDATION_ERROR } = require('./lib/axi-error');

const SCHEMA_VERSION = 1;

// The whole schema, flat. One registry drives validation, get, set, and list, so a
// new key cannot be half-added. CLOSED ENUMS: an unlisted value is rejected, never
// coerced. No credentials, no tokens, no free-text status fields - closed metadata only.
const KEYS = {
  'tracker.provider': { type: 'enum', values: ['jira', 'linear', 'github', 'file', 'none'] },
  'tracker.ready_signal': { type: 'string' },
  // Tracker-level, not Jira-level: Jira, Linear, and GitHub Issues all have labels.
  // Each provider APPLIES it its own way (commands/start.md step 3.2c).
  'tracker.label': { type: 'label' },
  'tracker.chosen': { type: 'enum', values: ['asked', 'detected', 'explicit'] },
  'tracker.chosen_at': { type: 'iso-date' },
  'jira.auto_transition': { type: 'boolean' },
  'review.external': { type: 'enum', values: ['greptile', 'none'] },
  'spend.ceiling_usd': { type: 'number' },
  // `off` (or unset) still shapes every /phantom:* report, because commands load
  // the contract from _shared.md. `always` extends it to every turn of the
  // session via hooks/response-shape.js, including replies that are not commands.
  'output.response_shape': { type: 'enum', values: ['off', 'always'] },
};

const SECTIONS = new Set(Object.keys(KEYS).map((k) => k.split('.')[0]));

// Keys with a real detector (step 4 of the resolution order). Everything else has
// no detector, and the unset reason says so rather than implying one ran.
const DETECTED_KEYS = new Set(['tracker.provider']);

// What an interactive caller should ask for a key that resolves to nothing. Text
// only - the prompting lives in the caller, never here.
const QUESTIONS = {
  'tracker.provider': 'Which ticket tracker should Phantom use for this repo?',
  'review.external': 'Which external reviewer should Phantom run on a PR?',
  'output.response_shape': 'Should the response-shape contract apply to every turn of the session, not only /phantom:* reports?',
};

function invalid(message, suggestions = []) {
  return new PhantomError('phantom-config: ' + message, VALIDATION_ERROR, suggestions);
}

// ---------------------------------------------------------------------------
// Schema validation
// ---------------------------------------------------------------------------

// Jira rejects a label containing whitespace and caps one at 255 characters; GitHub
// labels behave badly with whitespace too. Validating here means the stamping step in
// commands/start.md never has to guess whether a configured label is legal - an
// illegal one is refused at `set` time, before it can reach a tracker.
const LABEL_MAX = 255;

function describe(spec) {
  if (spec.type === 'enum') return 'one of: ' + spec.values.join(', ');
  if (spec.type === 'iso-date') return 'an ISO 8601 timestamp string';
  if (spec.type === 'number') return 'a non-negative number';
  if (spec.type === 'boolean') return 'a boolean (true or false)';
  if (spec.type === 'label') {
    return 'a valid tracker label: non-empty, no whitespace, at most ' + LABEL_MAX + ' characters';
  }
  return 'a non-empty string';
}

function accepts(spec, value) {
  switch (spec.type) {
    case 'enum':
      return typeof value === 'string' && spec.values.includes(value);
    case 'boolean':
      return typeof value === 'boolean';
    case 'number':
      return typeof value === 'number' && Number.isFinite(value) && value >= 0;
    case 'iso-date':
      return typeof value === 'string' && value.trim() !== '' && Number.isFinite(Date.parse(value));
    case 'label':
      return typeof value === 'string' && /^\S+$/.test(value) && value.length <= LABEL_MAX;
    default:
      return typeof value === 'string' && value.trim() !== '';
  }
}

/** Validate one already-typed value against its key. Returns it, or throws. */
function checkValue(key, value, origin) {
  const spec = KEYS[key];
  if (!spec) throw unknownKey(key);
  if (!accepts(spec, value)) {
    throw invalid(
      key + ' must be ' + describe(spec) + ', got ' + JSON.stringify(value) +
        (origin ? ' in ' + origin : ''),
    );
  }
  return value;
}

function unknownKey(key) {
  return invalid('unknown key: ' + key, ['known keys: ' + Object.keys(KEYS).join(', ')]);
}

function isPlainObject(value) {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Validate a whole config object against the closed schema. Unknown sections,
 * unknown keys, a wrong schema_version, and off-enum values all throw a
 * VALIDATION_ERROR naming the offending key and its file. Nothing is coerced and
 * nothing unknown is silently kept.
 */
function validateConfig(config, source) {
  if (!isPlainObject(config)) throw invalid(source + ' must contain a JSON object');
  if (config.schema_version !== SCHEMA_VERSION) {
    throw invalid(
      source + ' has schema_version ' + JSON.stringify(config.schema_version) +
        ', expected ' + SCHEMA_VERSION,
    );
  }
  for (const [section, body] of Object.entries(config)) {
    if (section === 'schema_version') continue;
    if (!SECTIONS.has(section)) {
      throw invalid('unknown section "' + section + '" in ' + source, [
        'known sections: ' + [...SECTIONS].join(', '),
      ]);
    }
    if (!isPlainObject(body)) throw invalid('section "' + section + '" in ' + source + ' must be an object');
    for (const [leaf, value] of Object.entries(body)) {
      const key = section + '.' + leaf;
      if (!KEYS[key]) {
        throw invalid('unknown key "' + key + '" in ' + source, [
          'known keys: ' + Object.keys(KEYS).join(', '),
        ]);
      }
      checkValue(key, value, source);
    }
  }
  return config;
}

/** Parse a CLI-supplied string into the key's declared type. Rejects, never coerces. */
function parseValue(key, raw) {
  const spec = KEYS[key];
  if (!spec) throw unknownKey(key);
  if (spec.type === 'boolean') {
    if (raw === 'true') return true;
    if (raw === 'false') return false;
    throw invalid(key + ' must be ' + describe(spec) + ', got ' + JSON.stringify(raw));
  }
  if (spec.type === 'number') {
    const n = String(raw).trim() === '' ? NaN : Number(raw);
    if (!Number.isFinite(n)) throw invalid(key + ' must be ' + describe(spec) + ', got ' + JSON.stringify(raw));
    return checkValue(key, n);
  }
  return checkValue(key, raw);
}

// ---------------------------------------------------------------------------
// Layer files
// ---------------------------------------------------------------------------

function repoConfigPath(repo) {
  return path.join(repoDir(repo), 'config.json');
}

function globalConfigPath() {
  return path.join(phantomData(), 'config.json');
}

// Per-process memoization, the way phantom-paths.js memoizes detectRepo: hooks are
// hot paths and a config read must not cost a stat per lookup. Keyed on the absolute
// file path; invalidated on our own writes and by clearCache() (tests, long-lived
// callers). A short-lived hook or CLI process never sees a stale layer.
const LAYER_CACHE = new Map();
const REMOTE_CACHE = new Map();

function parseConfigText(raw, source) {
  try {
    return JSON.parse(raw);
  } catch (e) {
    throw invalid(source + ' is not valid JSON: ' + e.message, ['fix or delete the file']);
  }
}

/** Read + validate one layer file. Absent or empty -> null (that layer has nothing). */
function readLayer(file) {
  if (LAYER_CACHE.has(file)) return LAYER_CACHE.get(file);
  const raw = readFileSafe(file);
  if (raw == null || raw.trim() === '') {
    LAYER_CACHE.set(file, null);
    return null;
  }
  const parsed = validateConfig(parseConfigText(raw, file), file);
  LAYER_CACHE.set(file, parsed);
  return parsed;
}

/** Drop every memoized layer and remote. Call after an out-of-band write. */
function clearCache() {
  LAYER_CACHE.clear();
  REMOTE_CACHE.clear();
}

function pick(config, key) {
  if (!config) return undefined;
  const [section, leaf] = key.split('.');
  return isPlainObject(config[section]) ? config[section][leaf] : undefined;
}

// ---------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------

/**
 * Shared resolution context. `opts.cwd` picks the workspace, `opts.repo` overrides
 * the detected repo id, `opts.explicit` supplies the top layer.
 */
function context(opts = {}) {
  const cwd = path.resolve(opts.cwd || process.cwd());
  const repo = opts.repo || detectRepo(cwd);
  return {
    cwd,
    repo,
    repoPath: repoConfigPath(repo),
    globalPath: globalConfigPath(),
    explicit: isPlainObject(opts.explicit) ? opts.explicit : null,
  };
}

// The canonical origin remote for a workspace, or null. Deliberately resolved
// WITHOUT dataRoot/PHANTOM_REPO: those change the repo ID, but detection wants the
// git remote itself, which an id override must not hide.
function originCanonical(cwd) {
  if (REMOTE_CACHE.has(cwd)) return REMOTE_CACHE.get(cwd);
  let canonical = null;
  try {
    const identity = codec.repoIdentity(cwd);
    canonical = identity.remote ? codec.normalizeRemote(identity.remote) : null;
  } catch (_) {
    canonical = null; // detection is best-effort; it never breaks a resolve
  }
  REMOTE_CACHE.set(cwd, canonical);
  return canonical;
}

// Step 4 of the resolution order. Only what the repo can actually prove: a
// github.com origin means the tracker COULD be GitHub issues. Provenance reports
// `detect`, so a caller can tell a detected candidate from a stored choice.
function detect(key, ctx) {
  if (key !== 'tracker.provider') return null;
  const canonical = originCanonical(ctx.cwd);
  if (canonical && /^github\.com(\/|$)/i.test(canonical)) {
    return { value: 'github', source: 'origin remote ' + canonical };
  }
  return null;
}

const PROVENANCE_REASON = {
  explicit: 'explicit caller override',
  repo: 'set in per-repo config',
  global: 'set in global config',
  detect: 'detected from the repository',
};

function hit(key, value, provenance, source) {
  return {
    key,
    value,
    set: true,
    provenance,
    source,
    reason: PROVENANCE_REASON[provenance] + ' (' + source + ')',
  };
}

function unsetReason(key, ctx) {
  return (
    'is unset: no caller override, nothing in per-repo config (' + ctx.repoPath + '), ' +
    'nothing in global config (' + ctx.globalPath + '), ' +
    (DETECTED_KEYS.has(key)
      ? 'and the repository detected no value'
      : 'and this key has no detector')
  );
}

/**
 * Resolve one key. Returns { key, value, set, provenance, source, reason }, where
 * provenance is explicit | repo | global | detect | unset. An unset key returns
 * `set: false` and `value: undefined` - never a fabricated default.
 */
function resolve(key, opts = {}) {
  if (!KEYS[key]) throw unknownKey(key);
  const ctx = opts.ctx || context(opts);

  if (ctx.explicit && ctx.explicit[key] !== undefined) {
    return hit(key, checkValue(key, ctx.explicit[key], 'explicit override'), 'explicit', 'caller override');
  }
  const fromRepo = pick(readLayer(ctx.repoPath), key);
  if (fromRepo !== undefined) return hit(key, fromRepo, 'repo', ctx.repoPath);

  const fromGlobal = pick(readLayer(ctx.globalPath), key);
  if (fromGlobal !== undefined) return hit(key, fromGlobal, 'global', ctx.globalPath);

  const detected = detect(key, ctx);
  if (detected) return hit(key, detected.value, 'detect', detected.source);

  return {
    key,
    value: undefined,
    set: false,
    provenance: 'unset',
    source: null,
    reason: unsetReason(key, ctx),
  };
}

/** Resolve every known key against one shared context. */
function resolveAll(opts = {}) {
  const ctx = opts.ctx || context(opts);
  const keys = {};
  for (const key of Object.keys(KEYS)) keys[key] = resolve(key, { ctx });
  return { repo: ctx.repo, cwd: ctx.cwd, paths: { repo: ctx.repoPath, global: ctx.globalPath }, keys };
}

// ---------------------------------------------------------------------------
// Write
// ---------------------------------------------------------------------------

/**
 * Write one key. Per-repo by default; `opts.global` targets the global file. The
 * file and its parents are created lazily. Setting `tracker.provider` also stamps
 * `tracker.chosen` (opts.chosen, default `explicit`) and `tracker.chosen_at`, so
 * that closed metadata always has a live writer.
 */
function set(key, rawValue, opts = {}) {
  if (!KEYS[key]) throw unknownKey(key);
  const ctx = context(opts);
  const value = typeof rawValue === 'string' ? parseValue(key, rawValue) : checkValue(key, rawValue);
  const file = opts.global ? ctx.globalPath : ctx.repoPath;

  const writes = { [key]: value };
  if (key === 'tracker.provider') {
    writes['tracker.chosen'] = checkValue('tracker.chosen', opts.chosen || 'explicit', 'the --chosen option');
    writes['tracker.chosen_at'] = new Date().toISOString();
  }

  atomicUpdate(file, (current) => {
    // Validate what is already on disk BEFORE merging, so a hand-corrupted file is
    // reported rather than silently rewritten into a valid-looking one.
    const config =
      current == null || current.trim() === ''
        ? { schema_version: SCHEMA_VERSION }
        : validateConfig(parseConfigText(current, file), file);
    for (const [k, v] of Object.entries(writes)) {
      const [section, leaf] = k.split('.');
      if (!isPlainObject(config[section])) config[section] = {};
      config[section][leaf] = v;
    }
    validateConfig(config, file);
    return JSON.stringify(config, null, 2) + '\n';
  });
  LAYER_CACHE.delete(file);

  return { key, value, scope: opts.global ? 'global' : 'repo', file, written: writes };
}

// ---------------------------------------------------------------------------
// Unattended / first-run
// ---------------------------------------------------------------------------

// Matches scripts/run-guard.js: an unattended run announces itself with
// PHANTOM_UNATTENDED=1. No human is present, so nothing may ask.
function isUnattended(env = process.env) {
  return env.PHANTOM_UNATTENDED === '1';
}

/**
 * Report whether a key needs asking, and what to ask. This module NEVER prompts -
 * it hands the caller a decision:
 *   guidance 'resolved' -> a value exists; use resolved.value.
 *   guidance 'ask'      -> unset, a human is present; the CALLER asks `question`.
 *   guidance 'inactive' -> unset and unattended; the caller prints
 *                          `inactive_message` and exits 0. Unconfigured is
 *                          INACTIVE, not an error (commands/loop.md).
 */
function askPlan(key, opts = {}) {
  const resolved = resolve(key, opts);
  const unattended = opts.env ? isUnattended(opts.env) : isUnattended();
  if (resolved.set) {
    return { key, needed: false, unattended, guidance: 'resolved', resolved, question: null, choices: null, inactive_message: null };
  }
  const spec = KEYS[key];
  return {
    key,
    needed: true,
    unattended,
    guidance: unattended ? 'inactive' : 'ask',
    resolved,
    question: QUESTIONS[key] || null,
    choices: spec.type === 'enum' ? spec.values.slice() : null,
    inactive_message: unattended
      ? 'INACTIVE: ' + key + ' is not configured - nothing done. Set it with: ' +
        'node scripts/phantom-config.js set ' + key + ' <value>'
      : null,
  };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const USAGE =
  'usage: phantom-config get [<key>] [--repo <path>] [--json]\n' +
  '       phantom-config set <key> <value> [--global] [--chosen <asked|detected|explicit>] [--repo <path>] [--json]\n' +
  '       phantom-config list [--repo <path>] [--json]\n' +
  '\n' +
  'exit: 0 ok | 1 single-key get resolved nothing (empty stdout, reason on stderr) | 2 usage or validation error\n';

function parseArgs(argv) {
  const opts = { cmd: null, key: null, value: null, global: false, chosen: null, cwd: process.cwd(), json: false };
  const positional = [];
  // A flag whose value is missing (or is the next flag) is a usage error, never a
  // silent fallback to the default - that is how a typo becomes a wrong write.
  const valueOf = (flag, next) => {
    if (next === undefined || next.startsWith('-')) throw invalid(flag + ' requires a value');
    return next;
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') opts.json = true;
    else if (a === '--global') opts.global = true;
    else if (a === '--repo') opts.cwd = valueOf(a, argv[++i]);
    else if (a === '--chosen') opts.chosen = valueOf(a, argv[++i]);
    else if (a.startsWith('-')) throw invalid('unknown option: ' + a);
    else positional.push(a);
  }
  opts.cmd = positional[0] || null;
  if (opts.cmd !== 'get' && opts.cmd !== 'set' && opts.cmd !== 'list') {
    throw invalid('expected subcommand get, set, or list');
  }
  if (!String(opts.cwd).trim()) throw invalid('--repo requires a path');
  if (opts.cmd === 'set') {
    if (positional.length !== 3) throw invalid('set requires <key> and <value>');
    opts.key = positional[1];
    opts.value = positional[2];
  } else {
    if (positional.length > (opts.cmd === 'get' ? 2 : 1)) throw invalid('unexpected argument: ' + positional[2]);
    opts.key = positional[1] || null;
    if (opts.chosen) throw invalid('--chosen applies only to `set tracker.provider`');
  }
  return opts;
}

// Pad to `width`, but never let a long cell swallow the next column's separator.
function col(value, width) {
  const s = String(value);
  return s.length >= width ? s + ' ' : s.padEnd(width);
}

// The layer paths are printed once in the header, so the per-key detail column
// carries only what the provenance does not already say.
const LAYER_DETAIL = { repo: 'per-repo config.json', global: 'global config.json', unset: 'no value in any layer' };

function printList(report) {
  const w = (s) => process.stdout.write(s);
  w('phantom-config: ' + report.repo + '\n');
  w('  per-repo: ' + report.paths.repo + '\n');
  w('  global:   ' + report.paths.global + '\n');
  for (const [key, r] of Object.entries(report.keys)) {
    w(
      '  ' + col(key, 22) +
        col(r.set ? String(r.value) : '(unset)', 26) +
        col(r.provenance, 10) +
        (LAYER_DETAIL[r.provenance] || r.source) + '\n',
    );
  }
}

function runGet(opts) {
  if (opts.key) {
    const r = resolve(opts.key, { cwd: opts.cwd });
    if (opts.json) process.stdout.write(JSON.stringify(r, null, 2) + '\n');
    else if (r.set) process.stdout.write(String(r.value) + '\n');
    if (!r.set) {
      // Empty stdout is the machine-readable half of "unset": a shell caller
      // comparing the output to a value can never mistake a reason line for one.
      process.stderr.write('phantom-config: ' + r.key + ' ' + r.reason + '\n');
      return 1;
    }
    return 0;
  }
  const report = resolveAll({ cwd: opts.cwd });
  const effective = {};
  for (const [key, r] of Object.entries(report.keys)) if (r.set) effective[key] = r.value;
  if (opts.json) {
    process.stdout.write(JSON.stringify({ repo: report.repo, effective }, null, 2) + '\n');
  } else {
    const entries = Object.entries(effective);
    if (entries.length === 0) process.stdout.write('phantom-config: nothing configured for ' + report.repo + '\n');
    for (const [key, value] of entries) process.stdout.write(key + ' = ' + String(value) + '\n');
  }
  return 0;
}

function main(argv = process.argv.slice(2)) {
  let opts;
  try {
    opts = parseArgs(argv);
  } catch (e) {
    process.stderr.write(e.message + '\n' + USAGE);
    process.exitCode = exitCodeForError(e);
    return;
  }

  if (opts.cmd === 'get') {
    process.exitCode = runGet(opts);
    return;
  }
  if (opts.cmd === 'set') {
    const result = set(opts.key, opts.value, { cwd: opts.cwd, global: opts.global, chosen: opts.chosen });
    if (opts.json) process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    else {
      process.stdout.write(
        'phantom-config: ' + result.key + ' = ' + String(result.value) +
          ' (' + result.scope + ' -> ' + result.file + ')\n',
      );
    }
    process.exitCode = 0;
    return;
  }
  const report = resolveAll({ cwd: opts.cwd });
  if (opts.json) process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  else printList(report);
  process.exitCode = 0;
}

module.exports = {
  SCHEMA_VERSION,
  KEYS,
  resolve,
  resolveAll,
  set,
  askPlan,
  isUnattended,
  clearCache,
  repoConfigPath,
  globalConfigPath,
  validateConfig,
  parseValue,
  main,
};

if (require.main === module) {
  try {
    main();
  } catch (err) {
    reportError(err);
  }
}
