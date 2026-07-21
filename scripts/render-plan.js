// Author: Subash Karki
// render-plan.js - deterministic plan.json -> plan.html renderer for the PLAN
// gate. Reads a session's plan.json and emits a self-contained HTML artifact
// (inline CSS, zero external requests) beside it so phantom:annotate has a real
// surface to open. plan.json is the source of truth; this file only presents it.
//
// Presentation runs entirely through scripts/lib/html-kit.js - the shared
// CloudZero design kit both gate renderers import. This file owns section logic
// (what plan vocabulary becomes which section, in what order); the kit owns the
// tokens, the primitives, and the universal smart-value fall-through renderer.
//
// Design contract:
//  - Input tolerance: plan.json shapes vary session-to-session. We render what
//    exists, skip what doesn't, and NEVER throw on a missing field. Unknown keys
//    fall through visibly - top-level ones into an "Other fields" section via
//    kit.smartValue (readable definition lists, never a raw JSON wall), and
//    unclaimed task/wave keys into per-task/per-wave fall-through cards.
//    Absorption direction is show, not hide: a key is excluded from fall-through
//    only when a dedicated section actually rendered it.
//  - First-class real-world vocabulary: top-level title/goal/ticket (headline),
//    summary, verified_facts, decisions_for_approval, plan-check verdict, waves,
//    wiring, test_plan, conventions_contract, risks, estimate, assumptions, and
//    constraints each get a dedicated readable section. A sibling intent.json
//    (goal/problem/tradeoffs) and wiring.json (dependencies/riskPoints) are
//    auto-discovered next to plan.json and rendered as the narrative lead and
//    dependency topology. Every field is optional; absence renders no section.
//  - Escaping is load-bearing: every string from plan.json is UNTRUSTED. The kit
//    escapes on the way in; a field of `<script>alert(1)</script>` renders inert.
//  - Determinism: no Date/random anywhere in the output. Two runs on the same
//    input are byte-identical. Object keys iterate in insertion order.
//  - Failure taxonomy via scripts/lib/axi-error.js: missing arg / unreadable
//    file / invalid JSON -> PhantomError(VALIDATION_ERROR) -> exit 2. We set
//    process.exitCode and return; never process.exit (which truncates writes).
'use strict';

const fs = require('fs');
const path = require('path');
const { PhantomError, reportError, VALIDATION_ERROR } = require('./lib/axi-error');
const {
  escapeHtml,
  isPlainObject,
  isScalar,
  isNonEmptyScalar,
  humanizeKey,
  slugify,
  chip,
  badge,
  callout,
  section,
  checklist,
  kvCard,
  table,
  smartValue,
  prose,
  pageShell,
} = require('./lib/html-kit');

// A present, non-empty value worth giving its own section - scalar strings,
// non-empty arrays, and non-empty objects all qualify; null/''/[]/{}  do not.
const hasContent = (v) => {
  if (v == null) return false;
  if (isScalar(v)) return String(v) !== '';
  if (Array.isArray(v)) return v.length > 0;
  return isPlainObject(v) && Object.keys(v).length > 0;
};

// The show-don't-hide fall-through: an object's entries minus the keys a
// dedicated element already claimed. Every renderer below ends by handing its
// leftover keys to kvCard/smartValue rather than dropping them; this states that
// intent once so the filter reads identically at all sites and can't drift.
const omitConsumed = (obj, consumed) =>
  Object.fromEntries(Object.entries(obj).filter(([k]) => !consumed.has(k)));

// ── task + wave normalization ────────────────────────────────────────────────
// Field names vary session-to-session. We model a small set of known aliases,
// then let EVERYTHING else fall through visibly rather than vanish -
// show-don't-hide applied recursively, at the task and wave level.

// A task's body: first present of these aliases. `text` is the current planner's
// key (added after `detail`); `details`/`steps` are the array-shaped bodies the
// current planner emits (a per-task step list) - the substance of "what we're
// doing", not a footnote. `title` is rendered separately as a short lead line, so
// it is not in this list. Whatever wins is consumed; other body-ish keys still
// fall through so nothing is dropped.
//
// A body may be a scalar (one prose block) OR an array of scalars (a step list).
// It used to accept only scalars, so an array-valued `details` fell through into
// the collapsed <details> block as a buried "Details" row - the plan's actual
// steps hidden behind a disclosure triangle. Arrays now render as a visible
// bullet list, first-class alongside scalar bodies.
const TASK_BODY_KEYS = ['detail', 'details', 'text', 'task', 'summary', 'description', 'action', 'steps'];
const readTaskBody = (t) => {
  for (const k of TASK_BODY_KEYS) {
    const v = t[k];
    if (isNonEmptyScalar(v)) return { kind: 'scalar', value: String(v), key: k };
    if (Array.isArray(v) && v.length) return { kind: 'list', value: v, key: k };
  }
  return { kind: null, key: null };
};

// A wave's display label: first present scalar of these. The winning key is
// consumed; the rest of the wave's keys fall through.
const WAVE_LABEL_KEYS = ['name', 'title', 'id'];
const readWaveLabel = (wave, i) => {
  for (const k of WAVE_LABEL_KEYS) {
    const v = wave[k];
    if (v != null && isScalar(v) && String(v) !== '') return { name: String(v), labelKey: k };
  }
  return { name: `Wave ${i + 1}`, labelKey: null };
};

