#!/usr/bin/env node
// Author: Subash Karki
// migrate-repo-dirs.js — idempotent, non-destructive consolidation of
// branch-named orphan repo dirs under <data>/repos/* (and legacy
// ~/.claude/phantom/repos/*) into their CANONICAL repo dir.
//
// WHY this exists: before the T1 detection fix, detectRepo() returned the
// BRANCH name for user worktrees at ~/.phantom-os/worktrees/{repo}/{branch},
// so session/learnings state was written under dozens of branch-named dirs
// (cp-43042-…, feature-…-branch) instead of the real repo. T1 now resolves the
// canonical name via `git remote get-url origin`; this script sweeps the old
// fragments into the canonical dirs so detection and data agree in ONE version.
//
// Resolver signal order (empirically validated against the real 34 orphans):
//   (e) --map override          orphanName=repoName (highest precedence)
//   (a) PR URL in artifacts      github.com/<org>/<repo>/pull/<n> -> <repo>
//   (b) _meta.gitHead            `git -C <candidate> cat-file -e <sha>` hit
//   (c) costs.json session_id    -> ~/.claude/projects/<encoded-cwd>/<id>.jsonl
//                                   -> encoded-cwd matches a candidate -> canonical
//   (d) _meta.gitBranch          branch exists in a candidate repo
// Empty dirs (0 files) -> pruned (rmdir). Unresolvable -> left in place + reported.
//
// Merge is APPEND-ONLY and byte-preserving (per [user-config-merge]):
//   * learnings/*.md   -> concatenated with a source-attribution header + per-line
//                         dedup (identical lines never duplicated).
//   * every other file -> copied whole; on collision the existing file is kept and
//                         the incoming copy is written beside it as <name>.migrated.
//   * whole subtree children under sessions/ (and peer dirs) whose dest already
//     exists are moved to <child>-migrated so nothing is overwritten.
// Sources are NEVER deleted: after a dir is processed it is renamed
// <name>.migrated-away (originals preserved for audit + rollback).
//
// Modes:
//   (default)   DRY-RUN — computes the full plan, writes a report, mutates nothing.
//   --apply     execute the plan + write the idempotent .repo-dirs-migrated marker.
//   --force     ignore the marker and re-run (picks up newly-appeared orphans).
//   --map a=b   pin orphan dir `a` to repo `b` (repeatable).
//
// Env overrides (testing):
//   PHANTOM_DATA                 destination/source root (via phantom-paths)
//   PHANTOM_MIGRATE_LEGACY_ROOT  legacy repos root (default ~/.claude/phantom/repos)
//   PHANTOM_MIGRATE_CANDIDATE_DIRS  ':'-sep parents holding repo checkouts
//                                   (default ~/CZ:~/.phantom-os/worktrees)
//   PHANTOM_PROJECTS_DIR         Claude transcript root (default ~/.claude/projects)

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execSync } = require('child_process');
const { phantomData, detectRepo, repoDir, auditDir } = require('./lib/phantom-paths');
const { collectSessionIds } = require('./lib/session-trace');

const MARKER_NAME = '.repo-dirs-migrated';
const LOCK_NAME = '.repo-dirs-migrating';
const LOCK_STALE_MS = 10 * 60 * 1000; // a lock older than this is from a crashed run
const MIGRATED_SUFFIX = '.migrated-away';
const TEXT_SCAN_EXT = new Set(['.json', '.md', '.txt', '.log']);
const MAX_SCAN_BYTES = 512 * 1024;
const PR_RE = /github\.com[/:][^/\s"')]+\/([^/\s"')]+)\/pull\/\d+/i;

// ---------------------------------------------------------------------------
// small git helper — guards the RUN, not just the precondition (per [guards]).
// ---------------------------------------------------------------------------
function git(cwd, argStr) {
  try {
    const out = execSync('git ' + argStr, {
      cwd,
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 2000,
      encoding: 'utf8',
    });
    return out.trim() || null;
  } catch (_) {
    return null;
  }
}

/** Exit-code test: true iff the git command runs and exits 0. Distinct from
 *  git() because `cat-file -e` / `rev-parse --verify` succeed with EMPTY stdout —
 *  presence of the object is in the exit code, not the output. */
function gitOk(cwd, argStr) {
  try {
    execSync('git ' + argStr, { cwd, stdio: 'ignore', timeout: 2000 });
    return true;
  } catch (_) {
    return false;
  }
}

/** Claude flattens a cwd into a projects/ dir name by replacing every `/` and
 *  `.` with `-`. Reproduce it so we can match transcript dirs to candidate cwds. */
function encodeCwd(p) {
  return p.replace(/[/.]/g, '-');
}

function isDir(p) {
  try { return fs.statSync(p).isDirectory(); } catch (_) { return false; }
}

function countFiles(dir) {
  let n = 0;
  const stack = [dir];
  while (stack.length) {
    const d = stack.pop();
    let entries;
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch (_) { continue; }
    for (const e of entries) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) stack.push(full);
      else if (e.isFile()) n++;
    }
  }
  return n;
}

