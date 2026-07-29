// Author: Subash Karki
// memory-reader.js — UserPromptSubmit hook
// Injects relevant learnings before Claude processes each prompt.
'use strict';

try {
  const fs = require('fs');
  const path = require('path');

  const { learningsDir } = require('../scripts/lib/phantom-paths');

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
    isLiveDomainFile,
  } = require('../scripts/lib/learning-grammar.cjs');

  let DOMAIN_KEYWORDS = {};
  try {
    ({ DOMAIN_KEYWORDS } = require('../scripts/lib/domains'));
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

  const LEARNINGS_DIR = learningsDir();
  const INDEX_PATH = path.join(LEARNINGS_DIR, 'INDEX.md');
  const MAX_INJECTION_CHARS = 1600; // ~400 tokens

  // --- Step 1: Read stdin ---
  // fd 0, not '/dev/stdin' — the device path ENXIOs on Linux pipe spawns (CI-discovered).
  const input = JSON.parse(fs.readFileSync(0, 'utf-8'));
  const prompt = (input.prompt || input.content || input.message || '').toLowerCase();

  if (!prompt) process.exit(0);

  // --- Step 2: Detect domain signals (canonical taxonomy: scripts/lib/domains.js) ---

  const matchedDomains = [];
  for (const [domain, keywords] of Object.entries(DOMAIN_KEYWORDS)) {
    if (keywords.some((kw) => prompt.includes(kw))) {
      matchedDomains.push(domain);
    }
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
          cls,
          date: entry.date || '',
          rank: (CLASS_RANK[cls] ?? CLASS_RANK.auto) * 2 + ageBand(entry.date),
        };
      });
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

  // Never go dark. A keyword can match a domain that has no file yet (a 'ui' prompt in
  // a repo whose only files are infra.md and workflow.md resolved to nothing, which is
  // most of why injection produced nothing at all). Recorded conventions are largely
  // cross-domain, and priority ordering still puts [failed] corrections first, so
  // falling back to every live domain file beats injecting silence.
  if (allEntries.length === 0) {
    for (const fileName of fs.readdirSync(LEARNINGS_DIR).filter(isLiveDomainFile)) {
      loadFile(fileName);
    }
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
      });
    }
  }

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

  const outputLines = picked.sort(byRank).map((entry) => '- ' + entry.text);

  // A single entry longer than the whole budget must not silently emit nothing -
  // truncating the highest-priority learning beats dropping it. Real entries run past
  // 1100 chars, so this is reachable, not theoretical.
  if (outputLines.length === 0 && allEntries.length > 0 && budget > 4) {
    outputLines.push('- ' + allEntries[0].text.slice(0, budget - 4) + '...');
  }

  if (outputLines.length === 0) process.exit(0);

  process.stdout.write(header + outputLines.join('\n') + footer);
} catch (_) {
  // Silent exit — never break user flow
  process.exit(0);
}
