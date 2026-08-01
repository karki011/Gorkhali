#!/usr/bin/env node
// Author: Subash Karki
// baseline-report.js - read-only retrospective miner over the existing Phantom corpus.
//
// READ-ONLY: this script has NO side effects - no writes, no mkdir, no mutation.
// It reads wrap.json / verification.json / outcome.json under
// <data>/repos/<repo>/{sessions,completed}/<ticket>/, the timing jsonl, and the
// role/model policy references, then prints one baseline table.
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
const historicalAliases = require('./lib/historical-repo-aliases');

const USAGE =
  'usage: node scripts/baseline-report.js [--no-gh] [--gh-limit <N>] [--json]\n';

// Aliases per GraphQL request. Each pullRequest(number:) alias is one node fetch,
// so this only bounds request size - it is not a rate limit.
const GH_BATCH_SIZE = 50;

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
function findRecordDirs(dataRoot) {
  const reposRoot = path.join(dataRoot, 'repos');
  const canonical = [];
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
      if (e.isDirectory()) walk(path.join(dir, e.name), segments.concat(e.name));
      else if (e.name === 'wrap.json') hasWrap = true;
      else if (e.name === 'outcome.json') hasOutcome = true;
    }
    if (!hasWrap && !hasOutcome) return;
    if (!bucketed) offBucket += hasWrap ? 1 : 0;
    else if (segments.length === 3) {
      canonical.push({ repoDir: segments[0], bucket: segments[1], ticket: segments[2], dir, hasWrap });
    } else nestedCopies += hasWrap ? 1 : 0;
  }

  walk(reposRoot, []);
  return { canonical, nestedCopies, offBucket };
}

// This explicit historical report resolves an on-disk repository directory name
// through the offline alias map (`repos/.aliases.json`). Normal runtime never
// consults this map. The `.migrated-away` / `.migrated-away-migrated`
// suffixes are migration bookkeeping, not part of any id, so they are stripped
// before the lookup. An AMBIGUOUS alias (non-string sentinel) is reported as
// ambiguous and NEVER collapsed onto either claimant.
function resolveRepoId(dataRoot, repoDir) {
  const base = repoDir.replace(/(\.migrated-away)+(-migrated)*$/, '');
  if (historicalAliases.isAmbiguousAlias(dataRoot, base)) {
    return { id: base, resolution: 'ambiguous' };
  }
  const canonical = historicalAliases.resolveCanonical(dataRoot, base);
  if (canonical !== base) return { id: canonical, resolution: 'aliased' };
  const known = Object.prototype.hasOwnProperty.call(historicalAliases.readAliasMap(dataRoot), base);
  return { id: base, resolution: known ? 'canonical' : 'unmapped' };
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
      verificationFixLoops: verification
        ? (typeof verification.review?.fixLoops === 'number' && verification.review.fixLoops >= 0
          ? verification.review.fixLoops
          : 0)
        : null,
      hasVerificationFixLoops: !!(
        verification && verification.review && typeof verification.review.fixLoops === 'number'
      ),
      wallTimeMs: sessionWallTimeMs(session),
      outcome,
    });
  }
  return { records, pathResolution, nestedCopies: files.nestedCopies, offBucket: files.offBucket };
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

// ── role passes vs model policy ─────────────────────────────────────────────

function agentNames() {
  const policy = loadJson(POLICY_PATH);
  return policy && policy.roles ? Object.keys(policy.roles).sort() : [];
}

// Expected model per role: model-policy.json role -> profile, resolved through
// model-presets.json for the claude-code host. Neither file is modified.
//
// Role names and profiles come directly from policy. Checked-in agent prompts do
// not participate in resolution; host adapters map semantic profiles to models.
function modelExpectations(agents, timing) {
  const policy = loadJson(POLICY_PATH);
  const presets = loadJson(PRESETS_PATH);
  const profiles =
    presets && presets.hosts && presets.hosts[PRESET_HOST] ? presets.hosts[PRESET_HOST].profiles : null;
  if (!policy || !policy.roles || !profiles) {
    return { rows: [], unresolved: 'model-policy.json or model-presets.json unreadable' };
  }

  const rows = [];
  for (const agent of agents) {
    const profile = policy.roles[agent] || null;
    if (!profile) continue;
    const preset = profiles[profile];
    const expected = preset ? preset.model : null;
    const observed = timing.available ? observedModels(timing, agent) : [];

    rows.push({
      agent,
      policyProfile: profile,
      expectedModel: expected,
      observedModels: observed,
    });
  }
  return { rows, unresolved: null };
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
  const { records, pathResolution, nestedCopies, offBucket } = readCorpus(dataRoot);

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
  if (agents.length === 0) unresolved.push({ field: 'agents', reason: 'model policy contains no roles' });
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
      '; historical verification.json review.fixLoops present in ' +
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
      mergeRate: ghResolved ? stateCounts.merged / ghResolved : null,
      mergeRateBasis: ghResolved
        ? 'gh ground truth over ' + ghResolved + ' resolved distinct PR urls'
        : null,
    },
    reviewCycles: {
      ghReviewsMedian: median(reviewCounts),
      ghReviewsTotal: reviewCounts.reduce((a, b) => a + b, 0),
      ghReviewsCoverage: reviewCounts.length + '/' + prRefs.length,
      ghCommentsTotal: commentCounts.reduce((a, b) => a + b, 0),
      greptileIterationsMedian: median(greptileIterations),
      greptileIterationsCoverage: greptileIterations.length + '/' + records.length,
    },
    agents: {
      enumerated: agents,
      spawns: spawnRows,
      zeroSpawn,
      pairing: timing.available ? timing.pairing : null,
    },
    modelSource,
    models: models.rows,
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
  w('');
  w('  ROLE PASS SPAWNS (all ' + r.agents.enumerated.length + ' policy roles)');
  for (const row of r.agents.spawns) {
    w('    ' + row.agent.padEnd(14) + (row.spawns == null ? 'absent' : String(row.spawns).padStart(5)));
  }
  w('    zero-spawn agents: ' + (r.agents.zeroSpawn.length ? r.agents.zeroSpawn.join(', ') : 'none'));
  if (r.agents.pairing) w('    pairing: ' + r.agents.pairing);
  w('');
  w('  MODEL: POLICY vs OBSERVED');
  w('    ' + 'role'.padEnd(14) + 'profile'.padEnd(10) + 'expected'.padEnd(14) + 'observed');
  for (const m of r.models) {
    w('    ' + m.agent.padEnd(14) +
      String(m.policyProfile || '-').padEnd(10) +
      String(m.expectedModel || '-').padEnd(14) +
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
