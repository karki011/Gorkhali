// Author: Subash Karki
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');

const modulePromise = import('../skills/phantom/scripts/lib/session-migration/durable-publication.mjs');

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'phantom-durable-publication-'));
  fs.mkdirSync(path.join(root, 'state'), { mode: 0o700 });
  return { root, target: 'state/pointer.json' };
}

function options(root, target, bytes = Buffer.from('prepared-generation\n'), overrides = {}) {
  return {
    root,
    target,
    operation: 'pointer-cutover',
    mode: 0o640,
    bytes,
    maxBytes: 1024,
    ...overrides,
  };
}

test('prepared filename deterministically binds schema, operation, target, mode, size, and bytes', async (t) => {
  const api = await modulePromise;
  const { root, target } = fixture();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const base = options(root, target);
  const name = api.preparedPublicationName(base);

  assert.match(name, /^\.phantom-publish-v1-[a-f0-9]{24}-[a-f0-9]{64}\.prepared$/);
  assert.equal(api.preparedPublicationName(base), name);
  assert.equal(api.DURABLE_PUBLICATION_SCHEMA, 'phantom-durable-publication-v1');
  assert.notEqual(api.preparedPublicationName({ ...base, operation: 'journal-append' }), name);
  assert.notEqual(api.preparedPublicationName({ ...base, target: 'state/other.json' }), name);
  assert.notEqual(api.preparedPublicationName({ ...base, mode: 0o600 }), name);
  assert.notEqual(api.preparedPublicationName({ ...base, bytes: Buffer.from('other-generation----\n') }), name);
  assert.notEqual(api.preparedPublicationName({ ...base, bytes: Buffer.from('short') }), name);
});

test('an exact prepared file resumes after a crash-style boundary and publishes cleanly', async (t) => {
  const api = await modulePromise;
  const { root, target } = fixture();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const request = options(root, target);
  const expectedTarget = api.captureTargetGeneration({ root, target, maxBytes: 1024 });

  const first = api.prepareDurablePublication(request);
  assert.equal(first.resumed, false);
  assert.equal(fs.statSync(first.preparedPath).mode & 0o777, 0o600);
  assert.equal(fs.statSync(first.preparedPath).nlink, 1);

  const resumed = api.prepareDurablePublication(request);
  assert.equal(resumed.resumed, true);
  assert.equal(resumed.preparedPath, first.preparedPath);

  const published = api.publishDurablePublication({ ...request, expectedTarget });
  assert.equal(fs.readFileSync(path.join(root, target), 'utf8'), 'prepared-generation\n');
  assert.equal(fs.statSync(path.join(root, target)).mode & 0o777, 0o640);
  assert.equal(fs.existsSync(first.preparedPath), false);
  assert.equal(published.publishedPath, path.join(fs.realpathSync(root), target));
  assert.deepEqual(
    fs.readdirSync(path.join(root, 'state')).filter((name) => name.startsWith('.phantom-publish-')),
    [],
  );
});

test('mismatched prepared bytes fail closed and remain for inspection', async (t) => {
  const api = await modulePromise;
  const { root, target } = fixture();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const request = options(root, target, Buffer.from('expected'));
  const prepared = api.prepareDurablePublication(request);
  fs.writeFileSync(prepared.preparedPath, 'tampered');
  fs.chmodSync(prepared.preparedPath, 0o600);

  assert.throws(
    () => api.publishDurablePublication(request),
    (error) => error.code === 'PHANTOM_PUBLICATION_MISMATCH',
  );
  assert.equal(fs.readFileSync(prepared.preparedPath, 'utf8'), 'tampered');
  assert.equal(fs.existsSync(path.join(root, target)), false);
});

test('prepared symlinks and hardlinks are rejected without cleanup', async (t) => {
  const api = await modulePromise;

  await t.test('symlink', () => {
    const { root, target } = fixture();
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const request = options(root, target);
    const prepared = api.prepareDurablePublication(request);
    const decoy = path.join(root, 'decoy');
    fs.writeFileSync(decoy, request.bytes);
    fs.unlinkSync(prepared.preparedPath);
    fs.symlinkSync(decoy, prepared.preparedPath);

    assert.throws(
      () => api.publishDurablePublication(request),
      (error) => error.code === 'PHANTOM_PUBLICATION_TYPE',
    );
    assert.equal(fs.lstatSync(prepared.preparedPath).isSymbolicLink(), true);
  });

  await t.test('hardlink', () => {
    const { root, target } = fixture();
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const request = options(root, target);
    const prepared = api.prepareDurablePublication(request);
    const alias = path.join(root, 'prepared-alias');
    fs.linkSync(prepared.preparedPath, alias);

    assert.throws(
      () => api.publishDurablePublication(request),
      (error) => error.code === 'PHANTOM_PUBLICATION_LINKS',
    );
    assert.equal(fs.statSync(prepared.preparedPath).nlink, 2);
    assert.equal(fs.statSync(alias).nlink, 2);
  });
});

