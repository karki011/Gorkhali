#!/usr/bin/env node
// Author: Subash Karki
// baseline-report.js - read-only retrospective miner over the existing Phantom corpus.
//
// READ-ONLY: this script has NO side effects - no writes, no mkdir, no mutation.
// It reads wrap.json / verification.json / outcome.json under
// <data>/repos/<repo>/{sessions,completed}/<ticket>/, the timing jsonl, and the
// agent/model policy references, then prints one baseline table.
//
// Merge rate is GROUND TRUTH from `gh api graphql` on the distinct PR urls, never
// parsed from wrap.json's free-text pr.status (16 measured variants). Any field
// whose source is unavailable prints as absent with a coverage count - never an
// estimate, never an extrapolation.
//
// Usage:
//   node scripts/baseline-report.js [--no-gh] [--gh-limit <N>] [--json]
//
// Exit codes: 0 = report produced; 1 = I/O or internal error; 2 = usage error.

'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { phantomData, timingDir } = require('./lib/phantom-paths');
const { PhantomError, exitCodeForError, reportError } = require('./lib/axi-error');
const codec = require('../skills/phantom/scripts/lib/shared-state.cjs');
const loopController = require('../hooks/loop-controller');
// The disposition vocabulary and the id derivation, from their one home (B9).
// The miner never keeps a private copy of either: a second list would drift the
// day B10 touches the first, and the whole point of this section is a number
// that means the same thing to the validator, the loop controller, and here.
const { DISPOSITIONS, findingId } = require('./lib/review-finding');
// The review standard (B10) owns the ONE severity scale. This miner READS it and
// never restates it: a private severity list here would be F9's pattern all over
// again. Fail-open load, like hooks/loop-controller.js does - a miner that cannot
// load the standard reports severities verbatim and says so, it does not crash.
let reviewStandard = null;
try {
  reviewStandard = require('./lib/review-standard');
} catch (_) { /* fail open: severities report verbatim, basis is stated in the output */ }

const USAGE =
  'usage: node scripts/baseline-report.js [--no-gh] [--gh-limit <N>] [--json]\n';

// Aliases per GraphQL request. Each pullRequest(number:) alias is one node fetch,
// so this only bounds request size - it is not a rate limit.
const GH_BATCH_SIZE = 50;

const AGENTS_DIR = path.join(__dirname, '..', 'agents');
const POLICY_PATH = path.join(__dirname, '..', 'skills', 'phantom', 'references', 'model-policy.json');
const PRESETS_PATH = path.join(__dirname, '..', 'skills', 'phantom', 'references', 'model-presets.json');
const PRESET_HOST = 'claude-code';

function loadJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch (_) {
    return null;
  }
}

// ── Corpus discovery ───────────────────────────────────────────────────────

// One walk of <data>/repos collecting every ticket record dir, keyed by path shape:
//   canonical  <repo>/{sessions,completed}/<ticket>/   - one per ticket run
//   nested     the same, plus inputs/ or runs/<run>/    - copies of a canonical wrap
//   offBucket  anything else (e.g. a legacy <repo>/state/completed/<ticket>/)
// A dir counts as a record when it holds a wrap.json OR an outcome.json, so the
// schema'd successor artifact is picked up without requiring the drifting one.
// Nested and off-bucket wrap files are counted, never aggregated, so the delta
// against a raw `find -name wrap.json` total is explicit rather than silent.
//
// `reviews/` dirs are collected on the same walk (B9b). Reviewer artifacts are
// only READ under a canonical record dir, because that is the only corpus every
// other rate here is over; any reviews/ dir OUTSIDE one (a session reviewed but
// never wrapped, so it has neither wrap.json nor outcome.json) is COUNTED and
// excluded, the same way nested wrap copies are. Silently dropping them would
// understate how much review data exists without saying so.
function findRecordDirs(dataRoot) {
  const reposRoot = path.join(dataRoot, 'repos');
  const canonical = [];
  const reviewDirs = [];
  let nestedCopies = 0;
  let offBucket = 0;

  function walk(dir, segments) {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (_) {
      return;
    }
    const bucketed = segments.length >= 3 && (segments[1] === 'sessions' || segments[1] === 'completed');
    let hasWrap = false;
    let hasOutcome = false;
    for (const e of entries) {
      if (e.isDirectory()) {
        if (e.name === 'reviews') reviewDirs.push(dir);
        walk(path.join(dir, e.name), segments.concat(e.name));
      } else if (e.name === 'wrap.json') hasWrap = true;
      else if (e.name === 'outcome.json') hasOutcome = true;
    }
    if (!hasWrap && !hasOutcome) return;
    if (!bucketed) offBucket += hasWrap ? 1 : 0;
    else if (segments.length === 3) {
      canonical.push({ repoDir: segments[0], bucket: segments[1], ticket: segments[2], dir, hasWrap });
    } else nestedCopies += hasWrap ? 1 : 0;
  }

  walk(reposRoot, []);
  const canonicalDirs = new Set(canonical.map((c) => c.dir));
  const reviewDirsOutsideRecords = reviewDirs.filter((d) => !canonicalDirs.has(d)).length;
  return { canonical, nestedCopies, offBucket, reviewDirsOutsideRecords };
}

// Resolve an on-disk repo dir name to its canonical repo id through the EXISTING
// alias map (repos/.aliases.json). The `.migrated-away` / `.migrated-away-migrated`
// suffixes are migration bookkeeping, not part of any id, so they are stripped
// before the lookup. An AMBIGUOUS alias (non-string sentinel) is reported as
// ambiguous and NEVER collapsed onto either claimant.
function resolveRepoId(dataRoot, repoDir) {
  const base = repoDir.replace(/(\.migrated-away)+(-migrated)*$/, '');
  if (codec.isAmbiguousAlias(dataRoot, base)) {
    return { id: base, resolution: 'ambiguous' };
  }
  const canonical = codec.resolveCanonical(dataRoot, base);
  if (canonical !== base) return { id: canonical, resolution: 'aliased' };
  const known = Object.prototype.hasOwnProperty.call(codec.readAliasMap(dataRoot), base);
  return { id: base, resolution: known ? 'canonical' : 'unmapped' };
}

// ── reviewer artifacts (B9b) ───────────────────────────────────────────────
//
// The three documented reviewer artifact locations under a session dir
// (reference/schemas/review.md):
//   reviews/*.json             the one default reviewer writes reviews/gaze.json
//   reviews/specialists/*.json risk-triggered specialists (archer today)
//   reviews/deep/*.json        explicitly selected RPSL perspectives
// review-panel.json is a CONTAINER, not a review - its perspectives write the
// deep/*.json files read here - so it is filtered out by the shape check below
// (it carries `perspectives`, never `findings`) and no finding is double-counted.
const REVIEW_SUBDIRS = ['specialists', 'deep'];

function jsonFilesIn(dir) {
  try {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isFile() && e.name.endsWith('.json'))
      .map((e) => path.join(dir, e.name))
      .sort();
  } catch (_) {
    return [];
  }
}

// Which reviewer wrote it: the artifact's own `role` is authoritative, the
// filename is the fallback for an artifact that predates the field. Never
// guessed from the directory - `specialists/` holds whichever specialist ran.
function reviewerAgent(data, file) {
  if (typeof data.role === 'string' && data.role.trim() !== '') return data.role.trim();
  return path.basename(file, '.json');
}

function readReviewArtifacts(recordDir) {
  const root = path.join(recordDir, 'reviews');
  const files = jsonFilesIn(root).concat(...REVIEW_SUBDIRS.map((sub) => jsonFilesIn(path.join(root, sub))));
  const out = [];
  for (const file of files) {
    const data = loadJson(file);
    // Shape check, not a schema check: this miner reports what is on disk and
    // never fails a session for it. scripts/validate-artifact.js is the schema
    // authority; a file with no `findings` array is simply not a review.
    if (!data || typeof data !== 'object' || Array.isArray(data) || !Array.isArray(data.findings)) continue;
    // F11: the reviewer model is a property of the RUN, so it is read once per
    // artifact and carried onto every finding in it. Absent on every artifact
    // written before F11, and absence is never filled in from the frontmatter
    // pin - the pin is what was asked for, not what ran.
    out.push({
      agent: reviewerAgent(data, file),
      model: reviewStandard ? reviewStandard.normalizeReviewerModel(data.model) : nonEmpty(data.model),
      modelRaw: nonEmpty(data.model),
      findings: data.findings,
    });
  }
  return out;
}

const PR_URL_RE = /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)$/;

