#!/usr/bin/env node
// Author: Subash Karki
// run-evals.js — Runs evals/evals.json against the claude CLI.
// Kinds: trigger (default when absent) | route | convention. See evals/README.md.
// Usage: run-evals.js [--filter <skill|kind|id[,..]>] [--model <alias>]
//        [--dry-run] [--baseline] [--date <YYYY-MM-DD>] [--concurrency N]
//        [--keep-transcripts <dir>]
// Env: PHANTOM_EVAL_TIMEOUT_S (per-case cap, default 60)
//      PHANTOM_EVAL_JUDGE_MODEL (llm-judge model, default haiku)
//      PHANTOM_EVAL_CLAUDE_BIN  (claude binary override)
//      PHANTOM_EVAL_DATE        (baseline date fallback for --baseline)
// Live runs spend tokens — `npm run evals` stays --dry-run by default.
// Exit 0 = all pass (or clean dry run), 1 = any failure.

'use strict';

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const EVALS_FILE = path.join(ROOT, 'evals', 'evals.json');
const BASELINES_DIR = path.join(ROOT, 'evals', 'baselines');

const KINDS = ['trigger', 'route', 'convention'];
const ROUTES = ['DIRECT', 'PLAN', 'BRAINSTORM', 'FULL'];
const JUDGE_TRANSCRIPT_CAP = 20000;

const USAGE = `Usage: node scripts/run-evals.js [--filter <skill|kind|id[,..]>] [--model <alias>]
       [--dry-run] [--baseline] [--date <YYYY-MM-DD>] [--concurrency N]
       [--keep-transcripts <dir>]`;

function parseArgs(argv) {
  const opts = { filter: null, model: null, dryRun: false, baseline: false, date: null, concurrency: 2, keepTranscripts: null };
  // A silently-missing value (e.g. a bare --filter on a live run) would
  // execute ALL cases — a token hazard. Fail loud instead.
  const takeValue = (flag, i) => {
    const v = argv[i];
    if (v === undefined || v.startsWith('--')) throw new Error(`${flag} requires a value`);
    return v;
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') opts.dryRun = true;
    else if (a === '--baseline') opts.baseline = true;
    else if (a === '--filter') opts.filter = takeValue(a, ++i);
    else if (a === '--model') opts.model = takeValue(a, ++i);
    else if (a === '--date') opts.date = takeValue(a, ++i);
    else if (a === '--concurrency') opts.concurrency = parseInt(takeValue(a, ++i), 10);
    else if (a === '--keep-transcripts') opts.keepTranscripts = takeValue(a, ++i);
    else throw new Error(`unknown argument: ${a}`);
  }
  if (!Number.isInteger(opts.concurrency) || opts.concurrency < 1) {
    throw new Error('--concurrency must be a positive integer');
  }
  return opts;
}

function kindOf(c) {
  return c.kind === undefined ? 'trigger' : c.kind;
}

function validateCase(c) {
  if (!c || typeof c !== 'object') return ['case must be an object'];
  const errs = [];
  if (!Number.isInteger(c.id)) errs.push('id must be an integer');
  if (typeof c.skill !== 'string' || !c.skill) errs.push('skill must be a non-empty string');
  if (typeof c.prompt !== 'string' || !c.prompt) errs.push('prompt must be a non-empty string');
  const kind = kindOf(c);
  if (!KINDS.includes(kind)) {
    errs.push(`unknown kind "${c.kind}" (expected ${KINDS.join('|')})`);
    return errs;
  }
  if (kind === 'trigger') {
    if (typeof c.should_trigger !== 'boolean') errs.push('trigger case needs boolean should_trigger');
  } else if (kind === 'route') {
    if (!ROUTES.includes(c.expected_route)) errs.push(`route case needs expected_route in ${ROUTES.join('|')}`);
  } else {
    const chk = c.expected_check;
    if (!chk || typeof chk !== 'object') {
      errs.push('convention case needs expected_check object');
    } else if (chk.type === 'regex') {
      if (typeof chk.pattern !== 'string' || !chk.pattern) {
        errs.push('regex check needs non-empty string pattern');
      } else {
        try { new RegExp(chk.pattern); } catch { errs.push(`invalid regex pattern: ${chk.pattern}`); }
      }
    } else if (chk.type === 'llm-judge') {
      if (typeof chk.criteria !== 'string' || !chk.criteria) errs.push('llm-judge check needs non-empty string criteria');
    } else {
      errs.push('expected_check.type must be "regex" or "llm-judge"');
    }
  }
  return errs;
}

