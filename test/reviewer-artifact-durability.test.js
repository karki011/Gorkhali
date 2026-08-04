// Author: Subash Karki
// reviewer-artifact-durability.test.js — pins the artifact-first reviewer contract.
// Reviewer deliverables must be durable on disk, not carried in a final message that
// a truncated turn destroys. Asserts the contract is documented in every surface an
// agent actually reads: reference/wrap/rpsl.md (per-role path, addressed to the
// agents, race rationale, empty-result resume guard, Apex merge), the three reviewer
// agent definitions (artifact-first ordering), and reference/_base-agent.md (the
// deliverable-before-verification ordering rule).
//
// Assertions target STABLE identifiers — the `reviews/` path, role names, the
// `SendMessage` resume — not full sentences, so harmless rewording doesn't break them.
// Zero external deps: node:test + node:assert only.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.join(__dirname, '..');

const RPSL = 'reference/wrap/rpsl.md';
const BASE_AGENT = 'reference/_base-agent.md';
const ARCHER = 'agents/archer.md';

// The only roles review-panel.md accepts, and so the only filenames the merge reads.
const PANEL_ROLES = ['scope', 'regression', 'architecture', 'skeptic'];

// Each reviewer surface: the file, and the role name its artifact path must carry.
// Archer carries the templated `{role}` segment: it is spawned as all four panel
// perspectives, so it has no single literal role name of its own.
const REVIEWER_AGENTS = [
  { file: ARCHER, role: '{role}' },
  { file: 'agents/gaze.md', role: 'gaze' },
  { file: 'agents/plan-checker.md', role: 'plan-checker' },
];

// Subset of REVIEWER_AGENTS that write into reviews/. plan-checker is deliberately
// excluded: it is not one of the panel's four perspectives (PANEL_ROLES) and never
// runs as part of that panel, only standalone at the plan gate, so it carries no
// reviews/<role>.json path. Its durable artifact is plan-check.json at a stable
// session path instead, and it still belongs in REVIEWER_AGENTS for the
// artifact-first-ordering and no-gate-runs assertions below, which apply to
// plan-check.json just as much as to the panel's reviews/ files.
const REVIEWS_PATH_AGENTS = REVIEWER_AGENTS.filter(({ file }) => file !== 'agents/plan-checker.md');

function read(rel) {
  return fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8');
}

// Matches a reviews/<something>.json artifact path, with or without a
// {SESSION_DIR} prefix and with either literal or templated role segment.
const REVIEWS_PATH = /reviews\/[{A-Za-z*][\w{}*-]*\.json/;

// ── reference/wrap/rpsl.md: the panel contract ────────────────────────────────

test('rpsl.md names the per-role reviews/<role>.json artifact path', () => {
  const content = read(RPSL);
  assert.match(
    content,
    REVIEWS_PATH,
    `${RPSL} must name the per-role reviews/<role>.json artifact path`
  );
  assert.ok(
    /SESSION_DIR\}?\/reviews\//.test(content),
    `${RPSL} must anchor the reviews/ path under SESSION_DIR`
  );
});

test('rpsl.md addresses the AGENTS, instructing them to write the artifact', () => {
  const content = read(RPSL);
  // The instruction must be directed at the reviewers, not only at Apex.
  assert.ok(
    /addresses the four review agents|not Apex|your deliverable is a file/i.test(content),
    `${RPSL} must state that the output contract addresses the review agents, not only Apex`
  );
  assert.ok(
    /write `?\{?SESSION_DIR/i.test(content),
    `${RPSL} must give the agents an imperative "write {SESSION_DIR}/..." instruction`
  );
});

test('rpsl.md names all four per-role artifact files', () => {
  const content = read(RPSL);
  for (const role of PANEL_ROLES) {
    assert.ok(
      content.includes(`reviews/${role}.json`),
      `${RPSL} must name reviews/${role}.json explicitly (per-role files, never one shared file)`
    );
  }
});

test('rpsl.md gives the parallel-write race as the reason for per-role files', () => {
  const content = read(RPSL);
  // \b-anchored: an unanchored /race/ matches "traceable" in the Protocol section,
  // which would let this test pass with the whole contract deleted.
  assert.ok(
    /\brace\b/i.test(content),
    `${RPSL} must name the concurrent-write race as the reason for per-role files`
  );
  assert.ok(
    /(run in parallel|four agents run|in parallel)[^.]{0,120}\brace\b/i.test(content),
    `${RPSL} must tie the race to the four agents running in parallel, not just assert per-role files`
  );
});

test('rpsl.md merges four NAMED role files and never globs the reviews/ directory', () => {
  const content = read(RPSL);
  // Scoped to the MERGE instruction itself. A file-wide check passes on the
  // pre-existing "One file per role" line, which tells the agents where to write and
  // says nothing about what Apex reads - so the merge could stop naming the four files
  // with every role assertion still green.
  const mergeLine = content
    .split('\n')
    .find((l) => /review-panel\.json/.test(l) && /\bmerge[sd]?\b/i.test(l));
  assert.ok(mergeLine, `${RPSL} must state that Apex merges the role files into review-panel.json`);
  for (const role of PANEL_ROLES) {
    assert.ok(
      mergeLine.includes(`reviews/${role}.json`),
      `${RPSL}'s merge instruction must itself name reviews/${role}.json; naming the four files elsewhere does not tell Apex what to read`
    );
  }
  // The glob was the defect. gaze.md writes reviews/gaze.json on every Gaze run and
  // verify spawns Gaze before wrap's panel, so a fifth non-perspective file is
  // normally already on disk; review-panel.md restricts role to the four panel names.
  assert.ok(
    !/reviews\/\*\.json/.test(content),
    `${RPSL} must not glob reviews/*.json - reviews/gaze.json is normally on disk at merge time and is not a panel perspective`
  );
  assert.ok(
    /merge[sd]?[^.]{0,80}review-panel\.json/i.test(content),
    `${RPSL} must state that Apex merges the four named files into review-panel.json`
  );
  // Absence of the glob is not the same as a rule against it. Held to the same standard
  // as the pre-spawn clear below: without the reason, a rewrite reverts it.
  assert.ok(
    /do not glob|never glob/i.test(content),
    `${RPSL} must state the no-glob rule in prose, not merely omit the glob`
  );
  assert.ok(
    /reviews\/gaze\.json/.test(content) && /schema-invalid|restricts/i.test(content),
    `${RPSL} must give the reason: reviews/gaze.json is normally on disk at merge time and merging it yields a schema-invalid panel`
  );
});