// Waves come in two shapes:
//  1. [{ id?, name?/title?, tasks?: [...], ...anything }]  (object wave)
//  2. [ ["id-a", "id-b"], "id-c" ]                          (id-refs into top-level tasks[])
// If there are no waves but a top-level tasks[] exists, synthesize one wave so
// the tasks still render. Returns [{ name, tasks: [task-object], rest }] where
// `rest` is every wave-level key we did NOT claim, preserved so renderWave can
// show them instead of dropping them.
const collectWaves = (plan) => {
  const topTasks = Array.isArray(plan.tasks) ? plan.tasks : [];
  const taskById = new Map();
  for (const t of topTasks) {
    if (isPlainObject(t) && t.id != null) taskById.set(String(t.id), t);
  }

  const waves = Array.isArray(plan.waves) ? plan.waves : [];
  if (waves.length === 0) {
    return topTasks.length ? [{ name: 'Tasks', tasks: topTasks, rest: {} }] : [];
  }

  return waves.map((wave, i) => {
    if (isPlainObject(wave)) {
      const tasksIsArray = Array.isArray(wave.tasks);
      const tasks = tasksIsArray ? wave.tasks : [];
      const { name, labelKey } = readWaveLabel(wave, i);
      // Only claim `tasks` when it's the array shape we actually render; a
      // malformed tasks value then falls through as raw instead of vanishing.
      const consumed = new Set();
      if (tasksIsArray) consumed.add('tasks');
      if (labelKey) consumed.add(labelKey);
      const rest = omitConsumed(wave, consumed);
      return { name, tasks, rest };
    }
    // id-ref shape: resolve each ref against top-level tasks[]; unknown refs
    // become a stub task carrying just the id so nothing is silently lost.
    const refs = Array.isArray(wave) ? wave : [wave];
    const tasks = refs.map((ref) => taskById.get(String(ref)) ?? { id: ref });
    return { name: `Wave ${i + 1}`, tasks, rest: {} };
  });
};

// ── section collector ──────────────────────────────────────────────────────
// Sections and their TOC chips are built together so a chip only ever anchors a
// section id that is actually emitted (reference-without-referent guard). The
// slug is derived once from the humanized title, so `verified_facts` and
// "Verified facts" both yield the `verified-facts` anchor and no raw underscore
// key ever leaks into an id.
const createSections = () => {
  const items = [];
  return {
    add(title, bodyHtml) {
      if (!bodyHtml) return;
      items.push({ slug: slugify(title), title, body: bodyHtml });
    },
    sectionsHtml() {
      return items.map((s) => section(s.slug, s.title, s.body)).join('\n');
    },
    tocChips() {
      return items
        .map((s) => `<a class="kit-chip" href="#${s.slug}">${escapeHtml(s.title)}</a>`)
        .join('');
    },
  };
};

// Verdict/result words map to a status badge class; the word itself is never
// interpolated into a class name (the kit looks the class up from this map).
const VERDICT_BADGE = {
  proceed: 'kit-badge-success', pass: 'kit-badge-success', go: 'kit-badge-success', ok: 'kit-badge-success',
  warn: 'kit-badge-warn', revise: 'kit-badge-warn', caution: 'kit-badge-warn',
  fail: 'kit-badge-error', block: 'kit-badge-error', blocked: 'kit-badge-error', 'no-go': 'kit-badge-error', stop: 'kit-badge-error',
};
const verdictBadge = (value, label = '') => badge(value, label, VERDICT_BADGE);

// Risk severity maps to a callout tone; an unknown/absent severity stays neutral.
const RISK_TONE = {
  critical: 'error', high: 'error', severe: 'error',
  medium: 'warn', med: 'warn', moderate: 'warn',
  low: 'info', minor: 'info', info: 'info',
};

