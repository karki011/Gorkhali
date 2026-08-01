// Author: Subash Karki
// Offline-only repository alias helpers for explicit migration and historical
// reporting commands. Current Phantom runtime code must never import this file.

'use strict';

const fs = require('fs');
const path = require('path');
const codec = require('../../skills/phantom/scripts/lib/shared-state.cjs');

const AMBIGUOUS_ALIAS = { ambiguous: true };

function aliasMapPath(dataRoot) {
  return path.join(dataRoot, 'repos', '.aliases.json');
}

function readAliasMap(dataRoot) {
  try {
    const parsed = JSON.parse(fs.readFileSync(aliasMapPath(dataRoot), 'utf8'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch (_) {
    return {};
  }
}

function isAmbiguousValue(value) {
  return !!value && typeof value === 'object' && value.ambiguous === true;
}

function aliasesForIdentity(identity) {
  if (!identity || !identity.id) return [];
  if (identity.kind === 'remote' && identity.remote) {
    const plain = codec.repoNameFromRemote(identity.remote);
    const aliases = new Set([
      plain,
      plain.toLowerCase(),
      identity.name,
      `${codec.sanitizeName(plain)}-${codec.shortHash(identity.remote)}`,
    ]);
    aliases.delete(identity.id);
    return [...aliases].filter(Boolean);
  }
  if ((identity.kind === 'common-dir' || identity.kind === 'walk-up') && identity.root) {
    const previous = path.basename(identity.root);
    return previous === identity.id ? [] : [previous];
  }
  return [];
}

function atomicWriteJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temporary, file);
}

function recordAliases(dataRoot, identity) {
  const map = readAliasMap(dataRoot);
  if (!dataRoot || !identity || !identity.id) return map;
  const aliases = Array.isArray(identity.aliases) ? identity.aliases : aliasesForIdentity(identity);
  if (aliases.length === 0) return map;
  let changed = false;
  for (const alias of aliases) {
    if (!alias || alias === identity.id) continue;
    const existing = map[alias];
    if (existing === identity.id || isAmbiguousValue(existing)) continue;
    map[alias] = existing === undefined ? identity.id : AMBIGUOUS_ALIAS;
    changed = true;
  }
  if (map[identity.id] !== identity.id) {
    map[identity.id] = identity.id;
    changed = true;
  }
  if (changed) atomicWriteJson(aliasMapPath(dataRoot), map);
  return map;
}

function resolveCanonical(dataRoot, id) {
  const value = readAliasMap(dataRoot)[id];
  return typeof value === 'string' ? value : id;
}

function isAmbiguousAlias(dataRoot, id) {
  return isAmbiguousValue(readAliasMap(dataRoot)[id]);
}

module.exports = {
  aliasMapPath,
  aliasesForIdentity,
  isAmbiguousAlias,
  readAliasMap,
  recordAliases,
  resolveCanonical,
};