test('rpsl.md clears the four role files before spawning the panel', () => {
  const content = read(RPSL);
  const marker = '## Agent Output Format';
  const cut = content.indexOf(marker);
  assert.notEqual(cut, -1, `${RPSL} must still have an "${marker}" heading`);
  // Everything above that heading is Apex's contract, including the pre-spawn setup.
  const preSpawn = content.slice(0, cut);
  // The verb must sit on the instruction line itself. An unanchored check over the whole
  // pre-spawn slice is satisfied by the word "clear" in the rationale paragraph below, so
  // the actual instruction could be softened to "may touch" with this still green.
  const clearLine = preSpawn
    .split('\n')
    .find((l) => PANEL_ROLES.every((role) => l.includes(`reviews/${role}.json`)));
  assert.ok(clearLine, `${RPSL}'s pre-spawn step must name all four role files on one line`);
  assert.ok(
    /\b(clear|clears|delete|deletes|remove|removes)\b/i.test(clearLine),
    `${RPSL} must instruct Apex to clear stale role files before spawning the panel, on the line that names them`
  );
  for (const role of PANEL_ROLES) {
    assert.ok(
      preSpawn.includes(`reviews/${role}.json`),
      `${RPSL} pre-spawn clear must name reviews/${role}.json; the Empty-Result Guard checks presence and verdict, never freshness`
    );
  }
  // Without the reason, the clear reads as tidiness and gets dropped in a rewrite.
  assert.ok(
    /re-run|previous run|stale|earlier git HEAD/i.test(preSpawn),
    `${RPSL} must give the re-run staleness reason for the pre-spawn clear`
  );
});

test('rpsl.md documents the empty-result / missing-artifact SendMessage resume guard', () => {
  const content = read(RPSL);
  assert.ok(
    /SendMessage/.test(content),
    `${RPSL} must document the SendMessage resume for a missing or empty reviewer artifact`
  );
  assert.ok(
    /missing|empty/i.test(content) && /resume/i.test(content),
    `${RPSL} must tie the resume to a missing/empty artifact`
  );
});

test('rpsl.md keeps the guard as resume-then-proceed, not a terminal block', () => {
  const content = read(RPSL);
  assert.ok(
    /not a terminal block|resume-then-proceed/i.test(content),
    `${RPSL} guard must be resume-then-proceed; a hard block on a documentation contract could wedge a session`
  );
});

test('rpsl.md preserves the verdict JSON shape', () => {
  const content = read(RPSL);
  for (const field of ['"role"', '"verdict"', '"findings"', '"confidence"']) {
    assert.ok(content.includes(field), `${RPSL} must keep the ${field} field in the verdict JSON`);
  }
  // The CLOSING quote is load-bearing: widening this to "pass|fail|not_observed" breaks
  // the match, which is what keeps the agents' write template narrow.
  assert.ok(
    content.includes('"pass|fail"'),
    `${RPSL} must keep the pass|fail verdict enum`
  );
  // Stated explicitly, so the intent survives a rewrite of the assertion above. The
  // agents' write template and the merged panel schema are deliberately DIFFERENT enums:
  // a reviewer that is alive to write a file can only honestly report pass or fail, and a
  // perspective is only ever not_observed because no reviewer wrote at all. A reviewer
  // able to self-report not_observed is an unreviewed perspective recorded as reviewed,
  // with no missing file for the Empty-Result Guard to notice.
  const template = content.slice(content.indexOf('## Agent Output Format'));
  const verdictLine = template.split('\n').find((l) => l.includes('"verdict"'));
  assert.ok(verdictLine, `${RPSL}'s agent write template must keep a "verdict" field`);
  assert.ok(
    !/not_observed/.test(verdictLine),
    `${RPSL}'s agent write template must NOT offer not_observed as a verdict a reviewer writes about itself - only Apex writes it, during the merge (see ${PANEL_SCHEMA})`
  );
  // Same closing-quote trick, on the confidence axis: widening this back to
  // "checked:clean|checked:concerns|not_observed" breaks the exact match, which is what
  // keeps a reviewer from respelling an unreviewed perspective as a reviewed-clean one.
  assert.ok(
    content.includes('"checked:clean|checked:concerns"'),
    `${RPSL} must keep the agents' write-template confidence enum narrowed to checked:clean|checked:concerns`
  );
  const confidenceLine = template.split('\n').find((l) => l.includes('"confidence"'));
  assert.ok(confidenceLine, `${RPSL}'s agent write template must keep a "confidence" field`);
  assert.ok(
    !/not_observed/.test(confidenceLine),
    `${RPSL}'s agent write template must NOT offer not_observed as a confidence a reviewer writes about itself - only Apex writes it, during the merge (see ${PANEL_SCHEMA})`
  );
  // The panel schema's confidence enum is deliberately WIDER (it covers Apex's merge
  // output too), so this fix must narrow the template only, never review-panel.md.
  const panelContent = read(PANEL_SCHEMA);
  const panelConfidenceRow = panelContent
    .split('\n')
    .find((l) => l.includes('perspectives[].confidence'));
  assert.ok(panelConfidenceRow, `${PANEL_SCHEMA} must still document perspectives[].confidence`);
  assert.ok(
    /not_observed/.test(panelConfidenceRow),
    `${PANEL_SCHEMA}'s confidence enum must still include not_observed - only the agents' write template in ${RPSL} narrows`
  );
});

test('rpsl.md preserves the four perspectives and the no-override panel rule', () => {
  const content = read(RPSL);
  for (const perspective of ['Scope Agent', 'Regression Agent', 'Architecture Agent', 'Skeptic Agent']) {
    assert.ok(content.includes(perspective), `${RPSL} must keep the ${perspective} perspective`);
  }
  assert.ok(
    /No override/i.test(content),
    `${RPSL} must keep the no-override panel rule`
  );
  assert.ok(
    /ALL PASS/.test(content),
    `${RPSL} must keep the ALL PASS panel decision rule`
  );
});

