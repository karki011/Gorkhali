#!/usr/bin/env node
// Author: Subash Karki
// Verifies that every entry in learnings/INDEX.md has a corresponding domain file,
// and that every domain file is referenced in INDEX.md.
// Usage: check-learnings-index.js <learnings-dir>
//   <learnings-dir> defaults to ~/.claude/phantom/repos/_default/learnings
// Exit 0 = healthy, Exit 1 = problems found

'use strict';

const fs = require('fs');
const path = require('path');

const [,, learningsDir] = process.argv;
const dir = (learningsDir || `${process.env.HOME}/.claude/phantom/repos/_default/learnings`)
  .replace(/^~/, process.env.HOME);

if (!fs.existsSync(dir)) {
  process.stderr.write(`ERROR: Learnings directory not found: ${dir}\n`);
  process.exit(1);
}

const indexPath = path.join(dir, 'INDEX.md');
if (!fs.existsSync(indexPath)) {
  process.stderr.write(`ERROR: INDEX.md not found in ${dir}\n`);
  process.exit(1);
}

const indexContent = fs.readFileSync(indexPath, 'utf8');

// Known domain files per learning-system.md routing table
const KNOWN_DOMAINS = ['ui.md', 'data.md', 'auth.md', 'testing.md', 'tooling.md', 'migration.md', 'shadows.md'];

// Parse INDEX.md: look for lines that reference domain files
// Format: `{one-liner} [{lifecycle-tag}] v:{validations} q:{quality} u:{date}`
// Domain references appear as markdown links or inline mentions like `→ ui.md`
// We look for any word ending in .md that matches a known domain
const referencedDomains = new Set();
const domainMentionRe = /\b(\w+\.md)\b/g;
let m;
while ((m = domainMentionRe.exec(indexContent)) !== null) {
  if (m[1] !== 'INDEX.md' && m[1] !== 'EDGES.md') {
    referencedDomains.add(m[1]);
  }
}

// Get actual domain files present in directory
const actualFiles = fs.readdirSync(dir)
  .filter(f => f.endsWith('.md') && f !== 'INDEX.md' && f !== 'EDGES.md');

const problems = [];
const warnings = [];

// Check: every KNOWN domain file that exists should be mentioned in INDEX.md (or empty is fine)
for (const domainFile of KNOWN_DOMAINS) {
  const filePath = path.join(dir, domainFile);
  if (fs.existsSync(filePath)) {
    const content = fs.readFileSync(filePath, 'utf8').trim();
    if (content.length > 0 && !referencedDomains.has(domainFile)) {
      warnings.push(`WARN: ${domainFile} has content but is not referenced in INDEX.md`);
    }
  }
}

// Check: any .md file in dir (not INDEX/EDGES) should be a known domain
for (const actualFile of actualFiles) {
  if (!KNOWN_DOMAINS.includes(actualFile)) {
    warnings.push(`WARN: Unknown domain file found: ${actualFile} (not in known domains list)`);
  }
}

// Check INDEX.md references non-existent domain files
for (const ref of referencedDomains) {
  const refPath = path.join(dir, ref);
  if (!fs.existsSync(refPath)) {
    problems.push(`ERROR: INDEX.md references "${ref}" but file does not exist`);
  }
}

// Validate lifecycle tag format on non-empty lines
const lines = indexContent.split('\n').filter(l => l.trim() && !l.startsWith('#'));
const lifecycleTags = ['[proposed]', '[validated:', '[scope:global]', '[stale]', '[failed]'];
let malformedLines = 0;
for (const line of lines) {
  const hasTag = lifecycleTags.some(tag => line.includes(tag));
  if (!hasTag && line.trim().length > 10) {
    malformedLines++;
    if (malformedLines <= 3) {
      warnings.push(`WARN: Line missing lifecycle tag: "${line.trim().substring(0, 80)}"`);
    }
  }
}
if (malformedLines > 3) {
  warnings.push(`WARN: ${malformedLines - 3} more lines missing lifecycle tags (truncated)`);
}

// Print results
if (warnings.length > 0) {
  warnings.forEach(w => process.stdout.write(`${w}\n`));
}

if (problems.length > 0) {
  problems.forEach(p => process.stderr.write(`${p}\n`));
  process.stderr.write(`\nLearnings index check FAILED: ${problems.length} error(s), ${warnings.length} warning(s)\n`);
  process.exit(1);
}

process.stdout.write(`OK: Learnings index healthy — ${actualFiles.length} domain file(s), ${warnings.length} warning(s)\n`);
process.exit(0);
