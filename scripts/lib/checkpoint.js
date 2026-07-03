// Author: Subash Karki
// checkpoint.js — atomic phase-checkpoint library. Numbered JSON chunks per phase,
// inspired by anthropics/defending-code-reference-harness checkpoint.py.
// Atomic via write-to-tmp + fs.renameSync (same-dir tmp → no cross-device rename).
'use strict';

const fs = require('fs');
const path = require('path');

// DRY: the atomic temp+rename write lives in atomic.js now (unique same-dir tmp,
// so concurrent checkpoint writers to one file never collide on the temp name).
// Keep a LOAD-FAILURE fallback so a missing/broken atomic.js degrades to the prior
// inline behavior rather than crashing a checkpoint write.
let atomicWrite;
try {
  ({ atomicWrite } = require('./atomic'));
} catch (_) {
  atomicWrite = (file, content) => {
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, content, 'utf8');
    fs.renameSync(tmp, file);
  };
}

// Regex: matches NNN-<anything>.json at the top level of dir (no path sep in filename).
const CHUNK_RE = /^(\d{3})-[^/\\]+\.json$/;

/**
 * Return next monotonic seq by scanning existing NNN-*.json files in dir.
 * Dir need not exist yet (returns 1).
 */
function _nextSeq(dir) {
  let files;
  try {
    files = fs.readdirSync(dir);
  } catch {
    return 1;
  }
  let max = 0;
  for (const f of files) {
    const m = CHUNK_RE.exec(f);
    if (m) {
      const n = parseInt(m[1], 10);
      if (n > max) max = n;
    }
  }
  return max + 1;
}

/**
 * writeCheckpoint(dir, phase, data) → { seq, file }
 *
 * Ensures dir exists, computes next monotonic seq, writes atomically via tmp rename.
 * Payload: { _meta: { phase, ts, ticket }, data }.
 */
function writeCheckpoint(dir, phase, data) {
  fs.mkdirSync(dir, { recursive: true });
  const seq = _nextSeq(dir);
  const name = `${String(seq).padStart(3, '0')}-${phase}.json`;
  const file = path.join(dir, name);
  const payload = {
    _meta: {
      phase,
      ts: new Date().toISOString(),
      ticket: (data && data.ticket) || null,
    },
    data: data || null,
  };
  atomicWrite(file, JSON.stringify(payload, null, 2));
  return { seq, file };
}

/**
 * readCheckpoints(dir, { phase } = {}) → ordered array of { seq, phase, file, _meta, data }
 *
 * Missing dir → []. Unparseable chunk → skipped (console.error to stderr), never throws.
 */
function readCheckpoints(dir, { phase } = {}) {
  let files;
  try {
    files = fs.readdirSync(dir);
  } catch {
    return [];
  }

  const chunks = [];
  for (const f of files) {
    const m = CHUNK_RE.exec(f);
    if (!m) continue;
    const seq = parseInt(m[1], 10);
    const file = path.join(dir, f);
    let parsed;
    try {
      parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (err) {
      console.error(`[checkpoint] skipping unparseable chunk ${f}: ${err.message}`);
      continue;
    }
    const chunkPhase = parsed._meta && parsed._meta.phase;
    if (phase !== undefined && chunkPhase !== phase) continue;
    chunks.push({ seq, phase: chunkPhase, file, _meta: parsed._meta || null, data: parsed.data });
  }

  chunks.sort((a, b) => a.seq - b.seq);
  return chunks;
}

/**
 * latestCheckpoint(dir) → last entry from readCheckpoints, or null.
 */
function latestCheckpoint(dir) {
  const all = readCheckpoints(dir);
  return all.length > 0 ? all[all.length - 1] : null;
}

module.exports = { writeCheckpoint, readCheckpoints, latestCheckpoint };

// CLI: node checkpoint.js write <dir> <phase>   (JSON on stdin)
//      node checkpoint.js latest <dir>
//      node checkpoint.js list <dir>
if (require.main === module) {
  const [,, cmd, dir, phase] = process.argv;

  function usage() {
    process.stderr.write(
      'Usage:\n' +
      '  node checkpoint.js write <dir> <phase>   # JSON on stdin\n' +
      '  node checkpoint.js latest <dir>\n' +
      '  node checkpoint.js list <dir>\n'
    );
    process.exit(2);
  }

  if (!cmd || !dir) usage();

  if (cmd === 'write') {
    if (!phase) usage();
    let raw = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', chunk => { raw += chunk; });
    process.stdin.on('end', () => {
      let data;
      try {
        data = JSON.parse(raw);
      } catch (err) {
        process.stderr.write(`[checkpoint] invalid JSON on stdin: ${err.message}\n`);
        process.exit(1);
      }
      try {
        const result = writeCheckpoint(dir, phase, data);
        process.stdout.write(JSON.stringify(result) + '\n');
        process.exit(0);
      } catch (err) {
        process.stderr.write(`[checkpoint] write failed: ${err.message}\n`);
        process.exit(1);
      }
    });
  } else if (cmd === 'latest') {
    try {
      const entry = latestCheckpoint(dir);
      process.stdout.write(JSON.stringify(entry) + '\n');
      process.exit(0);
    } catch (err) {
      process.stderr.write(`[checkpoint] latest failed: ${err.message}\n`);
      process.exit(1);
    }
  } else if (cmd === 'list') {
    try {
      const entries = readCheckpoints(dir);
      process.stdout.write(JSON.stringify(entries, null, 2) + '\n');
      process.exit(0);
    } catch (err) {
      process.stderr.write(`[checkpoint] list failed: ${err.message}\n`);
      process.exit(1);
    }
  } else {
    usage();
  }
}
