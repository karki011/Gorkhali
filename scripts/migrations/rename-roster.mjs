#!/usr/bin/env node
// Author: Subash Karki
// rename-roster.mjs - mechanical Depth 2 rename of Gorkhali's agent-naming
// vocabulary (11 roles + 64 characters, 75 tokens total) across the whole
// repo. `reference/roster.md` is the new-vocabulary SSoT this rename derives
// from (already rewritten by an earlier task in this same rename effort).
//
// Modes:
//   --census              dry-run: per-file replacement counts, total file
//                          count, and every planned file/dir rename. Mutates
//                          nothing.
//   --census --ambiguous  print every matching line (file:line:text) for the
//                          four ambiguous tokens (lens, sweep, ward, hound) -
//                          a curation aid for the EXCEPTIONS list below.
//   --apply               execute the replacement (case-insensitive match,
//                          case-preserving substitution) plus the file/dir
//                          renames via `git mv` (falls back to fs.rename
//                          outside a git repo, e.g. under test fixtures).
//                          Idempotent: a second --apply reports 0
//                          replacements, 0 renames.
//   --lint                post-apply sweep: (a) leftover old tokens,
//                          (b) article-agreement errors ("a engineer" etc.),
//                          (c) suspicious "surveyor" placements that suggest
//                          a prose "lens" was wrongly replaced.
//
// Matching is word-boundary (`\b`), case-insensitive; hyphen counts as a
// boundary character (so `apex-active` matches `apex`). Character tokens
// like `orin`, `sena`, `oda` are heavy substring-pollution risks
// ("ignoring", "essence", "coda") - `\b` protects them automatically, so no
// per-token exception list is needed for the character set. The role set
// needs one: `lens`, `sweep`, `ward`, `hound` all have a plain-English sense
// that collides with the agent-role sense. See EXCEPTIONS / FILE_EXEMPT.

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
export const REPO_ROOT = path.resolve(__dirname, '..', '..');

// ---------------------------------------------------------------------------
// TOKEN MAP - the single SSoT for this rename. 11 roles + 64 characters.
// ---------------------------------------------------------------------------
export const ROLE_MAP = {
  apex: 'chief', blade: 'engineer', ward: 'inspector', gaze: 'auditor',
  hound: 'detective', rival: 'opposition', sage: 'advisor', warden: 'clerk',
  lens: 'surveyor', sweep: 'steward', archer: 'justice',
};

export const CHARACTER_MAP = {
  kaze: 'varek', joran: 'dunmar', sabin: 'brasco', ryu: 'ferrin', garok: 'oskal',
  thorne: 'rignal', vex: 'talwin', orin: 'maren', dorik: 'dovrin', lenna: 'kestal',
  pravo: 'ralden', quist: 'besner', brakka: 'dremmet', sennor: 'jarnek', talvik: 'kelwick',
  ossian: 'mendrik', doven: 'norvale', kirran: 'ostrem', mossa: 'pellam', ellow: 'rendal',
  tavric: 'senwick', sorne: 'tarvel', vint: 'vosler', torvan: 'halden', ilkka: 'corliss',
  cassim: 'ebbet', dreve: 'farlow', holt: 'gathrek', wenna: 'ondra', arbek: 'presk',
  sull: 'welden', brann: 'yarnell', isolde: 'zelmar', corben: 'tindal', pike: 'pember',
  ravel: 'quade', tessa: 'ranthe', korin: 'saldur', nettle: 'teviss', quorra: 'wrennick',
  haldis: 'arvick', brint: 'bolen', silven: 'crandal', elden: 'ledgard', varel: 'fenwick',
  ombric: 'ostin', sura: 'pruett', sylas: 'gavelin', mira: 'robeck', dain: 'sagard',
  wren: 'verdick', fenrik: 'draget', corva: 'colven', yara: 'meridan', thal: 'gantrey',
  nix: 'ordwin', oda: 'tessle', dask: 'contrell', veyra: 'parlow', gorath: 'ledgett',
  sena: 'scrivet', fenn: 'farwick', rooke: 'drafton', vane: 'quarrick',
};

