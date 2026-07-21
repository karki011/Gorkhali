// Author: Subash Karki
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ANALYZER = path.join(__dirname, '..', 'skills', 'phantom', 'scripts', 'inspect-impact.mjs');

function workspace(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'phantom-impact-'));
  for (const [name, content] of Object.entries(files)) {
    const file = path.join(root, name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
  }
  return root;
}

function run(root, targets, options = []) {
  return spawnSync(
    process.execPath,
    [ANALYZER, 'inspect', '--workspace', root, ...options, ...targets],
    { encoding: 'utf8' },
  );
}

function parse(result) {
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

test('impact analysis is deterministic and unions direct and transitive importers', () => {
  const root = workspace({
    'src/app.ts': "import './service';\n",
    'src/broken.ts': "import './missing';\n",
    'src/core.ts': 'export const core = true;\n',
    'src/other-user.ts': "import './other';\n",
    'src/other.ts': 'export const other = true;\n',
    'src/peer.ts': "import './core';\n",
    'src/service.ts': "import './core';\n",
    'test/app.test.ts': "import '../src/app';\n",
  });

  const first = run(root, ['src/other.ts', 'src/core.ts'], ['--depth', '3']);
  const second = run(root, ['src/other.ts', 'src/core.ts'], ['--depth', '3']);
  const output = parse(first);

  assert.equal(first.stdout, second.stdout);
  assert.equal(output.status, 'complete');
  assert.equal(output.source, 'bundled-local-analysis');
  assert.deepEqual(output.query.targets, ['src/core.ts', 'src/other.ts']);
  assert.deepEqual(output.blast_radius.directly_affected, [
    'src/other-user.ts',
    'src/peer.ts',
    'src/service.ts',
  ]);
  assert.deepEqual(output.blast_radius.transitively_affected, [
    'src/app.ts',
    'test/app.test.ts',
  ]);
  assert.equal(output.coverage.discovery, 'walk');
});

test('cycles terminate without duplicating related files', () => {
  const root = workspace({
    'a.ts': "import './b';\n",
    'b.ts': "import './a';\n",
  });
  const output = parse(run(root, ['a.ts'], ['--depth', '4']));

  assert.deepEqual(output.related_files, ['b.ts']);
  assert.deepEqual(output.blast_radius.directly_affected, ['b.ts']);
  assert.deepEqual(output.blast_radius.transitively_affected, []);
  assert.equal(output.blast_radius.impact_score, 0.5);
});

test('blast radius computes full reverse closure beyond context depth', () => {
  const root = workspace({
    'a.ts': 'export const value = true;\n',
    'b.ts': "import './a';\n",
    'c.ts': "import './b';\n",
    'd.ts': "import './c';\n",
  });
  const output = parse(run(root, ['a.ts']));

  assert.equal(output.status, 'complete');
  assert.deepEqual(output.related_files, ['b.ts', 'c.ts']);
  assert.deepEqual(output.blast_radius.directly_affected, ['b.ts']);
  assert.deepEqual(output.blast_radius.transitively_affected, ['c.ts', 'd.ts']);
});

test('supported languages contribute local dependency edges', () => {
  const root = workspace({
    'go.mod': 'module example.test/project\n',
    'cmd/main.go': 'package main\nimport "example.test/project/lib"\n',
    'lib/lib.go': 'package lib\n',
    'native/helper.h': '#define VALUE 1\n',
    'native/main.c': '#include "helper.h"\n',
    'alpha.py': 'value = 1\n',
    'beta.py': 'value = 2\n',
    'imports.py': 'import alpha, beta\n',
    'pkg/helper.py': 'value = 1\n',
    'pkg/main.py': 'from . import helper\n',
    'src/helper.rs': 'pub fn value() {}\n',
    'src/lib.rs': 'use crate::{helper};\n',
  });
  const output = parse(run(root, [
    'alpha.py',
    'beta.py',
    'lib/lib.go',
    'native/helper.h',
    'pkg/helper.py',
    'src/helper.rs',
  ], ['--depth', '1']));

  assert.deepEqual(output.blast_radius.directly_affected, [
    'cmd/main.go',
    'imports.py',
    'native/main.c',
    'pkg/main.py',
    'src/lib.rs',
  ]);
  assert.deepEqual(output.coverage.languages, {
    c: 2,
    go: 2,
    python: 5,
    rust: 2,
  });
});

test('quoted C includes do not bind to script extensions', () => {
  const root = workspace({
    'native/config.js': 'export const config = true;\n',
    'native/main.c': '#include "config"\n',
  });
  const output = parse(run(root, ['native/config.js']));

  assert.equal(output.status, 'complete');
  assert.deepEqual(output.blast_radius.directly_affected, []);
});

test('ignored directories do not enter fallback discovery', () => {
  const root = workspace({
    'node_modules/noise.ts': "import '../src/core';\n",
    'src/core.ts': 'export const core = true;\n',
    'src/service.ts': "import './core';\n",
  });
  const output = parse(run(root, ['src/core.ts']));

  assert.equal(output.coverage.discovery, 'walk');
  assert.equal(output.coverage.files_discovered, 2);
  assert.deepEqual(output.blast_radius.directly_affected, ['src/service.ts']);
});

test('scan and result limits produce explicit partial coverage', () => {
  const root = workspace({
    'a.ts': 'export const value = true;\n',
    'b.ts': "import './a';\n",
    'c.ts': "import './b';\n",
  });
  const output = parse(run(root, ['a.ts'], ['--depth', '3', '--max-results', '1']));

  assert.equal(output.status, 'partial');
  assert.equal(output.coverage.truncated, true);
  assert.equal(output.context.files.length, 1);
  assert.equal(output.blast_radius.directly_affected.length, 1);

  const edgeLimited = parse(run(root, ['a.ts'], ['--depth', '3', '--max-edges', '1']));
  assert.equal(edgeLimited.status, 'partial');
  assert.equal(edgeLimited.coverage.skipped.edge_limit, 1);
  assert.deepEqual(edgeLimited.blast_radius.directly_affected, ['b.ts']);
  assert.deepEqual(edgeLimited.blast_radius.transitively_affected, []);

  const fileLimited = parse(run(root, ['a.ts'], ['--max-files', '1']));
  assert.equal(fileLimited.status, 'partial');
  assert.equal(fileLimited.coverage.skipped.discovery_limit, 1);

  const byteLimited = parse(run(root, ['a.ts'], ['--max-bytes', '1']));
  assert.equal(byteLimited.status, 'partial');
  assert.ok(byteLimited.coverage.skipped.byte_limit > 0);
});

test('edge and unresolved-warning collection stays bounded under dense input', () => {
  const files = {};
  const imports = [];
  for (let index = 0; index < 600; index += 1) {
    const name = `dep-${String(index).padStart(4, '0')}`;
    files[`src/${name}.ts`] = `export const value${index} = true;\n`;
    imports.push(`import './${name}';`);
    imports.push(`import './missing-${String(index).padStart(4, '0')}';`);
  }
  files['src/app.ts'] = `${imports.join('\n')}\n`;
  const root = workspace(files);
  const output = parse(run(root, ['src/app.ts'], ['--max-edges', '25']));

  assert.equal(output.status, 'partial');
  assert.equal(output.context.edges.length, 25);
  assert.equal(output.coverage.skipped.edge_limit, 575);
  assert.equal(output.coverage.skipped.warning_limit, 100);
  assert.equal(output.warnings.length, 100);
});

test('symlinked module metadata is never read outside the workspace', () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'phantom-impact-module-'));
  const root = path.join(parent, 'workspace');
  fs.mkdirSync(path.join(root, 'lib'), { recursive: true });
  fs.mkdirSync(path.join(root, 'cmd'), { recursive: true });
  fs.writeFileSync(path.join(parent, 'outside.mod'), 'module evil.test/project\n');
  fs.writeFileSync(path.join(root, 'lib', 'lib.go'), 'package lib\n');
  fs.writeFileSync(path.join(root, 'cmd', 'main.go'), 'package main\nimport "evil.test/project/lib"\n');
  fs.symlinkSync(path.join(parent, 'outside.mod'), path.join(root, 'go.mod'));
  const output = parse(run(root, ['lib/lib.go']));

  assert.equal(output.status, 'partial');
  assert.equal(output.coverage.skipped.go_module, 1);
  assert.deepEqual(output.blast_radius.directly_affected, []);
});

