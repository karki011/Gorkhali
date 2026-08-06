// Author: Subash Karki
// roster-naming.test.js — keeps reference/roster.md honest as spawn sites are
// added: every literal spawn spec under commands/, reference/ and agents/ must carry a
// `name:` alongside its `subagent_type:`. A name-less spawn is unresolvable by
// hooks/wake-classifier.js (the spawn's `name:`, the agent-records stub
// filename and `payload.agent_type` are the SAME string), and the live gate in
// hooks/blade-model-gate.js now denies one — this test stops the docs from
// specifying a spawn the gate would reject.
//
// Pure string checks, no LLM. A line is a spawn spec when it carries either
// SPEC_TOKEN — `subagent_type:` or `bypassPermissions` (both are Agent-call
// params, not narrative) — unless it is listed in POLICY_PROSE below. The
// `name:` must appear in the SAME spawn construct, delimited structurally by
// blockFor() below, so one spawn can never borrow its neighbour's name.
//
// KNOWN LIMIT: a spawn written as pure prose ("spawn Archer agent (opus)")
// carries no param token at all, and no token scan can see it. Those are caught
// by review; the fix — writing the spawn as a real spec — brings the site under
// this scan.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.join(__dirname, '..');
// Scanned RECURSIVELY: spawn specs live in nested reference docs
// (reference/wrap/evolution.md), under agents/reference/, and in `_shared-*.md`
// partials — none of which a top-level readdir would ever see.
const SCAN_DIRS = ['commands', 'reference', 'agents'];

// Agent-call params that mark a line as a literal spawn spec.
const SPEC_TOKENS = ['subagent_type:', 'bypassPermissions'];