// Accepts both the shipped wrapper ({skill_name, version, evals: [...]}) and a bare array.
function validateEvals(doc) {
  const cases = Array.isArray(doc) ? doc : (doc && Array.isArray(doc.evals) ? doc.evals : null);
  if (!cases) return { cases: [], errors: ['evals.json must be an array or an object with an "evals" array'] };
  const errors = [];
  const seen = new Set();
  for (const c of cases) {
    const hasId = Boolean(c) && c.id !== undefined;
    const id = hasId ? c.id : '?';
    for (const e of validateCase(c)) errors.push(`case ${id}: ${e}`);
    // id-less entries already fail validation; checking them for duplicates
    // would make every pair of them collide on the '?' placeholder.
    if (!hasId) continue;
    if (seen.has(c.id)) errors.push(`case ${c.id}: duplicate id`);
    seen.add(c.id);
  }
  return { cases, errors };
}

function matchesFilter(c, filter) {
  if (!filter) return true;
  return filter.split(',').some((f) => f === String(c.id) || f === kindOf(c) || c.skill.includes(f));
}

// `setup` is a fixture DESCRIPTION (config.yaml content / lockfile / env vars),
// not machine-readable — it is fed to the agent as assumed context, not materialized on disk.
function casePrompt(c) {
  if (kindOf(c) !== 'convention' || !c.setup) return c.prompt;
  const setup = typeof c.setup === 'string' ? c.setup : JSON.stringify(c.setup, null, 2);
  return `Assume this environment fixture exists:\n${setup}\n\n${c.prompt}`;
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Invocation = Skill tool input in stream-json, the prose form Skill(skill="..."),
// or a slash command. A bare prose mention of the skill name does NOT count.
function skillInvoked(transcript, skill) {
  const name = escapeRegExp(skill);
  return new RegExp(`"skill"\\s*:\\s*"${name}"`).test(transcript)
    || new RegExp(`Skill\\(skill="${name}"`).test(transcript)
    || new RegExp(`(^|[\\s"'\`(])/${name}\\b`, 'm').test(transcript);
}

function judgeTrigger(transcript, c) {
  const invoked = skillInvoked(transcript, c.skill);
  return {
    pass: invoked === c.should_trigger,
    reason: `skill ${invoked ? 'invoked' : 'not invoked'}, expected should_trigger=${c.should_trigger}`,
  };
}

// commands/start.md Phase B reports the route as "[{ROUTE}] {rationale}" at line
// start. In the stream-json transcript "line start" means: start of a JSON string
// value (`"`), an escaped newline inside it (`\n` as two chars), or a real
// line start. Mid-sentence prose mentions never anchor, so they are ignored.
function reportLineRoutes(transcript) {
  const re = new RegExp(`(?:^|\\n|\\\\n|")\\s*\\[(${ROUTES.join('|')})\\]`, 'g');
  const found = new Set();
  let m;
  while ((m = re.exec(transcript)) !== null) found.add(m[1]);
  return [...found];
}

// Pass requires the report-line route(s) to be exactly {expected_route} — a
// second distinct report-line route means the run was ambiguous, which fails.
function judgeRoute(transcript, c) {
  const routes = reportLineRoutes(transcript);
  return {
    pass: routes.length === 1 && routes[0] === c.expected_route,
    reason: `expected [${c.expected_route}], report-line route(s): ${routes.length ? routes.map((r) => `[${r}]`).join(' ') : 'none'} (prose mentions ignored)`,
  };
}

function judgeConventionRegex(transcript, c) {
  const pattern = c.expected_check.pattern;
  const pass = new RegExp(pattern).test(transcript);
  return { pass, reason: `${pass ? 'matched' : 'no match for'} /${pattern}/` };
}

// Judge may wrap the JSON in prose/fences; pull the first object with a boolean `pass`.
function parseJudgeResponse(stdout) {
  const text = String(stdout);
  const candidates = [text.trim()];
  const greedy = text.match(/\{[\s\S]*\}/);
  if (greedy) candidates.push(greedy[0]);
  candidates.push(...(text.match(/\{[\s\S]*?\}/g) || []));
  for (const s of candidates) {
    try {
      const o = JSON.parse(s);
      if (o && typeof o.pass === 'boolean') return { pass: o.pass, reason: String(o.reason || '') };
    } catch { /* keep scanning */ }
  }
  return null;
}

// results: { [id]: 'pass'|'fail' } for the current run.
function diffBaseline(baselineCases, results) {
  const prev = baselineCases || {};
  const drift = { regressions: [], improvements: [], added: [], removed: [] };
  for (const [id, was] of Object.entries(prev)) {
    const now = results[id];
    if (now === undefined) drift.removed.push(id);
    else if (was === 'pass' && now === 'fail') drift.regressions.push(id);
    else if (was === 'fail' && now === 'pass') drift.improvements.push(id);
  }
  for (const id of Object.keys(results)) if (!(id in prev)) drift.added.push(id);
  return drift;
}

function baselinePath(model) {
  const name = (model || 'default').replace(/[^A-Za-z0-9._-]/g, '_');
  return path.join(BASELINES_DIR, `${name}.json`);
}

function judgeLabel(c) {
  const kind = kindOf(c);
  if (kind === 'trigger') return `deterministic: should_trigger=${c.should_trigger}`;
  if (kind === 'route') return `deterministic: expect [${c.expected_route}]`;
  return c.expected_check.type === 'regex' ? 'deterministic: regex' : 'llm-judge (extra judge call)';
}

// stream-json emits one event per line; a completed assistant turn shows up as
// a {"type":"assistant",...} event. Used to qualify negatives on partial transcripts.
function hasAssistantTurn(transcript) {
  return /"type"\s*:\s*"assistant"/.test(transcript);
}

// Decisive mid-stream evidence per kind, used to kill the child early and save
// tokens. Trigger: invocation appearing is decisive either way (pass for
// should_trigger:true, fail for near-misses). Absence is never decisive mid-run.
// Route/regex delegate to the final judges so mid-stream evidence can never
// drift from the verdict logic. llm-judge has no deterministic evidence — no early exit.
function evidencePredicate(c) {
  const kind = kindOf(c);
  if (kind === 'trigger') return (out) => skillInvoked(out, c.skill);
  if (kind === 'route') return (out) => judgeRoute(out, c).pass;
  if (c.expected_check.type === 'regex') return (out) => judgeConventionRegex(out, c).pass;
  return null;
}

// Timeout is NOT an automatic failure: heavy skills (e.g. phantom:start) never
// finish inside a headless budget, but trigger/route evidence lands in the
// first turns — so the partial transcript is judged with the normal logic.
function finalizeVerdict(c, verdict, run, timeoutMs) {
  const sec = timeoutMs / 1000;
  const kind = kindOf(c);
  if (run.earlyExited) {
    return { id: c.id, status: verdict.pass ? 'PASS' : 'FAIL', reason: `${verdict.reason} (early exit)` };
  }
  if (!run.timedOut) {
    return { id: c.id, status: verdict.pass ? 'PASS' : 'FAIL', reason: verdict.reason };
  }
  if (verdict.pass) {
    // A near-miss "pass" on a timed-out run is absence-of-invocation — weak
    // evidence unless the agent actually got at least one full turn out.
    if (kind === 'trigger' && c.should_trigger === false && !hasAssistantTurn(run.out)) {
      return { id: c.id, status: 'FAIL', reason: `insufficient transcript (timed out at ${sec}s before a completed assistant turn)` };
    }
    return { id: c.id, status: 'PASS', reason: `pass (partial transcript, timed out at ${sec}s)` };
  }
  // Near-miss that DID invoke = positive evidence of failure; everything else
  // failed for lack of evidence in the partial transcript.
  if (kind === 'trigger' && c.should_trigger === false) {
    return { id: c.id, status: 'FAIL', reason: `${verdict.reason} (partial transcript)` };
  }
  return { id: c.id, status: 'FAIL', reason: `no evidence before timeout (${sec}s): ${verdict.reason}` };
}

function runClaude(args, timeoutMs, earlyExit) {
  return new Promise((resolve) => {
    const bin = process.env.PHANTOM_EVAL_CLAUDE_BIN || 'claude';
    const child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    let timedOut = false;
    let earlyExited = false;
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, timeoutMs);
    child.stdout.on('data', (d) => {
      out += d;
      if (earlyExit && !earlyExited && !timedOut && earlyExit(out)) {
        earlyExited = true;
        child.kill('SIGKILL');
      }
    });
    child.stderr.on('data', (d) => { err += d; });
    child.on('error', (e) => { clearTimeout(timer); resolve({ out, err: String(e.message || e), timedOut, earlyExited }); });
    child.on('close', () => { clearTimeout(timer); resolve({ out, err, timedOut, earlyExited }); });
  });
}