// ── task + wave rendering ────────────────────────────────────────────────────
const renderTask = (task) => {
  if (!isPlainObject(task)) return `<div class="kit-card">${chip(String(task), 'kit-chip-strong')}</div>`;

  // Track which keys a dedicated element rendered; every unclaimed key falls
  // through into the details card below so nothing is dropped.
  const consumed = new Set();

  const chips = [];
  if (task.id != null && String(task.id) !== '') {
    chips.push(chip(task.id, 'kit-chip-strong'));
    consumed.add('id');
  }
  if (isNonEmptyScalar(task.agent)) {
    chips.push(chip(task.agent, 'kit-chip-brand'));
    consumed.add('agent');
  } else if (isNonEmptyScalar(task.owner)) {
    chips.push(chip(task.owner, 'kit-chip-brand'));
    consumed.add('owner');
  }
  if (isNonEmptyScalar(task.model)) {
    chips.push(chip(task.model));
    consumed.add('model');
  }
  const chipsHtml = chips.length ? `<div class="kit-metabar">${chips.join('')}</div>` : '';

  // Short lead line above the body prose.
  let titleHtml = '';
  if (isNonEmptyScalar(task.title)) {
    titleHtml = `<p class="task-title"><strong>${escapeHtml(task.title)}</strong></p>`;
    consumed.add('title');
  }

  // The files the task touches, as a muted meta line of code tokens directly
  // under the title (kit-code wraps long paths, so a deep path never forces the
  // page to scroll horizontally). This is meta, not buried detail - a reader
  // scanning the plan sees what each task changes at a glance.
  let filesHtml = '';
  if (Array.isArray(task.files)) {
    consumed.add('files');
    if (task.files.length) {
      filesHtml =
        `<p class="kit-p task-files">${task.files
          .map((f) => `<code class="kit-code">${escapeHtml(f)}</code>`)
          .join(' ')}</p>`;
    }
  }

  // The task body (details/steps/text/... aliases). An array body is the plan's
  // step list - rendered as a visible bullet list. A scalar body goes through
  // kit.prose so an enumerated mega-paragraph becomes an ordered list. Either way
  // it reads inline, never collapsed - this is what we're planning.
  const body = readTaskBody(task);
  if (body.key) consumed.add(body.key);
  let bodyHtml = '';
  if (body.kind === 'scalar') {
    bodyHtml = `<div class="task-body">${prose(body.value)}</div>`;
  } else if (body.kind === 'list') {
    const lis = body.value
      .map((it) => `<li>${isScalar(it) ? escapeHtml(it == null ? '' : it) : smartValue(it)}</li>`)
      .join('');
    bodyHtml = `<div class="task-body"><ul class="kit-list">${lis}</ul></div>`;
  }

  // The claimed outcome: what the task produces, as a labeled row under the body.
  let outcomeHtml = '';
  if (hasContent(task.output)) {
    consumed.add('output');
    outcomeHtml =
      '<div class="kit-kv-row"><div class="kit-kv-key">Outcome</div>' +
      `<div class="kit-kv-val">${smartValue(task.output)}</div></div>`;
  }

  // acceptance_criteria is the definition of done - a first-class, always-visible
  // "Done when" checklist. Only claimed as the array shape we render; a malformed
  // value falls through.
  let acHtml = '';
  if (Array.isArray(task.acceptance_criteria)) {
    consumed.add('acceptance_criteria');
    if (task.acceptance_criteria.length) {
      acHtml = `<div class="kit-kv-key">Done when</div>${checklist(task.acceptance_criteria)}`;
    }
  }

  // Secondary bookkeeping only (verify, read_first, dependsOn, and any
  // session-specific key) falls through here - shown, never dropped, tucked
  // behind <details> so the title + files + body + Done-when read first. The
  // body and files are no longer in here; they are first-class above.
  const rest = omitConsumed(task, consumed);
  const restHtml = Object.keys(rest).length ? kvCard(rest) : '';
  const detailsHtml = restHtml
    ? `<details class="task-details"><summary>Details</summary>${restHtml}</details>`
    : '';

  return `<div class="kit-card">${[chipsHtml, titleHtml, filesHtml, bodyHtml, outcomeHtml, acHtml, detailsHtml]
    .filter(Boolean)
    .join('')}</div>`;
};

const renderWave = (wave) => {
  const rest = isPlainObject(wave.rest) ? wave.rest : {};
  const restHtml = Object.keys(rest).length ? kvCard(rest) : '';
  const hasTasks = wave.tasks.length > 0;
  // Only show the placeholder when the wave is genuinely empty - a wave whose
  // substance lives in fall-through keys (work/design/verify...) is not empty.
  const emptyNote =
    !hasTasks && !Object.keys(rest).length ? '<p class="kit-p">No tasks in this wave.</p>' : '';
  return [
    `<h3>${escapeHtml(wave.name)}</h3>`,
    hasTasks ? wave.tasks.map(renderTask).join('') : '',
    restHtml,
    emptyNote,
  ]
    .filter(Boolean)
    .join('');
};

// A single risk[] item as a tone-coloured callout. Scalars become a paragraph;
// objects render their fields readably (kvCard), with the tone picked from a
// severity/level field when present.
const renderRisk = (item) => {
  if (isScalar(item)) return callout(`<p class="kit-p">${escapeHtml(item == null ? '' : item)}</p>`);
  const sev = isPlainObject(item)
    ? String(item.severity ?? item.level ?? item.impact ?? '').toLowerCase().trim()
    : '';
  return callout(smartValue(item), RISK_TONE[sev] ?? '');
};

