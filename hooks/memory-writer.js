// Author: Subash Karki
// memory-writer.js — Stop hook that extracts learning candidates from observations
// and manages the auto-capture lifecycle: dedup, pruning, graduation, and atomic writes.
// Produces ZERO stdout. All output goes to files only.

'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { observationsDir, learningsDir } = require('../scripts/lib/phantom-paths');

const LEARNINGS_DIR = learningsDir();
const OBS_DIR = observationsDir();
const INDEX_PATH = path.join(LEARNINGS_DIR, 'INDEX.md');
const AUTO_CAPTURES_PATH = path.join(LEARNINGS_DIR, 'auto-captures.md');
const EXTRACT_SCRIPT = path.join(__dirname, '..', 'scripts', 'extract-learnings.js');
const TURN_WINDOW = 90; // seconds — capture observations from this turn only
const MAX_AUTO_ENTRIES = 80;
const PRUNE_TARGET = 60;
const MAX_INDEX_AUTO_LINES = 100;
const STALE_DAYS = 3;
const MIN_CONFIDENCE = 0.15;
const GRADUATION_THRESHOLD = 5; // validated:5+ → graduate

// ── Atomic write ──────────────────────────────────────────────────────────────

function atomicWrite(filePath, content) {
  const tmp = filePath + '.tmp';
  fs.writeFileSync(tmp, content);
  fs.renameSync(tmp, filePath);
}

// ── Parsing helpers ───────────────────────────────────────────────────────────

/**
 * Parse an auto-entry line into structured data.
 * Format: auto: {text} [{status}] v:{count} q:{confidence} u:{date}
 * Returns null if line doesn't match.
 */
function parseAutoLine(line) {
  const trimmed = line.trim();
  if (!trimmed.startsWith('auto:')) return null;

  const statusMatch = trimmed.match(/\[(proposed|validated:\d+|failed)\]/);
  const vMatch = trimmed.match(/\bv:(\d+)\b/);
  const qMatch = trimmed.match(/\bq:([\d.]+)\b/);
  const uMatch = trimmed.match(/\bu:(\d{4}-\d{2}-\d{2})\b/);

  if (!statusMatch) return null;

  // Extract text between "auto: " and the first "[status]"
  const textStart = trimmed.indexOf(' ') + 1; // after "auto:"
  const textEnd = trimmed.indexOf('[' + statusMatch[1] + ']');
  const text = trimmed.slice(textStart, textEnd).trim();

  const status = statusMatch[1];
  let validatedCount = 0;
  if (status.startsWith('validated:')) {
    validatedCount = parseInt(status.split(':')[1], 10) || 0;
  }

  return {
    raw: trimmed,
    text,
    status,
    validatedCount,
    version: parseInt(vMatch?.[1] || '0', 10),
    confidence: parseFloat(qMatch?.[1] || '0'),
    date: uMatch?.[1] || '',
    isProposed: status === 'proposed',
    isFailed: status === 'failed',
    isValidated: status.startsWith('validated:'),
  };
}

/**
 * Serialize a parsed auto entry back to line format.
 */
function serializeAutoEntry(entry) {
  return `auto: ${entry.text} [${entry.status}] v:${entry.version} q:${entry.confidence} u:${entry.date}`;
}

/**
 * Compute a normalized dedup key for comparison.
 */
function normalizeKey(key) {
  return key.toLowerCase().replace(/\s+/g, ' ').trim();
}

// ── INDEX.md helpers ──────────────────────────────────────────────────────────

function loadIndexFile() {
  try {
    return fs.readFileSync(INDEX_PATH, 'utf-8');
  } catch {
    return '';
  }
}

/**
 * Parse INDEX.md content into { preamble, autoLines, autoSectionExists }.
 * preamble = everything before ## Auto-Captured section.
 * autoLines = array of parsed auto entries in the section.
 */
