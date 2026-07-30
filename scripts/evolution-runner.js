// Author: Subash Karki
// Evolution Runner — 3-tier distillation engine for Phantom learnings
// Usage: node evolution-runner.js [--dry-run]

const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const {
  globalPatternsDir, learningsDir, stateDir, detectRepo, sessionsDir, completedDir,
} = require('./lib/phantom-paths');
// The ONE parser. This file used to carry its own three regexes, all of which required
// a separator or a leading list dash that the real files do not use, so every tier
// scanned 0 of 54 real entries. Never re-add a private entry regex here.
const { parseLearningEntries, isLiveDomainFile } = require('./lib/learning-grammar.cjs');

const REPO = detectRepo();
const LEARNINGS_DIR = learningsDir(REPO);
const PATTERNS_DIR = globalPatternsDir();
const STATE_FILE = path.join(stateDir(), 'evolution-log.json');
// The ONE mutex the capture path uses (skills/phantom/scripts/phantom-learning.mjs
// withLearningLock, held at <learningsDir>/.learning.lock). This file is CJS and that
// module is ESM; crossing the boundary via dynamic import() is the same pattern
// scripts/check-learnings-index.js already uses to reach the same module.
const LEARNING_API = path.join(__dirname, '..', 'skills', 'phantom', 'scripts', 'phantom-learning.mjs');

let STALE_DAYS = 30, REMOVE_DAYS = 60, PROMOTE_THRESHOLD = 5, DISTILL_CAP = 50;
let CITATION_FIELD = 'learningsCited';
try {
  const C = require('./lib/constants');
  STALE_DAYS = C.LEARNING_STALE_DAYS ?? STALE_DAYS;
  REMOVE_DAYS = C.LEARNING_REMOVE_DAYS ?? REMOVE_DAYS;
  PROMOTE_THRESHOLD = C.PROMOTE_THRESHOLD ?? PROMOTE_THRESHOLD;
  DISTILL_CAP = C.LEARNING_DISTILL_CAP ?? DISTILL_CAP;
  CITATION_FIELD = C.LEARNING_CITATION_FIELD ?? CITATION_FIELD;
} catch (_) { /* fail open: lib missing → inline defaults */ }

const dryRun = process.argv.includes('--dry-run');
// Expiry is OPT-IN. Until this fix, the parser matched 0 of 54 real entries, so no
// entry had ever been eligible for removal. Repairing the parser makes all 54 visible
// to the removal window at once, which would turn a first correct run into a mass
// delete. Removal stays report-only behind --prune; expiry policy is owned elsewhere.
const prune = process.argv.includes('--prune');
// The "explicitly overridden" escape hatch that reference/evolution.md's [failed]
// exemption promises. It exists so the prose's clause has a reader: without it the
// exemption would be absolute and a wrong correction recorded once would be immortal.
// Requires --prune too, so no single flag can reach the anti-repetition corpus.
const pruneFailed = prune && process.argv.includes('--prune-failed');
// check:`<cmd>` predicates (K5). Two-stage opt-in, same shape as --prune/--prune-failed:
// --check-predicates runs them and REPORTS pass/fail, changing nothing on disk.
// --flag-stale additionally writes [stale] onto entries whose predicate failed, and
// only takes effect alongside --check-predicates - a bare --flag-stale would tag
// entries based on a check that never ran.
const checkPredicates = process.argv.includes('--check-predicates');
const flagStale = checkPredicates && process.argv.includes('--flag-stale');
const now = new Date();

function daysSince(dateStr) {
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return Infinity;
  return Math.floor((now - d) / (1000 * 60 * 60 * 24));
}

function readDomainFiles() {
  if (!fs.existsSync(LEARNINGS_DIR)) return {};
  // isLiveDomainFile also drops retired snapshots: workflow.original.md is a stale
  // strict subset of workflow.md that used to load as a domain named
  // "workflow.original", double-counting its entries against the distillation cap.
  const files = fs.readdirSync(LEARNINGS_DIR).filter(isLiveDomainFile);
  const domains = {};
  for (const file of files) {
    const content = fs.readFileSync(path.join(LEARNINGS_DIR, file), 'utf8');
    const name = file.replace('.md', '');
    domains[name] = { file, content, entries: parseLearningEntries(content, file) };
  }
  return domains;
}

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) { return null; }
}