test('target generation CAS rejects replacement and retains the prepared candidate', async (t) => {
  const api = await modulePromise;
  const { root, target } = fixture();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const targetPath = path.join(root, target);
  fs.writeFileSync(targetPath, 'generation-one');
  const expectedTarget = api.captureTargetGeneration({ root, target, maxBytes: 1024 });
  const request = options(root, target, Buffer.from('generation-three'));
  const prepared = api.prepareDurablePublication(request);
  const replacement = path.join(root, 'state', 'replacement');
  fs.writeFileSync(replacement, 'generation-two');
  fs.renameSync(replacement, targetPath);

  assert.throws(
    () => api.publishDurablePublication({ ...request, expectedTarget }),
    (error) => error.code === 'PHANTOM_PUBLICATION_LEASE_REQUIRED',
  );
  const phases = [];
  assert.throws(
    () => api.publishDurablePublication({
      ...request,
      expectedTarget,
      validateLease(phase) {
        phases.push(phase);
        return true;
      },
    }),
    (error) => error.code === 'PHANTOM_PUBLICATION_GENERATION_CHANGED',
  );
  assert.deepEqual(phases, ['before_generation_check']);
  assert.equal(fs.readFileSync(targetPath, 'utf8'), 'generation-two');
  assert.equal(fs.existsSync(prepared.preparedPath), true);
  assert.equal(fs.statSync(prepared.preparedPath).mode & 0o777, 0o600);
});

test('an exact target generation CAS permits replacement', async (t) => {
  const api = await modulePromise;
  const { root, target } = fixture();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const targetPath = path.join(root, target);
  fs.writeFileSync(targetPath, 'generation-one');
  const expectedTarget = api.captureTargetGeneration({ root, target, maxBytes: 1024 });
  assert.deepEqual(
    Object.keys(expectedTarget).sort(),
    [
      'birthtimeNs', 'bytes', 'ctimeNs', 'device', 'inode', 'mode',
      'mtimeNs', 'nlink', 'size', 'state',
    ],
  );
  const request = options(root, target, Buffer.from('generation-two'));
  const prepared = api.prepareDurablePublication(request);
  const phases = [];

  api.publishDurablePublication({
    ...request,
    expectedTarget,
    validateLease(phase, context) {
      phases.push(phase);
      assert.equal(context.target, target);
      assert.equal(context.expectedTarget, expectedTarget);
      return true;
    },
  });
  assert.deepEqual(phases, [
    ...api.REPLACEMENT_LEASE_PHASES,
  ]);
  assert.equal(fs.readFileSync(targetPath, 'utf8'), 'generation-two');
  assert.equal(fs.existsSync(prepared.preparedPath), false);
});

test('absent target CAS rejects a new target and retains the prepared candidate', async (t) => {
  const api = await modulePromise;
  const { root, target } = fixture();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const expectedTarget = api.captureTargetGeneration({ root, target, maxBytes: 1024 });
  const request = options(root, target);
  const prepared = api.prepareDurablePublication(request);
  let injected = false;

  assert.throws(
    () => api.publishDurablePublication({
      ...request,
      expectedTarget,
      hooks: {
        onStep(step) {
          if (step === 'before_absent_link') {
            injected = true;
            fs.writeFileSync(path.join(root, target), 'racing-writer');
          }
        },
      },
    }),
    (error) => error.code === 'PHANTOM_PUBLICATION_TARGET_EXISTS',
  );
  assert.equal(injected, true);
  assert.equal(fs.existsSync(prepared.preparedPath), true);
  assert.equal(fs.readFileSync(path.join(root, target), 'utf8'), 'racing-writer');
});