function parseIndex(content) {
  const autoHeader = '## Auto-Captured';
  const idx = content.indexOf(autoHeader);

  if (idx === -1) {
    return {
      preamble: content,
      autoLines: [],
      autoSectionExists: false,
    };
  }

  const preamble = content.slice(0, idx);
  const autoSection = content.slice(idx + autoHeader.length);
  const lines = autoSection.split('\n');
  const autoLines = [];

  for (const line of lines) {
    const parsed = parseAutoLine(line);
    if (parsed) autoLines.push(parsed);
  }

  return {
    preamble,
    autoLines,
    autoSectionExists: true,
  };
}

/**
 * Rebuild INDEX.md content from preamble + auto entries.
 */
function rebuildIndex(preamble, autoLines) {
  let result = preamble.trimEnd();

  if (autoLines.length > 0) {
    result += '\n\n## Auto-Captured\n\n';
    result += autoLines.map(serializeAutoEntry).join('\n');
    result += '\n';
  }

  return result;
}

// ── auto-captures.md helpers ──────────────────────────────────────────────────

const AUTO_CAPTURES_HEADER = `# Auto-Captured Learnings

> Automatically extracted from observation data. Entries are promoted to domain files
> when they reach [validated:5+]. Stale [proposed] entries are pruned after 3 days.

`;

function loadAutoCaptures() {
  try {
    return fs.readFileSync(AUTO_CAPTURES_PATH, 'utf-8');
  } catch {
    return '';
  }
}

/**
 * Parse auto-captures.md into array of parsed entries.
 */
function parseAutoCaptures(content) {
  if (!content) return [];
  const entries = [];
  for (const line of content.split('\n')) {
    const parsed = parseAutoLine(line);
    if (parsed) entries.push(parsed);
  }
  return entries;
}

/**
 * Rebuild auto-captures.md from entries array.
 */
function rebuildAutoCaptures(entries) {
  if (entries.length === 0) return AUTO_CAPTURES_HEADER;
  return AUTO_CAPTURES_HEADER + entries.map(serializeAutoEntry).join('\n') + '\n';
}

// ── Domain file helpers ───────────────────────────────────────────────────────

/**
 * Append a graduated entry to the appropriate learnings/{domain}.md file.
 */
function graduateToDomainFile(domain, entry) {
  try {
    const domainFile = path.join(LEARNINGS_DIR, `${domain}.md`);
    let content;
    try {
      content = fs.readFileSync(domainFile, 'utf-8');
    } catch {
      // Create new domain file
      content = `# ${domain.charAt(0).toUpperCase() + domain.slice(1)} Learnings\n\n## Validated Patterns\n\n`;
    }

    // Find or create ## Validated Patterns section
    const sectionHeader = '## Validated Patterns';
    const sectionIdx = content.indexOf(sectionHeader);

    // Strip "auto: " prefix for domain file entry
    const cleanText = entry.text;
    const graduatedLine = `- ${cleanText} [validated:${entry.validatedCount}] q:${entry.confidence} u:${entry.date}`;

    if (sectionIdx === -1) {
      // Append section at end
      content = content.trimEnd() + `\n\n${sectionHeader}\n\n${graduatedLine}\n`;
    } else {
      // Find end of section (next ## or end of file)
      const afterHeader = sectionIdx + sectionHeader.length;
      const nextSection = content.indexOf('\n## ', afterHeader + 1);
      const insertAt = nextSection === -1 ? content.length : nextSection;

      // Insert before next section
      const before = content.slice(0, insertAt).trimEnd();
      const after = content.slice(insertAt);
      content = before + '\n' + graduatedLine + '\n' + after;
    }

    atomicWrite(domainFile, content);
  } catch {
    // Silent — graduation failure is non-fatal
  }
}

// ── Pruning ───────────────────────────────────────────────────────────────────

/**
 * Prune stale and low-confidence proposed entries, then prune by count if needed.
 * Returns the pruned array.
 */
