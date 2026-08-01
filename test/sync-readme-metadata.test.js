// Author: Subash Karki
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  START,
  END,
  ROADMAP_START,
  ROADMAP_END,
  parseArgs,
  parseTapSummary,
  readProjectMetadata,
  renderMetadataBlock,
  renderRoadmapStatus,
  replaceMetadataBlock,
  syncMetadata,
} = require('../scripts/sync-readme-metadata');

const PASSING_TAP = `TAP version 13
1..3
# tests 3
# suites 0
# pass 2
# fail 0
# cancelled 0
# skipped 1
# todo 0
# duration_ms 12.5
`;

const NESTED_TAP = `TAP version 13
# Subtest: grouped checks
    ok 1 - first nested check
    ok 2 - second nested check
    1..2
ok 1 - grouped checks
ok 2 - top-level check
1..2
# tests 4
# suites 0
# pass 4
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 15.5
`;

function projectFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'readme-metadata-'));
  fs.mkdirSync(path.join(root, '.claude-plugin'));
  fs.mkdirSync(path.join(root, 'evals'));
  fs.mkdirSync(path.join(root, 'skills', 'phantom'), { recursive: true });
  fs.writeFileSync(path.join(root, '.claude-plugin', 'plugin.json'), '{"version":"1.2.3"}\n');
  fs.writeFileSync(path.join(root, 'skills', 'phantom', 'manifest.json'), JSON.stringify({
    bundle_version: '4.5.6',
    contracts: {
      workflow_plan: { version: 2, resources: ['schemas/workflow-plan.schema.json'] },
      workflow_event: { version: 2, resources: ['schemas/workflow-event.schema.json'] },
    },
  }));
  fs.writeFileSync(path.join(root, 'evals', 'evals.json'), JSON.stringify({
    schema_version: 2,
    evals: [
      { id: 1, skill: 'a', prompt: 'a', should_trigger: true },
      { id: 2, kind: 'route', skill: 'b', prompt: 'b' },
      { id: 3, kind: 'convention', skill: 'c', prompt: 'c' },
    ],
  }));
  fs.writeFileSync(path.join(root, 'README.md'), `# Project\n\n${START}\nstale\n${END}\n`);
  fs.writeFileSync(path.join(root, 'ROADMAP.md'), `# Roadmap\n\n${ROADMAP_START}\nstale\n${ROADMAP_END}\n`);
  const tap = path.join(root, 'test.tap');
  fs.writeFileSync(tap, PASSING_TAP);
  return { root, tap };
}

test('parseTapSummary derives counts only from a successful final TAP summary', () => {
  assert.deepEqual(parseTapSummary(PASSING_TAP), { tests: 3, pass: 2, fail: 0, cancelled: 0, skipped: 1, todo: 0 });
  assert.deepEqual(parseTapSummary(NESTED_TAP), { tests: 4, pass: 4, fail: 0, cancelled: 0, skipped: 0, todo: 0 });
  assert.throws(() => parseTapSummary(PASSING_TAP.replace('# fail 0', '# fail 1')), /unsuccessful test run/);
  assert.throws(() => parseTapSummary('ok 1 - no summary'), /complete final plan and summary/);
  assert.throws(() => parseTapSummary(PASSING_TAP.replace('# pass 2', '# pass 1')), /internally inconsistent/);
});

test('parseTapSummary rejects zero, incomplete, mismatched flat, and trailing TAP results', () => {
  assert.throws(() => parseTapSummary(PASSING_TAP
    .replace('1..3', '1..0')
    .replace('# tests 3', '# tests 0')
    .replace('# pass 2', '# pass 0')
    .replace('# skipped 1', '# skipped 0')), /zero tests/);
  assert.throws(() => parseTapSummary(PASSING_TAP.replace('# todo 0\n', '')), /complete final plan and summary/);
  assert.throws(() => parseTapSummary(PASSING_TAP.replace('1..3', '1..4')), /does not match summary test count/);
  assert.throws(() => parseTapSummary(`${PASSING_TAP}not TAP\n`), /trailing content/);
});