/**
 * A session counts as evidence only when its verification actually OBSERVED a pass.
 * `verdict` alone is not enough: verification.json can carry verdict 'pass' while
 * `observations.tests` is 'not_observed' (a claim, not a measurement) or even
 * 'checked:fail' (an observed FAILURE misreported as verdict 'pass'). This is a
 * WHITELIST, not a blacklist: the only accepted evidence is an explicit, observed
 * 'checked:pass'. Anything else - missing verification, wrong verdict, absent
 * `observations`, or any `tests` value other than 'checked:pass' - is rejected,
 * fail-closed.
 */
function sessionPassed(verification) {
  if (!verification || verification.verdict !== 'pass') return false;
  const observed = verification.correctness && verification.correctness.observations;
  return !!observed && observed.tests === 'checked:pass';
}

/**
 * DERIVE [validated:N] from artifacts on disk instead of LLM judgment.
 *
 * N = the number of DISTINCT sessions that both cited the entry and recorded an observed
 * verification pass. Derived, not accumulated, so re-running cannot inflate a count and
 * no ledger is needed for idempotence - the arithmetic is a set size, recomputable from
 * the same inputs forever. This is why max validationCount on disk is stuck at 2 and
 * nothing has ever reached the promote threshold of 5: the old increment fired only when
 * an LLM decided a pattern "was successfully used", which was unverifiable and unlogged.
 *
 * MISSING WRITER - the one input that does not exist yet. No artifact records WHICH
 * learning entries a session recalled. context.json's `learningsRefs` is documented as
 * "Paths to relevant learning files": file granularity, so it cannot attribute a
 * validation to an entry. (One context.json on disk carries an undocumented freeform
 * `learnings_applied` array of prose sentences - also not entry-identified.) The minimal
 * field needed is `learningsCited: string[]` on context.json, holding the `[keyword]` of
 * each injected entry; all 54 real entries carry a keyword, so it is a sufficient
 * identity. Its only possible writer is hooks/memory-reader.js, the component that
 * selects the entries. Until that field is written this returns an empty map and every
 * computed count is 0 - the reader is deliberately built first so the field has a
 * consumer the day it lands, rather than being a clause with no reader.
 */
function computeCitedValidations() {
  const counts = new Map();
  for (const root of [sessionsDir(REPO), completedDir(REPO)]) {
    let sessions = [];
    try { sessions = fs.readdirSync(root, { withFileTypes: true }); } catch (_) { continue; }
    for (const dirent of sessions) {
      if (!dirent.isDirectory()) continue;
      const dir = path.join(root, dirent.name);
      if (!sessionPassed(readJson(path.join(dir, 'verification.json')))) continue;
      const context = readJson(path.join(dir, 'context.json'));
      const cited = context && context[CITATION_FIELD];
      if (!Array.isArray(cited)) continue;
      for (const raw of cited) {
        const keyword = String(raw == null ? '' : raw).trim().replace(/^\[|\]$/g, '').toLowerCase();
        if (!keyword) continue;
        if (!counts.has(keyword)) counts.set(keyword, new Set());
        counts.get(keyword).add(dirent.name);
      }
    }
  }
  return counts;
}

/** On-disk tag or computed count, whichever is higher. The tag is a manual floor. */
function effectiveValidation(entry, cited) {
  const computed = cited.get(String(entry.keyword || '').toLowerCase());
  return Math.max(entry.validationCount || 0, computed ? computed.size : 0);
}

// Tier 1: Staleness scan
// `entry.date` is the NEWEST date on the entry, so a RECURRED continuation counts as
// freshness rather than leaving the entry stale at its original date.
function scanStaleness(domains, cited) {
  const stale = [];
  const removable = [];
  const protectedFailed = [];
  for (const [name, domain] of Object.entries(domains)) {
    for (const entry of domain.entries) {
      if (!entry.date || entry.date === '') continue;
      const age = daysSince(entry.date);
      // UNTAGGED SEMANTICS (36 of 54 real entries carry no lifecycle tag at all):
      // an untagged entry means validated:0 - recorded once, never re-confirmed, never
      // contradicted. So it is unproven and IS expirable by date, it is never
      // promotable, and computeCitedValidations is the one path that lifts it out of
      // that state. Untagged is the lifecycle's ENTRY state, not a limbo class.
      const proven = effectiveValidation(entry, cited) >= PROMOTE_THRESHOLD;
      if (age >= REMOVE_DAYS && !proven) {
        // reference/evolution.md "Distillation Rules": never delete a [failed] entry
        // unless explicitly overridden. A [failed] correction is the most load-bearing
        // kind of entry - it records something that already went wrong once - and it is
        // the corpus prompt injection leans on hardest. --prune-failed is the override.
        if (entry.failed && !pruneFailed) protectedFailed.push({ domain: name, entry });
        else removable.push({ domain: name, entry });
      } else if (age >= STALE_DAYS && effectiveValidation(entry, cited) < 2) {
        stale.push({ domain: name, entry });
      }
    }
  }
  return { stale, removable, protectedFailed };
}

