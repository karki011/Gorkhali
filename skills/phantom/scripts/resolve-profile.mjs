#!/usr/bin/env node
// Author: Subash Karki

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isMainModule, parseArgs } from './lib/portable.mjs';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const manifestFile = join(scriptDirectory, '..', 'manifest.json');
const policyFile = join(scriptDirectory, '..', 'references', 'model-policy.json');
const presetsFile = join(scriptDirectory, '..', 'references', 'model-presets.json');

export const BUNDLE_VERSION = JSON.parse(readFileSync(manifestFile, 'utf8')).bundle_version;

let cachedPolicy = null;
let cachedPresets = null;

function loadPolicy() {
  if (!cachedPolicy) cachedPolicy = JSON.parse(readFileSync(policyFile, 'utf8'));
  return cachedPolicy;
}

function loadPresets() {
  if (!cachedPresets) cachedPresets = JSON.parse(readFileSync(presetsFile, 'utf8'));
  return cachedPresets;
}

function selection(value) {
  if (typeof value === 'string' && value.trim()) {
    return { model: value.trim(), effort: null };
  }
  if (value && typeof value.model === 'string' && value.model.trim()) {
    return {
      model: value.model.trim(),
      effort: typeof value.effort === 'string' && value.effort.trim() ? value.effort.trim() : null,
    };
  }
  return null;
}

export function resolveProfile({ role, profile: profileOverride, host, mapFile, explicitModel } = {}) {
  const policy = loadPolicy();
  if (profileOverride && !policy.profiles.includes(profileOverride)) {
    throw new Error(`Unknown model profile: ${profileOverride}`);
  }
  const profile = role === 'apex'
    ? policy.roles.apex
    : profileOverride || policy.roles[role] || policy.default_profile;
  const normalizedHost = typeof host === 'string' && host.trim() ? host.trim().toLowerCase() : null;
  const base = {
    bundle_version: BUNDLE_VERSION,
    role: role || null,
    host: normalizedHost,
    requested_profile: profile,
  };

  const explicit = selection(explicitModel);
  if (explicit) {
    return { ...base, ...explicit, resolution: 'explicit-user-choice' };
  }

  if (mapFile) {
    const mapping = JSON.parse(readFileSync(mapFile, 'utf8'));
    const mapped = selection(mapping?.profiles?.[profile]);
    if (mapped) {
      return { ...base, ...mapped, resolution: 'external-profile-map' };
    }
  }

  const preset = selection(loadPresets().hosts?.[normalizedHost]?.profiles?.[profile]);
  if (preset) {
    return { ...base, ...preset, resolution: 'bundled-host-preset' };
  }

  return { ...base, model: null, effort: null, resolution: 'inherit-active-model' };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  process.stdout.write(`${JSON.stringify(resolveProfile({
    role: args.role,
    profile: args.profile,
    host: args.host,
    mapFile: args.map,
    explicitModel: args.model,
  }), null, 2)}\n`);
}

if (isMainModule(import.meta.url)) main();
