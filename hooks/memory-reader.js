// Author: Subash Karki
// memory-reader.js — UserPromptSubmit hook
// Injects relevant learnings before Claude processes each prompt. When the
// host payload carries no session_id, per-session dedup is skipped entirely
// (no marker read or write) so an unidentifiable session always injects,
// rather than sharing a single 'unknown' marker across every such session.
'use strict';

try {
  const fs = require('fs');
  const os = require('os');
  const path = require('path');
  const crypto = require('crypto');

  let learningsDir, stateDir;
  try {
    ({ learningsDir, stateDir } = require('../scripts/lib/gorkhali-paths'));
  } catch (_) {
    // fail open: env-free stateDir fallback, mirrors hooks/router-nudge.js:16-23.
    // learningsDir has no safe standalone fallback; a missing module surfaces
    // below as INDEX_PATH never resolving, and the outer try/catch exits 0.
    const home = os.homedir();
    const data = process.env.GORKHALI_DATA ||
      (home ? path.join(home, '.gorkhali') : path.join(process.cwd(), '.gorkhali'));
    stateDir = () => path.join(data, 'state');
  }

  // The ONE parser. This hook used to carry its own entry regexes, which required a
  // markdown TABLE in INDEX.md (it is a bullet list) and skipped any entry outside a
  // recognized section (infra.md has no sections), so injection was fully dark.
  // Never re-add a private entry regex here.
  const {
    parseLearningEntries,
    parseIndexDomainFiles,
    parseAutoCaptures,
    lifecycleClass,
    isTemplatePlaceholder,
  } = require('../scripts/lib/learning-grammar.cjs');

  let DOMAIN_KEYWORDS = {};
  let fileDomain = () => null;
  try {
    ({ DOMAIN_KEYWORDS, fileDomain } = require('../scripts/lib/domains'));
  } catch (_) { /* fail open: lib missing → no matches → 'shadows' default below */ }
  let GRADUATION_THRESHOLD = 5; // validated:5+ → high injection priority
  let SLOTS = 5, CORRECTION_SLOTS = 3, VALIDATED_SLOTS = 1, AGE_BAND_DAYS = 30;
  try {
    const C = require('../scripts/lib/constants');
    GRADUATION_THRESHOLD = C.GRADUATION_THRESHOLD ?? GRADUATION_THRESHOLD;
    SLOTS = C.INJECTION_SLOTS ?? SLOTS;
    CORRECTION_SLOTS = C.INJECTION_CORRECTION_SLOTS ?? CORRECTION_SLOTS;
    VALIDATED_SLOTS = C.INJECTION_VALIDATED_SLOTS ?? VALIDATED_SLOTS;
    AGE_BAND_DAYS = C.LEARNING_STALE_DAYS ?? AGE_BAND_DAYS;
  } catch (_) { /* fail open: lib missing → inline defaults */ }

  let activeSessionDir = () => null;
  let recordSessionCited = () => {};
  try {
    ({ activeSessionDir } = require('../scripts/lib/routing-state'));
  } catch (_) { /* fail open: no session identity → skip citation write */ }
  try {
    ({ recordSessionCited } = require('../scripts/lib/learnings-cited'));
  } catch (_) { /* fail open: no citation helper → injection still emits */ }

  const LEARNINGS_DIR = learningsDir();
  const INDEX_PATH = path.join(LEARNINGS_DIR, 'INDEX.md');
  const MAX_INJECTION_CHARS = 1600; // ~400 tokens

  // --- Step 1: Read stdin ---
  // fd 0, not '/dev/stdin' — the device path ENXIOs on Linux pipe spawns (CI-discovered).
  const input = JSON.parse(fs.readFileSync(0, 'utf-8'));
  const prompt = (input.prompt || input.content || input.message || '').toLowerCase();
  // No 'unknown' fallback: an absent/empty session_id must not collapse onto a
  // shared marker file (that would turn per-session dedup into permanent
  // cross-session suppression). hasSessionId gates the marker read/write below.
  const hasSessionId = typeof input.session_id === 'string' && input.session_id.length > 0;
  const sessionId = hasSessionId ? input.session_id.replace(/[^A-Za-z0-9_-]/g, '_') : '';

  if (!prompt) process.exit(0);

  // --- Step 2: Detect domain signals (keywords + paths, not every domain) ---

  const matchedDomains = [];
  for (const [domain, keywords] of Object.entries(DOMAIN_KEYWORDS)) {
    if (keywords.some((kw) => prompt.includes(kw))) {
      matchedDomains.push(domain);
    }
  }

  const PATH_RE = /(?:^|[\s`'"(])([A-Za-z0-9_./-]+\.[A-Za-z0-9]+)/g;
  const pathHits = [];
  let pathMatch;
  while ((pathMatch = PATH_RE.exec(prompt)) !== null) pathHits.push(pathMatch[1]);

  // Paths this session already edited (PostToolUse). Subagents never see this
  // hook; the parent session does, and uses these paths to pick a domain.
  if (hasSessionId) {
    try {
      const touchedFile = path.join(stateDir(), 'memory-touched', sessionId);
      if (fs.existsSync(touchedFile)) {
        for (const line of fs.readFileSync(touchedFile, 'utf-8').split('\n')) {
          if (line.trim()) pathHits.push(line.trim());
        }
      }
    } catch (_) { /* fail toward keyword-only match */ }
  }

  for (const filePath of pathHits) {
    const domain = typeof fileDomain === 'function' ? fileDomain(filePath) : null;
    if (domain && !matchedDomains.includes(domain)) matchedDomains.push(domain);
  }

  // Default to shadows if nothing matched
  if (matchedDomains.length === 0) matchedDomains.push('shadows');

  // --- Step 3: Load INDEX.md and map domains to files ---
  if (!fs.existsSync(INDEX_PATH)) process.exit(0);

  const indexContent = fs.readFileSync(INDEX_PATH, 'utf-8');

  // Accepts BOTH INDEX.md shapes (bullet list and markdown table) via the shared grammar.
  const domainFileMap = parseIndexDomainFiles(indexContent);

  // Also build a reverse lookup: try matching detected domain to any key
  function findFileForDomain(domain) {
    // Direct match
    if (domainFileMap[domain]) return domainFileMap[domain];
    // Partial match (e.g., "shadows" matches "shadows")
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
  // Class rank, lower wins. `unconfirmed` is the 36-of-54 majority class: an entry with
  // no [failed], no [proposed] and no [validated:N] at all. The shared grammar cannot
  // distinguish it (lifecycleClass returns 'validated-low' for anything untagged), which
  // would rank 36 never-confirmed entries level with the 4 that carry a real
  // confirmation. It is refined below rather than in the grammar so the grammar stays
  // the single authority on recognition.
  const CLASS_RANK = {
    failed: 0,
    correction: 0,
    'validated-high': 1,
    'validated-low': 2,
    unconfirmed: 3,
    proposed: 4,
    auto: 5,
  };
  const CORRECTION_CLASSES = new Set(['failed', 'correction']);
  const VALIDATED_CLASSES = new Set(['validated-high', 'validated-low']);

  const TODAY = Date.now();
  // Recency is a term in the rank, not just a tiebreak: an aging correction loses ground
  // to a graduated pattern. Banded (not continuous) so one day's drift never reshuffles
  // the injection set, and capped at 2 so an ancient entry cannot outrank every class.
  function ageBand(dateStr) {
    if (!dateStr) return 2;
    const t = Date.parse(dateStr);
    if (Number.isNaN(t)) return 2;
    return Math.min(2, Math.floor((TODAY - t) / (86400000 * AGE_BAND_DAYS)));
  }

  function classOf(entry) {
    const cls = lifecycleClass(entry, GRADUATION_THRESHOLD);
    // Untagged entries land on 'validated-low' by grammar fallback; only a real
    // [validated:N] count earns that class.
    if (VALIDATED_CLASSES.has(cls) && !(entry.validationCount > 0)) return 'unconfirmed';
    return cls;
  }

  // Entry recognition and the lifecycle→class mapping live in the shared grammar; this
  // hook owns only the rank arithmetic and the slot partition.
  function readEntries(content, fileName) {
    return parseLearningEntries(content, fileName)
      .filter((entry) => entry.text && entry.text.length >= 10)
      .filter((entry) => !isTemplatePlaceholder(entry.text))
      .map((entry) => {
        const cls = classOf(entry);
        return {
          text: entry.text,
          keyword: entry.keyword || '',
          cls,
          date: entry.date || '',
          rank: (CLASS_RANK[cls] ?? CLASS_RANK.auto) * 2 + ageBand(entry.date),
          source: fileName,
        };
      });
  }

  // Injection dedup key: hash of the FULL entry text plus its domain file, not a
  // prefix — a prefix collides whenever two entries share an opening substring and
  // silently drops the second one from the marker set.
  function entryKey(entry) {
    return crypto.createHash('sha256')
      .update(entry.text + ' ' + (entry.source || ''))
      .digest('hex')
      .slice(0, 16);
  }

  // Collect entries from all matched domains
  let allEntries = [];
  const loadedFiles = new Set();

  const loadFile = (fileName) => {
    if (!fileName || loadedFiles.has(fileName)) return;
    loadedFiles.add(fileName);
    const filePath = path.join(LEARNINGS_DIR, fileName);
    if (!fs.existsSync(filePath)) return;
    allEntries.push(...readEntries(fs.readFileSync(filePath, 'utf-8'), fileName));
  };

  for (const domain of matchedDomains) {
    loadFile(findFileForDomain(domain));
  }

  // Never go dark, and never dump every domain file into the prompt. If the
  // matched domain has no file yet, inject short INDEX one-liners instead.
  if (allEntries.length === 0) {
    allEntries.push(...readEntries(indexContent, 'INDEX.md'));
  }

  // --- Step 7: Also check auto-captures.md ---
  const autoCapturesPath = path.join(LEARNINGS_DIR, 'auto-captures.md');
  if (fs.existsSync(autoCapturesPath)) {
    const autoContent = fs.readFileSync(autoCapturesPath, 'utf-8');
    for (const entry of parseAutoCaptures(autoContent)) {
      let cls = 'auto';
      if (entry.validationCount >= GRADUATION_THRESHOLD) cls = 'validated-high';
      else if (entry.validationCount >= 1) cls = 'validated-low';
      allEntries.push({
        text: entry.text,
        cls,
        date: entry.date || '',
        rank: CLASS_RANK[cls] * 2 + ageBand(entry.date),
        source: 'auto-captures.md',
      });
    }
  }

  // --- Step 4.5: Per-session injection dedup ---
  // Marker at stateDir()/memory-injected/<sessionId>: one entry key per line.
  // Excluded BEFORE claim() so the char/slot budget flows to entries this session
  // has not already seen, instead of re-spending it on repeats.
  const injectedDir = path.join(stateDir(), 'memory-injected');
  const injectedFile = hasSessionId ? path.join(injectedDir, sessionId) : null;
  let injectedKeys = new Set();
  // No session_id → no marker to read: injectedKeys stays empty, so nothing is excluded.
  if (hasSessionId) {
    try {
      if (fs.existsSync(injectedFile)) {
        injectedKeys = new Set(
          fs.readFileSync(injectedFile, 'utf-8').split('\n').map((l) => l.trim()).filter(Boolean)
        );
      }
    } catch (_) { /* fail toward injection: an unreadable marker excludes nothing */ }
  }

  allEntries = allEntries.filter((entry) => !injectedKeys.has(entryKey(entry)));

  // --- Step 5: Prioritize entries ---
  // Rank ascending; newest first inside a rank. The date tiebreak is what stops the
  // corpus's oldest corrections from owning their slots by file order alone.
  const byRank = (a, b) => a.rank - b.rank || (a.date < b.date ? 1 : a.date > b.date ? -1 : 0);
  allEntries.sort(byRank);

  // --- Step 6: Partitioned allocation over the CHAR budget ---
  const header = '<!-- memory-injection -->\n**Relevant learnings:**\n';
  const footer = '\n<!-- /memory-injection -->';
  const budget = MAX_INJECTION_CHARS - (header.length + footer.length);

  // CHARS are the binding constraint, not slots. Partitioning slots alone does not make a
  // validated entry reachable: entries here run 200-930 chars against a ~1525-char budget,
  // so two [failed] corrections spend it all and the reserved validated slot is dropped at
  // the formatting step. MEASURED: `nul byte binary diff` could not surface the entry
  // literally named nul-byte-binary-diff [validated:1]. So the budget is partitioned the
  // same way the slots are, and the reserve is what makes the floor real.
  const validatedCharReserve = Math.floor((budget * VALIDATED_SLOTS) / SLOTS);

  const picked = [];
  const taken = new Set();
  let usedChars = 0;

  // Claim within BOTH a slot limit and a char cap. Oversized candidates are skipped, not
  // stopped at, so a shorter lower-ranked member of the class can still take the reserve -
  // that is how a 267-char validated entry wins a slot the 690-char one cannot afford.
  const claim = (slotLimit, charCap, predicate) => {
    let slots = Math.min(slotLimit, SLOTS - picked.length);
    for (const entry of allEntries) {
      if (slots <= 0) return;
      if (taken.has(entry) || !predicate(entry)) continue;
      const cost = entry.text.length + 3; // '- ' prefix + trailing newline
      if (usedChars + cost > charCap) continue;
      taken.add(entry);
      picked.push(entry);
      usedChars += cost;
      slots--;
    }
  };

  claim(CORRECTION_SLOTS, budget - validatedCharReserve, (e) => CORRECTION_CLASSES.has(e.cls));
  claim(VALIDATED_SLOTS, budget, (e) => VALIDATED_CLASSES.has(e.cls));
  // Whatever neither reserved class claimed goes to the field in plain rank order, so
  // capping corrections never wastes budget on an empty reserve.
  claim(SLOTS, budget, () => true);

  const injectedThisRound = picked.slice();
  const outputLines = picked.sort(byRank).map((entry) => '- ' + entry.text);

  // A single entry longer than the whole budget must not silently emit nothing -
  // truncating the highest-priority learning beats dropping it. Real entries run past
  // 1100 chars, so this is reachable, not theoretical.
  if (outputLines.length === 0 && allEntries.length > 0 && budget > 4) {
    outputLines.push('- ' + allEntries[0].text.slice(0, budget - 4) + '...');
    injectedThisRound.push(allEntries[0]);
  }

  if (outputLines.length === 0) process.exit(0);

  // Advisory marker write: records what this session has now seen so a repeat
  // prompt doesn't re-spend budget on the same entries. A write failure must not
  // suppress the injection that already happened above (fail toward injection).
  // No session_id → no shared bucket to write into: skip the marker entirely.
  if (hasSessionId) {
    try {
      fs.mkdirSync(injectedDir, { recursive: true });
      const updated = new Set(injectedKeys);
      for (const entry of injectedThisRound) updated.add(entryKey(entry));
      fs.writeFileSync(injectedFile, Array.from(updated).join('\n') + '\n');
    } catch (_) { /* advisory: never suppress an injection over a marker write failure */ }
  }

  // Record cited keywords for evolve's computed [validated:N]. Fail-open: a
  // citation write must never suppress the injection already selected above.
  try {
    const keywords = injectedThisRound.map((entry) => entry.keyword).filter(Boolean);
    if (keywords.length > 0) {
      const sessionDir = activeSessionDir(input.cwd || process.cwd());
      if (sessionDir) recordSessionCited(sessionDir, keywords);
    }
  } catch (_) { /* advisory: never suppress an injection over a citation write failure */ }

  process.stdout.write(header + outputLines.join('\n') + footer);
} catch (_) {
  // Silent exit — never break user flow
  process.exit(0);
}
