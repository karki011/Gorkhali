// Author: Subash Karki
// domains.js — canonical domain taxonomy: names, file-path routing rules, prompt keywords.
// Dep-free. Consumers: memory-consolidator, memory-reader, extract-learnings,
// check-learnings-index. First match wins — rule order is part of the contract.
// Unification: the old copies conflicted (extract-learnings' loose /ui|frontend/
// substring routed 'build'/'gui' etc. to ui; consolidator routed scripts/→tooling) —
// resolved toward segment-scoped ui matching plus the scripts/→tooling rule.

'use strict';

const DOMAIN_NAMES = ['ui', 'data', 'auth', 'testing', 'tooling', 'migration', 'shadows', 'model-routing'];

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
  shadows: ['agent', 'shadows', 'skill', 'spawn', 'hook', 'apex', 'blade', 'sage', 'ward', 'gaze', 'archer', 'hound'],
  migration: ['migrate', 'schema', 'migration', 'alter', 'column', 'table', 'database', 'sql', 'prisma', 'drizzle'],
  tooling: ['config', 'eslint', 'tsconfig', 'webpack', 'vite', 'prettier', 'lint', 'build', 'ci', 'pipeline', 'docker', 'deploy'],
  'model-routing': ['model-routing', 'compute-profile', 'fallback', 'requested_profile', 'actual_profile', 'frontier'],
};

// Expected learnings/{domain}.md files (check-learnings-index).
const KNOWN_DOMAIN_FILES = DOMAIN_NAMES.map(d => `${d}.md`);

module.exports = {
  DOMAIN_NAMES,
  FILE_DOMAIN_RULES,
  fileDomain,
  DOMAIN_KEYWORDS,
  KNOWN_DOMAIN_FILES,
};
