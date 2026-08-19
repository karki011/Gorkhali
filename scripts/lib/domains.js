// Author: Subash Karki
// domains.js — canonical domain taxonomy: names, file-path routing rules, prompt keywords.
// Dep-free. Consumers: memory-consolidator, memory-reader, extract-learnings,
// check-learnings-index. First match wins — rule order is part of the contract.
// Unification: the old copies conflicted (extract-learnings' loose /ui|frontend/
// substring routed 'build'/'gui' etc. to ui; consolidator routed scripts/→tooling) —
// resolved toward segment-scoped ui matching plus the scripts/→tooling rule.

'use strict';

// 'infra' and 'workflow' are the two domains that actually accrete entries on disk;
// they were absent from the taxonomy, so every real learnings file was reported as an
// "Unknown domain file". 'model-routing' stays declared ahead of its first entry.
const DOMAIN_NAMES = ['ui', 'data', 'auth', 'testing', 'tooling', 'migration', 'shadows', 'model-routing', 'infra', 'workflow'];

// Domain files kept on disk for history but never read as live knowledge.
// workflow.original.md is a stale strict subset of workflow.md that evolution-runner
// used to load as a domain literally named "workflow.original", double-counting
// entries against the distillation cap. Retired here, not deleted - a human owns that.
const RETIRED_DOMAIN_FILES = ['workflow.original.md'];

const FILE_DOMAIN_RULES = [
  { test: p => /(^|\/)(?:hooks|commands|agents)\//.test(p) || /shadows|skill|spawn|agent/i.test(p), domain: 'shadows' },
  { test: p => /(^|\/)(?:test|spec|__tests__)\//.test(p) || /\.test\.|\.spec\./.test(p),            domain: 'testing' },
  { test: p => /(^|\/)(?:styles|components)\//.test(p) || /\.tsx$|\.css$|\.scss$/.test(p) || /(^|[\/_.-])(ui|frontend)([\/_.-]|$)/i.test(p), domain: 'ui' },
  { test: p => /(^|\/)(?:api|routes|controllers)\//.test(p) || /fetch|axios|http/i.test(p),         domain: 'data' },
  { test: p => /(^|\/)auth\//.test(p) || /jwt|token|oauth|session/i.test(p),                        domain: 'auth' },
  { test: p => /(^|\/)(?:migrations|schema)\//.test(p) || /migrate|schema/i.test(p),                domain: 'migration' },
  { test: p => /(^|\/)config\//.test(p) || /eslint|tsconfig|webpack|vite|prettier/i.test(p),        domain: 'tooling' },
  { test: p => /(^|\/)scripts\//.test(p),                                                            domain: 'tooling' },
];

/** Matched domain or null — callers own their fallback ('other' / 'unknown' / ext map). */
function fileDomain(filePath) {
  if (!filePath) return null;
  for (const rule of FILE_DOMAIN_RULES) {
    if (rule.test(filePath)) return rule.domain;
  }
  return null;
}

// Prompt-signal keywords (memory-reader injection routing).
const DOMAIN_KEYWORDS = {
  ui: ['react', 'jsx', 'tsx', 'component', 'css', 'style', 'chakra', 'layout', 'render', 'frontend', 'tailwind', 'svg', 'figma'],
  data: ['api', 'fetch', 'axios', 'graphql', 'endpoint', 'route', 'rest', 'http', 'query', 'mutation', 'request', 'response'],
  auth: ['auth', 'jwt', 'token', 'oauth', 'session', 'login', 'password', 'credential', 'permission', 'rbac'],
  testing: ['test', 'spec', 'mock', 'jest', 'vitest', 'mocha', 'assert', 'expect', 'coverage', 'fixture'],
  shadows: ['agent', 'shadows', 'skill', 'spawn', 'hook', 'chief', 'engineer', 'advisor', 'inspector', 'auditor', 'justice', 'detective'],
  migration: ['migrate', 'schema', 'migration', 'alter', 'column', 'table', 'database', 'sql', 'prisma', 'drizzle'],
  tooling: ['config', 'eslint', 'tsconfig', 'webpack', 'vite', 'prettier', 'lint', 'build', 'ci', 'pipeline', 'docker', 'deploy'],
  'model-routing': ['model-routing', 'compute-profile', 'fallback', 'requested_profile', 'actual_profile', 'frontier'],
  infra: ['infra', 'installer', 'plugin', 'marketplace', 'vendor', 'release', 'version', 'cache', 'regex', 'resolver'],
  workflow: ['workflow', 'session', 'wrap', 'gate', 'marker', 'lock', 'commit', 'worktree', 'prompt', 'injection'],
};

// Expected learnings/{domain}.md files (check-learnings-index). Retired files are
// deliberately absent: they must keep reporting as unknown so a human sees that a
// stale snapshot is still on disk awaiting deletion.
const KNOWN_DOMAIN_FILES = DOMAIN_NAMES.map(d => `${d}.md`);

module.exports = {
  DOMAIN_NAMES,
  FILE_DOMAIN_RULES,
  fileDomain,
  DOMAIN_KEYWORDS,
  KNOWN_DOMAIN_FILES,
  RETIRED_DOMAIN_FILES,
};