// ── plan-check section ─────────────────────────────────────────────────────────
// A sibling plan-check.json (the plan-checker's verdict) renders a "Plan check"
// section when present. Same tolerance contract as the rest of the file: render
// what exists, escape everything, let unknown keys fall through, NEVER throw.
// Real shape:
//   { _meta, checks: { <name>: { result, details:[...] } }, additionalFindings:[],
//     verdict, summary }
// loadPlanCheck distinguishes three outcomes:
//   absent (ENOENT)      -> null            -> no section
//   unreadable / invalid -> { error: msg }  -> a single loud, escaped note
//   valid JSON           -> { data }        -> the full section
// Absence means different things by how the path was chosen: an auto-discovered
// sibling's absence is normal (null, no section); an explicit --check-file is a
// stated expectation, so a missing path there is loud (an error note).
//
// loadSidecarJson is the shared tri-state read+parse used by plan-check.json,
// intent.json, and wiring.json. `label` only changes the wording of the note.
const loadSidecarJson = (filePath, label) => {
  let raw;
  try {
    raw = fs.readFileSync(filePath, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    return { error: `cannot read ${label} file ${filePath} (${err.code || err.message})` };
  }
  try {
    return { data: JSON.parse(raw) };
  } catch (err) {
    return { error: `invalid JSON in ${label} file ${filePath}: ${err.message}` };
  }
};

const loadPlanCheck = (checkPath, { explicit = false } = {}) => {
  const result = loadSidecarJson(checkPath, 'plan-check');
  if (result === null && explicit) return { error: `--check-file path not found: ${checkPath}` };
  return result;
};

// intent.json and wiring.json are always auto-discovered siblings (no CLI
// override exists for either), so absence is always normal - null, no section.
const loadIntent = (intentPath) => loadSidecarJson(intentPath, 'intent');
const loadWiring = (wiringPath) => loadSidecarJson(wiringPath, 'wiring');

// The plan-check verdict scalar, for the sticky top-bar badge. null when there
// is no readable, verdict-bearing plan-check.
const planCheckVerdict = (loaded) => {
  if (!loaded || loaded.error || !isPlainObject(loaded.data)) return null;
  return isNonEmptyScalar(loaded.data.verdict) ? String(loaded.data.verdict) : null;
};

// One card per named check. Known keys (result, details) get dedicated
// elements; everything else falls through, and a non-object check value is
// shown raw rather than vanishing.
const renderCheckRow = (name, c) => {
  if (!isPlainObject(c)) return kvCard({ [name]: c });
  const consumed = new Set();
  const head = [`<strong>${escapeHtml(humanizeKey(name))}</strong>`];
  if (isNonEmptyScalar(c.result)) {
    head.push(verdictBadge(c.result));
    consumed.add('result');
  }
  const parts = [`<div class="kit-metabar">${head.join('')}</div>`];
  if (Array.isArray(c.details)) {
    consumed.add('details');
    if (c.details.length) parts.push(smartValue(c.details));
  }
  const rest = omitConsumed(c, consumed);
  if (Object.keys(rest).length) parts.push(kvCard(rest));
  return `<div class="kit-card">${parts.join('')}</div>`;
};

// Builds the "Plan check" section body from the loadPlanCheck result. null -> ''
// (no section). Renders from file content only, so determinism is preserved.
const renderPlanCheckBody = (loaded) => {
  if (loaded == null) return '';
  if (loaded.error) return callout(`<p class="kit-p">${escapeHtml(loaded.error)}</p>`, 'warn');
  const check = loaded.data;
  if (!isPlainObject(check)) return smartValue(check);

  const consumed = new Set();
  const parts = [];

  const badges = [];
  if (isNonEmptyScalar(check.verdict)) {
    badges.push(verdictBadge(check.verdict));
    consumed.add('verdict');
  }
  if (isNonEmptyScalar(check.score)) {
    badges.push(verdictBadge(check.score, 'Score:'));
    consumed.add('score');
  }
  if (badges.length) parts.push(`<div class="kit-metabar">${badges.join('')}</div>`);

  if (isNonEmptyScalar(check.summary)) {
    consumed.add('summary');
    parts.push(prose(check.summary));
  }

  if (isPlainObject(check.checks)) {
    consumed.add('checks');
    const rows = Object.entries(check.checks).map(([name, c]) => renderCheckRow(name, c));
    if (rows.length) parts.push(rows.join(''));
  }

  if (Array.isArray(check.additionalFindings)) {
    consumed.add('additionalFindings');
    if (check.additionalFindings.length) {
      parts.push('<h3>Additional findings</h3>');
      parts.push(smartValue(check.additionalFindings));
    }
  }

  const rest = omitConsumed(check, consumed);
  if (Object.keys(rest).length) parts.push(smartValue(rest));

  return parts.join('');
};

// ── intent section (narrative lead) ──────────────────────────────────────────
// A sibling intent.json (the phase-B goal contract - see reference/schemas/
// intent.md: goal, problem, tradeoffs, nonNegotiables) is rendered ABOVE the
// tasks - the narrative lead. Same tri-state contract as plan-check. Each field
// is independently optional. Adds its sections onto the shared collector.
const renderIntent = (loaded, sections) => {
  if (loaded == null) return;
  if (loaded.error) {
    sections.add('Intent', callout(`<p class="kit-p">${escapeHtml(loaded.error)}</p>`, 'warn'));
    return;
  }
  const intent = loaded.data;
  if (!isPlainObject(intent)) {
    sections.add('Intent', smartValue(intent));
    return;
  }

  const consumed = new Set();

  if (isNonEmptyScalar(intent.goal)) {
    consumed.add('goal');
    sections.add('Goal', callout(prose(intent.goal)));
  }
  if (isNonEmptyScalar(intent.problem)) {
    consumed.add('problem');
    sections.add('Why', callout(prose(intent.problem), 'warn'));
  }

  const hasTradeoffs = Array.isArray(intent.tradeoffs) && intent.tradeoffs.length > 0;
  const hasNonNeg = Array.isArray(intent.nonNegotiables) && intent.nonNegotiables.length > 0;
  if (Array.isArray(intent.tradeoffs)) consumed.add('tradeoffs');
  if (Array.isArray(intent.nonNegotiables)) consumed.add('nonNegotiables');
  if (hasTradeoffs || hasNonNeg) {
    let body = '';
    if (hasTradeoffs) body += smartValue(intent.tradeoffs);
    if (hasNonNeg) body += `<h3>Non-negotiables</h3>${smartValue(intent.nonNegotiables)}`;
    sections.add('Tradeoffs', body);
  }

  const rest = omitConsumed(intent, consumed);
  if (Object.keys(rest).length) sections.add('Other intent fields', smartValue(rest));
};

// ── wiring section (dependencies + risk) ─────────────────────────────────────
// A sibling wiring.json (dependency topology - see reference/wiring.md) renders
// Dependencies + Risk points sections. Same tri-state contract.
const renderDependency = (dep) => {
  if (!isPlainObject(dep)) return kvCard({ dependency: dep });
  const consumed = new Set();
  const parts = [];
  if (isNonEmptyScalar(dep.task)) {
    parts.push(`<div class="kit-metabar">${chip(dep.task, 'kit-chip-strong')}</div>`);
    consumed.add('task');
  }
  if (Array.isArray(dep.produces)) {
    consumed.add('produces');
    if (dep.produces.length) parts.push(`<div class="kit-kv-key">Produces</div>${smartValue(dep.produces)}`);
  }
  if (Array.isArray(dep.consumes)) {
    consumed.add('consumes');
    if (dep.consumes.length) parts.push(`<div class="kit-kv-key">Consumes</div>${smartValue(dep.consumes)}`);
  }
  const rest = omitConsumed(dep, consumed);
  if (Object.keys(rest).length) parts.push(kvCard(rest));
  return `<div class="kit-card">${parts.join('')}</div>`;
};

// A risk point's producer(s)/consumer(s) come in singular or plural form - accept
// whichever is present without assuming a shape the plan didn't declare.
const renderRiskPoint = (rp) => {
  if (!isPlainObject(rp)) return kvCard({ riskPoint: rp });
  const consumed = new Set();
  const head = [];
  if (isNonEmptyScalar(rp.type)) {
    head.push(chip(rp.type, 'kit-chip-brand'));
    consumed.add('type');
  }
  const producerKey = rp.producer != null ? 'producer' : rp.producers != null ? 'producers' : null;
  if (producerKey) {
    consumed.add(producerKey);
    const value = rp[producerKey];
    const text = Array.isArray(value) ? value.map(String).join(', ') : String(value);
    head.push(`<span class="kit-code">${escapeHtml(text)}</span>`);
  }
  const consumerKey = rp.consumer != null ? 'consumer' : rp.consumers != null ? 'consumers' : null;
  if (consumerKey) {
    consumed.add(consumerKey);
    const value = rp[consumerKey];
    const text = Array.isArray(value) ? value.map(String).join(', ') : String(value);
    head.push(`<span class="kit-code">&rarr; ${escapeHtml(text)}</span>`);
  }
  const parts = [head.length ? `<div class="kit-metabar">${head.join('')}</div>` : ''];
  if (isNonEmptyScalar(rp.mitigation)) {
    consumed.add('mitigation');
    parts.push(`<p class="kit-p">Mitigation: ${escapeHtml(rp.mitigation)}</p>`);
  }
  const rest = omitConsumed(rp, consumed);
  if (Object.keys(rest).length) parts.push(kvCard(rest));
  return `<div class="kit-card">${parts.filter(Boolean).join('')}</div>`;
};

const renderWiring = (loaded, sections) => {
  if (loaded == null) return;
  if (loaded.error) {
    sections.add('Dependencies', callout(`<p class="kit-p">${escapeHtml(loaded.error)}</p>`, 'warn'));
    return;
  }
  const wiring = loaded.data;
  if (!isPlainObject(wiring)) {
    sections.add('Dependencies', smartValue(wiring));
    return;
  }

  const consumed = new Set();
  if (Array.isArray(wiring.dependencies)) {
    consumed.add('dependencies');
    if (wiring.dependencies.length) {
      sections.add('Dependencies', wiring.dependencies.map(renderDependency).join(''));
    }
  }
  if (Array.isArray(wiring.riskPoints)) {
    consumed.add('riskPoints');
    if (wiring.riskPoints.length) {
      sections.add('Risk points', wiring.riskPoints.map(renderRiskPoint).join(''));
    }
  }
  const rest = omitConsumed(wiring, consumed);
  if (Object.keys(rest).length) sections.add('Other wiring fields', smartValue(rest));
};

// ── "what changes" file table ────────────────────────────────────────────────
// A per-file overview derived from the normalized waves' task objects: every
// file a task touches, mapped to the task title(s) (or id) that touch it. This
// answers "what changes?" at a glance, above the detailed task cards. Derivable
// only from tasks[].files; a plan whose substance lives in wave-level keys (no
// per-task files) yields no rows and the section is skipped - tolerant, never a
// misleading empty table. File order is first-seen, so the table is
// deterministic. Returns [[file, label], ...] with the file and label as raw
// (unescaped) strings; the caller escapes on the way into the table.
const collectTaskFiles = (waves) => {
  const order = [];
  const labelsByFile = new Map();
  for (const wave of waves) {
    for (const task of wave.tasks) {
      if (!isPlainObject(task) || !Array.isArray(task.files)) continue;
      const label = isNonEmptyScalar(task.title)
        ? String(task.title)
        : isNonEmptyScalar(task.id)
          ? String(task.id)
          : '';
      for (const f of task.files) {
        const file = String(f);
        if (!labelsByFile.has(file)) {
          labelsByFile.set(file, []);
          order.push(file);
        }
        if (label) labelsByFile.get(file).push(label);
      }
    }
  }
  return order.map((file) => [file, labelsByFile.get(file).join('; ')]);
};

// A plan gate is a decision surface before it is an execution manifest. Keep
// the recommendation and any blocking human calls together at the top so the
// reader can approve, reject, or refine the direction without first decoding
// task mechanics.
const renderDecisionBrief = (decision, humanCallouts) => {
  const hasDecision = isPlainObject(decision) && Object.keys(decision).length > 0;
  if (!hasDecision && humanCallouts.length === 0) return '';

  let primary = '';
  if (hasDecision) {
    const consumed = new Set(['question', 'recommendation', 'rationale', 'status']);
    const rest = omitConsumed(decision, consumed);
    const body = [
      isNonEmptyScalar(decision.recommendation)
        ? `<p class="kit-p"><strong>${escapeHtml(decision.recommendation)}</strong></p>`
        : '',
      isNonEmptyScalar(decision.question)
        ? `<p class="kit-p"><span class="kit-kv-key">Approval question</span><br>${escapeHtml(
            decision.question,
          )}</p>`
        : '',
      Array.isArray(decision.rationale) && decision.rationale.length
        ? `<div class="kit-kv-key">Why</div>${checklist(decision.rationale)}`
        : '',
      isNonEmptyScalar(decision.status) ? badge(decision.status, 'Status:') : '',
      Object.keys(rest).length ? smartValue(rest) : '',
    ]
      .filter(Boolean)
      .join('');
    primary = `<div class="kit-decision-primary"><h3 class="kit-decision-title">Recommendation</h3>${body}</div>`;
  }
  const needsCall = humanCallouts.length
    ? `<aside class="kit-decision-aside"><h3 class="kit-decision-title">Needs your call</h3>${humanCallouts.join(
        '',
      )}</aside>`
    : '';
  const single = !primary || !needsCall ? ' kit-decision-grid-single' : '';
  return `<div class="kit-decision-grid${single}">${primary}${needsCall}</div>`;
};

// ── page assembly ────────────────────────────────────────────────────────────
const renderPlanHtml = (plan, { sourcePath = '', planCheck = null, intent = null, wiring = null } = {}) => {
  // Tolerate a non-object top-level: preserve the value under Other fields
  // rather than throwing, so `{}`, arrays, and scalars all still render a page.
  const isObj = isPlainObject(plan);
  const p = isObj ? plan : {};

  // Keys a dedicated element actually renders land here as it renders them. A
  // known key with the wrong shape (constraints as a string, waves as an object)
  // is never added, so it falls through to Other fields instead of vanishing.
  const consumed = new Set();

  // A header field only counts as consumed - and only prints - when the
  // top-level value is scalar-shaped (an object/array ticket|goal|route|title
  // would coerce to "[object Object]"; better to surface the raw value below).
  // When a top-level field is absent, fall back to the same key inside `_meta`
  // (the version-2 planner carries ticket/title/route/parent there). `_meta` is
  // NOT consumed by this read, so it still surfaces fully under Other fields -
  // show-don't-hide keeps the full provenance visible at the bottom.
  const meta = isPlainObject(p._meta) ? p._meta : {};
  const readHeader = (key) => {
    const v = p[key];
    if (isScalar(v)) {
      consumed.add(key);
      if (v != null && String(v) !== '') return String(v);
    }
    const mv = meta[key];
    return isNonEmptyScalar(mv) ? String(mv) : '';
  };
  const ticket = readHeader('ticket');
  const route = readHeader('route');
  const titleVal = readHeader('title');
  const goalVal = readHeader('goal');
  const parent = readHeader('parent');
  // Headline preference: title > goal > ticket. When both title and goal are
  // present the goal becomes the sub-line so its content is shown, not dropped.
  const heading = titleVal || goalVal || ticket || 'Plan';
  const subline = titleVal && goalVal ? goalVal : '';
  const pageTitle = ticket ? `Plan: ${ticket}` : 'Plan';

  const metaBits = [];
  if (ticket) metaBits.push(chip(ticket, 'kit-chip-strong'));
  if (parent) metaBits.push(badge(parent, 'Parent:'));
  if (route) metaBits.push(badge(route));
  const pcVerdict = planCheckVerdict(planCheck);
  if (pcVerdict) metaBits.push(verdictBadge(pcVerdict, 'Plan check:'));

  const headerHtml = [
    `<h1>${escapeHtml(heading)}</h1>`,
    subline ? `<p class="kit-sub">${escapeHtml(subline)}</p>` : '',
    metaBits.length ? `<div class="kit-metabar">${metaBits.join('')}</div>` : '',
  ]
    .filter(Boolean)
    .join('\n');

  const sections = createSections();

  // ── decision brief: what are we asking the human to approve? ───────────────
  const reviewNotes = isPlainObject(p.review_notes) ? p.review_notes : null;
  if (reviewNotes) consumed.add('review_notes');
  const openForHuman =
    reviewNotes && Array.isArray(reviewNotes.open_for_human) ? reviewNotes.open_for_human : [];
  const humanCallouts = [];
  if (Array.isArray(p.decisions_for_approval)) {
    consumed.add('decisions_for_approval');
    for (const d of p.decisions_for_approval) {
      humanCallouts.push(callout(isPlainObject(d) ? smartValue(d) : prose(d), 'info'));
    }
  }
  for (const item of openForHuman) {
    humanCallouts.push(callout(isScalar(item) ? prose(item) : smartValue(item), 'info'));
  }
  if (Array.isArray(p.open_questions)) {
    consumed.add('open_questions');
    for (const q of p.open_questions) {
      humanCallouts.push(callout(isScalar(q) ? prose(q) : smartValue(q), 'info'));
    }
  }
  const decision = isPlainObject(p.decision) ? p.decision : null;
  if (decision) consumed.add('decision');
  const decisionBrief = renderDecisionBrief(decision, humanCallouts);
  if (decisionBrief) sections.add('Decision brief', decisionBrief);

  // ── researched narrative: outcome, evidence, and tradeoffs ─────────────────

  // Legacy plans use sibling intent.json for their narrative. V3 plans carry
  // outcome and scope in plan.json, so rendering both would repeat the same goal
  // and constraints.
  if (!isPlainObject(p.outcome)) renderIntent(intent, sections);

  // The problem this plan solves - a prominent lead callout, not a trailing dump.
  if (isNonEmptyScalar(p.problem)) {
    consumed.add('problem');
    sections.add('Problem', callout(prose(p.problem)));
  }
  // The shape of the solution - readable prose, ahead of the task breakdown.
  if (isNonEmptyScalar(p.solution_shape)) {
    consumed.add('solution_shape');
    sections.add('Solution', prose(p.solution_shape));
  } else if (isPlainObject(p.solution_shape)) {
    consumed.add('solution_shape');
    sections.add('Solution architecture', smartValue(p.solution_shape));
  }
  if (isNonEmptyScalar(p.summary)) {
    consumed.add('summary');
    sections.add('Summary', prose(p.summary));
  }
  if (Array.isArray(p.verified_facts)) {
    consumed.add('verified_facts');
    if (p.verified_facts.length) sections.add('Verified facts', checklist(p.verified_facts));
  }

  const hasStructuredScope = isPlainObject(p.scope);
  for (const [key, title] of [
    ['outcome', 'Outcome and success'],
    ['scope', 'Scope and constraints'],
    ['research', 'Research findings'],
    ['evidence', 'Evidence'],
    ['alternatives', 'Alternatives and tradeoffs'],
  ]) {
    if (hasContent(p[key])) {
      consumed.add(key);
      sections.add(title, smartValue(p[key]));
    }
  }

  if (Array.isArray(p.risks)) {
    consumed.add('risks');
    if (p.risks.length) sections.add('Risks and reversibility', p.risks.map(renderRisk).join(''));
  }
  if (Array.isArray(p.assumptions)) {
    consumed.add('assumptions');
    if (p.assumptions.length) sections.add('Assumptions', smartValue(p.assumptions));
  }
  if (Array.isArray(p.constraints)) {
    consumed.add('constraints');
    if (!hasStructuredScope && p.constraints.length) sections.add('Constraints', smartValue(p.constraints));
  }
  if (Array.isArray(p.out_of_scope)) {
    consumed.add('out_of_scope');
    if (!hasStructuredScope && p.out_of_scope.length) sections.add('Out of scope', smartValue(p.out_of_scope));
  }
  if (hasContent(p.validation)) {
    consumed.add('validation');
    sections.add('Validation strategy', smartValue(p.validation));
  }
  if (hasContent(p.test_plan)) {
    consumed.add('test_plan');
    sections.add('Test plan', smartValue(p.test_plan));
  }

  // ── execution appendix: files, waves, dependencies, and mechanics ──────────
  // collectWaves reads both waves and tasks; each is consumed only when it's the
  // array shape the renderer understands, independent of whether the resulting
  // wave list ends up empty.
  if (Array.isArray(p.waves)) consumed.add('waves');
  if (Array.isArray(p.tasks)) consumed.add('tasks');
  const waves = collectWaves(p);

  // A per-file "what changes" overview, when tasks declare files. Sits above the
  // detailed cards so the reader sees the surface area before the steps.
  const fileRows = collectTaskFiles(waves);
  if (fileRows.length) {
    const rows = fileRows.map(([file, label]) => [
      `<code class="kit-code">${escapeHtml(file)}</code>`,
      escapeHtml(label),
    ]);
    sections.add('What changes', table(['File', 'Change'], rows, 'Files affected by the execution plan'));
  }

  if (waves.length) sections.add('Waves', waves.map(renderWave).join('\n'));

  // Dependency topology from a sibling wiring.json - reads best once the task
  // ids it references are already on the page.
  renderWiring(wiring, sections);

  if (hasContent(p.conventions_contract)) {
    consumed.add('conventions_contract');
    sections.add('Conventions', smartValue(p.conventions_contract));
  }

  // ── reviewer bookkeeping (demoted) ─────────────────────────────────────────
  // The plan-checker's verdict/findings (sibling plan-check.json) and the inline
  // review_notes are meta about the plan, not the plan - they read after it.
  sections.add('Plan check', renderPlanCheckBody(planCheck));
  if (reviewNotes) {
    const notes = omitConsumed(reviewNotes, new Set(['open_for_human']));
    if (Object.keys(notes).length) sections.add('Review notes', smartValue(notes));
  }

  if (isPlainObject(p.estimate) && Object.keys(p.estimate).length) {
    consumed.add('estimate');
    // kv rows, not a stat strip - real estimate values are paragraph-length.
    sections.add('Estimate', kvCard(p.estimate));
  }
  // Execution strategy (strategy + out_of_scope + any run detail) as a readable
  // object; a non-object execution value falls through to Other fields.
  if (isPlainObject(p.execution) && Object.keys(p.execution).length) {
    consumed.add('execution');
    sections.add('Execution', smartValue(p.execution));
  }

  // Every remaining top-level key falls through readably - a humanized
  // definition list via kit.smartValue, never a raw JSON wall. Insertion-order
  // iteration keeps output stable across runs.
  const otherEntries = isObj
    ? Object.entries(p).filter(([k]) => !consumed.has(k))
    : [['value', plan]];
  if (otherEntries.length) sections.add('Other fields', smartValue(Object.fromEntries(otherEntries)));

  const footerSource = sourcePath
    ? `Generated from <code class="kit-code">${escapeHtml(sourcePath)}</code> &middot; `
    : '';
  const footerHtml = `${footerSource}plan.json is the source of truth - this page is generated from it.`;

  return pageShell({
    title: pageTitle,
    headerHtml,
    tocChips: sections.tocChips(),
    sectionsHtml: sections.sectionsHtml(),
    footerHtml,
    // A plan carries decision grids, tables, and task cards; use the full review
    // surface while individual components preserve readable internal measures.
    wide: true,
  });
};

// ── CLI ──────────────────────────────────────────────────────────────────────
const HELP =
  'render-plan - deterministic plan.json -> plan.html renderer\n\n' +
  'Usage: node scripts/render-plan.js <path-to-plan.json> [--out <path>] [--check-file <path>]\n' +
  '       node scripts/render-plan.js --help\n\n' +
  'Writes plan.html beside the input file (or to --out). Exit 0 on success;\n' +
  'missing arg / unreadable file / invalid JSON -> exit 2 (VALIDATION_ERROR).\n\n' +
  'If a plan-check.json sibling exists next to the input plan.json, its verdict\n' +
  'is rendered as a "Plan check" section. Use --check-file <path> to point at a\n' +
  'plan-check.json elsewhere. An absent auto-discovered sibling renders no section\n' +
  '(its absence is normal). A missing, unreadable, or invalid --check-file renders\n' +
  'a one-line note instead (an explicit flag is an explicit expectation) - never an\n' +
  'error exit.\n\n' +
  'A sibling intent.json (goal/problem/tradeoffs) is auto-discovered the same way\n' +
  'and rendered above the tasks as the narrative lead. A sibling wiring.json\n' +
  '(dependencies/riskPoints) is auto-discovered and rendered after the tasks as\n' +
  'Dependencies + Risk points sections. Both are optional; absence renders no\n' +
  'section, never a crash. Neither has a --check-file-style override flag.\n';

const parseArgs = (args) => {
  let out = null;
  let checkFile = null;
  const positional = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--out') {
      out = args[i + 1];
      i++;
      if (out == null) {
        throw new PhantomError('--out requires a path argument', VALIDATION_ERROR, [
          'node scripts/render-plan.js <path-to-plan.json> --out <path>',
        ]);
      }
    } else if (args[i] === '--check-file') {
      checkFile = args[i + 1];
      i++;
      if (checkFile == null) {
        throw new PhantomError('--check-file requires a path argument', VALIDATION_ERROR, [
          'node scripts/render-plan.js <path-to-plan.json> --check-file <path>',
        ]);
      }
    } else {
      positional.push(args[i]);
    }
  }
  return { out, checkFile, input: positional[0] };
};

