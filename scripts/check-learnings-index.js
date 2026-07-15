#!/usr/bin/env node
// Author: Subash Karki
// Verifies that every entry in learnings/INDEX.md has a corresponding domain file,
// and that every domain file is referenced in INDEX.md.
// Usage: check-learnings-index.js <learnings-dir>
//   <learnings-dir> defaults to the current repo's learnings dir
//   (${PHANTOM_DATA}/repos/<detected-repo>/learnings)
// Exit 0 = healthy, Exit 1 = problems found

'use strict';

const fs = require('fs');
const path = require('path');
const { learningsDir, detectRepo } = require('./lib/phantom-paths');
const { KNOWN_DOMAIN_FILES } = require('./lib/domains');
const { PhantomError, reportError } = require('./lib/axi-error');

function main(argv) {
  const [,, argDir] = argv;
  const dir = (argDir || learningsDir(detectRepo()))
    .replace(/^~/, process.env.HOME);

  if (!fs.existsSync(dir)) {
    throw new PhantomError(`ERROR: Learnings directory not found: ${dir}`, 'IO_ERROR');
  }

  const indexPath = path.join(dir, 'INDEX.md');
  if (!fs.existsSync(indexPath)) {
    throw new PhantomError(`ERROR: INDEX.md not found in ${dir}`, 'IO_ERROR');
  }

  const indexContent = fs.readFileSync(indexPath, 'utf8');

  // Known domain files per learning-system.md routing table (canonical: scripts/lib/domains.js)
  const KNOWN_DOMAINS = KNOWN_DOMAIN_FILES;

  // Parse INDEX.md: look for lines that reference domain files
  // Format: `{one-liner} [{lifecycle-tag}] v:{validations} q:{quality} u:{date}`
  // Domain references appear as markdown links or inline mentions like `→ ui.md`
  // We look for any word ending in .md that matches a known domain.
  // Include '-' so hyphenated domain files (e.g. managed-organization.md,
  // dimension-studio.md) aren't truncated and then mis-flagged as broken refs.
  const referencedDomains = new Set();
  const domainMentionRe = /\b([\w-]+\.md)\b/g;
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
    // Validation failure stays exit 1 by contract (predates the VALIDATION_ERROR->2
    // taxonomy; downstream callers key on 1). See scripts/lib/axi-error.js.
    process.exitCode = 1;
    return;
  }

  process.stdout.write(`OK: Learnings index healthy — ${actualFiles.length} domain file(s), ${warnings.length} warning(s)\n`);
}

if (require.main === module) {
  try {
    main(process.argv);
  } catch (err) {
    reportError(err);
  }
}
