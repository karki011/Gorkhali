// Author: Subash Karki
// Evolution Runner — 3-tier distillation engine for Gorkhali learnings
// Usage: node evolution-runner.js [--dry-run]

const fs = require('fs');
const path = require('path');
const {
  globalPatternsDir, learningsDir, stateDir, detectRepo, sessionsDir, completedDir,
} = require('./lib/gorkhali-paths');
// The ONE parser. This file used to carry its own three regexes, all of which required
// a separator or a leading list dash that the real files do not use, so every tier
// scanned 0 of 54 real entries. Never re-add a private entry regex here.
const { parseLearningEntries, isLiveDomainFile } = require('./lib/learning-grammar.cjs');

const REPO = detectRepo();
const LEARNINGS_DIR = learningsDir(REPO);
const PATTERNS_DIR = globalPatternsDir();
const STATE_FILE = path.join(stateDir(), 'evolution-log.json');

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
 * `observations.tests` is 'not_observed', which is a claim, not a measurement - the same
 * unverifiable judgment this whole conversion exists to remove.
 */
function sessionPassed(verification) {
  if (!verification || verification.verdict !== 'pass') return false;
  const observed = verification.correctness && verification.correctness.observations;
  if (observed && observed.tests === 'not_observed') return false;
  return true;
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
    if (!dryRun) fs.writeFileSync(target, filtered.join('\n'));
  }
  return skipped;
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
function run() {
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
  let pruneSkipped = [];
  if (removable.length > 0 && prune) pruneSkipped = removeEntries(domains, removable);

  // Tier 2
  const citedTotal = [...cited.values()].reduce((n, s) => n + s.size, 0);
  console.log(`[Tier 2] Computed validations from artifacts: ${cited.size} entries cited, ${citedTotal} verified session citations`);
  if (cited.size === 0) {
    console.log(`  (no session records a '${CITATION_FIELD}' array; see reference/evolution.md "Computed validation")`);
  }
  const promotable = findPromotable(domains, cited);
  const promoted = [];
  for (const p of promotable) {
    const filename = promoteToGlobal(p.domain, p.entry, p.count);
    if (filename) {
      promoted.push({ ...p, filename });
      console.log(`[Tier 2] Promoted: ${p.domain}/${filename}`);
    }
  }
  if (promoted.length > 0) updatePatternsIndex(promoted);
  console.log(`[Tier 2] Promoted: ${promoted.length} patterns\n`);

  // Tier 3
  const oversized = checkDistillation(domains);
  console.log(`[Tier 3] Oversized domains: ${oversized.length}`);
  oversized.forEach(o => console.log(`  ! ${o.domain}: ${o.count} entries (cap: ${o.cap})`));

  // Log
  const result = {
    date: now.toISOString(),
    entries_parsed: totalEntries,
    untagged: untagged.length,
    stale_flagged: stale.length,
    stale_removed: prune ? removable.length : 0,
    removable_reported: removable.length,
    protected_failed: protectedFailed.length,
    prune_enabled: prune,
    prune_failed_override: pruneFailed,
    prune_skipped_changed_on_disk: pruneSkipped,
    cited_entries: cited.size,
    cited_session_validations: citedTotal,
    promoted: promoted.length,
    distill_needed: oversized.length,
    domains_processed: domainNames
  };
  writeLog(result);

  console.log(`\n--- Summary ---`);
  console.log(`Entries parsed: ${totalEntries} | Stale flagged: ${stale.length} | Removed: ${prune ? removable.length : 0} | Promoted: ${promoted.length} | Distill needed: ${oversized.length}`);
  console.log(dryRun ? '(No changes written — dry run)\n' : 'Evolution logged.\n');
}

// Fail open: maintenance script must never crash a session. Log and exit 0.
try {
  run();
} catch (err) {
  console.error(`[evolution-runner] non-fatal: ${err && err.message ? err.message : err}`);
  process.exit(0);
}
