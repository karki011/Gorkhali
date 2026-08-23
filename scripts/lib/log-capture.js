// Author: Subash Karki
// log-capture.js - CLI-first bounded-summary + full-log-on-disk capture for
// piped command output: `some-command 2>&1 | node scripts/lib/log-capture.js
// --label verify`. Returns a head+tail-truncated stdout summary sized for an
// agent's context, with the full output preserved on disk and a grep hint to
// drill into it without re-reading everything.
//
// Adapted from gh-axi run.ts (MIT, (c) 2026 Kun Chen) - github.com/kunchenguid/gh-axi.
// The original truncates a `gh run view --log` tail to a single char budget and
// stashes the full log via mkdtemp; this port adds a HEAD slice (general build/
// test output often puts the first failure at the top, not just the tail like CI
// logs do), resolves the full-log dir through gorkhali-paths.js stateDir() instead
// of os.tmpdir(), and is a fail-open CLI filter rather than an in-process helper.
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

let stateDir;
try {
  ({ stateDir } = require('./gorkhali-paths'));
} catch (_) {
  const os = require('os');
  const home = os.homedir();
  const data = process.env.GORKHALI_DATA ||
    (home ? path.join(home, '.gorkhali') : path.join(process.cwd(), '.gorkhali'));
  stateDir = () => path.join(data, 'state');
}

function numFromEnv(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

// Ported default from gh-axi run.ts's LOG_TRUNCATE_LIMIT - the hard char cap on
// the returned summary regardless of how the head/tail line budgets add up
// (guards a single giant line from blowing past the intended bound). No existing
// constant in scripts/lib/constants.js covers log capture, so these stay local
// rather than adding entries outside this task's scope (same call wake-classifier.js
// made for SELF_REVIEW_THRESHOLD).
const MAX_CHARS = numFromEnv('GORKHALI_LOG_CAPTURE_MAX_CHARS', 20000);

// Line budgets, env-overridable like SELF_REVIEW_THRESHOLD (wake-classifier.js).
// Tail gets the larger share: CI/build/test failures land at the end of output
// far more often than the start - gh-axi's whole rationale for keeping the tail.
const HEAD_LINES = numFromEnv('GORKHALI_LOG_CAPTURE_HEAD_LINES', 20);
const DEFAULT_TAIL_LINES = numFromEnv('GORKHALI_LOG_CAPTURE_TAIL_LINES', 200);

const LOGS_SUBDIR = 'logs';
const HINT_KEYWORDS = ['error', 'fail', 'exception', 'traceback'];

function safeName(s) {
  return String(s).replace(/[^A-Za-z0-9_-]/g, '_');
}

function logFileName(label) {
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const rand = crypto.randomBytes(4).toString('hex');
  return `${safeName(label)}-${ts}-${rand}.log`;
}

/**
 * Best-effort full-log write, mode 0600 (matches gh-axi saveFullLog semantics).
 * Never load-bearing for the summary - a write failure just loses the "grep the
 * full log" escape hatch, not the truncated output itself.
 */
function saveFullLog(output, label, dir) {
  try {
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, logFileName(label));
    fs.writeFileSync(file, output, { encoding: 'utf8', mode: 0o600 });
    fs.chmodSync(file, 0o600); // guard against a non-default umask widening the mode
    return file;
  } catch (_) {
    return undefined;
  }
}

/** First hint keyword present in the output (case-insensitive), or a generic fallback. */
function suggestGrepPattern(output) {
  const lower = output.toLowerCase();
  for (const kw of HINT_KEYWORDS) {
    if (lower.includes(kw)) return kw;
  }
  return 'error|fail';
}

/**
 * headTailTruncate(output, opts) -> { summary, truncated }
 *
 * Keeps the first `headLines` and last `tailLines` lines, dropping the middle,
 * then enforces `maxChars` as a hard cap on the result (tail wins - a single
 * huge line, or a head+tail that's still too long, gets trimmed from the front).
 * Small input that fits both budgets passes through byte-for-byte untouched.
 */