function parsePrUrl(url) {
  if (typeof url !== 'string') return null;
  const m = PR_URL_RE.exec(url.trim());
  return m ? { owner: m[1], repo: m[2], number: Number(m[3]) } : null;
}

function readCorpus(dataRoot) {
  const records = [];
  const pathResolution = { canonical: 0, aliased: 0, unmapped: 0, ambiguous: 0 };
  const files = findRecordDirs(dataRoot);

  for (const s of files.canonical) {
    const wrap = loadJson(path.join(s.dir, 'wrap.json'));
    const outcome = loadJson(path.join(s.dir, 'outcome.json'));
    if (!wrap && !outcome) continue; // both unparseable -> nothing to aggregate
    const { id, resolution } = resolveRepoId(dataRoot, s.repoDir);
    pathResolution[resolution] += 1;

    const verification = loadJson(path.join(s.dir, 'verification.json'));
    const session = loadJson(path.join(s.dir, 'session.json'));
    // outcome.json's pr_url is the schema'd field; wrap.json's is the legacy one.
    const rawUrl =
      (outcome && typeof outcome.pr_url === 'string' && outcome.pr_url) ||
      (wrap && wrap.pr && typeof wrap.pr.url === 'string' && wrap.pr.url) ||
      '';
    const prUrl = rawUrl.trim() || null;

    records.push({
      repoDir: s.repoDir,
      repoId: id,
      pathResolution: resolution,
      bucket: s.bucket,
      ticket: s.ticket,
      hasWrap: !!wrap,
      prUrl,
      prRef: parsePrUrl(prUrl),
      wrapStatus: wrap && wrap.pr && wrap.pr.status !== undefined ? wrap.pr.status : undefined,
      wrapKeys: wrap ? Object.keys(wrap) : [],
      hasWrapCost: !!(wrap && wrap.cost !== undefined),
      hasWrapFixLoops: !!(wrap && wrap.fixLoops !== undefined),
      greptileIterations:
        wrap && wrap.greptile && typeof wrap.greptile.iterations === 'number'
          ? wrap.greptile.iterations
          : null,
      verificationFixLoops: verification ? loopController.getFixLoops(verification) : null,
      hasVerificationFixLoops: !!(
        verification && verification.review && typeof verification.review.fixLoops === 'number'
      ),
      wallTimeMs: sessionWallTimeMs(session),
      reviews: readReviewArtifacts(s.dir),
      outcome,
    });
  }
  return {
    records,
    pathResolution,
    nestedCopies: files.nestedCopies,
    offBucket: files.offBucket,
    reviewDirsOutsideRecords: files.reviewDirsOutsideRecords,
  };
}

function sessionWallTimeMs(session) {
  if (!session) return null;
  const start = Date.parse(session.created_at);
  const end = Date.parse(session.completed_at || session.updated_at);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return null;
  return end - start;
}

// ── gh ground truth ────────────────────────────────────────────────────────

// gh's own enum -> the closed pr_state enum shared with outcome-write.js.
// draft is a property of an OPEN pr, so isDraft is checked first.
function ghStateToEnum(state, isDraft) {
  if (isDraft === true && state === 'OPEN') return 'draft';
  if (state === 'OPEN') return 'open';
  if (state === 'MERGED') return 'merged';
  if (state === 'CLOSED') return 'closed';
  return null;
}

function ghAvailable() {
  const res = spawnSync('gh', ['--version'], { encoding: 'utf-8' });
  return res.status === 0;
}

// One GraphQL request per (owner, repo, chunk of <=GH_BATCH_SIZE numbers). gh exits
// non-zero when ANY alias 404s but still writes the partial data payload to stdout,
// so stdout is parsed regardless of status and a null alias stays unresolved.
function queryPrChunk(owner, repo, numbers) {
  const fields = numbers
    .map((n) => `p${n}:pullRequest(number:${n}){state isDraft reviews(first:1){totalCount} comments(first:1){totalCount}}`)
    .join(' ');
  const query = `query{r:repository(owner:"${owner}",name:"${repo}"){${fields}}}`;
  const res = spawnSync('gh', ['api', 'graphql', '-f', `query=${query}`], {
    encoding: 'utf-8',
    maxBuffer: 16 * 1024 * 1024,
  });
  const parsed = res.stdout ? safeParse(res.stdout) : null;
  const node = parsed && parsed.data && parsed.data.r;
  if (!node) {
    const reason = (res.stderr || '').trim().split('\n')[0] || `gh exited ${res.status}`;
    return { results: {}, error: reason };
  }
  const results = {};
  for (const n of numbers) {
    const pr = node['p' + n];
    results[n] = pr
      ? {
          state: ghStateToEnum(pr.state, pr.isDraft),
          reviews: pr.reviews ? pr.reviews.totalCount : null,
          comments: pr.comments ? pr.comments.totalCount : null,
        }
      : null;
  }
  return { results, error: null };
}

function safeParse(text) {
  try {
    return JSON.parse(text);
  } catch (_) {
    return null;
  }
}

/**
 * Resolve every distinct PR url to the closed pr_state enum via gh. Degrades
 * gracefully: gh missing, unauthenticated, or rate-limited leaves every url
 * unresolved with a reason rather than falling back to the free-text status.
 */
function resolvePrStates(prRefs, opts) {
  const byUrl = new Map();
  const unresolved = [];
  if (opts.noGh) {
    for (const r of prRefs) unresolved.push({ url: r.url, reason: '--no-gh: gh not queried' });
    return { byUrl, unresolved, ghUsed: false, ghReason: '--no-gh requested' };
  }
  if (!ghAvailable()) {
    for (const r of prRefs) unresolved.push({ url: r.url, reason: 'gh CLI unavailable' });
    return { byUrl, unresolved, ghUsed: false, ghReason: 'gh CLI unavailable' };
  }

  const limited = opts.ghLimit != null ? prRefs.slice(0, opts.ghLimit) : prRefs;
  for (const r of prRefs.slice(limited.length)) {
    unresolved.push({ url: r.url, reason: '--gh-limit reached' });
  }

  const byRepo = new Map();
  for (const r of limited) {
    const key = r.ref.owner + '/' + r.ref.repo;
    if (!byRepo.has(key)) byRepo.set(key, []);
    byRepo.get(key).push(r);
  }

  let requests = 0;
  for (const [key, refs] of byRepo) {
    const [owner, repo] = key.split('/');
    for (let i = 0; i < refs.length; i += GH_BATCH_SIZE) {
      const chunk = refs.slice(i, i + GH_BATCH_SIZE);
      requests += 1;
      const { results, error } = queryPrChunk(owner, repo, chunk.map((c) => c.ref.number));
      for (const c of chunk) {
        const hit = results[c.ref.number];
        if (hit && hit.state) byUrl.set(c.url, hit);
        else unresolved.push({ url: c.url, reason: error || 'gh returned no pull request for this number' });
      }
    }
  }
  return { byUrl, unresolved, ghUsed: true, ghReason: null, requests };
}

// ── timing corpus ──────────────────────────────────────────────────────────

// 'param' and 'pinned' records count under their real tier. Records with no
// explicit model split into two DISTINCT buckets (this is the fix for the
// bug where both used to collapse into one 'inherited' string):
//   session-inherited - modelSource key IS present and equals 'session'
//                        (genuinely no pin - a real routing signal)
//   legacy-no-field    - modelSource key is ABSENT from the record entirely
//                        (predates hooks/timing-capture.js instrumentation,
//                        not a routing signal)
// Deliberately diverges from timing-report.js's norm(), which still merges
// both into 'inherited' - that file is out of scope for this fix.
function normModel(model, modelSource) {
  const m = model || 'inherited';
  const isInheritedLiteral = m === 'inherited' || m === 'opus(inherited)';
  if (modelSource === undefined) return isInheritedLiteral ? 'legacy-no-field' : m;
  if (modelSource === 'session') return isInheritedLiteral ? 'session-inherited' : m;
  if (m.startsWith('opus')) return 'opus';
  if (m.startsWith('fable')) return 'fable';
  return m;
}

/**
 * Read every timing jsonl and pair spawn -> stop exactly the way
 * timing-report.js does: by tool_use id when the harness supplied one on both
 * events, else FIFO within a session id. Counts are exact; FIFO durations are
 * approximate when background agents run in parallel, and that caveat is carried
 * into the record rather than dropped.
 */