export const TOKEN_MAP = { ...ROLE_MAP, ...CHARACTER_MAP }; // 75 entries

// Deliberately never in TOKEN_MAP - roster.md's own exclusion note covers why
// (they bind to identifiers this rename does not control: the native
// Explore/Plan subagent types and the external silent-failure-hunter plugin
// agent, plus council/scout which already fit the vocabulary or are handled
// via their character-slot tokens alone).
export const NOT_RENAMED = ['scout', 'council', 'explore', 'planner', 'hunter'];

// Role tokens that must survive a bare-word match in at least one genuine
// context. `lens`, `sweep`, `ward`, `hound` collide with a plain-English
// sense (see EXCEPTIONS below). `apex` collides differently: the literal
// filename `.apex-active` is a pre-rename runtime sentinel that other,
// already-shipped installs still write to disk, so the string itself must
// stay spelled `apex` for the upgrade-shim comparison to keep working (see
// FILE_EXEMPT.apex) - it is not a prose false positive, it is a value other
// code still depends on. Character tokens never need this - `\b` alone
// defeats their substring pollution (orin/ignoring, sena/essence, oda/coda,
// ...).
//
// `blade` has the same not-a-prose-false-positive shape as `apex`: .gitignore
// keeps a `.blade-editing` entry (the pre-rename spelling of the
// engineer-editing mutex marker file) as a one-release upgrade shim -
// pre-0.8.0 installs still write that filename to disk, same reasoning as
// .apex-active above. The .gitignore line itself needs no exemption:
// .gitignore has no extension and isn't under bin/, so it was never a member
// of SCAN_EXTS's scannedFiles set to begin with (see walkRepo below) - the
// old-token sweep's `blade` hit there is structurally out of scope for this
// tool, not curated around. But scripts/migrate-data.js and
// test/migrate-data.test.js also carry the literal `.blade-editing` (and
// `.apex-active`) sentinel as an in-code upgrade-shim comparison, and both
// files ARE scanned (`.js` extension) - so `blade` needs the same
// AMBIGUOUS_TOKENS/FILE_EXEMPT treatment `apex` gets, see FILE_EXEMPT.blade.
//
// `pravo` (a CHARACTER_MAP token, not a role token) needs the same mechanism
// for a different reason: it survives a real \b boundary (unlike
// orin/sena/oda's substring-pollution problem) because
// project-docs/seat-provenance-design.md quotes, verbatim, the real on-disk
// filename `agent-records/blade-pravo.json` as an evidence sample - rewriting
// the character name there would misrepresent the file that was actually
// observed, not just restate old vocabulary in prose. See FILE_EXEMPT.pravo.
export const AMBIGUOUS_TOKENS = ['lens', 'sweep', 'ward', 'hound', 'apex', 'blade', 'pravo'];

// ---------------------------------------------------------------------------
// SPECIAL PHRASES - applied before the generic map, whole-content, so a
// multi-word phrase never gets half-mangled by the single-token pass that
// follows. Case-insensitive match, case-preserving substitution (per-part).
// ---------------------------------------------------------------------------
export const SPECIAL_PHRASES = [
  {
    // The Dual-Lens Protocol (reference/agent-protocols/quality-gate.md) is
    // two Auditor reviewers, not two Lens/Surveyor reviewers - A1 already
    // wrote "Dual-Auditor Protocol" into roster.md as the SSoT name, so the
    // heading here must land on the exact same string, not on
    // "Dual-Surveyor" (what the generic lens->surveyor map alone would do).
    re: /\b(dual)-(lens)\b/gi,
    replace: (dual, lensPart) => `${dual}-${caseTransform(lensPart, 'auditor')}`,
    note: 'Dual-Lens Protocol -> Dual-Auditor Protocol (matches roster.md SSoT heading)',
  },
];