const run = (argv) => {
  const args = argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    process.stdout.write(HELP);
    return;
  }

  const { out, checkFile, input } = parseArgs(args);
  if (!input) {
    throw new PhantomError('missing required <path-to-plan.json> argument', VALIDATION_ERROR, [
      'node scripts/render-plan.js <path-to-plan.json> [--out <path>] [--check-file <path>]',
    ]);
  }

  let raw;
  try {
    raw = fs.readFileSync(input, 'utf8');
  } catch (err) {
    throw new PhantomError(`cannot read plan file: ${input} (${err.code || err.message})`, VALIDATION_ERROR, [
      'check the path exists and is readable',
    ]);
  }

  let plan;
  try {
    plan = JSON.parse(raw);
  } catch (err) {
    throw new PhantomError(`invalid JSON in ${input}: ${err.message}`, VALIDATION_ERROR, [
      'plan.json must be valid JSON',
    ]);
  }

  const checkPath = checkFile || path.join(path.dirname(input), 'plan-check.json');
  const planCheck = loadPlanCheck(checkPath, { explicit: checkFile != null });
  const intent = loadIntent(path.join(path.dirname(input), 'intent.json'));
  const wiring = loadWiring(path.join(path.dirname(input), 'wiring.json'));

  const html = renderPlanHtml(plan, { sourcePath: input, planCheck, intent, wiring });
  const target = out || path.join(path.dirname(input), 'plan.html');
  fs.writeFileSync(target, html);
  process.stdout.write(`wrote ${target}\n`);
};

module.exports = { renderPlanHtml, escapeHtml, collectWaves, loadPlanCheck, loadIntent, loadWiring, run };

if (require.main === module) {
  try {
    run(process.argv);
  } catch (err) {
    reportError(err);
  }
}