function walkFiles(dir) {
  const out = [];
  const stack = [dir];
  while (stack.length) {
    const d = stack.pop();
    let entries;
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch (_) { continue; }
    for (const e of entries) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) stack.push(full);
      else if (e.isFile()) out.push(full);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Candidate repo discovery. A candidate is a real checkout whose CANONICAL name
// (via T1 detectRepo) may differ from its directory basename — that mismatch is
// exactly the fragmentation we resolve (e.g. worktrees/research-phantom-skills
// whose git remote canonical name is research-team-skills).
// ---------------------------------------------------------------------------
function candidateParents() {
  const raw = process.env.PHANTOM_MIGRATE_CANDIDATE_DIRS;
  if (raw && raw.trim()) return raw.split(':').filter(Boolean);
  const home = os.homedir();
  return [path.join(home, 'CZ'), path.join(home, '.phantom-os', 'worktrees')];
}

/** Pick a git checkout to represent a parent-of-worktrees dir (its children are
 *  the per-branch worktrees). Returns the first child that is a git worktree. */
function firstGitChild(dir) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return null; }
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const child = path.join(dir, e.name);
    if (fs.existsSync(path.join(child, '.git'))) return child;
  }
  return null;
}

let CANDIDATE_CACHE = null;
function candidates() {
  if (CANDIDATE_CACHE) return CANDIDATE_CACHE;
  const list = [];
  const seen = new Set();
  for (const parent of candidateParents()) {
    let entries;
    try { entries = fs.readdirSync(parent, { withFileTypes: true }); } catch (_) { continue; }
    for (const e of entries) {
      if (!e.isDirectory() || e.name.startsWith('.')) continue;
      const dirPath = path.join(parent, e.name);
      // A candidate MUST be a git checkout (self or a parent-of-worktrees). This
      // filters non-repo noise dirs (scripts/, tests/, dotdirs) that would
      // otherwise pollute matching with bogus canonical names.
      const selfGit = fs.existsSync(path.join(dirPath, '.git'));
      const gitPath = selfGit ? dirPath : firstGitChild(dirPath);
      if (!gitPath) continue;
      const canonical = detectRepo(gitPath);
      if (!canonical || canonical === '_default' || canonical.startsWith('.')) continue;
      const matchKeys = new Set([e.name, canonical]);
      if (seen.has(gitPath)) continue;
      seen.add(gitPath);
      list.push({ parentBasename: e.name, canonical, catPath: gitPath, matchKeys });
    }
  }
  CANDIDATE_CACHE = list;
  return list;
}

/** Canonical repo names known to exist locally — dirs already at one of these
 *  names are real repos and are never migrated (protects them from a stray PR
 *  URL in one of their sessions pointing at a different repo). */
let KNOWN_CANONICAL = null;
function knownCanonical() {
  if (!KNOWN_CANONICAL) KNOWN_CANONICAL = new Set(candidates().map((c) => c.canonical));
  return KNOWN_CANONICAL;
}

// ---------------------------------------------------------------------------
// Signal extractors — each scoped to one orphan source dir.
// ---------------------------------------------------------------------------
// PR URLs are only trusted from a session's OWN artifacts (sessions/**/*.json,
// e.g. wrap.json/close.json trace fields). Scanning learnings prose misfires —
// a learnings note routinely cites ANOTHER repo's PR (that produced the
// phantom-os->phantom and phantom->research-phantom-skills false hits).
function scanForPrRepo(files) {
  for (const f of files) {
    if (path.extname(f) !== '.json') continue;
    if (!f.split(path.sep).includes('sessions')) continue;
    let content;
    try {
      if (fs.statSync(f).size > MAX_SCAN_BYTES) continue;
      content = fs.readFileSync(f, 'utf8');
    } catch (_) { continue; }
    const m = content.match(PR_RE);
    if (m && m[1]) return { repo: m[1], via: f };
  }
  return null;
}