// Tier 2: Promotion
// Promotion reads the EFFECTIVE count, so a pattern can graduate on computed evidence
// without anything rewriting the [validated:N] tag in the markdown. Keeping the derived
// count out of the source files means no new destructive write path, and the tag stays a
// human-editable floor rather than a cache that can drift.
function findPromotable(domains, cited) {
  const promotable = [];
  for (const [name, domain] of Object.entries(domains)) {
    for (const entry of domain.entries) {
      const count = effectiveValidation(entry, cited);
      if (entry.type === 'pattern' && count >= PROMOTE_THRESHOLD) {
        promotable.push({ domain: name, entry, count });
      }
    }
  }
  return promotable;
}

function promoteToGlobal(domain, entry, count) {
  // Prefer the entry's own tag: every real entry carries one, and it is a far better
  // filename than the first 40 characters of the body.
  const keyword = (entry.keyword || entry.content || '').replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 40).toLowerCase();
  const filename = `${domain}-${keyword || 'pattern'}.md`;
  const filepath = path.join(PATTERNS_DIR, filename);

  if (fs.existsSync(filepath)) return null; // already promoted

  const content = `---
name: ${keyword}
promoted_from: learnings/${domain}.md
promoted_date: ${now.toISOString().split('T')[0]}
validation_count: ${count}
---
${entry.content || entry.raw}
`;

  if (!dryRun) {
    fs.mkdirSync(PATTERNS_DIR, { recursive: true });
    fs.writeFileSync(filepath, content);
  }
  return filename;
}

function updatePatternsIndex(promoted) {
  const indexPath = path.join(PATTERNS_DIR, 'INDEX.md');
  let content = fs.existsSync(indexPath) ? fs.readFileSync(indexPath, 'utf8') : '';
  for (const p of promoted) {
    // PLAIN dash, never an em dash: this line is written INTO the learnings tree, and an
    // em dash in a separator position is the exact byte that made 54 entries parse as 0.
    const line = `- [${p.entry.content || p.entry.keyword}](${p.filename}) - promoted from ${p.domain}.md [validated:${p.count}] (${now.toISOString().split('T')[0]})`;
    if (!content.includes(p.filename)) {
      content += '\n' + line;
    }
  }
  if (!dryRun) fs.writeFileSync(indexPath, content);
}

// Tier 3: Distillation check
function checkDistillation(domains) {
  const oversized = [];
  for (const [name, domain] of Object.entries(domains)) {
    if (domain.entries.length > DISTILL_CAP) {
      oversized.push({ domain: name, count: domain.entries.length, cap: DISTILL_CAP });
    }
  }
  return oversized;
}

// --- check:`<cmd>` predicates (K5) ------------------------------------------------
//
// SECURITY MODEL. A learnings file is DATA - it is written by an LLM, merged and
// synced between repos, and read on the prompt-injection hot path. Running a shell
// command that sits inside it is an RCE vector unless every one of the following
// holds:
//
//  1. NEVER on any read path. hooks/memory-reader.js runs on every prompt and must
//     never execute anything; test/predicate-execution.test.js pins its source has
//     no child_process import. Only this file, and only behind flag (2), executes.
//  2. EXPLICIT OPT-IN ONLY. Nothing below runs unless --check-predicates is literally
//     on argv (checked once, at the top of this file, same as --prune above). A bare
//     run parses and counts predicates but never executes one.
//  3. LOCAL CANONICAL DIR ONLY. checkAllPredicates walks `domains`, which readDomainFiles
//     built by fs.readdirSync(LEARNINGS_DIR) - LEARNINGS_DIR itself is
//     learningsDir(REPO), resolved through phantom-paths' alias-aware resolver at
//     module load (line 16). A file's `source` is therefore always a bare basename of
//     that one directory; there is no code path here that reads a predicate from
//     anywhere else, so a file arriving via merge/sync cannot buy execution by sitting
//     in a different path.
//  4. BOUNDED. Each predicate gets PREDICATE_TIMEOUT_MS via a non-interactive shell
//     (stdin closed) with no stdin/stdout/stderr piped back into the process. A
//     timeout is treated as FAILED - never as passed - so a hang can never read as
//     healthy.
//  5. NO SANITIZATION. The command runs verbatim through `/bin/sh -c`. This file does
//     not attempt to allowlist or escape shell metacharacters - that produces false
//     confidence, not a real boundary. The ONLY security boundary is (2) and (3): the
//     explicit flag, and the fact that only entries from the local canonical dir are
//     ever considered.
const PREDICATE_TIMEOUT_MS = 5000;