function readTiming() {
  const dir = timingDir();
  let files;
  try {
    files = fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl'));
  } catch (_) {
    return { available: false, reason: 'no timing dir at ' + dir };
  }

  const spawns = [];
  const stops = [];
  for (const f of files) {
    let raw;
    try {
      raw = fs.readFileSync(path.join(dir, f), 'utf-8');
    } catch (_) {
      continue;
    }
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue;
      const r = safeParse(line);
      if (!r) continue;
      (r.event === 'stop' ? stops : spawns).push(r);
    }
  }

  const byAgent = new Map();
  const byModel = new Map();
  // Raw modelSource tally, independent of model tier - the ground truth for the
  // MODEL SOURCE section. legacyNoField is derived from ABSENCE of the key, never
  // from a value, so it can never be confused with a real routing decision.
  const modelSourceCounts = { param: 0, pinned: 0, session: 0, legacyNoField: 0 };
  for (const s of spawns) {
    const agent = s.agent || '(unnamed)';
    if (!byAgent.has(agent)) byAgent.set(agent, { spawns: 0, models: new Map(), durations: [] });
    const entry = byAgent.get(agent);
    entry.spawns += 1;
    const model = normModel(s.model, s.modelSource);
    entry.models.set(model, (entry.models.get(model) || 0) + 1);
    byModel.set(model, (byModel.get(model) || 0) + 1);
    if (s.modelSource === undefined) modelSourceCounts.legacyNoField += 1;
    else if (Object.prototype.hasOwnProperty.call(modelSourceCounts, s.modelSource)) {
      modelSourceCounts[s.modelSource] += 1;
    }
  }

  // Pairing, mirroring timing-report.js.
  const stopById = new Map();
  for (const st of stops) if (st.id) stopById.set(st.id, st);
  const fifoStops = new Map();
  for (const st of stops) {
    if (st.id) continue;
    if (!fifoStops.has(st.sid)) fifoStops.set(st.sid, []);
    fifoStops.get(st.sid).push(st);
  }
  let pairedById = 0;
  let pairedByFifo = 0;
  for (const sp of spawns) {
    let stop = sp.id ? stopById.get(sp.id) : null;
    if (stop) pairedById += 1;
    else {
      const q = fifoStops.get(sp.sid);
      if (q && q.length) {
        stop = q.shift();
        pairedByFifo += 1;
      }
    }
    if (!stop) continue;
    const dur = Date.parse(stop.ts) - Date.parse(sp.ts);
    if (dur >= 0) byAgent.get(sp.agent || '(unnamed)').durations.push(dur);
  }

  return {
    available: true,
    files: files.length,
    records: spawns.length + stops.length,
    spawns: spawns.length,
    stops: stops.length,
    byAgent,
    byModel,
    modelSourceCounts,
    pairing:
      pairedById >= pairedByFifo
        ? 'tool-use id (exact)'
        : 'FIFO per session id (counts exact; durations approximate when agents run in parallel)',
    pairedById,
    pairedByFifo,
  };
}

// ── agents vs model policy ─────────────────────────────────────────────────

function agentNames() {
  try {
    return fs
      .readdirSync(AGENTS_DIR)
      .filter((f) => f.endsWith('.md'))
      .map((f) => path.basename(f, '.md'))
      .sort();
  } catch (_) {
    return [];
  }
}

// The `model:` value from an agent's YAML frontmatter, or null when the agent
// pins no model (it inherits the session model).
function frontmatterModel(agent) {
  let raw;
  try {
    raw = fs.readFileSync(path.join(AGENTS_DIR, agent + '.md'), 'utf-8');
  } catch (_) {
    return null;
  }
  const end = raw.indexOf('\n---', 4);
  const head = end === -1 ? raw.slice(0, 2000) : raw.slice(0, end);
  const m = /^model:[ \t]*(\S+)[ \t]*$/m.exec(head);
  return m ? m[1] : null;
}

// Expected model per role: model-policy.json role -> profile, resolved through
// model-presets.json for the claude-code host. Neither file is modified.
//
// Only agents with a row in policy.roles belong in a policy-drift comparison -
// an agent with no row was never expected to pin a model, so it can never
// "drift". Agents/*.md files without a row (none exist today, but the check is
// not assumed away) are reported via noPolicyRoleAgents instead, alongside the
// built-in/recruited agent types collected by nonPhantomAgentRows().
function modelExpectations(agents, timing) {
  const policy = loadJson(POLICY_PATH);
  const presets = loadJson(PRESETS_PATH);
  const profiles =
    presets && presets.hosts && presets.hosts[PRESET_HOST] ? presets.hosts[PRESET_HOST].profiles : null;
  if (!policy || !policy.roles || !profiles) {
    return { rows: [], noPolicyRoleAgents: [], unresolved: 'model-policy.json or model-presets.json unreadable' };
  }

  const rows = [];
  const noPolicyRoleAgents = [];
  for (const agent of agents) {
    const profile = policy.roles[agent] || null;
    if (!profile) {
      noPolicyRoleAgents.push(agent);
      continue;
    }
    const preset = profiles[profile];
    const expected = preset ? preset.model : null;
    const declared = frontmatterModel(agent);
    const observed = timing.available ? observedModels(timing, agent) : [];

    let drift;
    if (declared == null) drift = expected == null ? 'match' : 'frontmatter-absent';
    else if (expected == null) drift = 'policy-inherit';
    else drift = declared === expected ? 'match' : 'drift';

    rows.push({
      agent,
      policyProfile: profile,
      expectedModel: expected,
      frontmatterModel: declared,
      observedModels: observed,
      drift,
    });
  }
  return { rows, noPolicyRoleAgents, unresolved: null };
}

// Every agent TYPE observed in the timing log that has no row in
// model-policy.json - built-in Claude Code types (general-purpose, Explore),
// ad hoc recruited specialists, etc. These have no pin BY DESIGN and are never
// policy-drift candidates, so they are reported separately rather than folded
// into (or silently missing from) the policy comparison table.
function nonPhantomAgentRows(timing, policy) {
  if (!timing.available || !policy || !policy.roles) return [];
  const policyNames = new Set(Object.keys(policy.roles));
  const rows = [];
  for (const [name, entry] of timing.byAgent) {
    const bare = name.startsWith('phantom:') ? name.slice('phantom:'.length) : name;
    if (policyNames.has(bare)) continue;
    rows.push({
      agent: name,
      spawns: entry.spawns,
      observedModels: [...entry.models.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([model, count]) => model + ':' + count),
    });
  }
  return rows.sort((a, b) => b.spawns - a.spawns);
}

// Models actually observed in the timing log for this agent, under both the
// `phantom:<agent>` and bare `<agent>` spawn names.
function observedModels(timing, agent) {
  const merged = new Map();
  for (const name of ['phantom:' + agent, agent]) {
    const entry = timing.byAgent.get(name);
    if (!entry) continue;
    for (const [model, count] of entry.models) merged.set(model, (merged.get(model) || 0) + count);
  }
  return [...merged.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([model, count]) => model + ':' + count);
}

function spawnCountFor(timing, agent) {
  if (!timing.available) return null;
  let total = 0;
  for (const name of ['phantom:' + agent, agent]) {
    const entry = timing.byAgent.get(name);
    if (entry) total += entry.spawns;
  }
  return total;
}

// ── review effectiveness: per-finding disposition (B9b) ────────────────────
//
// The metric, from Martian's Code Review Bench (project-docs/review-research-2026.md
// §1.11): a finding counts as a TRUE POSITIVE if the code changed after it. That
// is exactly what `disposition: "fixed"` records, so precision needs no human
// labelling - only findings that already carry a recorded disposition.
//
// THE ONE RULE THIS SECTION EXISTS TO ENFORCE (F8): this is a RE-baseline. Every
// reviewer artifact written before #109 and before B9 carries no disposition at
// all, and section 3's review numbers were measured against a pipeline that no
// longer exists. So findings WITHOUT a disposition are unmeasurable, they are
// counted and shown as unmeasurable, and they never enter a denominator. An
// empty measurable set prints as UNMEASURABLE - never as 0%, never as 100%,
// never as a clean review.
//
// AND WHAT THIS SECTION MUST NEVER DO: call loopController.closeFixLoop(). That
// function ASSIGNS a disposition (defaulting to `deferred`), which on a pre-B9
// artifact would manufacture the very data whose absence is the finding. This
// miner is read-only and reports only dispositions already on disk.

// Rows are printed, not paged. Cap the human table and say how many were cut;
// --json always carries every row.
const REVIEW_ROWS_SHOWN = 40;

