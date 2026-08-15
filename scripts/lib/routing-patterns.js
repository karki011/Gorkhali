// Author: Subash Karki
// routing-patterns.js — single source for router-nudge.js's implementation-intent
// pattern set. Moved verbatim from hooks/router-nudge.js:27-33 so reference/routing.md
// and test/routing-prose.test.js can pin the same list the hook actually runs.
'use strict';

// Implementation-intent triggers. Precision over recall: interrogative-opening
// prompts (diagnostic questions) are skipped wholesale before these run.
const PATTERNS = [
  { re: /\b[A-Z][A-Z0-9]+-\d+\b/, label: 'ticket-key' },
  { re: /\b(fix|implement|build|add|refactor|create|update|work on)\b/i, label: 'imperative-verb' },
  { re: /\b(let'?s|now|please|go ahead and) (fix|change|update|implement|add)\b/i, label: 'debug-to-fix' },
];

const INTERROGATIVE_RE = /^\s*(why|what|how|where|when|is|are|does|did|can you explain)\b/i;

module.exports = { PATTERNS, INTERROGATIVE_RE };