function collectMeta(files) {
  const heads = new Set();
  const branches = new Set();
  for (const f of files) {
    if (path.extname(f) !== '.json') continue;
    let obj;
    try {
      if (fs.statSync(f).size > MAX_SCAN_BYTES) continue;
      obj = JSON.parse(fs.readFileSync(f, 'utf8'));
    } catch (_) { continue; }
    const meta = obj && obj._meta ? obj._meta : obj;
    if (meta && typeof meta === 'object') {
      if (meta.gitHead) heads.add(String(meta.gitHead).trim());
      if (meta.gitBranch) branches.add(String(meta.gitBranch).trim());
    }
  }
  return { heads: [...heads], branches: [...branches] };
}

// session_id lives at costs.json `entries[].session_id` — collectSessionIds
// (scripts/lib/session-trace.js, shared with the brain backfill) recurses for it.

// Git signals must be UNAMBIGUOUS. A 7-char abbreviated gitHead can exist in
// several repos, and a branch name can too — accept only when the matching
// candidates all map to ONE canonical repo; otherwise reject to a report entry
// rather than guess (guessing produced phantom-terminal->Auth0).
function canonicalsMatching(test) {
  const set = new Set();
  for (const cand of candidates()) if (test(cand)) set.add(cand.canonical);
  return set;
}

function resolveByGitHead(heads) {
  for (const sha of heads) {
    if (!sha) continue;
    const set = canonicalsMatching((c) => gitOk(c.catPath, `cat-file -e ${sha}^{commit}`));
    if (set.size === 1) return { repo: [...set][0], via: `gitHead ${sha}` };
  }
  return null;
}

// Generic branch names exist in nearly every repo — useless for attribution.
const GENERIC_BRANCHES = new Set(['main', 'master', 'develop', 'dev', 'HEAD', 'staging', 'production', 'release']);

function resolveByGitBranch(branches) {
  for (const br of branches) {
    if (!br || GENERIC_BRANCHES.has(br)) continue;
    const set = canonicalsMatching((c) =>
      gitOk(c.catPath, `rev-parse --verify --quiet refs/heads/${br}`) ||
      gitOk(c.catPath, `rev-parse --verify --quiet refs/remotes/origin/${br}`));
    if (set.size === 1) return { repo: [...set][0], via: `gitBranch ${br}` };
  }
  return null;
}

function resolveBySession(ids, projectsDir) {
  let projDirs;
  try { projDirs = fs.readdirSync(projectsDir); } catch (_) { return null; }
  for (const sid of ids) {
    const owner = projDirs.find((d) => {
      try { return fs.existsSync(path.join(projectsDir, d, sid + '.jsonl')); }
      catch (_) { return false; }
    });
    if (!owner) continue;
    // Longest matchKey embedded as a path segment wins (feature-ai-… beats feature-…).
    let best = null;
    for (const cand of candidates()) {
      for (const key of cand.matchKeys) {
        if (owner.includes('-' + encodeCwd(key) + '-') || owner.endsWith('-' + encodeCwd(key))) {
          if (!best || key.length > best.keyLen) {
            best = { repo: cand.canonical, keyLen: key.length, via: `session ${sid} -> ${owner}` };
          }
        }
      }
    }
    if (best) return { repo: best.repo, via: best.via };
  }
  return null;
}