async function runLlmJudge(transcript, c, timeoutMs, partial) {
  const judgeModel = process.env.PHANTOM_EVAL_JUDGE_MODEL || 'haiku';
  const prompt = [
    'You are a strict eval judge. Decide if the transcript satisfies the criteria.',
    `Criteria: ${c.expected_check.criteria}`,
    partial ? 'Note: the transcript is PARTIAL — the run was cut off by a timeout. Judge what is present.' : '',
    '--- TRANSCRIPT START ---',
    transcript.slice(0, JUDGE_TRANSCRIPT_CAP),
    '--- TRANSCRIPT END ---',
    'Respond with ONLY strict JSON: {"pass": true|false, "reason": "<short>"}',
  ].filter(Boolean).join('\n');
  const res = await runClaude(['-p', prompt, '--permission-mode', 'plan', '--model', judgeModel], timeoutMs);
  const parsed = parseJudgeResponse(res.out);
  if (!parsed) return { pass: false, reason: `judge output unparseable${res.timedOut ? ' (timeout)' : ''}` };
  return { pass: parsed.pass, reason: `judge: ${parsed.reason || (parsed.pass ? 'criteria met' : 'criteria not met')}` };
}

// Persists a case transcript for triage (--keep-transcripts <dir>).
function saveTranscript(dir, id, out) {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `case-${id}.jsonl`);
  fs.writeFileSync(file, out);
  return file;
}