function pruneEntries(entries) {
  const now = Date.now();
  const staleCutoff = now - (STALE_DAYS * 24 * 60 * 60 * 1000);

  // First pass: remove stale and low-confidence proposed entries
  let pruned = entries.filter(e => {
    if (!e.isProposed) return true; // keep non-proposed

    // Remove stale proposed
    if (e.date) {
      const entryTime = new Date(e.date + 'T00:00:00Z').getTime();
      if (entryTime < staleCutoff) return false;
    }

    // Remove low-confidence proposed
    if (e.confidence < MIN_CONFIDENCE) return false;

    return true;
  });

  // Second pass: if still over limit, remove oldest proposed
  if (pruned.length > MAX_AUTO_ENTRIES) {
    // Separate proposed from rest
    const proposed = pruned.filter(e => e.isProposed);
    const rest = pruned.filter(e => !e.isProposed);

    // Sort proposed by date ascending (oldest first)
    proposed.sort((a, b) => (a.date || '').localeCompare(b.date || ''));

    // Remove oldest proposed until at target
    const excess = pruned.length - PRUNE_TARGET;
    const toRemove = Math.min(excess, proposed.length);
    const keptProposed = proposed.slice(toRemove);

    pruned = [...rest, ...keptProposed];
  }

  return pruned;
}

// ── INDEX.md auto-line cap enforcement ────────────────────────────────────────

function capIndexAutoLines(autoLines) {
  if (autoLines.length <= MAX_INDEX_AUTO_LINES) return autoLines;

  // Separate proposed from validated
  const proposed = autoLines.filter(e => e.isProposed);
  const rest = autoLines.filter(e => !e.isProposed);

  // Sort proposed by date ascending (oldest first)
  proposed.sort((a, b) => (a.date || '').localeCompare(b.date || ''));

  // Remove oldest proposed until at cap
  const excess = autoLines.length - MAX_INDEX_AUTO_LINES;
  const toRemove = Math.min(excess, proposed.length);
  const keptProposed = proposed.slice(toRemove);

  return [...rest, ...keptProposed];
}

// ── Main ──────────────────────────────────────────────────────────────────────

