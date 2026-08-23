#!/usr/bin/env node
// Author: Subash Karki
// Given a Phantom command name, outputs which preamble tier it belongs to
// and which shared context files it loads — no LLM needed.
// Usage: preamble-tier.js <command-name>
//   command-name: e.g. "start", "verify", "status", "phantom:start", "/phantom:start"
// Exit 0 always (informational tool). Outputs JSON with --json flag.

'use strict';

const [,, ...args] = process.argv;
const jsonMode = args.includes('--json');
const commandArg = args.find(a => !a.startsWith('--'));

// Strip leading slash and "phantom:" prefix for matching
function normalize(cmd) {
  return (cmd || '').replace(/^\//, '').replace(/^phantom:/, '').toLowerCase();
}

// Tier definitions - THE canonical registry. _shared.md's Preamble Tiers table
// and every command's blockquote render from this; test/preamble-tier.test.js
// fails on drift between the three.
const TIERS = {
  T1: {
    label: 'T1 — Leaf (read-only / single action)',
    commands: ['status', 'sessions', 'health', 'learn', 'scout', 'evolve', 'grill'],
    sharedContexts: [
      '_shared.md',
    ],
    ironLaws: [1, 2, 3],
    description: 'Minimal context. Only core governance, Core Rules 1-3, and path helpers.',
  },
  T2: {
    label: 'T2 — Verification (diagnose / report)',
    commands: ['verify', 'fix', 'validate', 'eval', 'detective', 'brainstorm', 'close', 'greploop', 'loop', 'q', 'wire'],
    sharedContexts: [
      '_shared.md',
      '_shared-repo-detection.md',
      '_shared-auto-learning.md',
    ],
    conditionalContexts: ['_shared-detective.md (on detective trigger)'],
    ironLaws: [1, 2, 3, 5, 11],
    description: 'Stack detection + learnings read/write. Detective loaded on trigger.',
  },
  T3: {
    label: 'T3 — Planning (research / review / discuss)',
    commands: ['review', 'pr-review', 'contract', 'recruit', 'visual', 'visualflow'],
    sharedContexts: [
      '_shared.md',
      '_shared-repo-detection.md',
      '_shared-auto-learning.md',
      '_shared-shadows.md',
      '_shared-discipline.md',
      '_shared-contracts.md',
    ],
    ironLaws: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
    description: 'Full planning context. Shadows roles, discipline, contracts.',
  },
  T4: {
    label: 'T4 — Full orchestration (plan + execute + verify)',
    commands: ['start', 'execute', 'wrap', 'resume', 'pause'],
    sharedContexts: [
      '_shared.md',
      '_shared-repo-detection.md',
      '_shared-auto-learning.md',
      '_shared-shadows.md',
      '_shared-discipline.md',
      '_shared-contracts.md',
      '_shared-detective.md',
    ],
    ironLaws: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13],
    description: 'All shared contexts. Full Core Rules.',
  },
};

// All shared context files with purpose (from _shared.md table)
const CONTEXT_PURPOSES = {
  '_shared.md': 'Core governance, Core Rules, paths, context management',
  '_shared-repo-detection.md': 'Stack detection, verification commands',
  '_shared-auto-learning.md': 'Read/write learnings after work',
  '_shared-shadows.md': 'Agent spawning, shadows roles',
  '_shared-discipline.md': 'Plan/execution discipline',
  '_shared-contracts.md': 'Contract templates, hooks',
  '_shared-detective.md': 'Forensic analysis (loaded on detective trigger)',
  '_shared-justice.md': 'Justice spec (loaded on demand)',
};

function findTier(cmd) {
  const norm = normalize(cmd);
  for (const [tierKey, tier] of Object.entries(TIERS)) {
    if (tier.commands.includes(norm)) {
      return { tierKey, tier };
    }
  }
  return null;
}

function printAll() {
  console.log('Phantom Preamble Tiers\n');
  for (const [tierKey, tier] of Object.entries(TIERS)) {
    console.log(`${tier.label}`);
    console.log(`  Commands: ${tier.commands.join(', ')}`);
    console.log(`  Shared contexts (${tier.sharedContexts.length}):`);
    tier.sharedContexts.forEach(f => {
      const purpose = CONTEXT_PURPOSES[f] || '';
      console.log(`    - ${f}${purpose ? ` — ${purpose}` : ''}`);
    });
    if (tier.conditionalContexts) {
      tier.conditionalContexts.forEach(c => console.log(`    * ${c} (conditional)`));
    }
    console.log(`  Core Rules active: ${tier.ironLaws.join(', ')}`);
    console.log(`  ${tier.description}`);
    console.log('');
  }
}

module.exports = { TIERS, CONTEXT_PURPOSES, normalize, findTier };

if (require.main === module) {

if (!commandArg) {
  printAll();
  process.exit(0);
}

const result = findTier(commandArg);

if (!result) {
  const norm = normalize(commandArg);
  const allCommands = Object.values(TIERS).flatMap(t => t.commands);
  process.stderr.write(`ERROR: Unknown command "${commandArg}" (normalized: "${norm}")\n`);
  process.stderr.write(`Known commands: ${allCommands.join(', ')}\n`);
  process.exit(1);
}

const { tierKey, tier } = result;

if (jsonMode) {
  const out = {
    command: commandArg,
    normalized: normalize(commandArg),
    tier: tierKey,
    label: tier.label,
    sharedContexts: tier.sharedContexts,
    conditionalContexts: tier.conditionalContexts || [],
    ironLaws: tier.ironLaws,
    description: tier.description,
  };
  console.log(JSON.stringify(out, null, 2));
} else {
  console.log(`Command: ${commandArg} (${normalize(commandArg)})`);
  console.log(`Tier: ${tierKey} — ${tier.description}`);
  console.log('');
  console.log('Shared contexts loaded:');
  tier.sharedContexts.forEach(f => {
    const purpose = CONTEXT_PURPOSES[f] || '';
    console.log(`  + ${f}${purpose ? ` — ${purpose}` : ''}`);
  });
  if (tier.conditionalContexts) {
    tier.conditionalContexts.forEach(c => console.log(`  ~ ${c}`));
  }
  console.log('');
  console.log(`Core Rules active: ${tier.ironLaws.join(', ')} (of 13)`);
}

process.exit(0);

}