// A spec line's `name:` must live in the SAME spawn construct, not merely
// nearby: a fixed line window let a neighbouring spawn's name satisfy an unnamed
// one. blockFor() grows from the spec line across contiguous lines and stops at
// a structural boundary — blank line, heading, the start of ANOTHER spawn
// (`subagent_type:`), or a list item that is not itself a spawn param. That
// keeps a param bullet list (`- subagent_type:` / `- name:` / `- mode:`) and a
// fenced `Agent(...)` block whole, while never spanning two spawns.
const PARAM_LINE_RE =
  /^\s*(?:[-*+]|\d+\.)?\s*\**`?\s*(?:subagent_type|name|mode|model|effort|prompt|description|isolation|run_in_background)\b/;
const LIST_ITEM_RE = /^\s*(?:[-*+]|\d+\.)\s/;
const HEADING_RE = /^#{1,6}\s/;

function blockFor(lines, i) {
  const boundary = (line) =>
    line.trim() === ''
    || HEADING_RE.test(line)
    || line.includes('subagent_type:')
    || (LIST_ITEM_RE.test(line) && !PARAM_LINE_RE.test(line));

  let start = i;
  while (start > 0 && !boundary(lines[start - 1])) start--;
  let end = i;
  while (end + 1 < lines.length && !boundary(lines[end + 1])) end++;
  return lines.slice(start, end + 1).join('\n');
}

// Lines that carry a SPEC_TOKEN as POLICY PROSE — a rule about spawning, not a
// call site a name could be attached to. Each entry is { file, match } where
// `match` is a substring uniquely identifying the line (line numbers would rot
// on every edit).
const POLICY_PROSE = [
  {
    file: 'commands/start.md',
    match: '`model: "haiku"` override ONLY for trivial mechanical',
    why: 'model-override rule; the DIRECT-route spawn block below it carries the name',
  },
  {
    file: 'commands/scout.md',
    match: 'All scouts `subagent_type: "blade"` with read-only ROLE FOCUS',
    why: 'restates the scout naming rule and points at roster.md',
  },
  {
    file: 'commands/execute.md',
    match: 'All implementation tasks spawn `subagent_type: blade`',
    why: 'model-routing rule for the wave; names come from the Rule 1 task index',
  },
  {
    file: 'commands/execute.md',
    match: 'with `model: "haiku"` override',
    why: 'mechanical-edit fast path — a model-override rule for the same wave spawn as above',
  },
  {
    file: 'commands/execute.md',
    match: 'SOLO route: spawn 1 `subagent_type: blade`',
    why: 'route description; the wake-bookkeeping bullet fixes the name for both routes',
  },
  {
    file: 'commands/execute.md',
    match: 'SHADOWS route: spawn parallel `subagent_type: blade`',
    why: 'route description; the wake-bookkeeping bullet fixes the name for both routes',
  },
  {
    file: 'commands/execute.md',
    match: 'All agents: `mode: "bypassPermissions"`',
    why: 'blanket mode rule for the wave; the wave spawn itself is named by task index',
  },
  {
    file: 'commands/scout.md',
    match: 'All agents `mode: "bypassPermissions"`',
    why: 'blanket mode rule; the Step 2 scout spawn above carries the scout-* names',
  },
  {
    file: 'commands/start.md',
    match: '`mode: "bypassPermissions"` — always',
    why: 'Core Discipline bullet stating the mode for every spawn; not a call site',
  },
  {
    file: 'commands/validate.md',
    match: '**PreToolUse hook** on Agent calls validates',
    why: 'describes what the hook checks; no spawn is being specified',
  },
  {
    file: 'reference/agents.md',
    match: 'All agents: `mode: "bypassPermissions"`',
    why: 'canonical blanket mode rule for every spawn site',
  },
  {
    file: 'agents/apex.md',
    match: 'ALWAYS `bypassPermissions` + `run_in_background`',
    why: "Apex's spawn-discipline bullet; not a call site",
  },
  {
    file: 'commands/brainstorm.md',
    match: 'Spawn 2-3 research agents **in parallel**',
    why: 'lead-in paragraph for the Agent 1/2/3 bullets below, each of which carries '
      + 'its own subagent_type + name; it already spells the three scout names in prose',
  },
];

// Every .md under `dir`, at any depth, as a repo-relative path.
function markdownFiles(dir) {
  const out = [];
  const walk = (rel) => {
    for (const entry of fs.readdirSync(path.join(REPO_ROOT, rel), { withFileTypes: true })) {
      const child = path.join(rel, entry.name);
      if (entry.isDirectory()) walk(child);
      else if (entry.name.endsWith('.md')) out.push(child);
    }
  };
  walk(dir);
  return out.sort();
}

function isPolicyProse(file, line) {
  return POLICY_PROSE.some((e) => e.file === file && line.includes(e.match));
}

function spawnSpecViolations() {
  const violations = [];
  for (const dir of SCAN_DIRS) {
    for (const file of markdownFiles(dir)) {
      const lines = fs.readFileSync(path.join(REPO_ROOT, file), 'utf8').split('\n');
      lines.forEach((line, i) => {
        if (!SPEC_TOKENS.some((t) => line.includes(t))) return;
        if (isPolicyProse(file, line)) return;
        if (!/\bname:/.test(blockFor(lines, i))) {
          violations.push(`${file}:${i + 1}: ${line.trim()}`);
        }
      });
    }
  }
  return violations;
}

test('every literal spawn spec under commands/, reference/ and agents/ carries a name:', () => {
  const violations = spawnSpecViolations();
  assert.deepEqual(
    violations,
    [],
    'spawn specs missing `name:` (add the roster name, or add a POLICY_PROSE entry '
    + 'if the line is a rule rather than a call site):\n' + violations.join('\n')
  );
});

test('every POLICY_PROSE allowlist entry still matches a real line', () => {
  const stale = POLICY_PROSE.filter((e) => {
    const abs = path.join(REPO_ROOT, e.file);
    if (!fs.existsSync(abs)) return true;
    return !fs.readFileSync(abs, 'utf8')
      .split('\n')
      .some((l) => SPEC_TOKENS.some((t) => l.includes(t)) && l.includes(e.match));
  });
  assert.deepEqual(
    stale.map((e) => `${e.file}: ${e.match}`),
    [],
    'allowlist entries no longer match any spawn-spec line — delete them'
  );
});

test('reference/roster.md exists and pins the stub-binding invariant', () => {
  const roster = fs.readFileSync(path.join(REPO_ROOT, 'reference', 'roster.md'), 'utf8');
  assert.match(roster, /## Stub Binding/, 'roster.md must document stub binding');
  assert.match(roster, /agent_type/, 'stub binding must name the wake-classifier payload field');
});

test('hooks/blade-model-gate.js enforces the roster name rule', () => {
  const gate = fs.readFileSync(path.join(REPO_ROOT, 'hooks', 'blade-model-gate.js'), 'utf8');
  assert.match(gate, /AGENT NAME GATE/, 'gate must carry the name-gate deny reason');
  assert.match(gate, /roster\.md/, 'deny reason must point at reference/roster.md');
});