/** Full resolver chain for one orphan. Returns {repo, signal, via} or null. */
function resolveTarget(srcDir, srcName, files, mapOverrides, projectsDir) {
  if (mapOverrides[srcName]) {
    return { repo: mapOverrides[srcName], signal: 'map', via: '--map override' };
  }
  const pr = scanForPrRepo(files);
  if (pr) return { repo: pr.repo, signal: 'pr', via: pr.via };

  const { heads, branches } = collectMeta(files);
  if (heads.length) {
    const h = resolveByGitHead(heads);
    if (h) return { repo: h.repo, signal: 'gitHead', via: h.via };
  }
  const ids = collectSessionIds(files);
  if (ids.length) {
    const s = resolveBySession(ids, projectsDir);
    if (s) return { repo: s.repo, signal: 'session', via: s.via };
  }
  if (branches.length) {
    const b = resolveByGitBranch(branches);
    if (b) return { repo: b.repo, signal: 'gitBranch', via: b.via };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Merge primitives (only mutate when apply === true).
// ---------------------------------------------------------------------------
function copyFile(src, dest, apply) {
  if (!apply) return;
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const st = fs.statSync(src);
  fs.copyFileSync(src, dest);
  try { fs.utimesSync(dest, st.atime, st.mtime); } catch (_) { /* best effort */ }
}

/** Append source .md lines missing from dest, once-prefixed with attribution. */
function mergeLearningFile(src, dest, srcLabel, apply, stats) {
  let srcText;
  try { srcText = fs.readFileSync(src, 'utf8'); } catch (_) { return; }
  if (!fs.existsSync(dest)) {
    copyFile(src, dest, apply);
    stats.merged++;
    return;
  }
  const destText = (() => { try { return fs.readFileSync(dest, 'utf8'); } catch (_) { return ''; } })();
  const destLines = new Set(destText.split('\n'));
  const additions = srcText.split('\n').filter((l) => l.trim() && !destLines.has(l));
  stats.merged++;
  if (!additions.length) { stats.deduped++; return; }
  if (apply) {
    const header = `\n\n<!-- merged from ${srcLabel} (append-only, ${additions.length} new lines) -->\n`;
    fs.appendFileSync(dest, header + additions.join('\n') + '\n');
  }
}

function uniqueDest(dest) {
  if (!fs.existsSync(dest)) return dest;
  let alt = dest + '-migrated';
  let i = 2;
  while (fs.existsSync(alt)) { alt = dest + '-migrated-' + i++; }
  return alt;
}

/** Merge one orphan `srcDir` into `<data>/repos/<target>`. */
function mergeOrphan(srcDir, srcName, target, apply, report) {
  const destRoot = repoDir(target);
  const stats = { merged: 0, deduped: 0, copied: 0, collisions: [], movedChildren: [] };

  let topEntries;
  try { topEntries = fs.readdirSync(srcDir, { withFileTypes: true }); } catch (_) { topEntries = []; }

  for (const entry of topEntries) {
    const srcEntry = path.join(srcDir, entry.name);

    if (entry.isFile()) {
      // Top-level file: keep existing on collision, park incoming as <name>.migrated.
      const dest = path.join(destRoot, entry.name);
      if (fs.existsSync(dest)) {
        const parked = uniqueDest(dest + '.migrated');
        stats.collisions.push({ file: entry.name, kept: dest, parked });
        copyFile(srcEntry, parked, apply);
      } else {
        copyFile(srcEntry, dest, apply);
        stats.copied++;
      }
      continue;
    }
    if (!entry.isDirectory()) continue;

    if (entry.name === 'learnings') {
      // File-by-file append-merge for .md (INDEX + domain files), copy the rest.
      for (const f of walkFiles(srcEntry)) {
        const rel = path.relative(srcEntry, f);
        const dest = path.join(destRoot, 'learnings', rel);
        if (path.extname(f) === '.md') {
          mergeLearningFile(f, dest, srcName, apply, stats);
        } else if (fs.existsSync(dest)) {
          const parked = uniqueDest(dest + '.migrated');
          stats.collisions.push({ file: 'learnings/' + rel, kept: dest, parked });
          copyFile(f, parked, apply);
        } else {
          copyFile(f, dest, apply);
          stats.copied++;
        }
      }
      continue;
    }

    // Peer dirs (sessions, completed, decisions, reviews, state, research, …):
    // move whole immediate children; collision -> <child>-migrated (never overwrite).
    let children;
    try { children = fs.readdirSync(srcEntry, { withFileTypes: true }); } catch (_) { children = []; }
    for (const child of children) {
      const srcChild = path.join(srcEntry, child.name);
      const childDest = path.join(destRoot, entry.name, child.name);
      const destChild = uniqueDest(childDest);
      if (destChild !== childDest) {
        stats.movedChildren.push({ from: path.join(entry.name, child.name), to: path.relative(destRoot, destChild) });
      }
      if (child.isFile()) {
        copyFile(srcChild, destChild, apply);
        stats.copied++;
      } else if (child.isDirectory()) {
        for (const f of walkFiles(srcChild)) {
          const rel = path.relative(srcChild, f);
          copyFile(f, path.join(destChild, rel), apply);
          stats.copied++;
        }
      }
    }
  }

  // Never delete the source: rename it aside so originals survive for audit.
  if (apply) {
    try { fs.renameSync(srcDir, uniqueDest(srcDir + MIGRATED_SUFFIX)); } catch (_) { /* leave in place */ }
  }

  report.resolved.push({
    src: srcName, srcDir, target, destRoot,
    merged: stats.merged, deduped: stats.deduped, copied: stats.copied,
    collisions: stats.collisions, movedChildren: stats.movedChildren,
  });
}

// ---------------------------------------------------------------------------
// Sweep one root (`<data>/repos` or the legacy repos root).
// ---------------------------------------------------------------------------
function sweepRoot(root, opts, report) {
  const { apply, dataReposRoot, mapOverrides, projectsDir } = opts;
  let entries;
  try { entries = fs.readdirSync(root, { withFileTypes: true }); } catch (_) { return; }

  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const name = e.name;
    if (name.endsWith(MIGRATED_SUFFIX) || name.startsWith('.')) continue;
    // Reserved buckets (_default etc.) aggregate unrelated sessions — attributing
    // them to any single repo is unsound, so never migrate them.
    if (name.startsWith('_')) { report.reserved.push({ src: name, root, reason: 'reserved bucket' }); continue; }
    const srcDir = path.join(root, name);
    const isDataRoot = path.resolve(root) === path.resolve(dataReposRoot);

    if (countFiles(srcDir) === 0) {
      report.pruned.push({ src: name, root });
      if (apply) { try { fs.rmSync(srcDir, { recursive: true, force: true }); } catch (_) {} }
      continue;
    }

    // A dir already named for a known-real repo IS that repo — trust the name
    // over any stray PR URL in its sessions. In the data root that means it is
    // already canonical (leave it); in the legacy root it means move it whole
    // into <data>/repos/<name>.
    if (knownCanonical().has(name)) {
      if (isDataRoot) { report.canonical.push({ src: name, signal: 'known-repo' }); continue; }
      mergeOrphan(srcDir, name, name, apply, report);
      const rec = report.resolved[report.resolved.length - 1];
      rec.signal = 'legacy-canonical'; rec.root = root;
      continue;
    }

    const files = walkFiles(srcDir);
    const res = resolveTarget(srcDir, name, files, mapOverrides, projectsDir);

    if (!res || !res.repo || res.repo.startsWith('.') || res.repo === name) {
      if (res && res.repo === name) { report.canonical.push({ src: name, signal: res.signal }); continue; }
      report.unresolved.push({ src: name, root, files: files.length, reason: res ? `rejected implausible target '${res.repo}'` : 'no PR/gitHead/session/gitBranch signal matched a candidate repo' });
      continue;
    }

    mergeOrphan(srcDir, name, res.repo, apply, report);
    report.resolved[report.resolved.length - 1].signal = res.signal;
    report.resolved[report.resolved.length - 1].via = res.via;
    report.resolved[report.resolved.length - 1].root = root;
  }
}

// ---------------------------------------------------------------------------
// Entry point.
// ---------------------------------------------------------------------------
function parseArgs(argv) {
  const apply = argv.includes('--apply');
  const force = argv.includes('--force');
  const mapOverrides = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--map' && argv[i + 1]) {
      const [k, v] = argv[i + 1].split('=');
      if (k && v) mapOverrides[k] = v;
    } else if (argv[i].startsWith('--map=')) {
      const [k, v] = argv[i].slice('--map='.length).split('=');
      if (k && v) mapOverrides[k] = v;
    }
  }
  return { apply, force, mapOverrides };
}