function nonEmpty(value) {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

// The finding's severity on the canonical scale, or its raw string when the
// standard does not recognise it (or is not loadable). Same expression
// hooks/loop-controller.js uses for the same column, so a row read off disk and
// a row handed back by closeFixLoop() mean the same thing.
function severityOf(finding) {
  const raw = nonEmpty(finding.severity) || nonEmpty(finding.temperature) || null;
  return (reviewStandard && reviewStandard.normalizeSeverity(raw)) || raw;
}

const SEVERITY_BASIS = reviewStandard
  ? 'canonical scale via scripts/lib/review-standard.js (legacy P0/P1/P2/P3/warn normalized)'
  : 'verbatim - scripts/lib/review-standard.js not loadable, so legacy spellings are NOT folded together';

/**
 * One row per finding, in the shape hooks/loop-controller.js closeFixLoop()
 * returns (id/file/severity/disposition/reason) plus the three columns a
 * CORPUS-wide table needs that a single loop close does not: which ticket, which
 * reviewer, and which review dimension.
 *
 * `disposition: null` means no disposition was recorded - written before B9, or
 * the fix loop never closed. The two cases are indistinguishable from the
 * artifact alone, so they are reported as one honestly-named bucket rather than
 * split on a guess.
 */
function reviewFindingRows(records) {
  const rows = [];
  const artifacts = { total: 0, clean: 0, measured: 0, partial: 0, unmeasured: 0 };
  const byAgentArtifacts = new Map();
  const sessionsWithReview = new Set();
  const sessionsMeasurable = new Set();

  for (const r of records) {
    for (const art of r.reviews) {
      artifacts.total += 1;
      byAgentArtifacts.set(art.agent, (byAgentArtifacts.get(art.agent) || 0) + 1);
      const sessionKey = r.repoId + '/' + r.bucket + '/' + r.ticket;
      sessionsWithReview.add(sessionKey);

      let findings = 0;
      let dispositioned = 0;
      let measurable = 0;
      for (const f of art.findings) {
        if (!f || typeof f !== 'object' || Array.isArray(f)) continue;
        findings += 1;
        const disposition = DISPOSITIONS.includes(f.disposition) ? f.disposition : null;
        if (disposition) dispositioned += 1;
        if (disposition && f.preExisting !== true) measurable += 1;
        // A recorded id is data. An id derived here is NOT - it is this miner
        // recomputing the content hash so a pre-B9 finding is still countable
        // as one finding. idSource keeps the two apart in every consumer.
        const recorded = nonEmpty(f.id);
        rows.push({
          repo: r.repoId,
          ticket: r.ticket,
          agent: art.agent,
          // F11: which reviewer actually produced this finding. Per artifact,
          // copied onto each of its findings so a population can be checked for
          // a shared model; null means UNRECORDED, never "the pinned one".
          model: art.model,
          modelRaw: art.modelRaw,
          id: recorded || findingId(f),
          idSource: recorded ? 'recorded' : 'derived',
          file: nonEmpty(f.file) || nonEmpty(f.component) || null,
          // Severity on the ONE scale, exactly as closeFixLoop() reports it: the
          // canonical value when the standard recognises the spelling, the raw
          // string otherwise. Without this a legacy `P0` and a canonical
          // `blocking` would split one severity across two rows of the table -
          // F9's drift resurfacing as a measurement artifact. `severityRaw`
          // keeps what is actually on disk, because that is the re-baseline's
          // own evidence.
          severity: severityOf(f),
          severityRaw: nonEmpty(f.severity) || nonEmpty(f.temperature) || null,
          // B10(b): a defect the diff did not introduce never enters the fix
          // loop, so the loop's outcome is not an outcome FOR it. Carried here
          // so precision can exclude it rather than silently absorb it.
          preExisting: f.preExisting === true,
          // No finding SCHEMA field carries a dimension today - archer.md names
          // five in its chat format only. Read when present, absent otherwise;
          // never inferred from the claim text.
          dimension: nonEmpty(f.dimension) || nonEmpty(f.category) || null,
          // B11's OTHER axis, kept strictly apart from severity above. A
          // finding with no `confidence` key was written before the
          // verification pass existed; it is UNVERIFIED, never "confirmed by
          // default" - the gate below compares those two populations and a
          // silent default would be it comparing a set against itself.
          confidence:
            (reviewStandard && reviewStandard.normalizeConfidence(f.confidence)) ||
            (nonEmpty(f.confidence) ? nonEmpty(f.confidence) : null),
          verified: nonEmpty(f.confidence) !== null,
          disposition,
          reason: nonEmpty(f.dispositionReason) || null,
        });
      }

      if (findings === 0) artifacts.clean += 1;
      else if (dispositioned === 0) artifacts.unmeasured += 1;
      else if (dispositioned === findings) artifacts.measured += 1;
      else artifacts.partial += 1;
      // A session counts as measurable only on a finding the diff INTRODUCED:
      // a preExisting finding is deferred by rule, so a session holding nothing
      // else has produced no evidence about review quality.
      if (measurable > 0) sessionsMeasurable.add(sessionKey);
    }
  }

  return {
    rows,
    artifacts,
    artifactsByAgent: [...byAgentArtifacts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])),
    sessionsWithReview: sessionsWithReview.size,
    sessionsMeasurable: sessionsMeasurable.size,
  };
}

/**
 * Precision over a disposition tally. `fixed` is the true positive (the code
 * changed after the finding). `deferred` is neither a confirmed true positive
 * nor a confirmed false one - nobody acted and nobody rejected - so there is no
 * single honest number, there is a BAND, and both ends are reported rather than
 * quietly picking the flattering one:
 *   lower  fixed / (fixed + dismissed + deferred)   deferred counted against
 *   upper  fixed / (fixed + dismissed)              deferred excluded, undecided
 * Both are null on an empty tally: absent, never 0, never 1.
 */
function precisionOf(counts) {
  const decided = counts.fixed + counts.dismissed;
  const dispositioned = decided + counts.deferred;
  return {
    dispositioned,
    fixed: counts.fixed,
    dismissed: counts.dismissed,
    deferred: counts.deferred,
    precisionLower: dispositioned ? counts.fixed / dispositioned : null,
    precisionUpper: decided ? counts.fixed / decided : null,
  };
}

// Group measurable rows by one column. A row with no disposition is skipped
// BEFORE the group is created, so an unmeasurable finding cannot even create a
// bucket, let alone dilute one. (`preExisting` rows are filtered by the caller,
// which owns that exclusion and reports its count.)
function tallyBy(rows, key) {
  const map = new Map();
  for (const row of rows) {
    if (!row.disposition) continue;
    const bucket = row[key] || '(unlabelled)';
    if (!map.has(bucket)) map.set(bucket, { fixed: 0, dismissed: 0, deferred: 0 });
    map.get(bucket)[row.disposition] += 1;
  }
  return [...map.entries()]
    .map(([bucket, counts]) => ({ key: bucket, ...precisionOf(counts) }))
    .sort((a, b) => b.dispositioned - a.dispositioned || a.key.localeCompare(b.key));
}

// ── report assembly ────────────────────────────────────────────────────────

function median(nums) {
  if (!nums.length) return null;
  const s = [...nums].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
}

/**
 * Build the baseline report. Read-only. Every absent field is null with a
 * sibling entry in unresolved[] naming the field and the reason.
 */
