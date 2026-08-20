#!/usr/bin/env node
// Author: Subash Karki
// validate-citations.mjs - resolves the B13 evidence-class citation contract
// (scripts/lib/review-standard.js) against the real filesystem, and computes
// calibration from the result instead of asking anyone to self-rate it.
//
// This is the piece of the fable-foreman finding contract this repo did not
// yet have machinery for: `evidenceClass`/`citation` are DATA on a finding
// (validated for shape by scripts/validate-artifact.js), but nothing checked
// whether a cited quote actually appears where it claims to, or whether a cited
// command is even well-formed. Without that check, `evidenceClass: "quoted"`
// is just a fifth self-rating with a fancier name - the exact failure B13
// exists to close.
//
// WHAT RESOLVES, and what does not (deliberately):
//   - `quoted`   resolved deterministically: the cited file must exist and the
//                finding's `quote` text (whitespace-normalized, REQUIRED - a
//                quoted citation with no quote text is unresolvable-as-quoted,
//                not a weaker resolvable claim) must appear in the file. If the
//                quote occurs more than once and the finding also gives a
//                `line`, any occurrence within 5 lines of it is enough.
//   - `observed` resolved structurally: the cited `command` must be a
//                non-empty string. The command is NEVER re-run here - this is
//                a reporting tool, not a sandbox, and re-running an arbitrary
//                reviewer-supplied command on every citation check would be
//                its own security problem.
//   - `derived` and `inferred` are NOT machine-resolvable by construction (a
//                free-text locator and "no citation" respectively), so they
//                are counted but excluded from the resolvable population.
//
// A resolved citation proves the cited text or command EXISTS. It does not
// prove the citation SUPPORTS the finding's claim - that judgment call is
// exactly what B13's own doc says stays with whoever reads the review.
//
// CONTAINMENT: `citation.file` is untrusted artifact content - a review
// artifact is written by a reviewer role, not hand-authored by whoever runs
// this tool - and it flows straight into a filesystem read. Without a check,
// an absolute path, a `../` traversal, or a symlink planted inside the root
// but pointing outside it turns this resolver into a quote-match oracle over
// any process-readable file: existence and line numbers leak via the report
// and the `--strict` exit code even though nothing here ever prints file
// CONTENTS. `resolveQuotedCitation` below rejects the first two shapes before
// ever touching the filesystem, then re-checks by CANONICAL path (real,
// symlink-resolved) against the real root - the only check that also catches
// the third. `scripts/validate-artifact.js` rejects the first two shapes
// earlier still, at the artifact-shape layer, but this resolver enforces its
// own containment regardless of what shape-checking ran before it, because a
// hand-authored fixture (as several tests here are) can bypass that layer.
//
// CALIBRATION: { total, resolvable, resolved, calibration: resolved/resolvable }
// across the artifact. `resolvable` counts only `quoted`/`observed` findings;
// `resolved` counts how many of those actually resolved. `calibration` is
// `null` when `resolvable` is 0 - a ratio of zero over zero is UNMEASURABLE,
// not 0%, same convention as scripts/lib/review-standard.js's precisionGate.
//
// Usage:
//   validate-citations.mjs <artifact> --root <dir> [--strict]
//   validate-citations.mjs --help
//
// This is a REPORTING tool, not a gate: exit 0 whenever the artifact parses,
// even if every citation is unresolved - a caller that wants a failing exit
// code passes --strict, which exits 1 if any resolvable finding did not
// resolve. Exit 1 also covers usage/IO errors (unparsable JSON, missing file,
// missing argument); there is no VALIDATION_ERROR/2 path here, because this
// script never rejects an artifact's SHAPE (scripts/validate-artifact.js
// already owns that) - it only resolves what shape already passed.

import { readFileSync, existsSync, realpathSync } from 'node:fs';
import { resolve as resolvePath, dirname, isAbsolute, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeEvidenceClass } from './lib/review-standard.js';

const SELF = fileURLToPath(import.meta.url);
const REPO_ROOT = resolvePath(dirname(SELF), '..');

