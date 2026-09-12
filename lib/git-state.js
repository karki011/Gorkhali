'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
function git(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
}
function digest(value) { return crypto.createHash('sha256').update(value).digest('hex'); }
function snapshot(cwd = process.cwd()) {
  const worktree = fs.realpathSync(git(cwd, ['rev-parse', '--show-toplevel']).trim());
  const head = git(worktree, ['rev-parse', 'HEAD']).trim();
  const branch = git(worktree, ['rev-parse', '--abbrev-ref', 'HEAD']).trim();
  const index = git(worktree, ['ls-files', '--stage', '-z']);
  const files = [...new Set(git(worktree, ['ls-files', '--cached', '--others', '--exclude-standard', '-z']).split('\0').filter(Boolean))].sort();
  const hash = crypto.createHash('sha256').update(JSON.stringify({ head, branch, worktree, index }));
  for (const file of files) {
    const full = path.join(worktree, file);
    hash.update(JSON.stringify(file));
    let stat;
    try { stat = fs.lstatSync(full); } catch (err) {
      if (err.code !== 'ENOENT') throw err;
      hash.update('deleted'); continue;
    }
    hash.update(String(stat.mode));
    if (stat.isSymbolicLink()) hash.update(fs.readlinkSync(full));
    else if (stat.isFile()) hash.update(fs.readFileSync(full));
    else throw new Error(`Cannot fingerprint ${file}: submodules and special files require separate verification`);
  }
  const dirtyFiles = [...new Set([
    ...git(worktree, ['diff', '--no-ext-diff', '--name-only', '-z', 'HEAD', '--']).split('\0'),
    ...git(worktree, ['ls-files', '--others', '--exclude-standard', '-z']).split('\0'),
  ].filter(Boolean))].sort();
  return { head, branch, worktree, dirtyFiles, fingerprint: hash.digest('hex') };
}
module.exports = { git, digest, snapshot };