// ── reviewer agent definitions: artifact-first ordering ───────────────────────

for (const { file, role } of REVIEWS_PATH_AGENTS) {
  test(`${file} requires writing the verdict to a reviews/<role>.json artifact`, () => {
    const content = read(file);
    assert.ok(
      content.includes(`reviews/${role}.json`) || REVIEWS_PATH.test(content),
      `${file} must name its reviews/<role>.json artifact path (expected reviews/${role}.json)`
    );
    assert.ok(
      /SESSION_DIR\}?\/reviews\//.test(content),
      `${file} must anchor the reviews/ artifact under SESSION_DIR`
    );
  });
}

for (const { file } of REVIEWER_AGENTS) {
  test(`${file} orders the artifact before refining or long-running commands`, () => {
    const content = read(file);
    assert.ok(
      /before refin/i.test(content),
      `${file} must require the artifact BEFORE refining`
    );
    assert.ok(
      /long[- ]running/i.test(content),
      `${file} must require the artifact before any long-running command`
    );
    assert.ok(
      /after (investigating|checking)/i.test(content),
      `${file} must place the artifact AFTER investigation, so the ordering rule can't be read as "report before you check"`
    );
  });

  test(`${file} carries the no-gate-runs line as guidance, not prohibition`, () => {
    const content = read(file);
    assert.ok(
      /don't run the project's build\/test gates|do not run the project's build\/test gates/i.test(content),
      `${file} must carry the reviewers-don't-run-gates line`
    );
    assert.ok(
      /guidance, not prohibition/i.test(content),
      `${file} must phrase the no-gate-runs line as guidance, not prohibition (the evidence is correlational)`
    );
  });
}

test('plan-checker.md documents plan-check.json as its durable artifact and carries no reviews/<role>.json path', () => {
  const content = read('agents/plan-checker.md');
  assert.ok(
    /plan-check\.json/.test(content),
    'agents/plan-checker.md must name plan-check.json as its durable artifact'
  );
  assert.ok(
    !REVIEWS_PATH.test(content),
    "agents/plan-checker.md must not name a reviews/<role>.json artifact path - it is not one of the panel's four perspectives and never writes into the panel merge directory"
  );
});

test('archer.md gives a panel perspective exactly one legal artifact filename', () => {
  const content = read(ARCHER);
  assert.ok(
    content.includes('reviews/{role}.json'),
    `${ARCHER} must send a panel perspective to reviews/{role}.json`
  );
  // wrap.md spawns all four panel perspectives as subagent_type archer, so a second
  // legal name (the old `archer` option) let a panel reviewer write a file the merge
  // never reads: perspective absent, resume burnt, PR shipped past the real review.
  const literals = [...new Set([...content.matchAll(/reviews\/([\w-]+)\.json/g)].map((m) => m[1]))];
  assert.equal(
    literals.length,
    1,
    `${ARCHER} must offer exactly one literal artifact filename - the non-panel one - beside the templated reviews/{role}.json, found: ${literals.join(', ') || 'none'}`
  );
  // Non-panel archer review is real and keeps its own path; it just must not be able
  // to land on a panel filename and be merged as a perspective.
  assert.ok(
    !PANEL_ROLES.includes(literals[0]),
    `${ARCHER}'s non-panel artifact name (reviews/${literals[0]}.json) must not collide with the four panel filenames`
  );
});

test('archer and gaze are the only agent files carrying the reviews/ contract', () => {
  const agentsDir = path.join(REPO_ROOT, 'agents');
  const carriers = fs
    .readdirSync(agentsDir)
    .filter((f) => f.endsWith('.md'))
    .filter((f) => /SESSION_DIR\}?\/reviews\//.test(fs.readFileSync(path.join(agentsDir, f), 'utf8')));
  assert.deepEqual(
    carriers.sort(),
    ['archer.md', 'gaze.md'],
    'only archer and gaze carry the reviews/ artifact contract; plan-checker writes plan-check.json instead, and other agent definitions must be untouched'
  );
});

// ── reference/_base-agent.md: the inherited ordering rule ─────────────────────

test('_base-agent.md carries the deliverable-before-verification ordering rule', () => {
  const content = read(BASE_AGENT);
  const section = content.slice(content.indexOf('## On Task Completion'));
  assert.ok(section.length > 0, `${BASE_AGENT} must still have an "On Task Completion" section`);
  assert.ok(
    /before refin/i.test(section),
    `${BASE_AGENT} must order the deliverable BEFORE refinement`
  );
  assert.ok(
    /verification|verify|test suite/i.test(section),
    `${BASE_AGENT} must order the deliverable before long-running verification`
  );
});

test('_base-agent.md states that a turn ending early ends AFTER the deliverable', () => {
  const content = read(BASE_AGENT);
  assert.ok(
    /end[s]? early[^.]{0,60}after the deliverable/i.test(content),
    `${BASE_AGENT} must state that a turn which must end early ends AFTER the deliverable`
  );
});

test('_base-agent.md preserves the existing handoff-note guidance', () => {
  const content = read(BASE_AGENT);
  assert.ok(
    content.includes(
      'what was done, key decisions, files changed, what the next agent needs to know, and any remaining concerns'
    ),
    `${BASE_AGENT} must preserve the handoff-note content; this change is about ordering, not replacement`
  );
});

test('_base-agent.md requires an unrun check be marked not_observed, never passing', () => {
  const content = read(BASE_AGENT);
  const section = content.slice(content.indexOf('## On Task Completion'));
  assert.match(
    section,
    /not_observed/,
    `${BASE_AGENT} must name not_observed as the label for a check that has not run`
  );
  assert.ok(
    /never as passing|never .{0,30}as passing|not .{0,20}as passing/i.test(section),
    `${BASE_AGENT} must forbid claiming an unrun check as passing`
  );
  assert.ok(
    /ward\.md/.test(section),
    `${BASE_AGENT} must cite agents/ward.md so there is one observation vocabulary, not two`
  );
});

