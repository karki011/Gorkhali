// Author: Subash Karki
// Evolution Runner — 3-tier distillation engine for team skill learnings
// Usage: node evolution-runner.js [--dry-run]

const fs = require('fs');
const path = require('path');

const TEAM_DIR = path.resolve(__dirname, '..');
const LEARNINGS_DIR = path.join(TEAM_DIR, 'learnings');
const PATTERNS_DIR = path.join(TEAM_DIR, 'global', 'patterns');
const STATE_FILE = path.join(TEAM_DIR, 'state', 'evolution-log.json');
const STALE_DAYS = 30;
const REMOVE_DAYS = 60;
const PROMOTE_THRESHOLD = 5;
const DISTILL_CAP = 50;

const dryRun = process.argv.includes('--dry-run');
const now = new Date();

function daysSince(dateStr) {
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return Infinity;
  return Math.floor((now - d) / (1000 * 60 * 60 * 24));
}

function parseEntries(content, filename) {
  const entries = [];
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    // Match CORRECTION entries
    const corrMatch = line.match(/^(?:-\s*)?(?:\*\*)?CORRECTION\s*\[([^\]]+)\]:\s*\[([^\]]*)\]\s*—\s*\[([^\]]*)\]\s*\[([^\]]*)\]\s*\(([^)]+)\)/i);
    if (corrMatch) {
      entries.push({
        type: 'correction', lineNum: i, raw: line,
        keyword: corrMatch[1], wrong: corrMatch[2], right: corrMatch[3],
        status: corrMatch[4], date: corrMatch[5], source: filename
      });
      continue;
    }
    // Match validated pattern entries: text [validated:N] (date) or text [validated:N]
    const valMatch = line.match(/^-\s*(.+?)\s*\[validated:(\d+)\](?:\s*\(([^)]+)\))?/);
    if (valMatch) {
      const dateStr = valMatch[3] || '';
      entries.push({
        type: 'pattern', lineNum: i, raw: line,
        content: valMatch[1], validationCount: parseInt(valMatch[2], 10),
        date: dateStr, source: filename
      });
      continue;
    }
    // Match date-stamped entries: - text (YYYY-MM-DD)
    const dateMatch = line.match(/^-\s*(.+?)\s*\((\d{4}-\d{2}-\d{2})\)\s*$/);
    if (dateMatch) {
      entries.push({
        type: 'entry', lineNum: i, raw: line,
        content: dateMatch[1], date: dateMatch[2], source: filename
      });
    }
  }
  return entries;
}

function readDomainFiles() {
  const files = fs.readdirSync(LEARNINGS_DIR)
    .filter(f => f.endsWith('.md') && f !== 'INDEX.md');
  const domains = {};
  for (const file of files) {
    const content = fs.readFileSync(path.join(LEARNINGS_DIR, file), 'utf8');
    const name = file.replace('.md', '');
    domains[name] = { file, content, entries: parseEntries(content, file) };
  }
  return domains;
}

// Tier 1: Staleness scan
function scanStaleness(domains) {
  const stale = [];
  const removable = [];
  for (const [name, domain] of Object.entries(domains)) {
    for (const entry of domain.entries) {
      if (!entry.date || entry.date === '') continue;
      const age = daysSince(entry.date);
      if (age >= REMOVE_DAYS && (!entry.validationCount || entry.validationCount < PROMOTE_THRESHOLD)) {
        removable.push({ domain: name, entry });
      } else if (age >= STALE_DAYS && (!entry.validationCount || entry.validationCount < 2)) {
        stale.push({ domain: name, entry });
      }
    }
  }
  return { stale, removable };
}

// Tier 2: Promotion
function findPromotable(domains) {
  const promotable = [];
  for (const [name, domain] of Object.entries(domains)) {
    for (const entry of domain.entries) {
      if (entry.type === 'pattern' && entry.validationCount >= PROMOTE_THRESHOLD) {
        promotable.push({ domain: name, entry });
      }
    }
  }
  return promotable;
}

function promoteToGlobal(domain, entry) {
  const keyword = (entry.content || '').replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 40).toLowerCase();
  const filename = `${domain}-${keyword || 'pattern'}.md`;
  const filepath = path.join(PATTERNS_DIR, filename);

  if (fs.existsSync(filepath)) return null; // already promoted

  const content = `---
name: ${keyword}
promoted_from: learnings/${domain}.md
promoted_date: ${now.toISOString().split('T')[0]}
validation_count: ${entry.validationCount}
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
  let content = fs.readFileSync(indexPath, 'utf8');
  for (const p of promoted) {
    const line = `- [${p.entry.content || p.entry.keyword}](${p.filename}) — promoted from ${p.domain}.md [validated:${p.entry.validationCount}] (${now.toISOString().split('T')[0]})`;
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

// Remove stale entries from domain files
function removeEntries(domains, removable) {
  const byDomain = {};
  for (const r of removable) {
    if (!byDomain[r.domain]) byDomain[r.domain] = [];
    byDomain[r.domain].push(r.entry.lineNum);
  }
  for (const [name, lineNums] of Object.entries(byDomain)) {
    const lines = domains[name].content.split('\n');
    const filtered = lines.filter((_, i) => !lineNums.includes(i));
    if (!dryRun) {
      fs.writeFileSync(path.join(LEARNINGS_DIR, domains[name].file), filtered.join('\n'));
    }
  }
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

// Main
function run() {
  console.log(`\n=== Evolution Runner ${dryRun ? '(DRY RUN)' : ''} ===\n`);

  const domains = readDomainFiles();
  const domainNames = Object.keys(domains);
  console.log(`Domains: ${domainNames.join(', ')} (${domainNames.length} files)\n`);

  // Tier 1
  const { stale, removable } = scanStaleness(domains);
  console.log(`[Tier 1] Stale (30+ days): ${stale.length}`);
  stale.forEach(s => console.log(`  ⚠ ${s.domain}: ${(s.entry.content || s.entry.raw).slice(0, 60)}...`));
  console.log(`[Tier 1] Removable (60+ days): ${removable.length}`);
  removable.forEach(r => console.log(`  ✕ ${r.domain}: ${(r.entry.content || r.entry.raw).slice(0, 60)}...`));
  if (removable.length > 0) removeEntries(domains, removable);

  // Tier 2
  const promotable = findPromotable(domains);
  const promoted = [];
  for (const p of promotable) {
    const filename = promoteToGlobal(p.domain, p.entry);
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
    stale_flagged: stale.length,
    stale_removed: removable.length,
    promoted: promoted.length,
    distill_needed: oversized.length,
    domains_processed: domainNames
  };
  writeLog(result);

  console.log(`\n--- Summary ---`);
  console.log(`Stale flagged: ${stale.length} | Removed: ${removable.length} | Promoted: ${promoted.length} | Distill needed: ${oversized.length}`);
  console.log(dryRun ? '(No changes written — dry run)\n' : 'Evolution logged.\n');
}

run();
