// Author: Subash Karki
// agent-seniority.test.js: holds the seniority ladder to model-policy.json.
//
// The ladder is the semantic profile in plain language, not a separate opinion:
// frontier = lead, deep = principal, balanced = staff, economy = engineer. A
// title is therefore derivable, and this test derives it rather than trusting
// the prose. Repointing a role's profile in the policy fails here until its
// title follows, which is the failure mode that hardcoded model names ("top-tier
// (Opus 5)") already had once when Fable was retired from routing.
//
// Zero external deps: node:test + node:assert only.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.join(__dirname, '..');
const AGENTS_DIR = path.join(REPO_ROOT, 'agents');
const POLICY = path.join(REPO_ROOT, 'skills', 'phantom', 'references', 'model-policy.json');
const ROLES_DOC = path.join(REPO_ROOT, 'skills', 'phantom', 'references', 'roles.md');
const REGISTRY_DOC = path.join(REPO_ROOT, 'reference', 'agents.md');

// The one place the ladder is defined. Everything else derives from it.
// deep/balanced read "Principal-level"/"Staff-level", not "Principal
// engineer"/"Staff engineer" - post-rename, "engineer" is the Engineer
// agent's proper name (the economy rung below), so a job-title "engineer"
// suffix on any other rung collides with it. economy's bare "Engineer" is
// the rung name itself, not a collision.
const RUNG_BY_PROFILE = {
  frontier: 'Engineering lead',
  deep: 'Principal-level',
  balanced: 'Staff-level',
  economy: 'Engineer',
};

// Specialty suffix per role, or null when the rung alone names the job. These
// are editorial; the rung in front of them is not.
const SPECIALTY = {
  chief: null,
  engineer: null,
  advisor: 'consulting',
  auditor: 'code review',
  justice: 'systems and integration',
  detective: 'forensics',
  opposition: 'design review',
  steward: 'code health',
  surveyor: 'visual QA',
  inspector: 'verification',
  clerk: 'release',
};

// Short rung as it appears in the two human-facing tables.
const SHORT_RUNG = {
  frontier: 'Engineering lead',
  deep: 'Principal',
  balanced: 'Staff',
  economy: 'Engineer',
};

const policyRoles = JSON.parse(fs.readFileSync(POLICY, 'utf8')).roles;

function expectedTitle(role) {
  const rung = RUNG_BY_PROFILE[policyRoles[role]];
  const specialty = SPECIALTY[role];
  return specialty ? `${rung}, ${specialty}` : rung;
}

function description(role) {
  const source = fs.readFileSync(path.join(AGENTS_DIR, `${role}.md`), 'utf8');
  const line = source.split('\n').find((l) => l.startsWith('description:'));
  assert.ok(line, `${role}.md must carry a description`);
  return line.slice('description:'.length).trim();
}

test('the ladder covers every profile the policy can assign', () => {
  const assigned = [...new Set(Object.values(policyRoles))].sort();
  for (const profile of assigned) {
    assert.ok(RUNG_BY_PROFILE[profile], `profile ${profile} has no rung in the ladder`);
  }
});

test('every agent description opens with the rung its policy profile earns', () => {
  for (const role of Object.keys(policyRoles)) {
    const title = expectedTitle(role);
    assert.ok(
      description(role).startsWith(`${title}.`),
      `${role}.md description must open with "${title}." (profile: ${policyRoles[role]})`,
    );
  }
});

test('specialties are declared for exactly the active roles', () => {
  assert.deepEqual(Object.keys(SPECIALTY).sort(), Object.keys(policyRoles).sort());
});

test('roles.md carries each role at its rung and profile', () => {
  const doc = fs.readFileSync(ROLES_DOC, 'utf8');
  for (const [role, profile] of Object.entries(policyRoles)) {
    const name = role[0].toUpperCase() + role.slice(1);
    const row = doc.split('\n').find((l) => l.startsWith(`| ${name} |`));
    assert.ok(row, `roles.md must carry a row for ${name}`);
    assert.ok(
      row.includes(`| ${SHORT_RUNG[profile]} |`),
      `roles.md ${name} must sit at ${SHORT_RUNG[profile]} (profile: ${profile})`,
    );
    assert.ok(
      row.includes(`\`${profile}\``),
      `roles.md ${name} must state profile ${profile}, matching model-policy.json`,
    );
  }
});

test('the native registry carries each role at the same rung', () => {
  const doc = fs.readFileSync(REGISTRY_DOC, 'utf8');
  for (const [role, profile] of Object.entries(policyRoles)) {
    const name = role[0].toUpperCase() + role.slice(1);
    const row = doc.split('\n').find((l) => l.startsWith(`| ${name} |`));
    assert.ok(row, `reference/agents.md must carry a row for ${name}`);
    assert.ok(
      row.includes(`| ${SHORT_RUNG[profile]} |`),
      `reference/agents.md ${name} must sit at ${SHORT_RUNG[profile]} (profile: ${profile})`,
    );
  }
});

test('no description hardcodes a model identity the policy owns', () => {
  for (const role of Object.keys(policyRoles)) {
    assert.doesNotMatch(
      description(role),
      /\b(opus|sonnet|haiku|fable)\b/i,
      `${role}.md description must not name a model; the rung and model-policy.json own that`,
    );
  }
});