// Regression guard for PR #97: the honesty rule above must NOT be read as
// "verify before emitting". Emit-early stays first; the amend comes after.
test('_base-agent.md keeps emit-early ahead of the honesty qualifier', () => {
  const content = read(BASE_AGENT);
  const section = content.slice(content.indexOf('## On Task Completion'));
  const emitEarly = section.search(/emit the deliverable, then refine or verify/i);
  const honesty = section.search(/not_observed/);
  assert.ok(emitEarly >= 0, `${BASE_AGENT} must still state the investigate/emit/verify order`);
  assert.ok(honesty >= 0, `${BASE_AGENT} must still carry the not_observed rule`);
  assert.ok(
    emitEarly < honesty,
    `${BASE_AGENT} must state emit-early BEFORE qualifying what an early record may claim`
  );
  // "amend the record", not bare /amend/i: the pre-existing "Refine by amending" bullet
  // sits after the honesty bullet and satisfied the loose form on its own, so the new
  // clause's amend requirement could be deleted with this still green.
  assert.ok(
    /amend the record/i.test(section.slice(honesty)),
    `${BASE_AGENT} must require amending the record once the check runs`
  );
});

// ── Gaze's artifact must have READERS, not just a writer ──────────────────────
// PR #97 told Gaze to write reviews/gaze.json but left both callers transcribing
// Gaze's final message, so for Gaze the durability bug was entirely unfixed. These
// pin the loop closed at both ends: the two consumers read the file, and the writer
// prompt they actually load produces the field those consumers read.

const VERIFY = 'commands/verify.md';
const REVIEW = 'commands/review.md';
const TEMPERATURE = 'reference/temperature-review.md';
const GAZE = 'agents/gaze.md';

// Both commands that spawn Gaze and consume its verdict.
const GAZE_CONSUMERS = [VERIFY, REVIEW];

for (const file of GAZE_CONSUMERS) {
  test(`${file} reads Gaze's verdict from reviews/gaze.json, not from the final message`, () => {
    const content = read(file);
    assert.ok(
      content.includes('reviews/gaze.json'),
      `${file} must name reviews/gaze.json - a durable artifact with no reader leaves the truncated-turn bug unfixed`
    );
    // Merely mentioning the path is not consuming it; the verb has to be there.
    assert.ok(
      /\bread(ing|s)?\b[^.]{0,160}reviews\/gaze\.json/i.test(content),
      `${file} must instruct the caller to READ reviews/gaze.json, not just mention the path`
    );
    // The message is the thing that gets destroyed; naming it is what makes the
    // instruction a correction rather than a restatement.
    assert.ok(
      /final message|transcrib/i.test(content),
      `${file} must say the verdict comes from the artifact rather than Gaze's final message`
    );
    // Same recovery shape as rpsl.md's Empty-Result Guard: one resume, then proceed.
    assert.ok(
      /SendMessage/.test(content) && /\bONE\b|\bone\b/.test(content),
      `${file} must apply the single-SendMessage-resume guard when the artifact is missing`
    );
    assert.ok(
      !/respawn/i.test(content) || /never a respawn/i.test(content),
      `${file}'s resume must be a resume, never a respawn`
    );
    // The third state, on BOTH consumers. review.md is the one that had no such clause
    // before this task: a still-absent artifact defaulted to the clean verdict.
    assert.ok(
      /not_observed/.test(content),
      `${file} must record a still-absent reviews/gaze.json as not_observed, never as a clean result`
    );
  });
}

test('gaze.md and temperature-review.md agree that reviews/gaze.json carries the P0/P1 findings array', () => {
  const definition = read(GAZE);
  const writerPrompt = read(TEMPERATURE);
  // Definition side: the artifact is a superset carrying the findings array.
  assert.ok(
    /"findings"/.test(definition),
    `${GAZE} must name the "findings" key as part of the reviews/gaze.json shape`
  );
  assert.ok(
    /P0\/P1 findings array|P0 and P1/i.test(definition),
    `${GAZE} must state that findings is the P0/P1 array`
  );
  // Writer side: the prompt Gaze is actually handed must produce that artifact,
  // not only return an array in chat. A field its writer was never told to write
  // is the same writer/reader asymmetry this PR exists to close.
  assert.ok(
    writerPrompt.includes('reviews/gaze.json'),
    `${TEMPERATURE}'s review-agent prompt must tell the writer to produce reviews/gaze.json, not only return an array`
  );
  assert.ok(
    /"findings"/.test(writerPrompt),
    `${TEMPERATURE} must name the "findings" key so the writer produces the field verify.md reads`
  );
  assert.ok(
    /P0 and P1/i.test(writerPrompt),
    `${TEMPERATURE} must keep findings scoped to P0 and P1 (P2/P3 dropped)`
  );
  // The empty-array semantics have to stay meaningful on the writer side too.
  assert.ok(
    /Empty array \[\] = clean code = SHIP IT/.test(writerPrompt),
    `${TEMPERATURE} must keep the empty-array-means-clean semantics`
  );
  assert.ok(
    /always write the key/i.test(writerPrompt),
    `${TEMPERATURE} must require the findings key even when empty; an omitted key is indistinguishable from a lost review`
  );
  // One superset artifact only works if the writer knows both readers and which key each
  // one takes. Without this, a later edit can drop a key that only one caller reads.
  assert.ok(
    /commands\/verify\.md[^.]{0,40}reads `findings`/i.test(definition) &&
      /commands\/review\.md[^.]{0,40}reads `verdict`/i.test(definition),
    `${GAZE} must name which caller reads which key: commands/verify.md -> findings, commands/review.md -> verdict`
  );
});

test('verify.md points at the review-agent prompt that actually exists', () => {
  const content = read(VERIFY);
  // reference/power-level.md never existed: verify.md's Step 2 told the caller to
  // load Gaze's prompt from a file that was not in the repo.
  assert.ok(
    content.includes(TEMPERATURE),
    `${VERIFY} must load the review-agent prompt from ${TEMPERATURE}`
  );
  assert.ok(
    content.includes('"Review Agent Prompt"'),
    `${VERIFY} must name the "Review Agent Prompt" section it loads`
  );
  assert.ok(
    read(TEMPERATURE).includes('## Review Agent Prompt'),
    `${TEMPERATURE} must actually carry the "Review Agent Prompt" heading ${VERIFY} cites`
  );
});