function runBaseline(opts) {
  const dataRoot = phantomData();
  const unresolved = [];
  const { records, pathResolution, nestedCopies, offBucket, reviewDirsOutsideRecords } = readCorpus(dataRoot);

  // wrapCount is the denominator for anything sourced from wrap.json keys; records
  // may also include a ticket that has only the schema'd outcome.json.
  const wrapCount = records.filter((r) => r.hasWrap).length;
  const distinctTickets = new Set(records.map((r) => r.ticket)).size;
  const withPrUrl = records.filter((r) => r.prUrl);
  const distinctUrls = new Map();
  for (const r of withPrUrl) {
    if (r.prRef && !distinctUrls.has(r.prUrl)) distinctUrls.set(r.prUrl, r.prRef);
  }
  const malformedUrls = withPrUrl.filter((r) => !r.prRef).length;
  if (malformedUrls > 0) {
    unresolved.push({
      field: 'pr_state',
      reason: malformedUrls + ' pr.url value(s) are not github.com/<owner>/<repo>/pull/<n> and cannot be queried',
    });
  }

  const prRefs = [...distinctUrls.entries()].map(([url, ref]) => ({ url, ref }));
  const gh = resolvePrStates(prRefs, opts);

  const stateCounts = { draft: 0, open: 0, merged: 0, closed: 0 };
  for (const hit of gh.byUrl.values()) if (hit.state in stateCounts) stateCounts[hit.state] += 1;
  const ghResolved = gh.byUrl.size;

  // MERGE RATE (F12). A PR that is still open or still draft has not been
  // rejected - it has not finished. Counting it as a non-merge measured the
  // corpus's SPEED, not its outcome: the 2026-08-13 run read 9 merged, 2 open,
  // 0 closed and printed 81.8%, where the settled record was 9 of 9. So the
  // denominator is SETTLED PRs only, the unfinished ones are reported beside it,
  // and the basis string says which numbers were divided - section 3's 99.1%
  // was 111 merged + 1 closed with ZERO open, and the two are only comparable
  // because that basis is now stated on both.
  const settled = stateCounts.merged + stateCounts.closed;
  const unfinished = stateCounts.open + stateCounts.draft;
  const unfinishedNote =
    unfinished > 0
      ? '; ' + unfinished + ' unfinished (open ' + stateCounts.open + ', draft ' + stateCounts.draft +
        ') EXCLUDED from the denominator - an unfinished PR is not a failed one'
      : '; 0 open and 0 draft, so settled = every resolved PR';
  let mergeRateBasis = null;
  if (ghResolved === 0) {
    mergeRateBasis = null; // nothing resolved: the rate is absent for the reason gh already gave
  } else if (settled === 0) {
    mergeRateBasis =
      'UNMEASURABLE: 0 settled PRs (merged+closed) among ' + ghResolved + ' resolved distinct PR url(s)' +
      unfinishedNote + '. Precision of an empty denominator is not 0% and not 100%';
  } else {
    mergeRateBasis =
      'merged/(merged+closed) = ' + stateCounts.merged + '/' + settled +
      ' settled distinct PR url(s), gh ground truth over ' + ghResolved + ' resolved' + unfinishedNote;
  }
  if (unfinished > 0) {
    unresolved.push({
      field: 'merge_rate',
      reason:
        unfinished +
        ' resolved distinct PR url(s) are still open/draft and are EXCLUDED from the merge-rate ' +
        'denominator (F12): an unfinished PR has not failed to merge. The rate covers the ' +
        settled +
        ' settled (merged+closed) PR(s) only, and their eventual outcome is not estimated here',
    });
  }
  if (ghResolved > 0 && settled === 0) {
    unresolved.push({
      field: 'merge_rate',
      reason:
        'none of the ' +
        ghResolved +
        ' resolved distinct PR url(s) has settled (merged or closed), so merge rate is UNMEASURABLE, ' +
        'not 0% and not 100% - there is no settled PR to divide by',
    });
  }
  if (gh.unresolved.length) {
    unresolved.push({
      field: 'merge_rate',
      reason:
        gh.unresolved.length +
        ' of ' +
        prRefs.length +
        ' distinct PR urls unresolved (' +
        (gh.ghReason || gh.unresolved[0].reason) +
        '); merge rate covers only the resolved subset and is never inferred from wrap.json pr.status',
    });
  }

  // Review cycles: gh review + comment totals on the resolved urls only.
  const reviewCounts = [...gh.byUrl.values()]
    .map((h) => h.reviews)
    .filter((n) => typeof n === 'number');
  const commentCounts = [...gh.byUrl.values()]
    .map((h) => h.comments)
    .filter((n) => typeof n === 'number');
  const greptileIterations = records
    .map((r) => r.greptileIterations)
    .filter((n) => typeof n === 'number');

  const timing = readTiming();
  if (!timing.available) unresolved.push({ field: 'agents', reason: timing.reason });

  const agents = agentNames();
  if (agents.length === 0) unresolved.push({ field: 'agents', reason: 'agents/ unreadable' });
  const spawnRows = agents.map((a) => ({ agent: a, spawns: spawnCountFor(timing, a) }));
  const zeroSpawn = spawnRows.filter((r) => r.spawns === 0).map((r) => r.agent);

  const models = modelExpectations(agents, timing);
  if (models.unresolved) unresolved.push({ field: 'model_policy', reason: models.unresolved });
  const policy = loadJson(POLICY_PATH);
  const nonPhantomAgents = nonPhantomAgentRows(timing, policy);

  // MODEL SOURCE: the four-way split ground truth. legacyNoField is a coverage
  // gap, not a routing signal - it cannot be attributed to param/pinned/session
  // because the field that would say so does not exist on those records.
  const modelSource = timing.available
    ? {
        param: timing.modelSourceCounts.param,
        pinned: timing.modelSourceCounts.pinned,
        sessionInherited: timing.modelSourceCounts.session,
        legacyNoField: timing.modelSourceCounts.legacyNoField,
        totalSpawns: timing.spawns,
      }
    : null;
  if (!timing.available) {
    unresolved.push({ field: 'model_source', reason: timing.reason });
  } else if (modelSource.legacyNoField > 0) {
    unresolved.push({
      field: 'model_source',
      reason:
        modelSource.legacyNoField +
        '/' +
        modelSource.totalSpawns +
        ' spawn records have no modelSource field (predate hooks/timing-capture.js instrumentation); ' +
        'they cannot be attributed to param, pinned, or session-inherited and are never guessed',
    });
  }

  // Wall time: only session.json carries a start/end pair. Absent elsewhere,
  // reported as absent with coverage - never reconstructed from file mtimes.
  const wallTimes = records.map((r) => r.wallTimeMs).filter((n) => typeof n === 'number');
  if (wallTimes.length < records.length) {
    unresolved.push({
      field: 'wall_time_ms',
      reason:
        'session.json created_at/completed_at present for ' +
        wallTimes.length +
        '/' +
        records.length +
        ' wrapped tickets; the rest have no start/end timestamps to measure',
    });
  }

  // fix_loops and cost: coverage only. Both sources are counted; neither is estimated.
  const wrapFixLoops = records.filter((r) => r.hasWrapFixLoops).length;
  const verifFixLoops = records.filter((r) => r.hasVerificationFixLoops).length;
  const wrapCost = records.filter((r) => r.hasWrapCost).length;
  unresolved.push({
    field: 'fix_loops',
    reason:
      'wrap.json fixLoops present in ' +
      wrapFixLoops +
      '/' +
      records.length +
      '; verification.json review.fixLoops (the loop-controller source) present in ' +
      verifFixLoops +
      '/' +
      records.length +
      '. Not estimated for the remainder.',
  });
  unresolved.push({
    field: 'cost',
    reason:
      'wrap.json cost present in ' +
      wrapCost +
      '/' +
      records.length +
      '. Not estimated for the remainder.',
  });

  // Review effectiveness (B9b). Coverage is reported the way wall_time and cost
  // already are: an explicit N/M, never an average over a corpus that has no
  // data for most of it.
  const review = reviewFindingRows(records);
  // Two exclusions, both structural, both stated rather than assumed:
  //   no disposition  - pre-B9, or the loop never closed: unmeasurable (F8).
  //   preExisting     - B10 stamps it `deferred` BY RULE because it never
  //                     entered the loop. Leaving it in would depress the lower
  //                     bound with a number that measures the rule, not the
  //                     review. Counted and reported, never averaged in.
  const dispositionedRows = review.rows.filter((row) => row.disposition);
  const preExistingRows = dispositionedRows.filter((row) => row.preExisting);
  const measurableRows = dispositionedRows.filter((row) => !row.preExisting);
  const overallCounts = { fixed: 0, dismissed: 0, deferred: 0 };
  for (const row of measurableRows) overallCounts[row.disposition] += 1;
  const overall = precisionOf(overallCounts);
  const dimensionRows = measurableRows.filter((row) => row.dimension);
  const legacySeverityRows = measurableRows.filter((row) => row.severityRaw && row.severityRaw !== row.severity);

  // B11's promote/revert gate. The two populations it compares are exactly the
  // ones on disk: findings written WITH a recorded confidence (the verification
  // pass ran) against findings written WITHOUT one (it did not). Neither side is
  // manufactured - a missing confidence stays missing.
  const verifiedCounts = { fixed: 0, dismissed: 0, deferred: 0 };
  const unverifiedCounts = { fixed: 0, dismissed: 0, deferred: 0 };
  // F11: the reviewer model behind each measurable finding, kept side by side
  // with the disposition tallies. A row with no recorded model contributes a
  // null, which the gate reads as UNRECORDED - it is never dropped from the
  // list, because dropping it would make an unmeasured side look uniform.
  const verifiedModels = [];
  const unverifiedModels = [];
  for (const row of measurableRows) {
    (row.verified ? verifiedCounts : unverifiedCounts)[row.disposition] += 1;
    (row.verified ? verifiedModels : unverifiedModels).push(row.model);
  }
  const verifiedPrecision = precisionOf(verifiedCounts);
  const unverifiedPrecision = precisionOf(unverifiedCounts);
  const gate = reviewStandard
    ? reviewStandard.precisionGate({
        before: unverifiedPrecision,
        after: verifiedPrecision,
        models: { before: unverifiedModels, after: verifiedModels },
      })
    : {
        verdict: 'unmeasurable',
        reason: 'scripts/lib/review-standard.js not loadable',
        confound: null,
        before: null,
        after: null,
        minSample: null,
        models: { before: null, after: null },
      };
  if (gate.verdict === 'unmeasurable') {
    unresolved.push({
      field: 'review_verification_gate',
      reason:
        'B11 promote/revert gate cannot fire: ' +
        gate.reason +
        '. Input is ' +
        (reviewStandard ? reviewStandard.PRECISION_GATE.input : 'unavailable'),
    });
  }
  // Named separately because it is a DIFFERENT problem from a thin corpus: the
  // two sides were produced by reviewers that cannot be shown to be the same
  // one, so the comparison is confounded rather than merely small. F11.
  if (gate.confound === 'reviewer-model') {
    unresolved.push({
      field: 'review_model_confound',
      reason:
        'the B11 precision gate is CONFOUNDED by the reviewer model and produces no verdict: ' +
        gate.reason +
        '. This is not adjusted for or estimated around - the underlying drift (gaze pinned `opus` ' +
        'but observed opus:18 sonnet:7) is B1\'s scope, and until `model` is recorded on both sides ' +
        'the gate refuses rather than compares two reviewers',
    });
  }
  const modelRecordedRows = measurableRows.filter((row) => row.model);

  if (review.artifacts.total === 0) {
    unresolved.push({
      field: 'review_precision',
      reason:
        'no reviewer artifact found under any canonical record dir (reviews/*.json, ' +
        'reviews/specialists/*.json, reviews/deep/*.json); an empty corpus is NOT a clean ' +
        'review and NOT 100% precision - review effectiveness is unmeasured here',
    });
  } else if (dispositionedRows.length === 0) {
    unresolved.push({
      field: 'review_precision',
      reason:
        '0 of ' +
        review.rows.length +
        ' findings across ' +
        review.artifacts.total +
        ' reviewer artifact(s) carry a disposition. Per F8 these predate B9 (and likely #109): ' +
        'precision is UNMEASURABLE, not 0% - and section 3’s review numbers may not be quoted for the current pipeline',
    });
  } else if (overall.dispositioned === 0) {
    unresolved.push({
      field: 'review_precision',
      reason:
        'every one of the ' +
        dispositionedRows.length +
        ' dispositioned finding(s) is preExisting, which B10 defers BY RULE rather than by outcome; ' +
        'precision is UNMEASURABLE until a finding the diff actually introduced closes a loop',
    });
  } else if (review.artifacts.unmeasured > 0 || review.artifacts.partial > 0) {
    unresolved.push({
      field: 'review_precision',
      reason:
        overall.dispositioned +
        '/' +
        review.rows.length +
        ' findings are measurable; ' +
        review.artifacts.unmeasured +
        ' artifact(s) carry no disposition at all and ' +
        review.artifacts.partial +
        ' are partly dispositioned. The rates below cover ONLY the measurable subset ' +
        'and pre-B9 findings are never averaged in',
    });
  }
  if (preExistingRows.length > 0) {
    unresolved.push({
      field: 'review_precision_pre_existing',
      reason:
        preExistingRows.length +
        ' dispositioned finding(s) are preExisting and excluded from every rate: B10 stamps them ' +
        '`deferred` by rule because they never entered the fix loop, so counting them would measure ' +
        'the rule rather than the review',
    });
  }
  if (measurableRows.length > 0 && dimensionRows.length === 0) {
    unresolved.push({
      field: 'review_dimension',
      reason:
        'no finding on disk carries a `dimension` (or `category`) key - the review finding ' +
        'schema has no such field today, and agents/archer.md names its five dimensions only in ' +
        'its chat format. Per-dimension precision is unmeasurable until a dimension is recorded (B10)',
    });
  }
  if (reviewDirsOutsideRecords > 0) {
    unresolved.push({
      field: 'review_coverage',
      reason:
        reviewDirsOutsideRecords +
        ' reviews/ dir(s) sit outside a canonical record dir (no wrap.json and no outcome.json) ' +
        'and are excluded, the same way nested wrap copies are',
    });
  }

  const keyFreq = new Map();
  for (const r of records) for (const k of r.wrapKeys) keyFreq.set(k, (keyFreq.get(k) || 0) + 1);
  const statusFreq = new Map();
  for (const r of records) {
    if (r.wrapStatus === undefined) continue;
    const key = JSON.stringify(r.wrapStatus);
    statusFreq.set(key, (statusFreq.get(key) || 0) + 1);
  }

  return {
    ts: new Date().toISOString(),
    dataRoot,
    corpus: {
      wrapRecords: records.length,
      nestedWrapCopiesExcluded: nestedCopies,
      offBucketWrapFilesExcluded: offBucket,
      wrapFilesOnDisk: records.length + nestedCopies + offBucket,
      distinctTickets,
      verificationRecords: records.filter((r) => r.verificationFixLoops !== null).length,
      outcomeRecords: records.filter((r) => r.outcome).length,
      timingRecords: timing.available ? timing.records : null,
      distinctWrapKeys: keyFreq.size,
      distinctWrapPrStatusValues: statusFreq.size,
    },
    pathResolution,
    prs: {
      ticketsWithPrUrl: withPrUrl.length,
      prCreatedRate: records.length ? withPrUrl.length / records.length : null,
      distinctPrUrls: prRefs.length,
      ghQueried: gh.ghUsed,
      ghRequests: gh.requests != null ? gh.requests : 0,
      ghResolved,
      ghUnresolved: gh.unresolved.length,
      stateCounts,
      // F12: SETTLED = merged + closed. An open PR, or one still carrying the
      // legacy draft status, has not failed to merge, it has not finished, so
      // it is counted and reported but never put in the denominator. The old
      // rate divided by every resolved PR and read 9/11 = 81.8% on a corpus
      // whose settled record was 9/9.
      settledPrs: settled,
      unfinishedPrs: unfinished,
      mergeRate: settled ? stateCounts.merged / settled : null,
      mergeRateBasis: mergeRateBasis,
    },
    reviewCycles: {
      ghReviewsMedian: median(reviewCounts),
      ghReviewsTotal: reviewCounts.reduce((a, b) => a + b, 0),
      ghReviewsCoverage: reviewCounts.length + '/' + prRefs.length,
      ghCommentsTotal: commentCounts.reduce((a, b) => a + b, 0),
      greptileIterationsMedian: median(greptileIterations),
      greptileIterationsCoverage: greptileIterations.length + '/' + records.length,
    },
    reviewFindings: {
      // Martian's online true-positive definition, stated in the artifact so a
      // consumer of --json cannot read the rate without reading what it means.
      metric: 'true positive = the code changed after the finding (disposition "fixed")',
      rebaseline:
        'F8: artifacts written before B9 carry no disposition and are UNMEASURABLE; ' +
        'they are counted separately and never averaged into any rate below',
      artifactsRead: review.artifacts.total,
      artifactsByAgent: review.artifactsByAgent,
      reviewDirsOutsideRecordsExcluded: reviewDirsOutsideRecords,
      sessionsWithReview: review.sessionsWithReview + '/' + records.length,
      sessionsMeasurable: review.sessionsMeasurable + '/' + records.length,
      artifactBuckets: review.artifacts,
      findingsTotal: review.rows.length,
      dispositionCoverage: dispositionedRows.length + '/' + review.rows.length,
      measurableCoverage: overall.dispositioned + '/' + review.rows.length,
      preExistingExcluded: preExistingRows.length,
      severityBasis: SEVERITY_BASIS,
      legacySeveritySpellings: legacySeverityRows.length + '/' + overall.dispositioned,
      overall,
      bySeverity: tallyBy(measurableRows, 'severity'),
      byConfidence: tallyBy(measurableRows, 'confidence'),
      confidenceRecorded: measurableRows.filter((row) => row.verified).length + '/' + overall.dispositioned,
      // The gate's two sides and its verdict, in the artifact rather than only
      // in the printed table, so --json carries the decision and not just the
      // numbers behind it.
      verificationGate: {
        input: reviewStandard ? reviewStandard.PRECISION_GATE.input : null,
        minSample: reviewStandard ? reviewStandard.PRECISION_GATE.minSample : null,
        minSampleReason: reviewStandard ? reviewStandard.PRECISION_GATE.minSampleReason : null,
        unverified: unverifiedPrecision,
        verified: verifiedPrecision,
        verdict: gate.verdict,
        reason: gate.reason,
        // F11: what each side ran on, and the named confound when they cannot
        // be shown to be one reviewer. `confound` is null when the gate got as
        // far as comparing precision at all.
        modelPrecondition: reviewStandard ? reviewStandard.PRECISION_GATE.modelPrecondition : null,
        models: gate.models,
        confound: gate.confound || null,
      },
      modelRecorded: modelRecordedRows.length + '/' + overall.dispositioned,
      byModel: tallyBy(modelRecordedRows, 'model'),
      byAgent: tallyBy(measurableRows, 'agent'),
      byDimension: tallyBy(dimensionRows, 'dimension'),
      dimensionRecorded: dimensionRows.length + '/' + overall.dispositioned,
      rows: review.rows,
    },
    agents: {
      enumerated: agents,
      spawns: spawnRows,
      zeroSpawn,
      pairing: timing.available ? timing.pairing : null,
    },
    modelSource,
    models: models.rows,
    noPolicyRoleAgents: models.noPolicyRoleAgents,
    nonPhantomAgents,
    wallTime: {
      coverage: wallTimes.length + '/' + records.length,
      totalMs: wallTimes.length ? wallTimes.reduce((a, b) => a + b, 0) : null,
      medianMs: median(wallTimes),
    },
    absent: {
      fixLoops: {
        value: null,
        wrapCoverage: wrapFixLoops + '/' + records.length,
        verificationCoverage: verifFixLoops + '/' + records.length,
      },
      cost: { value: null, wrapCoverage: wrapCost + '/' + records.length },
    },
    schemaDrift: {
      topWrapKeys: [...keyFreq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6),
      prStatusVariants: [...statusFreq.entries()].sort((a, b) => b[1] - a[1]),
    },
    unresolved,
  };
}

