#!/usr/bin/env node
// Author: Subash Karki
// phantom-learning.mjs -- the single, concurrent-safe learning/index API.
//
// This is the ONE place the auto-learning files are mutated:
//   <learnings>/INDEX.md          -- the `## Auto-Captured` section
//   <learnings>/auto-captures.md  -- the staging file for proposed captures
//   <learnings>/<domain>.md       -- graduated `## Validated Patterns`
//
// Both host-side entry points (hooks/memory-writer.js via `capture`,
// hooks/memory-consolidator.js via `consolidate`) and portable workflow prose
// invoke it -- the hooks by shelling out to the CLI, portable runtimes the same
// way. Every mutation runs under a per-learnings-dir advisory lock; a contended
// writer WAITS for the lock and, if the budget is exhausted, THROWS rather than
// running unlocked. There is intentionally no unlocked write path: a caller that
// cannot take the lock drops the capture (best-effort) instead of clobbering a
// concurrent writer's entry. That is what keeps both entries and a valid index
// after concurrent writes.
//
// Standalone: only Node built-ins plus sibling bundle helpers, so the portable
// skill stays self-contained.

import {
  closeSync,
  existsSync,
  linkSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { isMainModule, now, parseArgs } from './lib/portable.mjs';

// The auto-line grammar (parse/rebuild + the semantic merge) lives in one
// dependency-free CJS module so this ESM API, the CommonJS migrators, and any
// future runtime all agree on ONE learning format. It ships inside the skill
// (sibling file), so the portable bundle stays standalone.
const require = createRequire(import.meta.url);
const grammar = require('./lib/learning-grammar.cjs');
const {
  parseAutoLine,
  serializeAutoEntry,
  normalizeKey,
  parseIndex,
  rebuildIndex,
  VALIDATED_HEADER,
} = grammar;

// Re-export the grammar primitives this module has always exposed, so external
// callers and tests keep importing them from here.
export { parseAutoLine, serializeAutoEntry, normalizeKey };

// Thresholds mirror scripts/lib/constants.js and the prior hook inlines; kept
// here as the single source now that both hooks route through this module.
const GRADUATION_THRESHOLD = 5; // validated:5+ -> graduate to a domain file
const MAX_AUTO_ENTRIES = 80; // auto-captures.md soft cap before count pruning
const PRUNE_TARGET = 60; // count-prune target once over the cap
const MAX_INDEX_AUTO_LINES = 100; // INDEX.md auto-line hard cap
const STALE_DAYS = 3; // proposed-capture staleness window
const MIN_CONFIDENCE = 0.15; // drop proposed entries below this confidence

// Advisory-lock tuning, matching phantom-state.mjs's proven pattern. The wait
// budget is generous because concurrent learning writes are fast file ops; a
// handful of contenders serialize well within it.
const LOCK_WAIT_MS = 5_000;
const LOCK_RETRY_MS = 15;
const STALE_LOCK_MS = 5 * 60_000;
const lockWaiter = new Int32Array(new SharedArrayBuffer(4));

// --- portable atomic text write --------------------------------------------

function atomicWriteText(file, content) {
  mkdirSync(join(file, '..'), { recursive: true });
  const temporary = `${file}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const descriptor = openSync(temporary, 'wx', 0o600);
  try {
    writeFileSync(descriptor, content, 'utf8');
  } finally {
    closeSync(descriptor);
  }
  renameSync(temporary, file);
}

function readText(file) {
  try {
    return readFileSync(file, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return '';
    throw error;
  }
}

// --- per-learnings-dir advisory lock (fail-closed, never unlocked) ----------

function processIsAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code !== 'ESRCH';
  }
}

// Judge whether the lock at `file` is stale, returning the EXACT raw bytes of the
// generation judged stale (so the takeover can confirm it relocated THAT generation
// and not a fresh live lock a winner recreated after the judgment), or null when the
// lock is live or already gone. An empty/partial lockfile -- caught between
// acquireLock's create and its write -- is an UNKNOWN owner, never proven dead, so it
// only becomes stale via the age check (see learning lockfile-create-write-window).
function judgeStaleLock(file) {
  let raw;
  let mtimeMs;
  try {
    mtimeMs = statSync(file).mtimeMs;
    raw = readFileSync(file, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return null; // already gone -> nothing to break
    throw error;
  }
  let pid = null;
  try {
    const owner = JSON.parse(raw);
    if (Number.isInteger(owner.pid) && owner.pid > 0) pid = owner.pid;
  } catch { /* empty/partial lock: owner UNKNOWN -> age check only, never dead-by-pid */ }
  const dead = pid !== null && !processIsAlive(pid);
  if (dead || Date.now() - mtimeMs >= STALE_LOCK_MS) return raw;
  return null;
}

// Verified single-winner takeover of the generation whose bytes are `judgedRaw`
// (see learning takeover-single-winner). renameSync moves the inode atomically, so
// exactly one contender relocates a given lockfile; the rest get ENOENT and back
// off. Never unlink-by-path: two writers that both judged the SAME generation stale
// would each remove whatever sits at `file` when their unlink runs -- the second
// deleting the fresh lock the first just reclaimed -- and both enter the critical
// section (the lost-update this guards). After relocating we CONFIRM the bytes match
// the judged generation; a mismatch (a winner recreated a live lock between our
// judgment and our rename) is restored without clobbering a newer holder.
//   'won'        -> relocated the judged stale generation; caller retries the create.
//   'lost'       -> path already empty; another contender relocated it first.
//   'superseded' -> relocated a fresh live lock; restored it (or a newer holder had
//                   already reclaimed the momentarily-empty path). We did NOT acquire.
function takeoverStaleLock(file, judgedRaw) {
  const stale = `${file}.stale.${process.pid}.${Math.random().toString(16).slice(2)}`;
  try {
    renameSync(file, stale);
  } catch (error) {
    if (error.code === 'ENOENT') return 'lost'; // another contender relocated it first
    throw error;
  }
  let relocated;
  try { relocated = readFileSync(stale, 'utf8'); } catch { relocated = null; }
  if (relocated === judgedRaw) {
    try { unlinkSync(stale); } catch { /* never let a leftover artifact block acquisition */ }
    return 'won';
  }
  // Relocated a fresh live lock -- put it back atomically, but only while the path is
  // still empty (linkSync fails EEXIST once a newer holder claimed it; never clobber).
  try {
    linkSync(stale, file);
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
  }
  try { unlinkSync(stale); } catch { /* best-effort: the restored or newer lock is authoritative */ }
  return 'superseded';
}

function acquireLock(file) {
  const token = `${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const deadline = Date.now() + LOCK_WAIT_MS;
  mkdirSync(join(file, '..'), { recursive: true });
  while (true) {
    let descriptor;
    try {
      descriptor = openSync(file, 'wx', 0o600);
      writeFileSync(descriptor, `${JSON.stringify({ pid: process.pid, token, created_at: now() })}\n`, 'utf8');
      closeSync(descriptor);
      return { file, token };
    } catch (error) {
      if (descriptor !== undefined) {
        closeSync(descriptor);
        try { unlinkSync(file); } catch { /* fell to another owner */ }
      }
      if (error.code !== 'EEXIST') throw error;
      const judgedRaw = judgeStaleLock(file);
      if (judgedRaw !== null && takeoverStaleLock(file, judgedRaw) === 'won') {
        continue; // took over the exact judged generation -> retry the create immediately
      }
      if (Date.now() >= deadline) {
        throw new Error('phantom-learning: could not acquire the learnings lock before the deadline.');
      }
      Atomics.wait(lockWaiter, 0, 0, LOCK_RETRY_MS);
    }
  }
}

function releaseLock(lock) {
  try {
    const owner = JSON.parse(readFileSync(lock.file, 'utf8'));
    if (owner.token === lock.token) unlinkSync(lock.file);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}

/**
 * Run `action` while holding the per-learnings-dir advisory lock. On lock
 * contention it WAITS up to the budget and then throws -- it never runs `action`
 * unlocked. The lock lives inside the learnings dir so `capture`, `consolidate`,
 * and graduation all serialize against one another.
 */
export function withLearningLock(learningsDir, action) {
  mkdirSync(learningsDir, { recursive: true });
  const lock = acquireLock(join(learningsDir, '.learning.lock'));
  try {
    return action();
  } finally {
    releaseLock(lock);
  }
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

// --- auto-captures.md read / rebuild ---------------------------------------

const AUTO_CAPTURES_HEADER = `# Auto-Captured Learnings

> Automatically extracted from observation data. Entries are promoted to domain files
> when they reach [validated:${GRADUATION_THRESHOLD}+]. Stale [proposed] entries are pruned after ${STALE_DAYS} days.

`;

function parseAutoCaptures(content) {
  const entries = [];
  for (const line of (content || '').split('\n')) {
    const parsed = parseAutoLine(line);
    if (parsed) entries.push(parsed);
  }
  return entries;
}

function rebuildAutoCaptures(entries) {
  if (entries.length === 0) return AUTO_CAPTURES_HEADER;
  return AUTO_CAPTURES_HEADER + entries.map(serializeAutoEntry).join('\n') + '\n';
}

// --- pruning / capping ------------------------------------------------------

function pruneEntries(entries) {
  const staleCutoff = Date.now() - STALE_DAYS * 24 * 60 * 60 * 1000;
  let pruned = entries.filter((entry) => {
    if (!entry.isProposed) return true;
    if (entry.date) {
      const entryTime = new Date(entry.date + 'T00:00:00Z').getTime();
      if (entryTime < staleCutoff) return false;
    }
    return entry.confidence >= MIN_CONFIDENCE;
  });

  if (pruned.length > MAX_AUTO_ENTRIES) {
    const proposed = pruned.filter((entry) => entry.isProposed);
    const rest = pruned.filter((entry) => !entry.isProposed);
    proposed.sort((a, b) => (a.date || '').localeCompare(b.date || ''));
    const toRemove = Math.min(pruned.length - PRUNE_TARGET, proposed.length);
    pruned = [...rest, ...proposed.slice(toRemove)];
  }
  return pruned;
}

function capIndexAutoLines(autoLines) {
  if (autoLines.length <= MAX_INDEX_AUTO_LINES) return autoLines;
  const proposed = autoLines.filter((entry) => entry.isProposed);
  const rest = autoLines.filter((entry) => !entry.isProposed);
  proposed.sort((a, b) => (a.date || '').localeCompare(b.date || ''));
  const toRemove = Math.min(autoLines.length - MAX_INDEX_AUTO_LINES, proposed.length);
  return [...rest, ...proposed.slice(toRemove)];
}

// --- domain graduation ------------------------------------------------------

function graduateToDomainFile(learningsDir, domain, entry) {
  const domainFile = join(learningsDir, `${domain}.md`);
  let content;
  try {
    content = readFileSync(domainFile, 'utf8');
  } catch {
    content = `# ${domain.charAt(0).toUpperCase() + domain.slice(1)} Learnings\n\n${VALIDATED_HEADER}\n\n`;
  }
  const line = `- ${entry.text} [validated:${entry.validatedCount}] q:${entry.confidence} u:${entry.date}`;
  const idx = content.indexOf(VALIDATED_HEADER);
  if (idx === -1) {
    content = content.trimEnd() + `\n\n${VALIDATED_HEADER}\n\n${line}\n`;
  } else {
    const afterHeader = idx + VALIDATED_HEADER.length;
    const nextSection = content.indexOf('\n## ', afterHeader + 1);
    const insertAt = nextSection === -1 ? content.length : nextSection;
    const before = content.slice(0, insertAt).trimEnd();
    const after = content.slice(insertAt);
    content = before + '\n' + line + '\n' + after;
  }
  atomicWriteText(domainFile, content);
}

// --- capture policy (memory-writer) -----------------------------------------

/**
 * The capture read-modify-write, run inside the lock. Dedups candidates against
 * INDEX.md and auto-captures.md, bumps proposed -> validated on repeat, prunes,
 * graduates at the threshold, caps the INDEX auto lines, and writes all three
 * file classes atomically. `candidates` items: { dedup_key, entry, confidence, domain }.
 */
function applyCaptures(learningsDir, candidates) {
  const indexPath = join(learningsDir, 'INDEX.md');
  const autoPath = join(learningsDir, 'auto-captures.md');

  const indexContent = readText(indexPath);
  const parsedIndex = parseIndex(indexContent);
  let autoEntries = parseAutoCaptures(readText(autoPath));
  const todayStr = today();

  for (const candidate of candidates) {
    if (!candidate || !candidate.dedup_key || !candidate.entry) continue;
    const normKey = normalizeKey(candidate.dedup_key);
    const normEntry = normalizeKey(candidate.entry);
    const matches = (existing) => {
      const t = normalizeKey(existing.text);
      return t === normEntry || t === normKey;
    };

    const bump = (existing) => {
      if (existing.isFailed) return;
      if (existing.isProposed) {
        existing.status = 'validated:1';
        existing.validatedCount = 1;
        existing.isProposed = false;
        existing.isValidated = true;
      } else if (existing.isValidated) {
        existing.validatedCount += 1;
        existing.status = `validated:${existing.validatedCount}`;
      } else {
        return;
      }
      existing.date = todayStr;
      existing.version += 1;
    };

    const indexHit = parsedIndex.autoLines.find(matches);
    if (indexHit) bump(indexHit);
    const autoHit = autoEntries.find(matches);
    if (autoHit) bump(autoHit);

    if (!indexHit && !autoHit) {
      const created = {
        text: candidate.entry,
        status: 'proposed',
        validatedCount: 0,
        version: 0,
        confidence: candidate.confidence || 0,
        date: todayStr,
        isProposed: true,
        isFailed: false,
        isValidated: false,
      };
      autoEntries.push({ ...created });
      parsedIndex.autoLines.push({ ...created });
    }
  }

  autoEntries = pruneEntries(autoEntries);

  const graduated = [];
  autoEntries = autoEntries.filter((entry) => {
    if (entry.isValidated && entry.validatedCount >= GRADUATION_THRESHOLD) {
      graduated.push(entry);
      return false;
    }
    return true;
  });

  for (const entry of graduated) {
    let domain = 'unknown';
    for (const candidate of candidates) {
      if (candidate && normalizeKey(candidate.entry) === normalizeKey(entry.text)) {
        domain = candidate.domain || 'unknown';
        break;
      }
    }
    graduateToDomainFile(learningsDir, domain, entry);
  }

  const graduatedTexts = new Set(graduated.map((entry) => normalizeKey(entry.text)));
  parsedIndex.autoLines = capIndexAutoLines(
    parsedIndex.autoLines.filter((entry) => !graduatedTexts.has(normalizeKey(entry.text))),
  );

  atomicWriteText(indexPath, rebuildIndex(indexContent, parsedIndex.autoLines));
  atomicWriteText(autoPath, rebuildAutoCaptures(autoEntries));
}

// --- consolidate policy (memory-consolidator) -------------------------------

/**
 * The consolidate read-modify-write, run inside the lock. Adds high-confidence
 * patterns straight into the INDEX `## Auto-Captured` section as `validated:1`
 * and bumps existing validated entries; it does not stage, prune, or graduate.
 * `candidates` items: { entry, confidence }.
 */
function applyConsolidated(learningsDir, candidates) {
  const indexPath = join(learningsDir, 'INDEX.md');
  const indexContent = readText(indexPath);
  const parsedIndex = parseIndex(indexContent);
  const todayStr = today();

  for (const candidate of candidates) {
    if (!candidate || !candidate.entry) continue;
    const normEntry = normalizeKey(candidate.entry);
    const existing = parsedIndex.autoLines.find((entry) => normalizeKey(entry.text) === normEntry);
    if (existing) {
      if (existing.isValidated) {
        existing.validatedCount += 1;
        existing.status = `validated:${existing.validatedCount}`;
        existing.date = todayStr;
        existing.version += 1;
      }
      continue;
    }
    parsedIndex.autoLines.push({
      text: candidate.entry,
      status: 'validated:1',
      validatedCount: 1,
      version: 1,
      confidence: candidate.confidence || 0,
      date: todayStr,
      isProposed: false,
      isFailed: false,
      isValidated: true,
    });
  }

  atomicWriteText(indexPath, rebuildIndex(indexContent, parsedIndex.autoLines));
}

// --- public API -------------------------------------------------------------

/** Locked capture: stage/validate/graduate observation candidates. */
export function capture(learningsDir, candidates) {
  if (!Array.isArray(candidates) || candidates.length === 0) return;
  withLearningLock(learningsDir, () => applyCaptures(learningsDir, candidates));
}

/** Locked consolidate: fold high-confidence patterns into the INDEX. */
export function consolidate(learningsDir, candidates) {
  if (!Array.isArray(candidates) || candidates.length === 0) return;
  withLearningLock(learningsDir, () => applyConsolidated(learningsDir, candidates));
}

/**
 * Validate a learnings dir's INDEX.md against its domain files. Pure read; no
 * lock needed. `knownDomains` (optional) enables the unknown-file and
 * unreferenced-file checks; portable callers may omit it. Returns
 * { problems, warnings, domainFileCount }.
 */
export function validateLearningIndex(learningsDir, { knownDomains = [] } = {}) {
  const problems = [];
  const warnings = [];
  const indexPath = join(learningsDir, 'INDEX.md');
  if (!existsSync(learningsDir)) {
    problems.push(`ERROR: Learnings directory not found: ${learningsDir}`);
    return { problems, warnings, domainFileCount: 0 };
  }
  if (!existsSync(indexPath)) {
    problems.push(`ERROR: INDEX.md not found in ${learningsDir}`);
    return { problems, warnings, domainFileCount: 0 };
  }
  const indexContent = readFileSync(indexPath, 'utf8');

  // A domain reference is a markdown link target `[label](file.md)` or a bare
  // `file.md` anchored at the start of an entry line (`- file.md ...`). A token
  // that carries a path separator (e.g. `reference/agents.md:40`) or one that
  // appears mid-sentence outside a link is prose, not a domain pointer - both
  // shapes are real entry bodies in this INDEX.md, not references.
  const referencedDomains = new Set();
  for (const match of indexContent.matchAll(/\[[^\]]*\]\(([\w-]+\.md)\)/g)) {
    if (match[1] !== 'INDEX.md' && match[1] !== 'EDGES.md') referencedDomains.add(match[1]);
  }
  for (const line of indexContent.split('\n')) {
    const bare = line.match(/^\s*-\s+([\w-]+\.md)\b/);
    if (bare && bare[1] !== 'INDEX.md' && bare[1] !== 'EDGES.md') referencedDomains.add(bare[1]);
  }

  const actualFiles = readdirSync(learningsDir)
    .filter((f) => f.endsWith('.md') && f !== 'INDEX.md' && f !== 'EDGES.md');

  for (const domainFile of knownDomains) {
    const filePath = join(learningsDir, domainFile);
    if (existsSync(filePath)) {
      const content = readFileSync(filePath, 'utf8').trim();
      if (content.length > 0 && !referencedDomains.has(domainFile)) {
        warnings.push(`WARN: ${domainFile} has content but is not referenced in INDEX.md`);
      }
    }
  }
  if (knownDomains.length) {
    for (const actualFile of actualFiles) {
      if (!knownDomains.includes(actualFile)) {
        warnings.push(`WARN: Unknown domain file found: ${actualFile} (not in known domains list)`);
      }
    }
  }
  for (const ref of referencedDomains) {
    if (!existsSync(join(learningsDir, ref))) {
      problems.push(`ERROR: INDEX.md references "${ref}" but file does not exist`);
    }
  }

  const lines = indexContent.split('\n').filter((l) => l.trim() && !l.startsWith('#'));
  const lifecycleTags = ['[proposed]', '[validated:', '[scope:global]', '[stale]', '[failed]'];
  let malformedLines = 0;
  for (const line of lines) {
    if (!lifecycleTags.some((tag) => line.includes(tag)) && line.trim().length > 10) {
      malformedLines++;
      if (malformedLines <= 3) {
        warnings.push(`WARN: Line missing lifecycle tag: "${line.trim().substring(0, 80)}"`);
      }
    }
  }
  if (malformedLines > 3) {
    warnings.push(`WARN: ${malformedLines - 3} more lines missing lifecycle tags (truncated)`);
  }

  return { problems, warnings, domainFileCount: actualFiles.length };
}

export const constants = {
  GRADUATION_THRESHOLD,
  MAX_AUTO_ENTRIES,
  PRUNE_TARGET,
  MAX_INDEX_AUTO_LINES,
  STALE_DAYS,
  MIN_CONFIDENCE,
};

// Internal stale-lock takeover primitives, exported for deterministic single-winner
// tests only. Not part of the public API -- callers use withLearningLock, which
// serializes through acquireLock/releaseLock.
export const _internals = { judgeStaleLock, takeoverStaleLock, STALE_LOCK_MS };

// --- CLI --------------------------------------------------------------------
// Both hooks and portable prose shell out here so there is exactly one write
// path. Candidates arrive as a JSON array on stdin.
//   node phantom-learning.mjs capture     --learnings <dir>   # candidates on stdin
//   node phantom-learning.mjs consolidate --learnings <dir>   # candidates on stdin
//   node phantom-learning.mjs check       --learnings <dir>   # validate, exit 1 on problems

function readStdinJson() {
  let raw = '';
  try {
    raw = readFileSync(0, 'utf8');
  } catch {
    return [];
  }
  if (!raw.trim()) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const command = args._[0];
  const learningsDir = args.learnings;
  if (!learningsDir) {
    process.stderr.write('phantom-learning: --learnings <dir> is required.\n');
    process.exitCode = 1;
    return;
  }
  try {
    if (command === 'capture') {
      capture(learningsDir, readStdinJson());
    } else if (command === 'consolidate') {
      consolidate(learningsDir, readStdinJson());
    } else if (command === 'check') {
      const { problems, warnings, domainFileCount } = validateLearningIndex(learningsDir, {
        knownDomains: args['known-domains'] ? args['known-domains'].split(',').filter(Boolean) : [],
      });
      for (const warning of warnings) process.stdout.write(`${warning}\n`);
      if (problems.length) {
        for (const problem of problems) process.stderr.write(`${problem}\n`);
        process.stderr.write(
          `\nLearnings index check FAILED: ${problems.length} error(s), ${warnings.length} warning(s)\n`,
        );
        process.exitCode = 1;
        return;
      }
      process.stdout.write(
        `OK: Learnings index healthy -- ${domainFileCount} domain file(s), ${warnings.length} warning(s)\n`,
      );
    } else {
      process.stderr.write('Usage: phantom-learning.mjs <capture|consolidate|check> --learnings <dir>\n');
      process.exitCode = 1;
    }
  } catch (error) {
    process.stderr.write(`phantom-learning: ${error.message}\n`);
    process.exitCode = 1;
  }
}

if (isMainModule(import.meta.url)) main();