test('no command file points at the non-existent reference/power-level.md', () => {
  const commandsDir = path.join(REPO_ROOT, 'commands');
  const offenders = fs
    .readdirSync(commandsDir)
    .filter((f) => f.endsWith('.md'))
    .filter((f) => fs.readFileSync(path.join(commandsDir, f), 'utf8').includes('power-level.md'));
  assert.deepEqual(
    offenders,
    [],
    `commands/ must not cite reference/power-level.md - the file does not exist, so the cited prompt never loads: ${offenders.join(', ')}`
  );
});

// The reference-without-referent remedy, scoped to the files this task rewired.
// A doc path that resolves nowhere is a silently dead instruction, which is how
// verify.md shipped a pointer at a prompt file that was never in the repo.
test('every reference/ and agents/ path cited by the rewired files resolves on disk', () => {
  // Agent definitions resolve a bare `reference/x.md` against their own directory
  // (agents/reference/), commands resolve against the repo root. Accept either root.
  const CITED_PATH = /(?:reference|agents)\/[\w./-]*\.md/g;
  const dead = [];
  for (const file of [GAZE, TEMPERATURE, VERIFY, REVIEW]) {
    const ownDir = path.dirname(path.join(REPO_ROOT, file));
    for (const cited of new Set(read(file).match(CITED_PATH) || [])) {
      const resolves =
        fs.existsSync(path.join(REPO_ROOT, cited)) || fs.existsSync(path.join(ownDir, cited));
      if (!resolves) dead.push(`${file} -> ${cited}`);
    }
  }
  assert.deepEqual(dead, [], `dead documentation pointers found: ${dead.join(', ')}`);
});

// The correctness trap. Three states, and the third must never be reported as the
// first: an absent artifact reported as zero findings turns a lost deliverable into
// a false clean bill of health - the exact bug class this PR exists to fix.
test('verify.md distinguishes a MISSING gaze.json from a genuinely EMPTY findings array', () => {
  const content = read(VERIFY);
  // State 1 survives: a real empty array still gets the definitive scoped line.
  assert.ok(
    content.includes('review: 0 P0/P1 findings (gaze against git diff main...HEAD)'),
    `${VERIFY} must keep the definitive scoped empty-result line for a genuine empty array`
  );
  // State 2 survives.
  assert.ok(
    /review: N P0\/P1 findings/.test(content),
    `${VERIFY} must keep the non-empty reporting form with each finding named`
  );
  // State 3 must exist and must be labelled unknown, not zero.
  assert.ok(
    /not_observed/.test(content),
    `${VERIFY} must label an unread review not_observed, reusing the vocabulary in reference/schemas/verification.md`
  );
  assert.ok(
    /(absent|missing)[^|]{0,200}not_observed|not_observed[^|]{0,200}(absent|missing)/i.test(content),
    `${VERIFY} must tie not_observed specifically to an absent/missing reviews/gaze.json`
  );
  // The explicit prohibition. Without this the three states collapse on the first
  // rewrite: "no findings on disk" reads as "no findings".
  assert.ok(
    /never (print|report|state)[^.]{0,80}0 P0\/P1 findings/i.test(content),
    `${VERIFY} must forbid reporting a missing artifact as "0 P0/P1 findings"`
  );
  // Guard the PASS reporting path too: Result must not print the zero for state 3.
  const result = content.slice(content.indexOf('## Result'));
  assert.ok(result.length > 0, `${VERIFY} must still have a "## Result" section`);
  assert.ok(
    /not_observed/.test(result),
    `${VERIFY}'s Result section must carry the not_observed outcome through instead of substituting a zero`
  );
});

test('gaze.md names the four panel files instead of globbing reviews/*.json', () => {
  const content = read(GAZE);
  // Wave 1 removed the glob from the merge; the sentence describing it was left behind
  // and became false.
  assert.ok(
    !/reviews\/\*\.json/.test(content),
    `${GAZE} must not describe Apex as merging reviews/*.json - that glob was removed`
  );
  for (const role of PANEL_ROLES) {
    assert.ok(
      content.includes(`reviews/${role}.json`),
      `${GAZE} must name reviews/${role}.json when describing what the panel merges`
    );
  }
  // And it must stay clear that gaze.json is not one of the merged perspectives.
  assert.ok(
    /not one of them|not a panel perspective|deliberately not/i.test(content),
    `${GAZE} must state that reviews/gaze.json is not one of the merged panel perspectives`
  );
});

// ── The third verdict: not_observed must be legal, distinct, and consumed ─────
// Greptile P1 on PR #97: the Empty-Result Guard recorded a missing perspective with
// confidence not_observed, but review-panel.md's verdict enum had only pass|fail and
// the Panel Decision had only two branches. Both spellings were wrong - pass ships
// unreviewed code, fail wedges the wrap the guard promises never to wedge.

const PANEL_SCHEMA = 'reference/schemas/review-panel.md';
const WRAP_CMD = 'commands/wrap.md';
const SHIP = 'reference/wrap/ship-ceremony.md';

test('review-panel.md admits not_observed in the perspectives[].verdict enum', () => {
  const content = read(PANEL_SCHEMA);
  const verdictRow = content
    .split('\n')
    .find((l) => l.includes('perspectives[].verdict'));
  assert.ok(verdictRow, `${PANEL_SCHEMA} must still document perspectives[].verdict`);
  // Pinned on the enum CELL, not the row and not the file. The word appears in the
  // confidence enum (always has) and in this row's own description column, so anything
  // wider passes with the verdict enum reverted to pass|fail - the exact defect.
  // Split on unescaped pipes: the enum cell separates its members with `\|`.
  const enumCell = verdictRow.split(/(?<!\\)\|/)[2];
  assert.ok(enumCell, `${PANEL_SCHEMA}'s verdict row must keep its type column`);
  assert.match(
    enumCell,
    /not_observed/,
    `${PANEL_SCHEMA}'s verdict enum CELL must include not_observed; confidence already had it, and recording an unobserved perspective needs a legal VERDICT too`
  );
  for (const legal of ['pass', 'fail']) {
    assert.ok(
      enumCell.includes(legal),
      `${PANEL_SCHEMA}'s verdict enum must keep ${legal}`
    );
  }
});