/** Run one predicate to completion or timeout. Never throws - every outcome is FAILED
 *  except a clean exit 0. */
function runPredicate(cmd) {
  const { execFileSync } = require('child_process');
  try {
    execFileSync('/bin/sh', ['-c', cmd], {
      timeout: PREDICATE_TIMEOUT_MS,
      killSignal: 'SIGKILL',
      // Non-interactive: stdin closed so a predicate can never block waiting on input.
      // Output is discarded - only the exit code is evidence.
      stdio: ['ignore', 'ignore', 'ignore'],
    });
    return { ok: true, timedOut: false };
  } catch (err) {
    // Node's own timeout enforcement sets error.code = 'ETIMEDOUT' - the only reliable
    // discriminator. A predicate that kills itself with SIGKILL (e.g. `kill -9 $$`)
    // throws the SAME signal our own timeout uses but WITHOUT this code, so checking
    // `err.signal` alone would misclassify a self-inflicted kill as a timeout.
    return { ok: false, timedOut: !!(err && err.code === 'ETIMEDOUT') };
  }
}

/** Execute every entry's predicate across all domains. Only ever called behind
 *  --check-predicates (see gate 2 above). */
function checkAllPredicates(domains) {
  const results = [];
  for (const [name, domain] of Object.entries(domains)) {
    for (const entry of domain.entries) {
      if (!entry.predicate) continue;
      results.push({ domain: name, entry, ...runPredicate(entry.predicate) });
    }
  }
  return results;
}

/**
 * Write `[stale]` onto entries whose predicate failed. Only reachable behind
 * --check-predicates --flag-stale (both required - see the flagStale definition
 * above). Mirrors removeEntries' TOCTOU discipline: each target file is re-read and
 * compared byte-for-byte against what was scanned before any write, and a file that
 * changed since the scan is skipped rather than written against stale line numbers.
 */
function flagEntriesStale(domains, failedResults) {
  const byDomain = {};
  for (const r of failedResults) {
    if (!byDomain[r.domain]) byDomain[r.domain] = [];
    byDomain[r.domain].push(r.entry);
  }
  const skipped = [];
  let flagged = 0;
  for (const [name, entries] of Object.entries(byDomain)) {
    const target = path.join(LEARNINGS_DIR, domains[name].file);
    let onDisk;
    try { onDisk = fs.readFileSync(target, 'utf8'); } catch (_) { onDisk = null; }
    if (onDisk !== domains[name].content) {
      skipped.push(name);
      console.log(`  ! ${name}: changed on disk since scan - skipped (re-run to flag)`);
      continue;
    }
    const lines = onDisk.split('\n');
    for (const entry of entries) {
      const last = Number.isInteger(entry.endLine) ? entry.endLine : entry.lineNum;
      if (/\[stale\]/i.test(lines[last])) continue; // already flagged
      lines[last] = `${lines[last]} [stale]`;
      flagged++;
    }
    const newContent = lines.join('\n');
    if (!dryRun) {
      fs.writeFileSync(target, newContent);
      // Keep the scanned snapshot in sync with what was actually written. This runs
      // BEFORE removeEntries (see the ordering comment in mutate()), and removeEntries'
      // own TOCTOU guard compares onDisk against this same domains[name].content - if it
      // stayed at the pre-flag scan, the flag write we just made would read as an
      // external change and removeEntries would wrongly skip a domain nothing external
      // touched.
      domains[name].content = newContent;
    }
  }
  return { flagged, skipped };
}