test('bounded prepare and publish reject oversized input without deleting evidence', async (t) => {
  const api = await modulePromise;
  const { root, target } = fixture();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  assert.throws(
    () => api.prepareDurablePublication(options(root, target, Buffer.from('four'), { maxBytes: 3 })),
    (error) => error.code === 'PHANTOM_PUBLICATION_BOUNDS',
  );
  assert.deepEqual(fs.readdirSync(path.join(root, 'state')), []);

  const request = options(root, target, Buffer.from('abc'), { maxBytes: 3 });
  const prepared = api.prepareDurablePublication(request);
  fs.appendFileSync(prepared.preparedPath, 'd');
  assert.throws(
    () => api.publishDurablePublication(request),
    (error) => error.code === 'PHANTOM_PUBLICATION_BOUNDS',
  );
  assert.equal(fs.readFileSync(prepared.preparedPath, 'utf8'), 'abcd');
});

test('mismatched and duplicate target debris fails closed and is retained', async (t) => {
  const api = await modulePromise;
  const { root, target } = fixture();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const request = options(root, target);
  const expectedName = api.preparedPublicationName(request);
  const mismatch = expectedName.replace(/[a-f0-9]{64}\.prepared$/, `${'0'.repeat(64)}.prepared`);
  const mismatchPath = path.join(root, 'state', mismatch);
  fs.writeFileSync(mismatchPath, request.bytes, { mode: 0o600 });

  assert.throws(
    () => api.prepareDurablePublication(request),
    (error) => error.code === 'PHANTOM_PUBLICATION_DEBRIS',
  );
  assert.equal(fs.existsSync(mismatchPath), true);

  fs.writeFileSync(path.join(root, 'state', expectedName), request.bytes, { mode: 0o600 });
  assert.throws(
    () => api.prepareDurablePublication(request),
    (error) => error.code === 'PHANTOM_PUBLICATION_DEBRIS',
  );
  assert.equal(fs.existsSync(mismatchPath), true);
  assert.equal(fs.existsSync(path.join(root, 'state', expectedName)), true);
});

test('present replacement rejects an invalid lease at a stable phase', async (t) => {
  const api = await modulePromise;
  const { root, target } = fixture();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, target), 'old');
  const expectedTarget = api.captureTargetGeneration({ root, target, maxBytes: 1024 });
  const request = options(root, target, Buffer.from('new'));
  const prepared = api.prepareDurablePublication(request);
  const phases = [];

  assert.throws(
    () => api.publishDurablePublication({
      ...request,
      expectedTarget,
      validateLease(phase) {
        phases.push(phase);
        return phase !== 'after_generation_check';
      },
    }),
    (error) => error.code === 'PHANTOM_PUBLICATION_LEASE_INVALID',
  );
  assert.deepEqual(phases, ['before_generation_check', 'after_generation_check']);
  assert.equal(fs.existsSync(prepared.preparedPath), true);
  assert.equal(fs.readFileSync(path.join(root, target), 'utf8'), 'old');
});

test('a missing prepared file retries as already_published after exact verification and fsync', async (t) => {
  const api = await modulePromise;
  const { root, target } = fixture();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const request = options(root, target);
  const prepared = api.prepareDurablePublication(request);
  const first = api.publishDurablePublication({ ...request, expectedTarget: { state: 'absent' } });
  assert.equal(first.status, 'published');
  assert.equal(fs.existsSync(prepared.preparedPath), false);

  const steps = [];
  const retry = api.publishDurablePublication({
    ...request,
    expectedTarget: { state: 'absent' },
    hooks: { onStep: (step) => steps.push(step) },
  });
  assert.equal(retry.status, 'already_published');
  assert.deepEqual(steps.slice(-4), [
    'before_published_file_fsync',
    'after_published_file_fsync',
    'before_published_parent_fsync',
    'after_published_parent_fsync',
  ]);
});

test('partial random staging never resumes and is safely cleaned on retry', async (t) => {
  const api = await modulePromise;
  const { root, target } = fixture();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const request = options(root, target);

  assert.throws(
    () => api.prepareDurablePublication({
      ...request,
      hooks: {
        onStep(step) {
          if (step === 'before_staging_file_fsync') throw new Error('injected fsync failure');
        },
      },
    }),
    (error) => error.code === 'PHANTOM_PUBLICATION_IO',
  );
  const afterFailure = fs.readdirSync(path.join(root, 'state'));
  assert.equal(afterFailure.some((name) => name.endsWith('.prepared')), false);
  assert.equal(afterFailure.filter((name) => name.includes('.stage-')).length, 1);

  const prepared = api.prepareDurablePublication(request);
  assert.equal(prepared.resumed, false);
  assert.equal(fs.existsSync(prepared.preparedPath), true);
  assert.equal(fs.readdirSync(path.join(root, 'state')).some((name) => name.includes('.stage-')), false);
});