function pct(n) {
  return n == null ? 'absent' : (n * 100).toFixed(1) + '%';
}

function dur(ms) {
  if (ms == null) return 'absent';
  if (ms >= 3600000) return (ms / 3600000).toFixed(1) + 'h';
  if (ms >= 60000) return (ms / 60000).toFixed(1) + 'm';
  return (ms / 1000).toFixed(1) + 's';
}

// The precision BAND for one tally, or an explicit UNMEASURABLE. Never prints a
// number over an empty denominator - that is the whole F8 hazard in one line.
function precisionBand(p) {
  if (!p || p.dispositioned === 0) return 'UNMEASURABLE - no measurable finding here';
  return (
    pct(p.precisionLower) +
    ' lower / ' +
    (p.precisionUpper == null ? 'n/a (every disposition is deferred)' : pct(p.precisionUpper) + ' upper')
  );
}

// One breakdown table (severity / agent / dimension). Dispositioned findings
// only; the caller has already filtered, and an empty table says why rather
// than printing a row of zeros.
function printTally(w, label, tally, emptyReason) {
  w('    BY ' + label + ' (measurable findings only)');
  if (!tally.length) {
    w('      absent - ' + emptyReason);
    return;
  }
  w('      ' + 'value'.padEnd(22) + 'n'.padStart(4) + 'fixed'.padStart(7) + 'dismis'.padStart(8) +
    'defer'.padStart(7) + '   precision');
  for (const t of tally) {
    w('      ' + String(t.key).slice(0, 21).padEnd(22) +
      String(t.dispositioned).padStart(4) +
      String(t.fixed).padStart(7) +
      String(t.dismissed).padStart(8) +
      String(t.deferred).padStart(7) +
      '   ' + precisionBand(t));
  }
}