// The reason the two enums differ. rpsl.md hands the agents pass|fail; this schema adds a
// third value for the merge only. Without this sentence the split looks like an oversight
// and the next editor "fixes" it by widening the agents' template.
test('review-panel.md scopes not_observed to Apex, never to a reviewer self-report', () => {
  const content = read(PANEL_SCHEMA);
  assert.ok(
    /reviewers never write/i.test(content),
    `${PANEL_SCHEMA} must state that reviewers never write not_observed about themselves`
  );
  assert.ok(
    /Apex writes[^.]{0,40}merge/i.test(content),
    `${PANEL_SCHEMA} must state that Apex is what writes not_observed, during the merge`
  );
});

test('review-panel.md ties allPass to every verdict being pass', () => {
  const content = read(PANEL_SCHEMA);
  const allPassRow = content.split('\n').find((l) => l.trimStart().startsWith('| allPass'));
  assert.ok(allPassRow, `${PANEL_SCHEMA} must still document allPass`);
  assert.ok(
    /every/i.test(allPassRow) && /pass/.test(allPassRow),
    `${PANEL_SCHEMA} must state allPass is true only when EVERY verdict is pass`
  );
  assert.ok(
    /not_observed/.test(allPassRow),
    `${PANEL_SCHEMA} must say a not_observed verdict makes allPass false, not just a fail`
  );
});

test('review-panel.md forbids verdict pass paired with confidence not_observed', () => {
  const content = read(PANEL_SCHEMA);
  // Without this, the hole is simply respelled on the confidence axis: an unreviewed
  // perspective recorded as a reviewed-clean one.
  assert.ok(
    /(invalid|forbidden|never|must not)/i.test(content),
    `${PANEL_SCHEMA} must carry a prohibition, not only a description`
  );
  assert.ok(
    /verdict[^.]{0,40}pass[^.]{0,60}confidence[^.]{0,40}not_observed[^.]{0,80}(invalid|forbidden|never|must not)|(invalid|forbidden|never|must not)[^.]{0,60}verdict[^.]{0,40}pass[^.]{0,60}not_observed/i.test(
      content
    ),
    `${PANEL_SCHEMA} must specifically forbid verdict "pass" combined with confidence "not_observed"`
  );
  assert.ok(
    /not_observed[^|]{0,60}\|[^|]{0,40}not_observed|`not_observed` only/i.test(content),
    `${PANEL_SCHEMA} must pin not_observed's only legal confidence to not_observed`
  );
});

test('review-panel.md shows an example perspective carrying the not_observed verdict', () => {
  const content = read(PANEL_SCHEMA);
  assert.ok(
    /"verdict":\s*"not_observed"/.test(content),
    `${PANEL_SCHEMA} must show an example perspective with "verdict": "not_observed"`
  );
  // That example must be internally consistent, or it teaches the bug it documents.
  assert.ok(
    /"allPass":\s*false/.test(content),
    `${PANEL_SCHEMA}'s not_observed example must pair with "allPass": false`
  );
  assert.ok(
    !/"verdict":\s*"pass",\s*"findings":[^}]*"confidence":\s*"not_observed"/.test(content),
    `${PANEL_SCHEMA} must not contain an example of the pairing it forbids`
  );
});

test('review-panel.md records that no machine validator covers this artifact', () => {
  const content = read(PANEL_SCHEMA);
  // scripts/validate-artifact.js has no review-panel schema, so the doc + these tests
  // are the entire contract. Saying so is what stops a reader assuming a validator
  // catches an illegal combination.
  assert.ok(
    /validate-artifact\.js/.test(content),
    `${PANEL_SCHEMA} must name scripts/validate-artifact.js when stating that review-panel.json is unvalidated`
  );
  assert.ok(
    /not machine-validated|no machine|not validated/i.test(content),
    `${PANEL_SCHEMA} must state that review-panel.json is not machine-validated`
  );
  // And the claim must stay TRUE: if a review-panel schema is ever added, this doc lies.
  const validator = read('scripts/validate-artifact.js');
  assert.ok(
    !/review-panel/.test(validator),
    'scripts/validate-artifact.js gained a review-panel schema - review-panel.md\'s "not machine-validated" note is now false and must be updated'
  );
});

test('rpsl.md records a still-missing perspective with verdict not_observed plus a blocker', () => {
  const content = read(RPSL);
  const guard = content.slice(content.indexOf('### Empty-Result Guard'));
  assert.ok(guard.length > 0, `${RPSL} must still have an Empty-Result Guard section`);
  assert.ok(
    /verdict:?\s*`?not_observed/i.test(guard),
    `${RPSL}'s guard must name the VERDICT (not only the confidence) for a still-missing perspective`
  );
  // The schema FIELD, not the English word: the guard-to-EOF slice uses "blockers" in
  // prose three separate times, so /blockers/i pinned nothing.
  assert.ok(
    /blockers\[\]/.test(guard),
    `${RPSL}'s guard must require a blockers[] entry for the unreviewed perspective`
  );
  // The guard must not be allowed to spell a missing file as either of the two
  // wrong states; both were available before this fix and both were wrong. Pinned on the
  // PASS half specifically - the fail half is a second carrier that hid its removal.
  assert.ok(
    /not substitute a `?pass/i.test(guard),
    `${RPSL}'s guard must forbid substituting a pass for a missing perspective`
  );
  assert.ok(
    /not substitute a `?fail/i.test(guard),
    `${RPSL}'s guard must forbid substituting a fail either - a fail wedges the wrap on blockers nobody found`
  );
});