test('unresolved local imports are reported instead of guessed', () => {
  const root = workspace({
    'src/broken.ts': "import './missing';\n",
  });
  const output = parse(run(root, ['src/broken.ts']));

  assert.equal(output.status, 'partial');
  assert.match(output.warnings.join('\n'), /Unresolved local import/);
});

test('targets cannot escape the workspace and invalid arguments fail clearly', () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'phantom-impact-boundary-'));
  const root = path.join(parent, 'workspace');
  fs.mkdirSync(root);
  fs.writeFileSync(path.join(parent, 'outside.ts'), 'export const outside = true;\n');
  fs.symlinkSync(path.join(parent, 'outside.ts'), path.join(root, 'link.ts'));

  for (const target of ['../outside.ts', 'link.ts']) {
    const escaped = run(root, [target]);
    assert.notEqual(escaped.status, 0);
    assert.match(escaped.stderr, /escapes the workspace/);
  }

  const invalidDepth = run(root, ['missing.ts'], ['--depth', '5']);
  assert.notEqual(invalidDepth.status, 0);
  assert.match(invalidDepth.stderr, /depth must be an integer from 1 to 4/);

  const missing = run(root, ['missing.ts']);
  assert.notEqual(missing.status, 0);
  assert.match(missing.stderr, /Target does not exist/);

  const raisedLimit = run(root, ['link.ts'], ['--max-files', '5001']);
  assert.notEqual(raisedLimit.status, 0);
  assert.match(raisedLimit.stderr, /max-files must be an integer from 1 to 5000/);
});