/**
 * Remove entries from domain files, by line RANGE.
 *
 * Two hazards in the line-number mechanism this keeps, both real:
 *
 * 1. An entry spans lineNum..endLine - the grammar absorbs wrapped continuation lines,
 *    and real entries do wrap. Deleting only `lineNum` left the continuation lines behind
 *    as orphaned prose that no longer parses as anything. Both bounds are required.
 * 2. TOCTOU. Line numbers were computed when readDomainFiles ran; commands/learn.md
 *    appends to these same files, so an append between scan and write shifts nothing
 *    (appends land at the end) but a concurrent distillation rewrite shifts everything,
 *    and stale offsets would delete unrelated entries. So the file is re-read and
 *    compared byte-for-byte against what was scanned, and a changed file is SKIPPED
 *    rather than written with offsets that no longer describe it.
 *
 * Content-addressed removal would retire hazard 2 outright; that is a grammar-level
 * change (entries need stable ids) and is not in this task's file set.
 */
function removeEntries(domains, removable) {
  const byDomain = {};
  for (const r of removable) {
    if (!byDomain[r.domain]) byDomain[r.domain] = [];
    byDomain[r.domain].push(r.entry);
  }
  const skipped = [];
  // Count only entries actually removed - a domain skipped for TOCTOU still holds its
  // candidates on disk, and reporting removable.length regardless made the log and the
  // console claim entries were gone when they were not (P1 #4).
  let removedCount = 0;
  for (const [name, entries] of Object.entries(byDomain)) {
    const target = path.join(LEARNINGS_DIR, domains[name].file);
    let onDisk;
    try { onDisk = fs.readFileSync(target, 'utf8'); } catch (_) { onDisk = null; }
    if (onDisk !== domains[name].content) {
      skipped.push(name);
      console.log(`  ! ${name}: changed on disk since scan - skipped (re-run to prune)`);
      continue;
    }
    const doomed = new Set();
    for (const entry of entries) {
      const last = Number.isInteger(entry.endLine) ? entry.endLine : entry.lineNum;
      for (let i = entry.lineNum; i <= last; i++) doomed.add(i);
    }
    const filtered = onDisk.split('\n').filter((_, i) => !doomed.has(i));
    const newContent = filtered.join('\n');
    if (!dryRun) {
      fs.writeFileSync(target, newContent);
      // Keep the snapshot in sync with what was written, same discipline as
      // flagEntriesStale - removeEntries currently runs last (see mutate()'s ordering
      // comment), so nothing downstream depends on this today, but a domain must never
      // be judged against a stale scan after this function has already rewritten it.
      domains[name].content = newContent;
    }
    removedCount += entries.length;
  }
  return { skipped, removedCount };
}