// B11's promote/revert verdict, printed with BOTH sides of the comparison so the
// verdict is never readable without the evidence under it. Modelled on B6's
// wall-clock gate: one input, one comparison, one verdict word.
// One side's reviewer models, F11-style: what was recorded, and how much of the
// side recorded nothing. "unrecorded" is printed as a count, never blanked.
function sideModels(side) {
  if (!side) return 'unrecorded';
  const named = side.models && side.models.length ? side.models.join('+') : 'none recorded';
  return side.unrecorded > 0 ? named + ' (' + side.unrecorded + '/' + side.n + ' unrecorded)' : named;
}

function printVerificationGate(w, gate, confidenceRecorded) {
  w('    VERIFICATION GATE (B11) - promote or revert the verification pass on measured precision');
  if (!gate) {
    w('      absent - scripts/lib/review-standard.js not loadable');
    return;
  }
  w('      input                  ' + (gate.input || 'unavailable'));
  w('      confidence recorded    ' + confidenceRecorded + ' measurable finding(s)');
  w('      unverified (before)    ' + precisionBand(gate.unverified) + '   n=' + (gate.unverified ? gate.unverified.dispositioned : 0) +
    '   model ' + sideModels(gate.models && gate.models.before));
  w('      verified   (after)     ' + precisionBand(gate.verified) + '   n=' + (gate.verified ? gate.verified.dispositioned : 0) +
    '   model ' + sideModels(gate.models && gate.models.after));
  w('      model precondition     ' + (gate.modelPrecondition || 'unavailable'));
  w('      minimum sample         ' + (gate.minSample == null ? 'UNSET - ' + (gate.minSampleReason || '') : gate.minSample));
  if (gate.confound) w('      CONFOUND               ' + gate.confound.toUpperCase() + ' - no verdict is produced, and none is estimated');
  w('      VERDICT                ' + gate.verdict.toUpperCase() + ' - ' + gate.reason);
}

function printReviewFindings(w, rf) {
  // Measurable rows first - they are what the section is for - then the ones
  // excluded by rule, then the ones with no disposition at all.
  const rank = (row) => (!row.disposition ? 2 : row.preExisting ? 1 : 0);
  const rows = [...rf.rows].sort((a, b) => rank(a) - rank(b));
  const shown = rows.slice(0, REVIEW_ROWS_SHOWN);

  w('');
  w('  REVIEW FINDINGS - per-finding disposition (B9)');
  w('    metric: ' + rf.metric);
  w('    RE-BASELINE (F8): a pre-B9 artifact carries NO disposition. Those findings are');
  w('      counted as unmeasurable and never averaged into any rate below.');
  w('');
  w('    reviewer artifacts read  ' + rf.artifactsRead +
    (rf.artifactsByAgent.length ? '   (' + rf.artifactsByAgent.map(([a, n]) => a + ':' + n).join(' ') + ')' : ''));
  w('    sessions with a review   ' + rf.sessionsWithReview + '   measurable ' + rf.sessionsMeasurable);
  w('    artifact buckets         measured ' + rf.artifactBuckets.measured +
    '   partly ' + rf.artifactBuckets.partial +
    '   unmeasured ' + rf.artifactBuckets.unmeasured +
    '   clean/no findings ' + rf.artifactBuckets.clean);
  w('    findings                 ' + rf.findingsTotal + '   with a disposition ' + rf.dispositionCoverage +
    '   measurable ' + rf.measurableCoverage);
  if (rf.preExistingExcluded > 0) {
    w('      preExisting excluded   ' + rf.preExistingExcluded +
      '  (B10 defers these BY RULE - they never entered the fix loop)');
  }
  w('    disposition              fixed ' + rf.overall.fixed +
    '   dismissed ' + rf.overall.dismissed +
    '   deferred ' + rf.overall.deferred);
  w('    precision                ' + precisionBand(rf.overall));
  if (rf.overall.dispositioned > 0) {
    w('                             [lower = fixed/(fixed+dismissed+deferred); upper = fixed/(fixed+dismissed)]');
  }
  w('    severity basis           ' + rf.severityBasis);
  w('');
  w('    PER FINDING (one row per finding id; ' + rf.measurableCoverage + ' measurable)');
  if (!rows.length) {
    w('      none - no reviewer artifact on disk holds a finding');
  } else {
    w('      ' + 'id'.padEnd(17) + 'agent'.padEnd(9) + 'severity'.padEnd(11) + 'dimension'.padEnd(12) +
      'disposition'.padEnd(13) + 'ticket'.padEnd(14) + 'file');
    for (const row of shown) {
      w('      ' + ((row.idSource === 'derived' ? '~' : '') + row.id).padEnd(17) +
        String(row.agent || '-').slice(0, 8).padEnd(9) +
        String(row.severity || '-').slice(0, 10).padEnd(11) +
        String(row.dimension || '-').slice(0, 11).padEnd(12) +
        ((row.disposition || '(none)') + (row.preExisting ? '*' : '')).padEnd(13) +
        String(row.ticket || '-').slice(0, 13).padEnd(14) +
        String(row.file || '-'));
    }
    if (rows.length > shown.length) w('      + ' + (rows.length - shown.length) + ' more row(s) - use --json for all');
    w('      ~ = id derived here from finding content, NOT recorded on disk (pre-B9 finding)');
    w('      * = preExisting: deferred by rule, never entered the fix loop - excluded from every rate');
    w('      (none) = no disposition recorded (written before B9, or the fix loop never closed) - not counted');
  }
  w('');
  printTally(w, 'SEVERITY', rf.bySeverity, 'no measurable finding yet');
  printTally(
    w,
    'CONFIDENCE',
    rf.byConfidence,
    'no measurable finding carries a `confidence` - every one predates the B11 verification pass'
  );
  printVerificationGate(w, rf.verificationGate, rf.confidenceRecorded);
  printTally(w, 'AGENT', rf.byAgent, 'no measurable finding yet');
  printTally(
    w,
    'MODEL',
    rf.byModel,
    'reviewer model recorded on ' + rf.modelRecorded +
      ' measurable findings - F11 added the optional per-artifact `model` field, and until a' +
      ' reviewer or the harness records it the B11 gate above refuses to compare the two' +
      ' populations rather than assume they ran on one model'
  );
  printTally(
    w,
    'DIMENSION',
    rf.byDimension,
    'dimension recorded on ' + rf.dimensionRecorded +
      ' measurable findings - B10 added the optional `findings[].dimension` field, so' +
      ' this fills in as Archer writes post-B10 findings; Gaze has no dimension' +
      ' vocabulary and omits the key by design'
  );
}