/**
 * Exclusive claim on a mutating (--apply) run. session-marker.js spawns `--apply`
 * detached on every prompt until the marker exists, so concurrent runs could
 * otherwise double-append learnings lines. Returns:
 *   number     -> fd we own; caller MUST close + unlink in a finally.
 *   null       -> another live run holds it -> skip.
 *   undefined  -> lock unusable (non-EEXIST error); proceed best-effort, never
 *                 crash the detached hook path (per [guards]).
 * A lock older than LOCK_STALE_MS is treated as a crashed run and reclaimed.
 */
function acquireMigrationLock(lockPath) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const fd = fs.openSync(lockPath, 'wx');
      try { fs.writeSync(fd, JSON.stringify({ pid: process.pid, at: new Date().toISOString() })); } catch (_) {}
      return fd;
    } catch (e) {
      if (e.code !== 'EEXIST') return undefined; // unwritable path etc. — do not crash
      let stale = false;
      try { stale = (Date.now() - fs.statSync(lockPath).mtimeMs) > LOCK_STALE_MS; }
      catch (_) { stale = true; } // lock vanished mid-check — retry the claim
      if (!stale) return null; // held by a live run
      try { fs.unlinkSync(lockPath); } catch (_) {} // reclaim crashed lock, then retry
    }
  }
  return null;
}