test('readProjectMetadata derives version, eval categories, and test count from authorities', () => {
  const fixture = projectFixture();
  const metadata = readProjectMetadata(fixture.root, fixture.tap);
  assert.equal(metadata.version, '1.2.3');
  assert.equal(metadata.bundleVersion, '4.5.6');
  assert.equal(metadata.contractCount, 2);
  assert.deepEqual(metadata.evals, { total: 3, trigger: 1, route: 1, convention: 1 });
  assert.equal(metadata.tests.tests, 3);
});

test('readProjectMetadata rejects malformed contract registry entries', () => {
  const fixture = projectFixture();
  const file = path.join(fixture.root, 'skills', 'phantom', 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
  manifest.contracts.workflow_plan.resources = [];
  fs.writeFileSync(file, JSON.stringify(manifest));
  assert.throws(() => readProjectMetadata(fixture.root, fixture.tap), /contract workflow_plan is invalid/);
});

test('renderRoadmapStatus derives release status from the same authorities', () => {
  const fixture = projectFixture();
  const metadata = readProjectMetadata(fixture.root, fixture.tap);
  const block = renderRoadmapStatus(metadata);
  assert.match(block, /Package `1\.2\.3`/);
  assert.match(block, /bundle `4\.5\.6`/);
  assert.match(block, /2 versioned contracts/);
  assert.match(block, /3 completed test cases/);
  assert.doesNotMatch(block, /passed|skipped|todo/);
  assert.equal(renderRoadmapStatus({
    ...metadata,
    tests: { ...metadata.tests, pass: 1, skipped: 2 },
  }), block);
  assert.match(block, /3 declared isolated evaluation cases/);
});

test('renderMetadataBlock is deterministic and includes all three derived facts', () => {
  const fixture = projectFixture();
  const block = renderMetadataBlock(readProjectMetadata(fixture.root, fixture.tap));
  assert.match(block, /version-1\.2\.3-blue/);
  assert.match(block, /tests-3-brightgreen/);
  assert.match(block, /declared_evals-3-brightgreen/);
});

test('replaceMetadataBlock requires exact markers and changes only their contents', () => {
  assert.equal(replaceMetadataBlock(`before\n${START}\nold\n${END}\nafter`, `${START}\nnew\n${END}`),
    `before\n${START}\nnew\n${END}\nafter`);
  assert.throws(() => replaceMetadataBlock('# no markers', 'block'), /markers are missing/);
});

test('syncMetadata write then check is stable; stale check fails closed', () => {
  const fixture = projectFixture();
  assert.throws(() => syncMetadata({ root: fixture.root, tap: fixture.tap, mode: 'check' }), /metadata is stale/);
  assert.equal(syncMetadata({ root: fixture.root, tap: fixture.tap, mode: 'write' }).changed, true);
  assert.deepEqual(syncMetadata({ root: fixture.root, tap: fixture.tap, mode: 'check' }).changed, false);
});

test('parseArgs requires TAP provenance and rejects unknown options', () => {
  assert.throws(() => parseArgs(['--check']), /--tap is required/);
  assert.throws(() => parseArgs(['--tap', '/tmp/result.tap', '--legacy']), /unknown argument/);
  const parsed = parseArgs(['--write', '--root', '/tmp/project', '--tap', '/tmp/result.tap']);
  assert.equal(parsed.mode, 'write');
  assert.equal(parsed.root, '/tmp/project');
  assert.equal(parsed.tap, '/tmp/result.tap');
});

test('CI preserves TAP failures and enforces generated metadata plus synchronized versions', () => {
  const workflow = fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', 'ci.yml'), 'utf8');
  assert.match(workflow, /set -o pipefail[\s\S]+--test-reporter=tap[\s\S]+\| tee/);
  assert.match(workflow, /npm run metadata:check/);
  assert.match(workflow, /npm run version:check/);
  assert.doesNotMatch(workflow, /gen-schema-docs/);
});