function printHuman(r) {
  const w = (s) => process.stdout.write(s + '\n');

  w('');
  w('  Phantom baseline - ' + r.dataRoot);
  w('  ' + r.ts);
  w('');
  w('  CORPUS');
  w('    wrap.json files on disk  ' + r.corpus.wrapFilesOnDisk);
  w('      nested copies excluded ' + r.corpus.nestedWrapCopiesExcluded + '  (inputs/, runs/<run>/ duplicates of a canonical record)');
  w('      off-bucket excluded    ' + r.corpus.offBucketWrapFilesExcluded + '  (legacy nesting outside <repo>/{sessions,completed}/<ticket>/)');
  w('    canonical wrap records   ' + r.corpus.wrapRecords + '  <- every rate below is over this');
  w('    distinct tickets         ' + r.corpus.distinctTickets);
  w('    verification.json read   ' + r.corpus.verificationRecords);
  w('    outcome.json present     ' + r.corpus.outcomeRecords);
  w('    timing records           ' + (r.corpus.timingRecords == null ? 'absent' : r.corpus.timingRecords));
  w('    distinct wrap.json keys  ' + r.corpus.distinctWrapKeys + '  (no schema - this is the drift)');
  w('    distinct pr.status text  ' + r.corpus.distinctWrapPrStatusValues + '  (free text, NOT used for merge rate)');
  w('');
  w('  REPO PATH RESOLUTION (existing repos/.aliases.json)');
  w('    canonical ' + r.pathResolution.canonical +
    '   aliased ' + r.pathResolution.aliased +
    '   unmapped ' + r.pathResolution.unmapped +
    '   ambiguous ' + r.pathResolution.ambiguous);
  w('');
  w('  OUTCOMES');
  w('    tickets attempted        ' + r.corpus.wrapRecords);
  w('    with a PR url            ' + r.prs.ticketsWithPrUrl + '  (' + pct(r.prs.prCreatedRate) + ' PR created)');
  w('    distinct PR urls         ' + r.prs.distinctPrUrls);
  w('    gh resolved / unresolved ' + r.prs.ghResolved + ' / ' + r.prs.ghUnresolved +
    (r.prs.ghQueried ? '  (' + r.prs.ghRequests + ' graphql request(s))' : '  (gh not queried)'));
  w('    pr_state (closed enum)   merged ' + r.prs.stateCounts.merged +
    '  open ' + r.prs.stateCounts.open +
    '  draft ' + r.prs.stateCounts.draft +
    '  closed ' + r.prs.stateCounts.closed);
  w('    settled / unfinished     ' + r.prs.settledPrs + ' (merged+closed) / ' + r.prs.unfinishedPrs +
    ' (open+draft)  <- only SETTLED PRs are in the merge-rate denominator (F12)');
  w('    merge rate               ' + pct(r.prs.mergeRate) +
    (r.prs.mergeRateBasis ? '  [' + r.prs.mergeRateBasis + ']' : ''));
  w('');
  w('  REVIEW CYCLES');
  w('    gh reviews  median ' + (r.reviewCycles.ghReviewsMedian == null ? 'absent' : r.reviewCycles.ghReviewsMedian) +
    '  total ' + r.reviewCycles.ghReviewsTotal + '  coverage ' + r.reviewCycles.ghReviewsCoverage);
  w('    gh comments total ' + r.reviewCycles.ghCommentsTotal);
  w('    greptile iterations median ' +
    (r.reviewCycles.greptileIterationsMedian == null ? 'absent' : r.reviewCycles.greptileIterationsMedian) +
    '  coverage ' + r.reviewCycles.greptileIterationsCoverage);
  printReviewFindings(w, r.reviewFindings);
  w('');
  w('  AGENT SPAWNS (all ' + r.agents.enumerated.length + ' agents in agents/)');
  for (const row of r.agents.spawns) {
    w('    ' + row.agent.padEnd(14) + (row.spawns == null ? 'absent' : String(row.spawns).padStart(5)));
  }
  w('    zero-spawn agents: ' + (r.agents.zeroSpawn.length ? r.agents.zeroSpawn.join(', ') : 'none'));
  if (r.agents.pairing) w('    pairing: ' + r.agents.pairing);
  w('');
  w('  MODEL: POLICY vs FRONTMATTER vs OBSERVED');
  w('    ' + 'agent'.padEnd(14) + 'profile'.padEnd(10) + 'expected'.padEnd(10) + 'frontmatter'.padEnd(13) + 'drift'.padEnd(20) + 'observed');
  for (const m of r.models) {
    w('    ' + m.agent.padEnd(14) +
      String(m.policyProfile || '-').padEnd(10) +
      String(m.expectedModel || '-').padEnd(10) +
      String(m.frontmatterModel || '(inherit)').padEnd(13) +
      m.drift.padEnd(20) +
      (m.observedModels.length ? m.observedModels.join(' ') : '-'));
  }
  w('');
  w('  WALL TIME');
  w('    coverage ' + r.wallTime.coverage + '   total ' + dur(r.wallTime.totalMs) + '   median ' + dur(r.wallTime.medianMs));
  w('');
  w('  ABSENT (coverage only - never estimated)');
  w('    fix_loops: absent - wrap.json ' + r.absent.fixLoops.wrapCoverage +
    ', verification.json review.fixLoops ' + r.absent.fixLoops.verificationCoverage);
  w('    cost:      absent - wrap.json ' + r.absent.cost.wrapCoverage);
  w('');
  w('  UNRESOLVED (' + r.unresolved.length + ')');
  for (const u of r.unresolved) w('    ' + u.field + ': ' + u.reason);
  w('');
}

function usageError(msg) {
  return new PhantomError(msg, 'VALIDATION_ERROR');
}

function parseArgs(argv) {
  const opts = { noGh: false, ghLimit: null, json: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--no-gh') opts.noGh = true;
    else if (a === '--gh-limit') {
      const n = Number(argv[++i]);
      if (!Number.isInteger(n) || n < 0) throw usageError('--gh-limit requires a non-negative integer');
      opts.ghLimit = n;
    } else if (a === '--json') opts.json = true;
    else if (a === '--help' || a === '-h') opts.help = true;
    else throw usageError('unknown option: ' + a);
  }
  return opts;
}

function main(argv = process.argv.slice(2)) {
  let opts;
  try {
    opts = parseArgs(argv);
  } catch (e) {
    process.stderr.write('baseline-report: ' + e.message + '\n' + USAGE);
    process.exitCode = exitCodeForError(e);
    return;
  }
  if (opts.help) {
    process.stdout.write(USAGE);
    process.exitCode = 0;
    return;
  }

  const result = runBaseline(opts);
  if (opts.json) process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  else printHuman(result);
  process.exitCode = 0;
}

module.exports = { runBaseline, ghStateToEnum, resolveRepoId, main };

if (require.main === module) {
  try {
    main();
  } catch (err) {
    reportError(err);
  }
}