const HELP =
  'validate-citations.mjs - resolve B13 evidence-class citations and compute calibration\n\n' +
  'Usage:\n' +
  '  validate-citations.mjs <artifact> --root <dir> [--strict]\n' +
  '  validate-citations.mjs --help\n\n' +
  '  <artifact>   path to a review artifact (auditor.json / justice.json / ...)\n' +
  '  --root       REQUIRED. Workspace root citation file paths are resolved against.\n' +
  '               An artifact lives in a session directory but citation file paths\n' +
  '               are workspace-relative, so there is no safe default to fall back\n' +
  '               to - pass the workspace root explicitly.\n' +
  '  --strict     exit 1 if any resolvable citation (quoted/observed) did not resolve\n\n' +
  'Always a REPORTING tool, never a gate, without --strict: exit 0 whenever the\n' +
  'artifact itself parses. Unresolved findings are always printed, --strict or not.\n';

function parseArgs(argv) {
  const args = { artifact: null, root: null, strict: false, help: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') args.help = true;
    else if (a === '--strict') args.strict = true;
    else if (a === '--root') args.root = argv[++i];
    else if (!args.artifact && !a.startsWith('--')) args.artifact = a;
    else throw usageError(`unknown option or extra argument: ${a}`);
  }
  return args;
}

class UsageError extends Error {}
function usageError(message) {
  return new UsageError(`ERROR: ${message}\n\n${HELP}`);
}

/** Whitespace-normalized text: internal runs of whitespace collapse to one space, trimmed. */
function normalizeWhitespace(value) {
  return String(value == null ? '' : value).trim().replace(/\s+/g, ' ');
}

/**
 * Normalize `text` the same way `normalizeWhitespace` does, but keep a
 * parallel `mapping` array so a character offset into the normalized string
 * can be traced back to its 1-based line number in the ORIGINAL text. Needed
 * because a quote may legitimately bridge a line break (its own whitespace,
 * newline included, is collapsed by `normalizeWhitespace` too) - a naive
 * per-line join would insert a marker at every line boundary that the quote's
 * own normalization never produces, and a quote spanning two lines would
 * never match.
 */
function normalizeWithLineMap(text) {
  const value = String(text == null ? '' : text);
  const n = value.length;
  const isSpace = (ch) => ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r' || ch === '\f' || ch === '\v';
  let line = 1;
  let out = '';
  const mapping = [];
  let i = 0;
  while (i < n) {
    if (!isSpace(value[i])) {
      out += value[i];
      mapping.push(line);
      i++;
      continue;
    }
    let hasMore = false;
    while (i < n && isSpace(value[i])) {
      if (value[i] === '\n') line++;
      i++;
      if (i < n && !isSpace(value[i])) hasMore = true;
    }
    // Collapse the run to one separating space, same as normalizeWhitespace -
    // but only between content, never leading (out still empty) or trailing.
    if (out.length > 0 && hasMore) {
      out += ' ';
      mapping.push(line);
    }
  }
  return { normalized: out, mapping };
}

/**
 * Resolve a `quoted` citation against the filesystem. Takes a `readText`
 * function so tests can inject fake file CONTENTS - but the containment
 * checks below always run against the real filesystem regardless (via
 * `existsSync`/`realpathSync`), because canonical-path containment is a
 * property of the real filesystem's symlinks and cannot be expressed by a
 * fake content map. `root` MUST already be a canonical (realpath'd) path -
 * `main()` resolves it once via `realpathSync` before any finding is checked.
 */
