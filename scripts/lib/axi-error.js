// Author: Subash Karki
// axi-error.js - typed error + deterministic exit-code mapping for Phantom CLIs.
// A PhantomError carries a machine code and optional remediation suggestions;
// exitCodeForError maps it to a process exit status. Callers set
// `process.exitCode` (or throw a PhantomError caught by reportError) and RETURN -
// they never call process.exit(), which can truncate pending stdout writes and
// skip finally blocks. That truncation-on-exit is the exact silent-absorption
// failure class this module exists to guard against.
//
// Adapted from gh-axi's error/exit handling (MIT, (c) 2026 Kun Chen) -
// github.com/kunchenguid/gh-axi. gh-axi centralizes CLI failures behind a typed
// error and a single exit-code decision; this port renames it PhantomError, pins
// the taxonomy at VALIDATION_ERROR -> 2 / everything else -> 1, and adds a shared
// reportError sink so the Phantom CLIs share one non-absorbing backstop.
'use strict';

const VALIDATION_ERROR = 'VALIDATION_ERROR';

class PhantomError extends Error {
  constructor(message, code, suggestions = []) {
    super(message);
    this.name = 'PhantomError';
    this.code = code;
    this.suggestions = Array.isArray(suggestions) ? suggestions : [];
  }
}

// Duck-typed so an error crossing a module boundary (or a re-thrown plain object
// carrying the same shape) is still recognized - instanceof alone is brittle.
function isPhantomError(err) {
  return err instanceof PhantomError || (err != null && err.name === 'PhantomError');
}

// VALIDATION_ERROR -> 2 (bad input / invalid artifact / doc drift the caller can
// fix); any other error, including an unexpected internal throw, -> 1. Never 0:
// a thrown error is never success. This is the absorption direction the prior P1s
// kept getting wrong - swallowing a failure into a 0 exit.
function exitCodeForError(err) {
  return err != null && err.code === VALIDATION_ERROR ? 2 : 1;
}

// Shared CLI backstop: write the error (and any suggestions) to `stream` and set
// process.exitCode. Deliberately does NOT call process.exit - it lets Node drain
// stdout/stderr and run finally blocks, then exit with the code we set. A
// PhantomError prints just its message (already user-facing); anything else
// prints its stack so an unexpected failure is loud, not swallowed.
function reportError(err, stream = process.stderr) {
  const phantom = isPhantomError(err);
  const body = phantom ? err.message : (err && err.stack) || String(err);
  stream.write(body.endsWith('\n') ? body : body + '\n');
  if (phantom) {
    for (const s of err.suggestions) stream.write('  → ' + s + '\n');
  }
  process.exitCode = exitCodeForError(err);
}

module.exports = { PhantomError, exitCodeForError, reportError, isPhantomError, VALIDATION_ERROR };

const HELP =
  'axi-error - typed error + exit-code taxonomy for Phantom CLIs\n\n' +
  'Usage: node scripts/lib/axi-error.js <code>   demo exitCodeForError(<code>)\n' +
  '       node scripts/lib/axi-error.js --help\n\n' +
  'Exit-code taxonomy:\n' +
  '  VALIDATION_ERROR -> 2  (bad input / invalid artifact / doc drift)\n' +
  '  <anything else>  -> 1  (I/O, parse, usage, unexpected internal error)\n' +
  '  success          -> 0  (callers set process.exitCode, never process.exit)\n';

if (require.main === module) {
  const arg = process.argv[2];
  if (arg === undefined || arg === '--help') {
    process.stdout.write(HELP);
  } else {
    const code = exitCodeForError(new PhantomError('demo', arg));
    process.stdout.write(`exitCodeForError(${arg}) = ${code}\n`);
  }
}