test('rpsl.md Panel Decision has three branches, and only one ships with allPass false', () => {
  const content = read(RPSL);
  const decision = content.slice(content.indexOf('## Panel Decision'));
  assert.ok(decision.length > 0, `${RPSL} must still have a Panel Decision section`);
  assert.ok(/\*\*ALL PASS\*\*/.test(decision), `${RPSL} must keep the ALL PASS branch`);
  assert.ok(/\*\*ANY FAIL\*\*/.test(decision), `${RPSL} must keep the ANY FAIL branch`);
  assert.ok(
    /\*\*ANY NOT_OBSERVED[^*]*\*\*/i.test(decision),
    `${RPSL} must add a third branch for a perspective that produced no verdict`
  );
  // The third branch is only a fix if it PROCEEDS; a third label that also stops is
  // the two-branch behaviour with extra words.
  // Bounded to the bullet, so the ALL PASS branch's "proceed" cannot stand in for it.
  const third = decision.slice(decision.search(/\*\*ANY NOT_OBSERVED/i));
  assert.ok(
    /proceed/i.test(third),
    `${RPSL}'s not_observed branch must proceed to the draft PR, not stop`
  );
  // Both halves: the branch must write false AND must never write true. Asserting only
  // the presence of "allPass: false" passes with the branch flipped to true, because the
  // bullet's closing sentence ("the only path that ships with allPass: false") repeats it.
  assert.ok(
    /allPass: false/.test(third) && !/allPass: true/.test(third),
    `${RPSL}'s not_observed branch must write allPass: false and never allPass: true`
  );
  // FAIL must still win over not_observed, or a diff with a real blocker could ship
  // by also having a missing perspective.
  assert.ok(
    /no FAIL|without a FAIL|no `?fail/i.test(third),
    `${RPSL}'s not_observed branch must be conditioned on there being no FAIL`
  );
  // And the FAIL branch must still be the unoverridable one.
  const fail = decision.slice(decision.search(/\*\*ANY FAIL\*\*/), decision.search(/\*\*ANY NOT_OBSERVED/i));
  assert.ok(
    /STOP/.test(fail) && /no override|no skip flag/i.test(fail),
    `${RPSL}'s ANY FAIL branch must still STOP with no override and no skip flag`
  );
});

test('rpsl.md leans on the pre-spawn clear rather than inventing a freshness check', () => {
  const content = read(RPSL);
  const guard = content.slice(content.indexOf('### Empty-Result Guard'));
  assert.ok(
    /clear|cleared/i.test(guard) && /this run|stale|earlier/i.test(guard),
    `${RPSL} must explain that the pre-spawn clear is what makes an absent role file unambiguous`
  );
});

test('wrap.md keeps FAIL unoverridable while letting an unobserved perspective ship', () => {
  const content = read(WRAP_CMD);
  // The original absolute wording is load-bearing and must survive.
  assert.ok(
    /No override/i.test(content),
    `${WRAP_CMD} must keep the no-override rule`
  );
  assert.ok(
    /No skip flag/i.test(content),
    `${WRAP_CMD} must keep the no-skip-flag rule`
  );
  // ...and must now be scoped to the FAIL path, so it reads as stricter, not looser.
  assert.ok(
    /FAIL[^.]{0,160}(stops?|STOP)/i.test(content),
    `${WRAP_CMD} must say a FAIL stops the wrap`
  );
  const noOverrideAt = content.search(/No override/i);
  const failAt = content.search(/\*\*FAIL\*\*|FAIL\*\*|returns? .{0,10}FAIL/i);
  assert.ok(failAt >= 0, `${WRAP_CMD} must name the FAIL path`);
  assert.ok(
    failAt < noOverrideAt && noOverrideAt - failAt < 400,
    `${WRAP_CMD}'s "No override" must sit in the FAIL paragraph, not float free where it reads as covering every outcome`
  );
  // The unobserved path must be present and explicitly NOT a fail and NOT a pass.
  assert.ok(
    /not_observed/.test(content),
    `${WRAP_CMD} must name the not_observed outcome`
  );
  assert.ok(
    /not a FAIL/i.test(content) && /not .{0,30}(as a|a) pass/i.test(content),
    `${WRAP_CMD} must state an unobserved perspective is neither a FAIL nor a pass`
  );
});

test('wrap.md no longer claims the PR waits for the whole panel to PASS', () => {
  const content = read(WRAP_CMD);
  assert.ok(
    !/once verification \+ the review panel pass/i.test(content),
    `${WRAP_CMD} must not still say the draft PR waits for the review panel to pass - that contradicts the not_observed branch`
  );
  assert.ok(
    /no FAIL/i.test(content),
    `${WRAP_CMD} must condition the draft PR on the panel returning no FAIL`
  );
});

test('ship-ceremony.md requires the draft PR body to NAME any not_observed perspective', () => {
  const content = read(SHIP);
  // This is the reader that makes the third verdict real. Without it, allPass:false
  // plus a draft PR is behaviourally identical to a pass: allPass is written to
  // artifacts and documented, but no code anywhere branches on it.
  assert.ok(
    /not_observed/.test(content),
    `${SHIP} must name the not_observed verdict`
  );
  assert.ok(
    /review-panel\.json/.test(content),
    `${SHIP} must read the perspectives from review-panel.json`
  );
  assert.ok(
    /\bname\b|\bnamed\b|\bnaming\b/i.test(content),
    `${SHIP} must require the perspective to be NAMED, not merely counted`
  );
  // The requirement must be mandatory, and must be tied to the PR body specifically -
  // a terminal print dies with the session, which is the whole point of this consumer.
  // The mandate must attach to the NAMING instruction. A file-wide /(MUST|required|not
  // optional)/ is satisfied by the section heading's own "(required when ...)", so the
  // instruction could be downgraded to "can mention" with this still green.
  assert.ok(
    /\bMUST\b[^.]{0,80}\bname\b/.test(content),
    `${SHIP} must make NAMING the perspective mandatory, not a suggestion`
  );
  assert.ok(
    /PR body[^.]{0,200}not_observed|not_observed[^.]{0,200}PR body/i.test(content),
    `${SHIP} must tie the not_observed disclosure to the PR BODY, not to a printed line`
  );
  // Guard against the fix degrading into "print allPass: false and call it named".
  // /branch/i was vacuous here: ship-ceremony.md talks about git branches ("print branch
  // name", "Branch pushed"), so the whole explanation could be deleted with this green.
  assert.ok(
    /allPass[^.]{0,60}alone/i.test(content),
    `${SHIP} must state that reporting allPass: false ALONE does not satisfy the disclosure`
  );
  assert.ok(
    /branch(es)? on it/i.test(content),
    `${SHIP} must give the reason - nothing branches on allPass - not merely mention allPass`
  );
});

test('ship-ceremony.md carries the not_observed line in the PR body template', () => {
  const content = read(SHIP);
  const start = content.indexOf('## Validation');
  assert.notEqual(start, -1, `${SHIP} must still have the Validation PR-body template`);
  // Bounded to the closing fence of the PR-body block. A fixed 600-char window overshoots
  // it into the "### Unreviewed perspectives (required when any verdict is `not_observed`)"
  // heading, whose own title carries the word - so the template slot itself could be
  // deleted with this still green.
  const fence = content.indexOf('```', start);
  assert.notEqual(fence, -1, `${SHIP}'s PR-body template must stay inside a fenced block`);
  const template = content.slice(start, fence);
  assert.ok(
    /not_observed/.test(template),
    `${SHIP}'s PR body template must itself carry the not_observed slot, so the requirement is visible where the body is assembled`
  );
});