function run(argv = process.argv.slice(2)) {
  // The migrator resolves canonical names for MANY candidate repos, not "the
  // current one" — honoring a per-spawn PHANTOM_REPO override here would
  // collapse every candidate onto one name and silently cross-merge orphans
  // (session-marker.js spawns this inheriting process.env, so a stray
  // override reaches production). Testing env overrides (PHANTOM_MIGRATE_*)
  // are unaffected.
  delete process.env.PHANTOM_REPO;
  const { apply, force, mapOverrides } = parseArgs(argv);
  const DATA = phantomData();
  const dataReposRoot = path.join(DATA, 'repos');
  const legacyRoot = process.env.PHANTOM_MIGRATE_LEGACY_ROOT ||
    path.join(os.homedir(), '.claude', 'phantom', 'repos');
  const projectsDir = process.env.PHANTOM_PROJECTS_DIR ||
    path.join(os.homedir(), '.claude', 'projects');
  const marker = path.join(DATA, MARKER_NAME);
  const lockPath = path.join(DATA, LOCK_NAME);

  if (apply && fs.existsSync(marker) && !force) {
    return { skipped: true, reason: 'already migrated', marker };
  }

  // Only --apply mutates; a dry-run reads and never needs the lock.
  let lockFd;
  if (apply) {
    try { fs.mkdirSync(DATA, { recursive: true }); } catch (_) {}
    lockFd = acquireMigrationLock(lockPath);
    if (lockFd === null) return { skipped: true, reason: 'in progress' };
  }

  try {
    return runSweep({ apply, force, mapOverrides, DATA, dataReposRoot, legacyRoot, projectsDir, marker });
  } finally {
    if (typeof lockFd === 'number') {
      try { fs.closeSync(lockFd); } catch (_) {}
      try { fs.unlinkSync(lockPath); } catch (_) {}
    }
  }
}

function runSweep({ apply, mapOverrides, DATA, dataReposRoot, legacyRoot, projectsDir, marker }) {
  const report = {
    mode: apply ? 'apply' : 'dry-run',
    at: new Date().toISOString(),
    dataRoot: DATA,
    roots: [dataReposRoot, legacyRoot].filter(isDir),
    resolved: [], unresolved: [], pruned: [], canonical: [], reserved: [],
  };

  const opts = { apply, dataReposRoot, mapOverrides, projectsDir };
  if (isDir(dataReposRoot)) sweepRoot(dataReposRoot, opts, report);
  if (isDir(legacyRoot)) sweepRoot(legacyRoot, opts, report);

  report.counts = {
    resolved: report.resolved.length,
    unresolved: report.unresolved.length,
    pruned: report.pruned.length,
    canonical: report.canonical.length,
    reserved: report.reserved.length,
  };

  // Report is a read-only artifact — always written, even for dry-run.
  try {
    const dir = auditDir();
    fs.mkdirSync(dir, { recursive: true });
    const stamp = report.at.replace(/[:.]/g, '-');
    report.reportPath = path.join(dir, `repo-dirs-migration-${report.mode}-${stamp}.json`);
    fs.writeFileSync(report.reportPath, JSON.stringify(report, null, 2));
  } catch (_) { /* audit dir unwritable — report still returned to caller */ }

  if (apply) {
    try {
      fs.mkdirSync(DATA, { recursive: true });
      fs.writeFileSync(marker, JSON.stringify({
        migratedAt: report.at, counts: report.counts, reportPath: report.reportPath,
      }, null, 2));
    } catch (_) { /* marker unwritable — next run will retry */ }
  }

  return report;
}

module.exports = { run, resolveTarget, candidates, encodeCwd, MARKER_NAME };

if (require.main === module) {
  const r = run();
  if (r.skipped) {
    console.log(`  ○ repo-dirs migration: ${r.reason} (skipping)`);
  } else {
    console.log(
      `  ${r.mode === 'apply' ? '✓' : '·'} repo-dirs migration [${r.mode}]: ` +
      `resolved=${r.counts.resolved} pruned=${r.counts.pruned} ` +
      `unresolved=${r.counts.unresolved} canonical=${r.counts.canonical}` +
      (r.reportPath ? ` → ${r.reportPath}` : '')
    );
  }
  process.exit(0);
}