// stream-json keeps tool_use blocks in the transcript, which the trigger judge needs.
// Note: the installed claude CLI has no --max-turns; plan mode + the per-case timeout bound each run.
async function runCase(c, opts, timeoutMs) {
  const args = ['-p', casePrompt(c), '--permission-mode', 'plan', '--output-format', 'stream-json', '--verbose'];
  if (opts.model) args.push('--model', opts.model);
  const res = await runClaude(args, timeoutMs, evidencePredicate(c));
  if (opts.keepTranscripts && res.out) saveTranscript(opts.keepTranscripts, c.id, res.out);
  if (!res.out) {
    const why = res.timedOut ? `no transcript before timeout (${timeoutMs / 1000}s)` : `no transcript: ${(res.err || 'empty stdout').slice(0, 120).trim()}`;
    return { id: c.id, status: 'FAIL', reason: why };
  }
  const kind = kindOf(c);
  let verdict;
  if (kind === 'trigger') verdict = judgeTrigger(res.out, c);
  else if (kind === 'route') verdict = judgeRoute(res.out, c);
  else if (c.expected_check.type === 'regex') verdict = judgeConventionRegex(res.out, c);
  else verdict = await runLlmJudge(res.out, c, timeoutMs, res.timedOut);
  return finalizeVerdict(c, verdict, res, timeoutMs);
}

async function runPool(cases, opts, timeoutMs) {
  const results = new Array(cases.length);
  let next = 0;
  async function worker() {
    while (next < cases.length) {
      const i = next++;
      results[i] = await runCase(cases[i], opts, timeoutMs);
      const r = results[i];
      console.error(`  [${r.status}] case ${r.id} (${kindOf(cases[i])} ${cases[i].skill})`);
    }
  }
  await Promise.all(Array.from({ length: Math.min(opts.concurrency, cases.length) }, worker));
  return results;
}

function printTable(rows) {
  const pad = (s, n) => String(s).padEnd(n);
  console.log(pad('ID', 5) + pad('KIND', 12) + pad('SKILL', 22) + pad('STATUS', 8) + 'DETAIL');
  for (const r of rows) {
    console.log(pad(r.id, 5) + pad(r.kind, 12) + pad(r.skill, 22) + pad(r.status, 8) + (r.detail || ''));
  }
}