try {
  // Read stdin-json for session info
  let stdinData = '';
  try {
    stdinData = fs.readFileSync('/dev/stdin', 'utf-8');
  } catch {
    // No stdin available
  }

  let sessionId = 'unknown';
  try {
    const event = JSON.parse(stdinData || '{}');
    sessionId = event.session_id || process.env.CLAUDE_SESSION_ID || 'unknown';
  } catch {
    sessionId = process.env.CLAUDE_SESSION_ID || 'unknown';
  }

  // Step 1: Get today's observations
  const today = new Date().toISOString().slice(0, 10);
  const obsFile = path.join(OBS_DIR, `${today}.jsonl`);

  if (!fs.existsSync(obsFile)) process.exit(0);

  // Step 2: Call extract-learnings.js
  let candidates;
  try {
    const result = execFileSync(process.execPath, [
      EXTRACT_SCRIPT,
      '--input', obsFile,
      '--window', String(TURN_WINDOW),
      '--session', sessionId
    ], { encoding: 'utf-8', timeout: 5000 });
    candidates = JSON.parse(result);
  } catch {
    process.exit(0);
  }

  if (!candidates || !Array.isArray(candidates) || candidates.length === 0) {
    process.exit(0);
  }

  // Step 3: Load current INDEX.md and auto-captures.md
  fs.mkdirSync(LEARNINGS_DIR, { recursive: true });

  const indexContent = loadIndexFile();
  const indexParsed = parseIndex(indexContent);

  const autoCapturesContent = loadAutoCaptures();
  let autoEntries = parseAutoCaptures(autoCapturesContent);

  // Build lookup maps for dedup
  // Map from normalized dedup_key-like string → index in autoEntries
  const autoKeyMap = new Map();
  for (let i = 0; i < autoEntries.length; i++) {
    // Use normalized text as dedup key for existing entries
    autoKeyMap.set(normalizeKey(autoEntries[i].text), i);
  }

  const indexAutoKeyMap = new Map();
  for (let i = 0; i < indexParsed.autoLines.length; i++) {
    indexAutoKeyMap.set(normalizeKey(indexParsed.autoLines[i].text), i);
  }

  // Step 4: Dedup + Lifecycle Management
  const todayStr = new Date().toISOString().slice(0, 10);

  for (const candidate of candidates) {
    if (!candidate.dedup_key || !candidate.entry) continue;

    const normKey = normalizeKey(candidate.dedup_key);
    const normEntry = normalizeKey(candidate.entry);

    // Check INDEX.md auto entries first (by dedup_key or entry text)
    let foundInIndex = false;
    for (let i = 0; i < indexParsed.autoLines.length; i++) {
      const existing = indexParsed.autoLines[i];
      const existingNormText = normalizeKey(existing.text);

      if (existingNormText === normEntry || existingNormText === normKey) {
        foundInIndex = true;

        if (existing.isFailed) break; // skip manual corrections

        if (existing.isProposed) {
          // Bump to validated:1
          existing.status = 'validated:1';
          existing.validatedCount = 1;
          existing.isProposed = false;
          existing.isValidated = true;
          existing.date = todayStr;
          existing.version = existing.version + 1;
          indexParsed.autoLines[i] = existing;
        } else if (existing.isValidated) {
          // Bump validated count
          existing.validatedCount += 1;
          existing.status = `validated:${existing.validatedCount}`;
          existing.date = todayStr;
          existing.version = existing.version + 1;
          indexParsed.autoLines[i] = existing;
        }
        break;
      }
    }

    // Also check and update auto-captures.md
    let foundInAuto = false;
    for (let i = 0; i < autoEntries.length; i++) {
      const existing = autoEntries[i];
      const existingNormText = normalizeKey(existing.text);

      if (existingNormText === normEntry || existingNormText === normKey) {
        foundInAuto = true;

        if (existing.isFailed) break; // skip

        if (existing.isProposed) {
          existing.status = 'validated:1';
          existing.validatedCount = 1;
          existing.isProposed = false;
          existing.isValidated = true;
          existing.date = todayStr;
          existing.version = existing.version + 1;
          autoEntries[i] = existing;
        } else if (existing.isValidated) {
          existing.validatedCount += 1;
          existing.status = `validated:${existing.validatedCount}`;
          existing.date = todayStr;
          existing.version = existing.version + 1;
          autoEntries[i] = existing;
        }
        break;
      }
    }

    // If not found anywhere → add as new proposed
    if (!foundInIndex && !foundInAuto) {
      const newEntry = {
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
      autoEntries.push(newEntry);
      indexParsed.autoLines.push({ ...newEntry });
    }
  }

  // Step 5: Anti-Bloat Pruning
  autoEntries = pruneEntries(autoEntries);

  // Step 6: Graduation Check
  const graduated = [];
  autoEntries = autoEntries.filter(entry => {
    if (entry.isValidated && entry.validatedCount >= GRADUATION_THRESHOLD) {
      graduated.push(entry);
      return false; // remove from auto-captures
    }
    return true;
  });

  // Graduate to domain files
  for (const entry of graduated) {
    // Determine domain from the candidate that matches, or default to 'unknown'
    let domain = 'unknown';
    for (const candidate of candidates) {
      if (normalizeKey(candidate.entry) === normalizeKey(entry.text)) {
        domain = candidate.domain || 'unknown';
        break;
      }
    }
    graduateToDomainFile(domain, entry);
  }

  // Also remove graduated entries from INDEX.md auto lines
  const graduatedTexts = new Set(graduated.map(e => normalizeKey(e.text)));
  indexParsed.autoLines = indexParsed.autoLines.filter(
    e => !graduatedTexts.has(normalizeKey(e.text))
  );

  // Step 7: INDEX.md Cap Enforcement
  indexParsed.autoLines = capIndexAutoLines(indexParsed.autoLines);

  // Step 8: Atomic Write
  const newIndexContent = rebuildIndex(indexParsed.preamble, indexParsed.autoLines);
  const newAutoCapturesContent = rebuildAutoCaptures(autoEntries);

  atomicWrite(INDEX_PATH, newIndexContent);
  atomicWrite(AUTO_CAPTURES_PATH, newAutoCapturesContent);
} catch {
  // Top-level catch: exit silently on any error
  // Never throw, never log, never break the user's flow
}