test('installed staging interrupted before unlink recovers to one prepared link', async (t) => {
  const api = await modulePromise;
  const { root, target } = fixture();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const request = options(root, target);

  assert.throws(
    () => api.prepareDurablePublication({
      ...request,
      hooks: {
        onStep(step) {
          if (step === 'after_prepared_install') throw new Error('crash after prepared link');
        },
      },
    }),
    (error) => error.code === 'PHANTOM_PUBLICATION_IO',
  );
  const interrupted = fs.readdirSync(path.join(root, 'state'));
  assert.equal(interrupted.filter((name) => name.includes('.stage-')).length, 1);
  assert.equal(interrupted.filter((name) => name.endsWith('.prepared')).length, 1);

  const resumed = api.prepareDurablePublication(request);
  assert.equal(resumed.resumed, true);
  assert.equal(fs.statSync(resumed.preparedPath).nlink, 1);
  assert.equal(fs.readdirSync(path.join(root, 'state')).some((name) => name.includes('.stage-')), false);
});

test('no-replace link interruption recovers as already_published', async (t) => {
  const api = await modulePromise;
  const { root, target } = fixture();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const request = options(root, target);
  const prepared = api.prepareDurablePublication(request);

  assert.throws(
    () => api.publishDurablePublication({
      ...request,
      expectedTarget: { state: 'absent' },
      hooks: {
        onStep(step) {
          if (step === 'after_absent_link') throw new Error('crash after target link');
        },
      },
    }),
    (error) => error.code === 'PHANTOM_PUBLICATION_IO',
  );
  assert.equal(fs.statSync(prepared.preparedPath).nlink, 2);
  assert.equal(fs.statSync(path.join(root, target)).nlink, 2);

  const retry = api.publishDurablePublication(request);
  assert.equal(retry.status, 'already_published');
  assert.equal(fs.existsSync(prepared.preparedPath), false);
  assert.equal(fs.statSync(path.join(root, target)).nlink, 1);
});

test('publication rejects untrusted or symlinked parent directories', async (t) => {
  const api = await modulePromise;

  await t.test('public parent', () => {
    const { root, target } = fixture();
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    fs.chmodSync(path.join(root, 'state'), 0o755);
    assert.throws(
      () => api.prepareDurablePublication(options(root, target)),
      (error) => error.code === 'PHANTOM_PUBLICATION_TRUST',
    );
  });

  await t.test('symlink segment', () => {
    const { root } = fixture();
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const real = path.join(root, 'real');
    fs.mkdirSync(real, { mode: 0o700 });
    fs.symlinkSync(real, path.join(root, 'linked'));
    assert.throws(
      () => api.prepareDurablePublication(options(root, 'linked/pointer.json')),
      (error) => error.code === 'PHANTOM_PUBLICATION_TRUST',
    );
  });
});

test('published fsync ordering is observable and a parent-fsync failure retries safely', async (t) => {
  const api = await modulePromise;
  const { root, target } = fixture();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const request = options(root, target);
  const prepared = api.prepareDurablePublication(request);
  const steps = [];

  assert.throws(
    () => api.publishDurablePublication({
      ...request,
      expectedTarget: { state: 'absent' },
      hooks: {
        onStep(step) {
          steps.push(step);
          if (step === 'before_published_parent_fsync') throw new Error('injected directory fsync failure');
        },
      },
    }),
    (error) => error.code === 'PHANTOM_PUBLICATION_IO',
  );
  assert.equal(fs.existsSync(prepared.preparedPath), false);
  assert.deepEqual(steps.slice(-3), [
    'before_published_file_fsync',
    'after_published_file_fsync',
    'before_published_parent_fsync',
  ]);

  const retry = api.publishDurablePublication(request);
  assert.equal(retry.status, 'already_published');
  assert.equal(fs.readFileSync(path.join(root, target), 'utf8'), 'prepared-generation\n');
});

test('stable error codes are unique and exported', async () => {
  const api = await modulePromise;
  const codes = Object.values(api.DURABLE_PUBLICATION_ERROR_CODES);
  assert.equal(new Set(codes).size, codes.length);
  assert.ok(codes.every((code) => /^PHANTOM_PUBLICATION_[A-Z_]+$/.test(code)));
});
