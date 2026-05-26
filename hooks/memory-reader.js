// Author: Subash Karki
// memory-reader.js — UserPromptSubmit hook
// Injects relevant learnings before Claude processes each prompt.
'use strict';

try {
  const fs = require('fs');
  const path = require('path');

  const HOME = require('os').homedir();
  const TEAM_DIR = path.join(HOME, '.claude', 'team');
  const LEARNINGS_DIR = path.join(TEAM_DIR, 'learnings');
  const INDEX_PATH = path.join(LEARNINGS_DIR, 'INDEX.md');
  const MAX_INJECTION_CHARS = 1600; // ~400 tokens

  // --- Step 1: Read stdin ---
  const input = JSON.parse(fs.readFileSync('/dev/stdin', 'utf-8'));
  const prompt = (input.prompt || input.content || input.message || '').toLowerCase();

  if (!prompt) process.exit(0);

  // --- Step 2: Detect domain signals ---
  const DOMAIN_KEYWORDS = {
    ui: ['react', 'jsx', 'tsx', 'component', 'css', 'style', 'chakra', 'layout', 'render', 'frontend', 'tailwind', 'svg', 'figma'],
    data: ['api', 'fetch', 'axios', 'graphql', 'endpoint', 'route', 'rest', 'http', 'query', 'mutation', 'request', 'response'],
    auth: ['auth', 'jwt', 'token', 'oauth', 'session', 'login', 'password', 'credential', 'permission', 'rbac'],
    testing: ['test', 'spec', 'mock', 'jest', 'vitest', 'mocha', 'assert', 'expect', 'coverage', 'fixture'],
    crew: ['agent', 'crew', 'skill', 'spawn', 'hook', 'cortex', 'spark', 'oracle', 'sentinel', 'prism', 'hawkeye', 'detective'],
    migration: ['migrate', 'schema', 'migration', 'alter', 'column', 'table', 'database', 'sql', 'prisma', 'drizzle'],
    tooling: ['config', 'eslint', 'tsconfig', 'webpack', 'vite', 'prettier', 'lint', 'build', 'ci', 'pipeline', 'docker', 'deploy'],
  };

  const matchedDomains = [];
  for (const [domain, keywords] of Object.entries(DOMAIN_KEYWORDS)) {
    if (keywords.some((kw) => prompt.includes(kw))) {
      matchedDomains.push(domain);
    }
  }

  // Default to crew if nothing matched
  if (matchedDomains.length === 0) matchedDomains.push('crew');

  // --- Step 3: Load INDEX.md and map domains to files ---
  if (!fs.existsSync(INDEX_PATH)) process.exit(0);

  const indexContent = fs.readFileSync(INDEX_PATH, 'utf-8');

  // Parse the table in INDEX.md to find domain → file mappings
  // Table format: | Domain | `file.md` | Entries | Corrections |
  const domainFileMap = {};
  const tableRowRe = /\|\s*([^|]+?)\s*\|\s*`([^`]+)`\s*\|/g;
  let match;
  while ((match = tableRowRe.exec(indexContent)) !== null) {
    const domainLabel = match[1].trim().toLowerCase().replace(/\s+/g, '-');
    const fileName = match[2].trim();
    domainFileMap[domainLabel] = fileName;
  }

  // Also build a reverse lookup: try matching detected domain to any key
  function findFileForDomain(domain) {
    // Direct match
    if (domainFileMap[domain]) return domainFileMap[domain];
    // Partial match (e.g., "crew" matches "crew")
    for (const [key, file] of Object.entries(domainFileMap)) {
      if (key.includes(domain) || domain.includes(key)) return file;
    }
    // Try domain.md as fallback
    const fallback = domain + '.md';
    const fallbackPath = path.join(LEARNINGS_DIR, fallback);
    if (fs.existsSync(fallbackPath)) return fallback;
    return null;
  }

  // --- Step 4: Load domain files and extract entries ---
  const PRIORITY = { failed: 0, correction: 1, 'validated-high': 2, 'validated-low': 3, proposed: 4, auto: 5 };

  function parseEntries(content) {
    const entries = [];
    const lines = content.split('\n');

    // Track which section we're in (## Corrections, ## Patterns, ## Habits, etc.)
    let currentSection = '';

    for (const line of lines) {
      const trimmed = line.trim();

      // Detect section headers
      const sectionMatch = trimmed.match(/^##\s+(.+)/);
      if (sectionMatch) {
        currentSection = sectionMatch[1].trim().toLowerCase();
        continue;
      }

      // Skip non-list lines and sub-headers
      if (trimmed.startsWith('###') || trimmed.startsWith('>') || trimmed.startsWith('|')) continue;
      if (!trimmed.startsWith('-') && !trimmed.match(/^(?:\*\*)?CORRECTION/i)) continue;

      const text = trimmed.replace(/^-\s+/, '').replace(/\*\*/g, '');
      if (!text || text.length < 10) continue;
      // Skip template/placeholder entries and "no entries" markers
      if (/no corrections recorded|template|YYYY-MM-DD|\[describe\b|\[why\b|\[the approach|\[task types|start as \[failed\]|What failed:|Root cause:|What to do instead:|Applies to:/i.test(text)) continue;

      // Explicit CORRECTION [{keyword}]: ... [{status}] format
      if (/CORRECTION\s*\[/i.test(trimmed)) {
        if (/\[failed\]/i.test(trimmed)) {
          entries.push({ text, priority: PRIORITY.failed });
        } else {
          const valMatch = trimmed.match(/\[validated:(\d+)\]/i);
          const count = valMatch ? parseInt(valMatch[1], 10) : 0;
          entries.push({
            text,
            priority: count >= 5 ? PRIORITY['validated-high'] : PRIORITY['validated-low'],
          });
        }
        continue;
      }

      // Check for [failed] tag anywhere
      if (/\[failed\]/i.test(trimmed)) {
        entries.push({ text, priority: PRIORITY.failed });
        continue;
      }

      // Check for [validated:N] tag
      const valMatch = trimmed.match(/\[validated:(\d+)\]/i);
      if (valMatch) {
        const count = parseInt(valMatch[1], 10);
        entries.push({
          text,
          priority: count >= 5 ? PRIORITY['validated-high'] : PRIORITY['validated-low'],
        });
        continue;
      }

      // Check for [proposed] tag
      if (/\[proposed\]/i.test(trimmed)) {
        entries.push({ text, priority: PRIORITY.proposed });
        continue;
      }

      // Untagged entries — priority depends on section
      if (currentSection.includes('correction')) {
        entries.push({ text, priority: PRIORITY.correction });
      } else if (currentSection.includes('pattern') || currentSection.includes('validated')) {
        entries.push({ text, priority: PRIORITY['validated-low'] });
      } else if (currentSection.includes('habit')) {
        entries.push({ text, priority: PRIORITY.proposed });
      }
      // Skip entries outside recognized sections
    }

    return entries;
  }

  // Collect entries from all matched domains
  let allEntries = [];
  const loadedFiles = new Set();

  for (const domain of matchedDomains) {
    const fileName = findFileForDomain(domain);
    if (!fileName || loadedFiles.has(fileName)) continue;
    loadedFiles.add(fileName);

    const filePath = path.join(LEARNINGS_DIR, fileName);
    if (!fs.existsSync(filePath)) continue;

    const content = fs.readFileSync(filePath, 'utf-8');
    allEntries.push(...parseEntries(content));
  }

  // --- Step 7: Also check auto-captures.md ---
  const autoCapturesPath = path.join(LEARNINGS_DIR, 'auto-captures.md');
  if (fs.existsSync(autoCapturesPath)) {
    const autoContent = fs.readFileSync(autoCapturesPath, 'utf-8');
    const autoLines = autoContent.split('\n');

    for (const line of autoLines) {
      const trimmed = line.trim();
      // auto: {entry text} [proposed] v:{N} q:{confidence} u:{date}
      const autoMatch = trimmed.match(/^auto:\s+(.+)/i);
      if (!autoMatch) continue;

      const text = trimmed;
      // Check if it has validated status
      const valMatch = trimmed.match(/v:(\d+)/);
      const valCount = valMatch ? parseInt(valMatch[1], 10) : 0;

      if (valCount >= 5) {
        allEntries.push({ text, priority: PRIORITY['validated-high'] });
      } else if (valCount >= 1) {
        allEntries.push({ text, priority: PRIORITY['validated-low'] });
      } else {
        allEntries.push({ text, priority: PRIORITY.auto });
      }
    }
  }

  // --- Step 5: Prioritize entries ---
  allEntries.sort((a, b) => a.priority - b.priority);

  // Take top 5
  const topEntries = allEntries.slice(0, 5);

  if (topEntries.length === 0) process.exit(0);

  // --- Step 6: Format output ---
  const header = '<!-- memory-injection -->\n**Relevant learnings:**\n';
  const footer = '\n<!-- /memory-injection -->';
  const headerFooterLen = header.length + footer.length;
  const budget = MAX_INJECTION_CHARS - headerFooterLen;

  const outputLines = [];
  let usedChars = 0;

  for (const entry of topEntries) {
    const line = '- ' + entry.text;
    if (usedChars + line.length + 1 > budget) break; // +1 for newline
    outputLines.push(line);
    usedChars += line.length + 1;
  }

  if (outputLines.length === 0) process.exit(0);

  process.stdout.write(header + outputLines.join('\n') + footer);
} catch (_) {
  // Silent exit — never break user flow
  process.exit(0);
}