async function main() {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (e) {
    console.error(String(e.message || e));
    console.error(USAGE);
    process.exit(1);
  }

  const doc = JSON.parse(fs.readFileSync(EVALS_FILE, 'utf8'));
  const { cases, errors } = validateEvals(doc);
  if (errors.length) {
    console.error(`evals.json failed validation (${errors.length} problem${errors.length === 1 ? '' : 's'}):`);
    for (const e of errors) console.error(`  - ${e}`);
    process.exit(1);
  }

  const selected = cases.filter((c) => matchesFilter(c, opts.filter));

  if (opts.dryRun) {
    console.log(`Run plan: ${selected.length} of ${cases.length} case(s)`
      + (opts.filter ? ` (filter: ${opts.filter})` : '')
      + (opts.model ? `, model: ${opts.model}` : ''));
    printTable(cases.map((c) => ({
      id: c.id,
      kind: kindOf(c),
      skill: c.skill,
      status: matchesFilter(c, opts.filter) ? 'RUN' : 'SKIP',
      detail: judgeLabel(c),
    })));
    console.log('\nDry run — no claude invocations. Drop --dry-run for a live (token-spending) run.');
    process.exit(0);
  }

  const timeoutMs = (parseInt(process.env.PHANTOM_EVAL_TIMEOUT_S, 10) || 60) * 1000;
  console.error('='.repeat(72));
  console.error(`WARNING: live eval run — ${selected.length} case(s) will invoke the claude CLI and SPEND TOKENS.`);
  console.error(`Per-case timeout ${timeoutMs / 1000}s, concurrency ${opts.concurrency}. Use --filter to narrow, --dry-run to preview.`);
  console.error('='.repeat(72));

  const results = await runPool(selected, opts, timeoutMs);
  const byId = new Map(results.map((r) => [r.id, r]));
  printTable(cases.map((c) => {
    const r = byId.get(c.id);
    return { id: c.id, kind: kindOf(c), skill: c.skill, status: r ? r.status : 'SKIP', detail: r ? r.reason : 'filtered out' };
  }));

  const passes = results.filter((r) => r.status === 'PASS').length;
  const fails = results.length - passes;
  const skips = cases.length - results.length;
  const passRate = results.length ? passes / results.length : 0;
  console.log(`\nSummary: ${passes} pass, ${fails} fail, ${skips} skip — pass rate ${(passRate * 100).toFixed(1)}%`);

  const resultMap = {};
  for (const r of results) resultMap[r.id] = r.status === 'PASS' ? 'pass' : 'fail';

  const bp = baselinePath(opts.model);
  if (opts.baseline) {
    fs.mkdirSync(BASELINES_DIR, { recursive: true });
    const date = opts.date || process.env.PHANTOM_EVAL_DATE || new Date().toISOString().slice(0, 10);
    const baseline = { model: opts.model || 'default', date, cases: resultMap, passRate: Number(passRate.toFixed(3)) };
    fs.writeFileSync(bp, JSON.stringify(baseline, null, 2) + '\n');
    console.log(`Baseline written: ${path.relative(ROOT, bp)}`);
  } else if (fs.existsSync(bp)) {
    const baseline = JSON.parse(fs.readFileSync(bp, 'utf8'));
    const drift = diffBaseline(baseline.cases, resultMap);
    console.log(`\nDrift vs ${path.relative(ROOT, bp)} (${baseline.date}):`);
    if (!drift.regressions.length && !drift.improvements.length) console.log('  no flips');
    for (const id of drift.regressions) console.log(`  REGRESSION: case ${id} pass -> fail`);
    for (const id of drift.improvements) console.log(`  improvement: case ${id} fail -> pass`);
    if (drift.added.length) console.log(`  not in baseline: ${drift.added.join(', ')}`);
    if (drift.removed.length) console.log(`  in baseline but not run: ${drift.removed.join(', ')}`);
  }

  process.exit(fails > 0 ? 1 : 0);
}

if (require.main === module) {
  main().catch((e) => {
    console.error(String(e && e.stack ? e.stack : e));
    process.exit(1);
  });
}

module.exports = {
  parseArgs,
  kindOf,
  validateCase,
  validateEvals,
  matchesFilter,
  casePrompt,
  skillInvoked,
  judgeTrigger,
  judgeRoute,
  judgeConventionRegex,
  parseJudgeResponse,
  diffBaseline,
  hasAssistantTurn,
  evidencePredicate,
  finalizeVerdict,
  saveTranscript,
};