function resolveQuotedCitation(citation, { root, readText }) {
  const file = citation && typeof citation.file === 'string' ? citation.file.trim() : '';
  if (!file) return { resolved: false, reason: 'citation.file is missing or empty' };

  // Reject the two shapes that are wrong on their FACE, before ever resolving
  // a path or touching the filesystem for them.
  if (isAbsolute(file)) {
    return { resolved: false, reason: 'citation path must be workspace-relative (absolute paths are rejected)' };
  }
  if (file.split(/[\\/]/).includes('..')) {
    return { resolved: false, reason: 'citation path must be workspace-relative ("../" traversal is rejected)' };
  }

  const path = resolvePath(root, file);
  if (!existsSync(path)) {
    return { resolved: false, reason: `file does not exist: ${file}` };
  }

  // The guarantee the first two checks cannot provide on their own: a path
  // that LOOKS clean can still be a symlink, planted inside `root`, whose
  // TARGET lives outside it. Resolving the real (symlink-free) path and
  // comparing THAT against the real root is the only way to catch that -
  // string-prefix containment on the unresolved path does not see through a
  // symlink.
  let realPath;
  try {
    realPath = realpathSync(path);
  } catch {
    return { resolved: false, reason: `file does not exist: ${file}` };
  }
  if (realPath !== root && !realPath.startsWith(root + sep)) {
    return { resolved: false, reason: 'citation path escapes the workspace root' };
  }

  let contents;
  try {
    contents = readText(path);
  } catch {
    return { resolved: false, reason: `file does not exist: ${file}` };
  }

  const quote = typeof citation.quote === 'string' ? citation.quote : '';
  if (!quote.trim()) {
    // A quoted citation with no quote text is unresolvable-as-quoted: the file
    // existing proves nothing about WHAT was cited, and validate-artifact.js
    // now rejects this shape outright - this branch only fires for an
    // artifact that bypassed that shape check.
    return { resolved: false, reason: 'quoted citation carries no quote text' };
  }

  const normalizedQuote = normalizeWhitespace(quote);
  const { normalized: normalizedFileText, mapping } = normalizeWithLineMap(contents);

  // Collect EVERY occurrence, not just the first - a quote that recurs in a
  // file (a common pattern repeated, a re-exported constant) must not
  // unresolve just because indexOf's first hit happens to sit far from the
  // cited line while a later occurrence sits right next to it.
  const occurrences = [];
  const step = Math.max(normalizedQuote.length, 1);
  for (let at = normalizedFileText.indexOf(normalizedQuote); at !== -1; at = normalizedFileText.indexOf(normalizedQuote, at + step)) {
    occurrences.push(at);
  }
  if (occurrences.length === 0) {
    return { resolved: false, reason: `quote not found in ${file} (whitespace-normalized)` };
  }
  const occurrenceLines = occurrences.map((at) => mapping[at] || 1);

  if (citation.line != null) {
    if (!Number.isFinite(citation.line)) {
      return { resolved: false, reason: 'citation.line is not a number' };
    }
    const near = occurrenceLines.find((line) => Math.abs(line - citation.line) <= 5);
    if (near == null) {
      const reason = occurrenceLines.length === 1
        ? `quote found at ${file}:${occurrenceLines[0]}, more than 5 lines from cited line ${citation.line}`
        : `quote found at ${file}:${occurrenceLines.join(',')}, none within 5 lines of cited line ${citation.line}`;
      return { resolved: false, reason };
    }
    return { resolved: true, reason: `quote found at ${file}:${near}` };
  }
  return { resolved: true, reason: `quote found at ${file}:${occurrenceLines[0]}` };
}

/** Resolve an `observed` citation structurally: the command is never re-run. */
function resolveObservedCitation(citation) {
  const command = citation && typeof citation.command === 'string' ? citation.command.trim() : '';
  if (!command) return { resolved: false, reason: 'citation.command is missing or empty' };
  return { resolved: true, reason: 'command is a well-formed, non-empty string (not re-run)' };
}

/**
 * Resolve one finding. Returns `resolvable: false` for `derived`/`inferred`
 * (and for a finding with no evidenceClass at all) rather than counting them
 * as failures - they are outside what this pass can check, not findings that
 * failed the check.
 */
function resolveFinding(finding, index, { root, readText }) {
  const label = finding && typeof finding.id === 'string' && finding.id.trim() ? finding.id : `findings[${index}]`;
  const evidenceClass = normalizeEvidenceClass(finding && finding.evidenceClass);
  const base = { label, index, evidenceClass: evidenceClass || finding?.evidenceClass || null };

  if (!evidenceClass) {
    return { ...base, resolvable: false, resolved: false, reason: 'no evidenceClass recorded' };
  }
  if (evidenceClass === 'quoted') {
    const { resolved, reason } = resolveQuotedCitation(finding.citation, { root, readText });
    return { ...base, resolvable: true, resolved, reason };
  }
  if (evidenceClass === 'observed') {
    const { resolved, reason } = resolveObservedCitation(finding.citation);
    return { ...base, resolvable: true, resolved, reason };
  }
  // derived / inferred: not machine-resolvable by construction.
  return { ...base, resolvable: false, resolved: false, reason: `evidenceClass "${evidenceClass}" is not machine-resolvable` };
}

/**
 * Resolve every finding in a review artifact object. Pure aside from the
 * injected `readText`. Exported for direct unit testing without shelling out.
 */