// The context line is the one place a reader learns which panel outcomes reach this file
// at all. Left at the pre-fix "after RPSL passes" it contradicts the three-branch rule:
// a not_observed panel has allPass false, so "passes" would exclude the case wave 4 added.
test('ship-ceremony.md states it is reached on no-FAIL, and that an unobserved perspective reaches it', () => {
  const content = read(SHIP);
  const context = content.slice(0, content.indexOf('## 1.'));
  assert.ok(context.length > 0, `${SHIP} must still open with a Context line`);
  assert.ok(
    /no FAIL/i.test(context),
    `${SHIP}'s context line must condition entry on RPSL returning no FAIL, not on the panel "passing" - a not_observed panel never passes yet still ships`
  );
  assert.ok(
    /unobserved|not_observed/i.test(context),
    `${SHIP}'s context line must say an unobserved perspective does reach the ceremony`
  );
});

test('gaze.md makes Gaze ensure its own artifact directory exists before writing', () => {
  const content = read(GAZE);
  const section = content.slice(content.indexOf('### Artifact First'));
  assert.ok(section.length > 0, `${GAZE} must still have an "Artifact First" section`);
  assert.ok(
    /mkdir/i.test(section),
    `${GAZE} must tell Gaze to create {SESSION_DIR}/reviews/ before writing; verify.md and review.md spawn Gaze standalone with no pre-spawn mkdir, unlike rpsl.md's panel`
  );
  // The mkdir must come BEFORE the write, or it is decoration.
  const mkdirAt = section.search(/mkdir/i);
  const writeAt = section.search(/write that verdict|reviews\/gaze\.json/i);
  assert.ok(
    mkdirAt >= 0 && mkdirAt < writeAt,
    `${GAZE} must order the directory creation before the artifact write`
  );
  // The reason matters: a failed write here manufactures a spurious not_observed,
  // which is precisely the state wave 4 gave meaning to.
  // Scoped to the rationale paragraph and path-anchored on `commands/`. A bare
  // /verify\.md|review\.md/ over the section is satisfied twice over by accident: the
  // path `reference/temperature-review.md` ends in "review.md", and the consumer-map
  // sentence later in the section names both files for a different reason.
  const why = section
    .split('\n\n')
    .find((p) => /standalone/i.test(p) && /(mkdir|directory)/i.test(p));
  assert.ok(why, `${GAZE} must explain WHY it owns the mkdir in its own paragraph`);
  assert.ok(
    /commands\/verify\.md/.test(why) && /commands\/review\.md/.test(why),
    `${GAZE} must NAME commands/verify.md and commands/review.md as the standalone callers with no equivalent mkdir step`
  );
  assert.ok(
    /not_observed/.test(section),
    `${GAZE} must note that a failed write is read back as not_observed by those callers`
  );
});

test('_base-agent.md leaves the unrelated sections intact', () => {
  const content = read(BASE_AGENT);
  const count = (needle) => content.split(needle).length - 1;
  assert.equal(count('## Sage Escalation'), 1, 'Sage Escalation section must be untouched');
  assert.equal(count('## Model Behavior Notes'), 1, 'Model Behavior Notes section must be untouched');
});

// ── tasks[].testResult: not_observed spelling agrees between the two docs a
// Blade actually reads ──────────────────────────────────────────────────────
// agents/blade.md:75 tells a Blade what to write for a check it did not run;
// reference/schemas/execution.md's generated table is what the validator
// (scripts/validate-artifact.js) actually enforces. Both must agree on the
// not_observed spelling and on passed being omitted, or a Blade following one
// document ships a testResult the validator reads from the other rejects.
// Each assertion is scoped to the single row/bullet that carries the rule -
// not_observed legitimately appears elsewhere in both files (the confidence
// vocabulary shared with agents/ward.md, the correctness.observations fields),
// so an unscoped /not_observed/ match on the whole file would pin nothing.

const EXECUTION_SCHEMA = 'reference/schemas/execution.md';

test('execution.md testResult.observation row names not_observed as the unrun-check spelling', () => {
  const content = read(EXECUTION_SCHEMA);
  const row = content.split('\n').find((l) => l.trimStart().startsWith('| tasks[].testResult.observation'));
  assert.ok(row, `${EXECUTION_SCHEMA} must document the tasks[].testResult.observation row`);
  assert.ok(
    row.includes('`"not_observed"`'),
    `${EXECUTION_SCHEMA}'s testResult.observation row must list "not_observed" as a legal enum value`
  );
  assert.ok(
    /only legal spelling/i.test(row),
    `${EXECUTION_SCHEMA}'s testResult.observation row must state not_observed is the only legal spelling for an unrun check`
  );
});

test('execution.md testResult.passed row requires passed be omitted when observation is not_observed', () => {
  const content = read(EXECUTION_SCHEMA);
  const row = content.split('\n').find((l) => l.trimStart().startsWith('| tasks[].testResult.passed'));
  assert.ok(row, `${EXECUTION_SCHEMA} must document the tasks[].testResult.passed row`);
  assert.ok(
    /must be omitted when `observation` is `not_observed`/.test(row),
    `${EXECUTION_SCHEMA}'s testResult.passed row must require passed be omitted when observation is not_observed`
  );
});

test('blade.md testResult bullet tells a Blade to write not_observed and omit passed for an unrun check', () => {
  const content = read('agents/blade.md');
  const bullet = content.split('\n').find((l) => l.trimStart().startsWith('- `testResult`'));
  assert.ok(bullet, 'agents/blade.md must carry the `testResult` completion-record bullet');
  assert.ok(
    /observation: "not_observed"/.test(bullet),
    'agents/blade.md\'s testResult bullet must instruct writing observation: "not_observed" for a check that did not run'
  );
  assert.ok(
    /omit `passed`/.test(bullet),
    "agents/blade.md's testResult bullet must instruct omitting `passed` for an unrun check"
  );
});
