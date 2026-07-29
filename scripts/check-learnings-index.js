#!/usr/bin/env node
// Author: Subash Karki
// Verifies that every entry in learnings/INDEX.md has a corresponding domain file,
// and that every domain file is referenced in INDEX.md.
// Usage: check-learnings-index.js <learnings-dir>
//   <learnings-dir> defaults to the current repo's learnings dir
//   (${PHANTOM_DATA}/repos/<detected-repo>/learnings)
// Exit 0 = healthy, Exit 1 = problems found
//
// The INDEX-vs-domain-file validation itself lives in the canonical learning API
// (skills/phantom/scripts/phantom-learning.mjs) so the writer (memory-writer)
// and this validator all read the index by one grammar.

'use strict';

const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { learningsDir, detectRepo } = require('./lib/phantom-paths');
const { KNOWN_DOMAIN_FILES } = require('./lib/domains');
const { PhantomError, reportError } = require('./lib/axi-error');

const LEARNING_API = path.join(__dirname, '..', 'skills', 'phantom', 'scripts', 'phantom-learning.mjs');

async function main(argv) {
  const [,, argDir] = argv;
  const dir = (argDir || learningsDir(detectRepo()))
    .replace(/^~/, process.env.HOME);

  if (!fs.existsSync(dir)) {
    throw new PhantomError(`ERROR: Learnings directory not found: ${dir}`, 'IO_ERROR');
  }
  if (!fs.existsSync(path.join(dir, 'INDEX.md'))) {
    throw new PhantomError(`ERROR: INDEX.md not found in ${dir}`, 'IO_ERROR');
  }

  const { validateLearningIndex } = await import(pathToFileURL(LEARNING_API).href);
  const { problems, warnings, domainFileCount } = validateLearningIndex(dir, {
    knownDomains: KNOWN_DOMAIN_FILES,
  });

  if (warnings.length > 0) {
    warnings.forEach((w) => process.stdout.write(`${w}\n`));
  }

  if (problems.length > 0) {
    problems.forEach((p) => process.stderr.write(`${p}\n`));
    process.stderr.write(`\nLearnings index check FAILED: ${problems.length} error(s), ${warnings.length} warning(s)\n`);
    // Validation failure stays exit 1 by contract (predates the VALIDATION_ERROR->2
    // taxonomy; downstream callers key on 1). See scripts/lib/axi-error.js.
    process.exitCode = 1;
    return;
  }

  process.stdout.write(`OK: Learnings index healthy - ${domainFileCount} domain file(s), ${warnings.length} warning(s)\n`);
}

if (require.main === module) {
  main(process.argv).catch((err) => {
    reportError(err);
  });
}