function resolveArtifact(artifact, { root, readText = (p) => readFileSync(p, 'utf8') } = {}) {
  const findings = Array.isArray(artifact && artifact.findings) ? artifact.findings : [];
  const results = findings.map((f, i) => resolveFinding(f, i, { root, readText }));
  const resolvableResults = results.filter((r) => r.resolvable);
  const resolved = resolvableResults.filter((r) => r.resolved).length;
  const resolvable = resolvableResults.length;
  return {
    results,
    summary: {
      total: results.length,
      resolvable,
      resolved,
      calibration: resolvable > 0 ? resolved / resolvable : null,
    },
  };
}

function formatReport(artifactPath, { results, summary }) {
  const lines = [];
  const unresolved = results.filter((r) => r.resolvable && !r.resolved);
  if (unresolved.length) {
    lines.push(`UNRESOLVED (${unresolved.length}) in ${artifactPath}:`);
    for (const r of unresolved) {
      lines.push(`  - ${r.label} [${r.evidenceClass}]: ${r.reason}`);
    }
    lines.push('');
  } else {
    lines.push(`No unresolved citations in ${artifactPath}.`);
  }
  const notResolvable = results.filter((r) => !r.resolvable);
  if (notResolvable.length) {
    lines.push(`Not machine-resolvable (derived/inferred/no evidenceClass): ${notResolvable.length}`);
  }
  const pct = summary.calibration == null ? 'unmeasurable (0 resolvable findings)' : `${(summary.calibration * 100).toFixed(1)}%`;
  lines.push(
    `Calibration: ${summary.resolved}/${summary.resolvable} resolved of ${summary.resolvable} resolvable ` +
      `(${summary.total} findings total) -> ${pct}`
  );
  return lines.join('\n');
}

function main(argv) {
  const args = parseArgs(argv);
  if (args.help) {
    process.stdout.write(HELP);
    return;
  }
  if (!args.artifact) throw usageError('missing required <artifact> path');

  const artifactPath = resolvePath(args.artifact);
  if (!existsSync(artifactPath)) throw new UsageError(`ERROR: artifact not found: ${artifactPath}`);

  let artifact;
  try {
    artifact = JSON.parse(readFileSync(artifactPath, 'utf8'));
  } catch (err) {
    throw new UsageError(`ERROR: cannot parse ${artifactPath} as JSON: ${err.message}`);
  }

  // No safe default: an artifact lives in a session directory, but citation
  // file paths are workspace-relative - defaulting --root to the artifact's
  // own directory silently unresolved every valid citation. Fail closed and
  // name the flag rather than guess, once we know the artifact itself is
  // legitimate (a bad --artifact path or unparsable JSON is still reported
  // as that error, not masked by this one).
  if (!args.root) throw usageError('missing required --root <dir> (the workspace root citation file paths resolve against)');

  // Resolved to its CANONICAL (symlink-free) form ONCE, here - every
  // containment check downstream compares a citation's canonical path
  // against this one root, so the root itself must already be canonical or
  // the comparison would be meaningless.
  let root;
  try {
    root = realpathSync(resolvePath(args.root));
  } catch {
    throw usageError(`--root does not exist or cannot be resolved: ${resolvePath(args.root)}`);
  }
  const { results, summary } = resolveArtifact(artifact, { root });

  process.stdout.write(formatReport(artifactPath, { results, summary }) + '\n');

  // Reporting tool: exit 0 once the artifact parsed, unless --strict was
  // passed and something resolvable did not resolve.
  const anyUnresolved = results.some((r) => r.resolvable && !r.resolved);
  if (args.strict && anyUnresolved) {
    process.exitCode = 1;
  }
}

const isMain = process.argv[1] === SELF || (process.argv[1] && resolvePath(process.argv[1]) === SELF);
if (isMain) {
  try {
    main(process.argv);
  } catch (err) {
    const body = err instanceof Error ? err.message : String(err);
    process.stderr.write(body.endsWith('\n') ? body : body + '\n');
    process.exitCode = 1;
  }
}

export {
  resolveArtifact,
  resolveFinding,
  resolveQuotedCitation,
  resolveObservedCitation,
  normalizeWhitespace,
  normalizeWithLineMap,
  REPO_ROOT,
};