// ---------------------------------------------------------------------------
// EXCEPTIONS - per-token skip-patterns. If a line matches any pattern for a
// given ambiguous token, that token is NOT replaced anywhere on that line
// (other tokens on the same line are unaffected). Curated by running
// `--census --ambiguous` against this repo and reading every hit; a token
// names the AGENT (replace) when it refers to a role, spawn, file, or
// subagent_type; it is plain English (skip) when removing the agent meaning
// leaves the sentence intact.
// ---------------------------------------------------------------------------
export const EXCEPTIONS = {
  lens: [
    // Given base patterns: brainstorming's "generating lens" concept
    // (mvp-first / risk-first / ... framing) is a completely different
    // "lens" than the Lens/Surveyor agent - none of these are call sites.
    { re: /generating lens/i, note: 'approach-lens prose (brainstorm schema/docs), not the Lens agent' },
    { re: /lens enum/i, note: 'approach-lens prose' },
    { re: /per lens/i, note: 'approach-lens prose' },
    { re: /approach lens/i, note: 'approach-lens prose' },
    { re: /lens-agents/i, note: 'approach-lens prose (reference/brainstorm.md Council Mode description)' },
    { re: /distinct lens/i, note: 'approach-lens prose' },
    { re: /whyLens/i, note: 'the whyLens schema field name is the approach-lens concept, not the agent' },
    // Found while curating: additional genuine approach-lens usages in
    // reference/brainstorm.md and skills/gorkhali/references/brainstorming.md
    // that do not contain any of the base patterns above.
    { re: /idea's lens/i, note: "brainstorming.md: \"Record each idea's lens\" - approach-lens, not the agent" },
    { re: /summary,\s*lens,\s*technique/i, note: 'brainstorming.md ideas[] schema field list - "lens" is a field name for the approach-lens concept' },
    { re: /whole lens/i, note: 'brainstorming.md: "the whole lens" - approach-lens prose' },
    { re: /lens menu/i, note: 'reference/brainstorm.md: "Lens menu" heading for the approach-lens taxonomy (mvp-first/risk-first/...), not the agent' },
    { re: /stripping lens/i, note: 'reference/brainstorm.md: "stripping lens labels" during anonymized peer-ranking - approach-lens prose' },
    { re: /lens didn't surface|lens did not surface/i, note: 'reference/brainstorm.md: approach-lens prose' },
    { re: /\(id, name, lens\)/i, note: 'test/decision-first-output.test.js: approach-lens test-helper param, feeds whyLens - not the agent' },
  ],
  sweep: [
    { re: /large-scope sweep/i, note: 'commands/detective.md: "Large-scope sweep" means a broad investigative scan, not the Sweep agent' },
    { re: /running the sweep as/i, note: 'commands/detective.md: same broad-scan sense as above' },
  ],
  ward: [],
  hound: [],
  // No regex patterns needed: every apex occurrence left in the tree is the
  // literal .apex-active sentinel filename or a comment describing it, and
  // FILE_EXEMPT.apex covers all six files that reference it (confirmed by
  // a repo-wide `\bapex\b` grep - no other file matches).
  apex: [],
  // Same reasoning as apex: every blade occurrence left in the tree is the
  // literal .blade-editing sentinel filename or a comment describing it, and
  // FILE_EXEMPT.blade covers both files that reference it.
  blade: [],
  // No regex pattern needed: the one pravo occurrence left in the tree is the
  // real on-disk filename in a verbatim-quoted evidence sample, and
  // FILE_EXEMPT.pravo covers the single file that quotes it.
  pravo: [],
};

// Whole-file exemptions: every "sweep" occurrence in these files is the
// generic filesystem/session maintenance-pass sense (repo-dirs consolidation,
// stale-lock reclaim, per-repo archival sweep) - confirmed by inspection that
// none of them ever mention subagent_type, gorkhali:sweep, agents/sweep, or
// any other Sweep-agent call site. Doing this at file scope (rather than
// hunting down every individual "the sweep .../sweep's ..." phrasing) keeps
// the exception list honest instead of an ever-growing regex pile chasing
// one file's prose style.
export const FILE_EXEMPT = {
  sweep: [
    'scripts/migrate-repo-dirs.js',
    'scripts/migrate-data.js',
    'hooks/session-marker.js',
    'scripts/session-cleanup.js',
    'scripts/lib/atomic.js',
    'test/repo-dirs-migration.test.js',
  ],
  // Every "apex" occurrence in these files is the literal
  // .apex-active upgrade-shim sentinel filename (or a comment naming it) -
  // the pre-rename marker that not-yet-upgraded installs may still write.
  // Renaming the string would break the fallback comparison against real
  // files on disk, so it must stay spelled `apex` here specifically.
  apex: [
    'hooks/chief-subagent-driven-law.sh',
    'hooks/greploop-gate.js',
    'test/engineer-marker-mutex.test.js',
    'test/greploop-gate.test.js',
    // legacy pre-0.8.0 sentinel literals, upgrade shim
    'scripts/migrate-data.js',
    'test/migrate-data.test.js',
  ],
  // Every "blade" occurrence in these files is the literal .blade-editing
  // upgrade-shim sentinel filename (or a comment naming it), same reasoning
  // as apex above.
  blade: [
    // legacy pre-0.8.0 sentinel literals, upgrade shim
    'scripts/migrate-data.js',
    'test/migrate-data.test.js',
    // .blade-editing / .blade-editing.d dual-namespace read added for the
    // one-release editing-marker upgrade shim (mirrors greploop-gate.js's
    // .apex-active/.chief-active MARKER_NAMES pattern) - same legacy
    // sentinel reasoning as the two files above.
    'hooks/engineer-marker-state.js',
    'test/engineer-marker-mutex.test.js',
    // verbatim pre-0.8.0 telemetry samples quoted as evidence (timing-capture
    // spawn record, an agent-records/blade-*.json filename) - rewriting the
    // quoted `"agent":"blade"` field value or the real on-disk filename would
    // falsify the sample being cited, so this file is exempted rather than
    // patterned around line-by-line.
    'project-docs/seat-provenance-design.md',
  ],
  // Every "lens" occurrence in this file is the ideas[] approach-lens schema
  // field name (brainstorm contract v3: `{ id, title, summary, lens,
  // technique, ... }`, matching skills/gorkhali/references/brainstorming.md
  // and reference/brainstorm.md), not the Lens/Surveyor agent - confirmed by
  // inspection that decision-contracts.mjs never mentions subagent_type,
  // gorkhali:lens, or any other Lens-agent call site.
  lens: [
    'skills/gorkhali/scripts/lib/decision-contracts.mjs',
    // fixtures/tests that mirror the same ideas[].lens schema field
    'test/decision-first-output.test.js',
    'test/fixtures/decision-first/brainstorm-v3-rich.json',
    'test/portable-lifecycle.test.js',
    'test/state-interoperability.test.js',
  ],
  // The real on-disk filename `agent-records/blade-pravo.json` is quoted
  // verbatim in this one file as an observed evidence sample (section 1d) -
  // same reasoning as the blade entry immediately above, for the character
  // half of that same filename.
  pravo: ['project-docs/seat-provenance-design.md'],
};

// ---------------------------------------------------------------------------
// Case-preserving substitution.
// ---------------------------------------------------------------------------
export function caseTransform(matched, replacement) {
  if (/^[A-Z]+$/.test(matched)) return replacement.toUpperCase();
  if (/^[A-Z]/.test(matched) && /^[a-z]*$/.test(matched.slice(1))) {
    return replacement[0].toUpperCase() + replacement.slice(1).toLowerCase();
  }
  return replacement.toLowerCase();
}

// ---------------------------------------------------------------------------
// Per-line active-token resolution + content replacement.
// ---------------------------------------------------------------------------
function activeTokensForLine(line, relFile) {
  const active = new Set(Object.keys(TOKEN_MAP));
  for (const tok of AMBIGUOUS_TOKENS) {
    const exemptFiles = FILE_EXEMPT[tok];
    if (exemptFiles && relFile && exemptFiles.includes(relFile)) {
      active.delete(tok);
      continue;
    }
    const patterns = EXCEPTIONS[tok] || [];
    if (patterns.some((e) => e.re.test(line))) active.delete(tok);
  }
  return active;
}

function applySpecialPhrases(text) {
  let out = text;
  for (const sp of SPECIAL_PHRASES) {
    out = out.replace(sp.re, (_m, ...groups) => sp.replace(...groups.slice(0, -2)));
  }
  return out;
}

/** Replace one line's content. Returns { text, count }. `relFile` is the
 *  repo-relative path (posix separators), used only for FILE_EXEMPT lookups -
 *  pass '' when it doesn't apply (e.g. isolated fixture strings). */
export function replaceLine(line, relFile = '') {
  const afterPhrases = applySpecialPhrases(line);
  const active = activeTokensForLine(afterPhrases, relFile);
  if (active.size === 0) return { text: afterPhrases, count: 0 };
  const tokens = [...active].sort((a, b) => b.length - a.length);
  const re = new RegExp(`\\b(${tokens.join('|')})\\b`, 'gi');
  let count = 0;
  const text = afterPhrases.replace(re, (m) => {
    count += 1;
    return caseTransform(m, TOKEN_MAP[m.toLowerCase()]);
  });
  return { text, count };
}

/** Replace a whole file's content, line by line (preserves line endings). */
export function replaceContent(content, relFile = '') {
  const lines = content.split('\n');
  let total = 0;
  const out = lines.map((line) => {
    const { text, count } = replaceLine(line, relFile);
    total += count;
    return text;
  });
  return { text: out.join('\n'), count: total };
}

// ---------------------------------------------------------------------------
// Basename (file/dir) rename derivation.
// ---------------------------------------------------------------------------
const TOKEN_KEYS_BY_LEN = Object.keys(TOKEN_MAP).sort((a, b) => b.length - a.length);
const BASENAME_RE = new RegExp(`\\b(${TOKEN_KEYS_BY_LEN.join('|')})\\b`, 'i');
const BASENAME_RE_G = new RegExp(`\\b(${TOKEN_KEYS_BY_LEN.join('|')})\\b`, 'gi');

export function basenameMatches(name) {
  return BASENAME_RE.test(name);
}

export function renameBasename(name) {
  return name.replace(BASENAME_RE_G, (m) => caseTransform(m, TOKEN_MAP[m.toLowerCase()]));
}

// ---------------------------------------------------------------------------
// Repo walk.
// ---------------------------------------------------------------------------
const EXCLUDED_DIRS = new Set(['.git', 'node_modules']);
// Extensionless root dotfiles (.gitignore among them) never match SCAN_EXTS
// and aren't under bin/, so they're outside scannedFiles entirely - see the
// `blade` note on AMBIGUOUS_TOKENS above for why .gitignore's legacy
// `.blade-editing` sentinel line needs no FILE_EXEMPT entry here.
const SCAN_EXTS = new Set(['.md', '.js', '.mjs', '.cjs', '.json', '.sh']);
const EXCLUDED_FILES = new Set(['CHANGELOG.md']);

// This tool's own source and its fixture tests carry the 75 old-token
// strings as DATA - TOKEN_MAP keys, EXCEPTIONS regex literals, and paired
// before/after assertion strings - not repo prose that names an agent.
// Content-scanning them would rewrite the map's own keys (`apex: 'chief'`
// -> `chief: 'chief'`) and corrupt fixture assertions that must keep both
// sides of a rename spelled out. Excluded from scannedFiles only; neither
// basename matches a token, so this has no effect on rename planning.
const EXCLUDED_PATHS = new Set([
  'scripts/migrations/rename-roster.mjs',
  'test/rename-roster.test.js',
]);

function toPosix(p) {
  return p.split(path.sep).join('/');
}

/** Walk `root`, returning every file and directory (repo-relative, posix,
 *  excluding .git/node_modules) as { files: [...], dirs: [...] }, plus
 *  `scannedFiles`: the subset of files whose content this tool reads/writes
 *  (the SCAN_EXTS set, plus extensionless files under bin/, minus
 *  EXCLUDED_FILES). */
export function walkRepo(root) {
  const files = [];
  const dirs = [];

  function recurse(relDir) {
    const abs = path.join(root, relDir);
    let entries;
    try {
      entries = fs.readdirSync(abs, { withFileTypes: true });
    } catch (_) {
      return;
    }
    for (const e of entries) {
      if (EXCLUDED_DIRS.has(e.name)) continue;
      const rel = relDir ? `${relDir}/${e.name}` : e.name;
      if (e.isDirectory()) {
        dirs.push(rel);
        recurse(rel);
      } else if (e.isFile()) {
        files.push(rel);
      }
    }
  }
  recurse('');

  const scannedFiles = files.filter((rel) => {
    const base = path.basename(rel);
    if (EXCLUDED_FILES.has(base)) return false;
    if (EXCLUDED_PATHS.has(rel)) return false;
    const ext = path.extname(rel);
    if (SCAN_EXTS.has(ext)) return true;
    if (rel === 'bin' || rel.startsWith('bin/')) return ext === '';
    return false;
  });

  return {
    files: files.map(toPosix),
    dirs: dirs.map(toPosix),
    scannedFiles: scannedFiles.map(toPosix),
  };
}

// ---------------------------------------------------------------------------
// Rename planning - basename-level, computed against the CURRENT (pre-apply)
// tree. Files first, then directories deepest-first, so applying renames in
// list order never invalidates a not-yet-processed path (a shallower
// directory rename would otherwise change the path of a deeper entry still
// waiting its turn).
// ---------------------------------------------------------------------------
export function planRenames(root) {
  const { files, dirs } = walkRepo(root);
  const planFor = (relPaths) => relPaths
    .filter((rel) => basenameMatches(path.basename(rel)))
    .map((rel) => {
      const dir = path.posix.dirname(rel);
      const newBase = renameBasename(path.basename(rel));
      const newRel = dir === '.' ? newBase : `${dir}/${newBase}`;
      return { oldRel: rel, newRel };
    });

  const fileRenames = planFor(files).map((r) => ({ ...r, type: 'file' }));
  const dirRenames = planFor(dirs)
    .map((r) => ({ ...r, type: 'dir', depth: r.oldRel.split('/').length }))
    .sort((a, b) => b.depth - a.depth)
    .map(({ depth, ...rest }) => rest);

  return [...fileRenames, ...dirRenames];
}

// ---------------------------------------------------------------------------
// Census (dry-run).
// ---------------------------------------------------------------------------
export function census(root) {
  const { scannedFiles } = walkRepo(root);
  const perFile = [];
  let filesWithMatches = 0;
  let totalReplacements = 0;

  for (const rel of scannedFiles) {
    const abs = path.join(root, ...rel.split('/'));
    let content;
    try {
      content = fs.readFileSync(abs, 'utf8');
    } catch (_) {
      continue;
    }
    const { count } = replaceContent(content, rel);
    if (count > 0) {
      filesWithMatches += 1;
      totalReplacements += count;
      perFile.push({ file: rel, replacements: count });
    }
  }

  const renames = planRenames(root);

  return {
    filesScanned: scannedFiles.length,
    filesWithMatches,
    totalReplacements,
    perFile: perFile.sort((a, b) => b.replacements - a.replacements),
    renames,
  };
}

/** --census --ambiguous: every matching line for the four ambiguous tokens,
 *  ignoring EXCEPTIONS/FILE_EXEMPT (this is the curation aid that EXCEPTIONS
 *  itself was built from - it must show the raw hits, not the post-exception
 *  view, or a real miss could never be found). */
export function ambiguousCensus(root) {
  const { scannedFiles } = walkRepo(root);
  const re = new RegExp(`\\b(${AMBIGUOUS_TOKENS.join('|')})\\b`, 'i');
  const hits = [];
  for (const rel of scannedFiles) {
    const abs = path.join(root, ...rel.split('/'));
    let content;
    try {
      content = fs.readFileSync(abs, 'utf8');
    } catch (_) {
      continue;
    }
    content.split('\n').forEach((line, i) => {
      if (re.test(line)) hits.push(`${rel}:${i + 1}:${line}`);
    });
  }
  return hits;
}

// ---------------------------------------------------------------------------
// Apply.
// ---------------------------------------------------------------------------
function moveEntry(root, oldRel, newRel) {
  const oldAbs = path.join(root, ...oldRel.split('/'));
  const newAbs = path.join(root, ...newRel.split('/'));
  fs.mkdirSync(path.dirname(newAbs), { recursive: true });
  let usedGit = false;
  if (fs.existsSync(path.join(root, '.git'))) {
    try {
      execSync(`git mv -- ${JSON.stringify(oldRel)} ${JSON.stringify(newRel)}`, {
        cwd: root,
        stdio: 'pipe',
        shell: true,
      });
      usedGit = true;
    } catch (_) {
      // not tracked, or git unavailable in this environment - fall through
    }
  }
  if (!usedGit) {
    // Defense in depth: apply() below already preflights every destination
    // before any mutation begins, but this fallback path is exactly the one
    // that can silently overwrite - `git mv` refuses a colliding destination
    // outright, we catch that failure and fall through to a raw fs.rename,
    // which on POSIX overwrites the destination without complaint. Re-check
    // here too and fail closed rather than clobber whatever now occupies
    // newAbs.
    if (fs.existsSync(newAbs)) {
      throw new Error(`rename destination already exists, refusing to overwrite: ${newRel}`);
    }
    fs.renameSync(oldAbs, newAbs);
  }
}

export function apply(root) {
  // PREFLIGHT - before any mutation. Renames are planned against the
  // PRE-rename tree (files first, then directories deepest-first, per
  // planRenames' own ordering guarantee) and that exact plan is reused
  // below for both the collision check and the actual moves - never
  // recomputed after content edits or partial renames, so this check and
  // what actually executes can never drift apart. If any planned
  // destination already exists on disk right now, abort with the full
  // collision list and make ZERO changes (no content rewrites, no renames) -
  // this is what stops the moveEntry fallback (git mv fails on a colliding
  // destination, falls through to fs.renameSync, which overwrites silently)
  // from ever running against a tree we haven't verified is collision-free.
  const renames = planRenames(root);
  const collisions = renames.filter(
    ({ newRel }) => fs.existsSync(path.join(root, ...newRel.split('/'))),
  );
  if (collisions.length > 0) {
    const list = collisions.map(({ oldRel, newRel }) => `${oldRel} -> ${newRel}`).join('\n  ');
    throw new Error(
      `rename collision: ${collisions.length} planned destination(s) already exist on disk; ` +
      `aborting before making any changes:\n  ${list}`,
    );
  }

  const { scannedFiles } = walkRepo(root);
  let filesChanged = 0;
  let totalReplacements = 0;

  for (const rel of scannedFiles) {
    const abs = path.join(root, ...rel.split('/'));
    let content;
    try {
      content = fs.readFileSync(abs, 'utf8');
    } catch (_) {
      continue;
    }
    const { text, count } = replaceContent(content, rel);
    if (count > 0) {
      fs.writeFileSync(abs, text);
      filesChanged += 1;
      totalReplacements += count;
    }
  }

  // Execute the SAME plan the preflight above already verified is
  // collision-free - files, then directories deepest-first, so a shallower
  // directory move can never invalidate a still-pending deeper path.
  for (const { oldRel, newRel } of renames) {
    moveEntry(root, oldRel, newRel);
  }

  return { filesChanged, totalReplacements, renames };
}

// ---------------------------------------------------------------------------
// Lint (post-apply sweep).
// ---------------------------------------------------------------------------
const ARTICLE_ERRORS = [
  'a engineer', 'a inspector', 'a auditor', 'a opposition', 'a advisor',
  'an chief', 'an clerk', 'an detective', 'an justice', 'an steward', 'an surveyor',
];

const SUSPICIOUS_NEIGHBORS = ['approach', 'generating', 'council', 'enum', 'whylens'];

function surveyorMisfires(line) {
  const words = line.split(/\s+/).map((w) => w.toLowerCase().replace(/[^a-z']/g, ''));
  const hits = [];
  words.forEach((w, i) => {
    if (w !== 'surveyor') return;
    for (let j = Math.max(0, i - 3); j <= Math.min(words.length - 1, i + 3); j++) {
      if (j === i) continue;
      if (SUSPICIOUS_NEIGHBORS.includes(words[j])) {
        hits.push(words[j]);
      }
    }
  });
  return hits;
}

export function lint(root) {
  const { scannedFiles } = walkRepo(root);
  const leftovers = [];
  const articleErrors = [];
  const suspicious = [];

  for (const rel of scannedFiles) {
    if (path.basename(rel) === 'CHANGELOG.md') continue;
    const abs = path.join(root, ...rel.split('/'));
    let content;
    try {
      content = fs.readFileSync(abs, 'utf8');
    } catch (_) {
      continue;
    }
    content.split('\n').forEach((line, i) => {
      // Same active-token resolution apply/replaceLine uses: a documented
      // EXCEPTIONS/FILE_EXEMPT entry means this line's ambiguous token is
      // intentionally left alone (plain English, or - for apex - a literal
      // legacy sentinel other installs still write), not a missed rename.
      // Non-ambiguous tokens are never exempt, so a real miss still fires.
      const active = activeTokensForLine(line, rel);
      if (active.size) {
        const activeRe = new RegExp(`\\b(${[...active].join('|')})\\b`, 'i');
        if (activeRe.test(line)) leftovers.push(`${rel}:${i + 1}:${line}`);
      }
      const articleNormalized = line.toLowerCase().replace(/[`'"]/g, '');
      for (const phrase of ARTICLE_ERRORS) {
        if (articleNormalized.includes(phrase)) {
          articleErrors.push(`${rel}:${i + 1}:${line}`);
          break;
        }
      }
      const misfires = surveyorMisfires(line);
      if (misfires.length) {
        suspicious.push(`${rel}:${i + 1}: surveyor near [${misfires.join(', ')}]: ${line}`);
      }
    });
  }

  return { leftovers, articleErrors, suspicious };
}

// ---------------------------------------------------------------------------
// CLI.
// ---------------------------------------------------------------------------
function main(argv) {
  const root = REPO_ROOT;

  if (argv.includes('--census')) {
    if (argv.includes('--ambiguous')) {
      const hits = ambiguousCensus(root);
      for (const h of hits) console.log(h);
      console.log(`\n${hits.length} ambiguous-token lines (lens/sweep/ward/hound), raw (pre-exception).`);
      process.exit(0);
    }
    const report = census(root);
    console.log(`Files scanned: ${report.filesScanned}`);
    console.log(`Files with replacements: ${report.filesWithMatches}`);
    console.log(`Total replacements: ${report.totalReplacements}`);
    console.log(`Planned renames: ${report.renames.length}`);
    for (const r of report.renames) console.log(`  ${r.type}: ${r.oldRel} -> ${r.newRel}`);
    process.exit(0);
  }

  if (argv.includes('--apply')) {
    const report = apply(root);
    console.log(`Files changed: ${report.filesChanged}`);
    console.log(`Total replacements: ${report.totalReplacements}`);
    console.log(`Renames applied: ${report.renames.length}`);
    for (const r of report.renames) console.log(`  ${r.type}: ${r.oldRel} -> ${r.newRel}`);
    process.exit(0);
  }

  if (argv.includes('--lint')) {
    const report = lint(root);
    console.log(`Leftover old-token hits: ${report.leftovers.length}`);
    report.leftovers.forEach((l) => console.log(`  LEFTOVER ${l}`));
    console.log(`Article errors: ${report.articleErrors.length}`);
    report.articleErrors.forEach((l) => console.log(`  ARTICLE ${l}`));
    console.log(`Suspicious surveyor placements: ${report.suspicious.length}`);
    report.suspicious.forEach((l) => console.log(`  SUSPICIOUS ${l}`));
    const dirty = report.leftovers.length || report.articleErrors.length || report.suspicious.length;
    process.exit(dirty ? 1 : 0);
  }

  console.error('usage: rename-roster.mjs (--census [--ambiguous] | --apply | --lint)');
  process.exit(2);
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === __filename;
if (isMain) {
  main(process.argv.slice(2));
}