// Write evolution log
function writeLog(result) {
  let log = { version: 1, evolutions: [] };
  if (fs.existsSync(STATE_FILE)) {
    try { log = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch {}
  }
  log.evolutions.push(result);
  if (!dryRun) {
    fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
    fs.writeFileSync(STATE_FILE, JSON.stringify(log, null, 2) + '\n');
  }
}

/**
 * Identify an entry in a report line. The KEYWORD leads, because it is the entry's stable
 * identity and the only handle a human or a follow-up command can act on; truncated
 * content is ambiguous by construction and two entries can easily share a first 60 chars.
 * Date and domain stay so a candidate can be judged without reopening the file.
 */
function describe(entry, domain) {
  const id = entry.keyword ? `[${entry.keyword}]` : '(no keyword)';
  const body = String(entry.content || entry.raw || '').replace(/\s+/g, ' ').slice(0, 60);
  return `${domain} ${id} (${entry.date || 'no date'}): ${body}...`;
}

// Main
async function run() {
  console.log(`\n=== Evolution Runner ${dryRun ? '(DRY RUN)' : ''} ===\n`);

  const domains = readDomainFiles();
  const domainNames = Object.keys(domains);
  console.log(`Domains: ${domainNames.join(', ')} (${domainNames.length} files)\n`);

  const cited = computeCitedValidations();

  // Tier 1
  const { stale, removable, protectedFailed } = scanStaleness(domains, cited);
  const totalEntries = Object.values(domains).reduce((n, d) => n + d.entries.length, 0);
  const allEntries = Object.values(domains).flatMap((d) => d.entries);
  const untagged = allEntries.filter((e) => !e.failed && !e.proposed && !(e.validationCount > 0));
  Object.entries(domains).forEach(([name, d]) => console.log(`  parsed ${d.file}: ${d.entries.length} entries`));
  console.log(`  parsed total: ${totalEntries} entries`);
  // Report the untagged majority explicitly. Left unreported it looks like the corpus is
  // fully classified, when in fact most of it is unproven and on the expiry clock.
  console.log(`  untagged (= validated:0, unproven and expirable): ${untagged.length}\n`);
  console.log(`[Tier 1] Stale (${STALE_DAYS}+ days): ${stale.length}`);
  stale.forEach(s => console.log(`  ! ${describe(s.entry, s.domain)}`));
  console.log(`[Tier 1] Removable (${REMOVE_DAYS}+ days): ${removable.length}${prune ? '' : ' (report-only; pass --prune to act)'}`);
  removable.forEach(r => console.log(`  x ${describe(r.entry, r.domain)}`));
  console.log(`[Tier 1] Past the window but PROTECTED as [failed]: ${protectedFailed.length}${pruneFailed ? ' (override active: --prune-failed)' : ''}`);
  protectedFailed.forEach(p => console.log(`  = ${describe(p.entry, p.domain)}`));

  // Tier 2 (read side; the write side runs inside `mutate` below)
  const citedTotal = [...cited.values()].reduce((n, s) => n + s.size, 0);
  console.log(`[Tier 2] Computed validations from artifacts: ${cited.size} entries cited, ${citedTotal} verified session citations`);
  if (cited.size === 0) {
    console.log(`  (no session records a '${CITATION_FIELD}' array; see reference/evolution.md "Computed validation")`);
  }
  const promotable = findPromotable(domains, cited);

  // Tier 3
  const oversized = checkDistillation(domains);

  // Predicates (K5). Population is always counted - parsing and counting a
  // check:`...` clause is free and safe. Execution is not: it happens ONLY behind
  // --check-predicates (see the security model above runPredicate), and it never
  // writes on its own - only --flag-stale does, inside `mutate` below.
  const withPredicate = allEntries.filter((e) => e.predicate);
  console.log(`\n[Predicates] ${withPredicate.length} entries carry a check: predicate (population; parsed, not executed)`);
  let predicateResults = [];
  let predicatesPassed = 0;
  let predicatesFailed = 0;
  if (checkPredicates) {
    predicateResults = checkAllPredicates(domains);
    predicatesPassed = predicateResults.filter((r) => r.ok).length;
    predicatesFailed = predicateResults.length - predicatesPassed;
    console.log(`[Predicates] Checked ${predicateResults.length}: ${predicatesPassed} pass, ${predicatesFailed} fail${flagStale ? '' : ' (report-only; pass --flag-stale to mark failing entries stale)'}`);
    predicateResults.forEach((r) => {
      const mark = r.ok ? 'v' : (r.timedOut ? 'x [TIMED OUT]' : 'x');
      console.log(`  ${mark} ${describe(r.entry, r.domain)}`);
    });
  } else if (withPredicate.length > 0) {
    console.log(`  (pass --check-predicates to execute and report pass/fail)`);
  }

  // --- Write phase --------------------------------------------------------
  //
  // Every rewrite of a shared domain file (removeEntries, promoteToGlobal +
  // updatePatternsIndex, flagEntriesStale) runs inside `mutate`, and `mutate` runs
  // ONLY while holding the exact per-repo learnings lock the capture path holds
  // (phantom-learning.mjs withLearningLock, <learningsDir>/.learning.lock) - the same
  // lock a Stop-hook capture takes to graduate an entry into these same files. That
  // makes the two writers mutually exclusive instead of racing.
  //
  // Fail-closed: if the lock cannot be acquired within its budget, `mutate` never
  // runs and NOTHING is written - the runner reports zero mutations rather than
  // falling back to an unlocked write, which would restore the exact defect this
  // guards against. --dry-run bypasses the lock entirely: every write inside
  // `mutate` is itself gated on `!dryRun`, so running it unlocked in dry-run mode
  // is safe and avoids contending for a lock only to write nothing.
  let pruneResult = { skipped: [], removedCount: 0 };
  const promoted = [];
  let staleFlagResult = { flagged: 0, skipped: [] };
  let lockUnavailable = false;

  const mutate = () => {
    // ORDER IS LOAD-BEARING (P1 #3). flagEntriesStale only ever appends ` [stale]` to an
    // existing line - it never adds or removes a line - so it is safe to run first,
    // against the line numbers the original scan computed. removeEntries deletes line
    // RANGES, which shifts every entry below the deletion, so it must run LAST: nothing
    // after it may rely on a line number removal would invalidate. Both functions also
    // refresh domains[name].content immediately after a write, so each guard compares
    // against what was actually just written rather than the pre-mutation scan -
    // otherwise flagEntriesStale's own prune-order write would make removeEntries' (or,
    // in the old order, the reverse) TOCTOU check misread its own prior write as an
    // external change and skip a domain nothing external touched.
    if (checkPredicates && flagStale) {
      const failing = predicateResults.filter((r) => !r.ok);
      if (failing.length > 0) staleFlagResult = flagEntriesStale(domains, failing);
    }

    if (removable.length > 0 && prune) pruneResult = removeEntries(domains, removable);

    for (const p of promotable) {
      const filename = promoteToGlobal(p.domain, p.entry, p.count);
      if (filename) {
        promoted.push({ ...p, filename });
        console.log(`[Tier 2] Promoted: ${p.domain}/${filename}`);
      }
    }
    if (promoted.length > 0) updatePatternsIndex(promoted);
  };

  if (dryRun) {
    mutate();
  } else {
    try {
      const { withLearningLock } = await import(pathToFileURL(LEARNING_API).href);
      withLearningLock(LEARNINGS_DIR, mutate);
    } catch (err) {
      lockUnavailable = true;
      console.log(`\n! learnings lock unavailable (${err && err.message ? err.message : err}) - all writes skipped this run\n`);
    }
  }

  console.log(`[Tier 2] Promoted: ${promoted.length} patterns\n`);
  console.log(`[Tier 3] Oversized domains: ${oversized.length}`);
  oversized.forEach(o => console.log(`  ! ${o.domain}: ${o.count} entries (cap: ${o.cap})`));
  if (checkPredicates && flagStale) {
    console.log(`[Predicates] Flagged stale: ${staleFlagResult.flagged}`);
  }

  // Log
  const result = {
    date: now.toISOString(),
    entries_parsed: totalEntries,
    untagged: untagged.length,
    stale_flagged: stale.length,
    // ACTUAL count, not the candidate count: removeEntries can skip a domain whose file
    // changed on disk between scan and write, and reporting removable.length regardless
    // claimed entries were gone when they were still on disk (P1 #4).
    stale_removed: (prune && !lockUnavailable) ? pruneResult.removedCount : 0,
    removable_reported: removable.length,
    protected_failed: protectedFailed.length,
    prune_enabled: prune,
    prune_failed_override: pruneFailed,
    prune_skipped_changed_on_disk: pruneResult.skipped,
    cited_entries: cited.size,
    cited_session_validations: citedTotal,
    promoted: promoted.length,
    distill_needed: oversized.length,
    predicates_population: withPredicate.length,
    predicates_checked: checkPredicates,
    predicates_passed: predicatesPassed,
    predicates_failed: predicatesFailed,
    predicates_flagged_stale: staleFlagResult.flagged,
    // Same honesty applied to stale-flagging: a domain can be skipped here too (its file
    // changed since the scan), so surface it explicitly rather than leaving `flagged`
    // as the only number and letting a caller assume everything failing was flagged.
    predicates_flagged_stale_skipped: staleFlagResult.skipped,
    flag_stale_enabled: flagStale,
    lock_unavailable: lockUnavailable,
    domains_processed: domainNames
  };
  writeLog(result);

  console.log(`\n--- Summary ---`);
  const removedForSummary = (prune && !lockUnavailable) ? pruneResult.removedCount : 0;
  const skippedNote = (prune && pruneResult.skipped.length > 0) ? ` (${pruneResult.skipped.length} domain(s) skipped - changed on disk, re-run needed)` : '';
  console.log(`Entries parsed: ${totalEntries} | Stale flagged: ${stale.length} | Removed: ${removedForSummary}${skippedNote} | Promoted: ${promoted.length} | Distill needed: ${oversized.length} | Predicates: ${withPredicate.length}${checkPredicates ? ` (checked: ${predicatesPassed} pass / ${predicatesFailed} fail)` : ''}`);
  console.log(dryRun ? '(No changes written — dry run)\n' : 'Evolution logged.\n');
}

// Fail open: maintenance script must never crash a session. Log and exit 0.
run().catch((err) => {
  console.error(`[evolution-runner] non-fatal: ${err && err.message ? err.message : err}`);
  process.exit(0);
});