function headTailTruncate(output, opts = {}) {
  const headLines = opts.headLines ?? HEAD_LINES;
  const tailLines = opts.tailLines ?? DEFAULT_TAIL_LINES;
  const maxChars = opts.maxChars ?? MAX_CHARS;

  const lines = output.split('\n');
  const total = lines.length;
  const lineTruncated = total > headLines + tailLines;

  let summary = output;
  if (lineTruncated) {
    const omitted = total - headLines - tailLines;
    const head = lines.slice(0, headLines).join('\n');
    const tail = lines.slice(total - tailLines).join('\n');
    summary = `${head}\n... [${omitted} lines omitted] ...\n${tail}`;
  }

  let truncated = lineTruncated;
  if (summary.length > maxChars) {
    truncated = true;
    summary = `... [truncated to last ${maxChars} chars] ...\n${summary.slice(-maxChars)}`;
  }

  return { summary, truncated };
}

/**
 * captureOutput(output, opts) -> { summary, truncated, fullLogPath, originalLength }
 *
 * opts: { label, dir, headLines, tailLines, maxChars }. `dir` defaults to
 * <stateDir()>/logs; callers (tests, other commands) may pass their own.
 * Fail-open: any unexpected error here returns the raw output unmodified rather
 * than throwing - a capture bug must never hide the real command output.
 */
function captureOutput(output, opts = {}) {
  const label = opts.label || 'capture';
  const dir = opts.dir || path.join(stateDir(), LOGS_SUBDIR);
  try {
    const { summary, truncated } = headTailTruncate(output, opts);
    if (!truncated) {
      return { summary, truncated: false, fullLogPath: null, originalLength: output.length };
    }
    const fullLogPath = saveFullLog(output, label, dir) || null;
    const pattern = suggestGrepPattern(output);
    const hint = fullLogPath
      ? `full log: ${fullLogPath} - grep -n '${pattern}' for details`
      : `full log unavailable (save failed) - showing head/tail of ${output.length} chars`;
    return { summary: `${summary}\n${hint}`, truncated: true, fullLogPath, originalLength: output.length };
  } catch (_) {
    return { summary: output, truncated: false, fullLogPath: null, originalLength: output.length };
  }
}

module.exports = {
  captureOutput,
  headTailTruncate,
  suggestGrepPattern,
  saveFullLog,
  logFileName,
  MAX_CHARS,
  HEAD_LINES,
  DEFAULT_TAIL_LINES,
};

function parseArgs(argv) {
  const args = { label: 'capture', tailLines: undefined, dir: undefined };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--label') args.label = argv[++i];
    else if (a === '--tail') {
      const n = Number(argv[++i]);
      if (Number.isFinite(n) && n > 0) args.tailLines = n;
    } else if (a === '--dir') args.dir = argv[++i];
  }
  return args;
}

function readStdin() {
  try {
    return fs.readFileSync(0, 'utf8');
  } catch (_) {
    return '';
  }
}

// CLI: some-command 2>&1 | node scripts/lib/log-capture.js --label <label> [--tail N] [--dir <dir>]
//
// PIPEFAIL NOTE: this script always exits 0 - a capture-logic bug fails open
// (passes the raw stdin through) rather than masking the wrapped command's exit
// status with its own crash. Bash's default $? after a pipe is the LAST
// command's status (this script's, always 0), not the wrapped command's. Run
// with `set -o pipefail` (or the shell's equivalent) BEFORE the pipe so $? still
// reflects the wrapped command, e.g.:
//   set -o pipefail
//   pnpm test 2>&1 | node scripts/lib/log-capture.js --label test
//   test_status=$?
if (require.main === module) {
  const { label, tailLines, dir } = parseArgs(process.argv.slice(2));
  const input = readStdin();
  let output;
  try {
    output = captureOutput(input, { label, tailLines, dir }).summary;
  } catch (_) {
    output = input; // never hide the wrapped command's real output
  }
  process.stdout.write(output.endsWith('\n') ? output : `${output}\n`);
  process.exit(0);
}
