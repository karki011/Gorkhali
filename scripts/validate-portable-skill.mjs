#!/usr/bin/env node
// Author: Subash Karki

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const defaultSkillDirectory = join(repositoryRoot, 'skills', 'phantom');
const commandsDirectory = join(repositoryRoot, 'commands');
const skillsDirectory = join(repositoryRoot, 'skills');
const codexManifestFile = join(repositoryRoot, '.codex-plugin', 'plugin.json');
const claudeManifestFile = join(repositoryRoot, '.claude-plugin', 'plugin.json');
const marketplaceFile = join(repositoryRoot, '.claude-plugin', 'marketplace.json');
const codexCompatibilityReference = '../../codex-support/codex-compatibility.md';

const forbiddenPatterns = [
  ['provider directory', /\.(?:claude|codex|gemini)(?:\/|\\)/i],
  ['provider environment', /\b(?:CLAUDE|CODEX|GEMINI|ANTHROPIC|OPENAI)_[A-Z0-9_]+\b/],
  ['provider name', /\b(?:Claude|Codex|Gemini|Anthropic|OpenAI)\b/i],
  ['provider model alias', /\b(?:opus|sonnet|haiku|fable|gpt-[A-Za-z0-9.-]+)\b/i],
  ['private tool syntax', /\bmcp__|\b(?:Agent|Task|Skill)\s*\(/],
  ['host command syntax', /\/phantom:|\$ARGUMENTS\b/],
  ['host frontmatter', /\b(?:allowed-tools|disable-model-invocation|user-invocable)\s*:/],
  ['absolute user path', /\/Users\//],
];
const controlledPresetPatterns = new Set(['provider name', 'provider model alias']);
const selectionOrder = [
  'explicit-user-choice',
  'external-profile-map',
  'bundled-host-preset',
  'inherit-active-model',
];
const requiredContractVersions = {
  capability_ledger: 1,
  decision_artifact: 3,
  delegation: 1,
  impact_report: 1,
  model_policy: 1,
  model_presets: 1,
  model_routing: 1,
  state_envelope: 1,
};

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function checkKeys(value, expected, label, errors) {
  if (!isObject(value)) {
    errors.push(`${label} must be an object.`);
    return false;
  }
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    errors.push(`${label} must contain exactly: ${wanted.join(', ')}.`);
    return false;
  }
  return true;
}

function validatePresets(presets, policy, errors) {
  if (!checkKeys(
    presets,
    ['schema_version', 'selection_order', 'hosts', 'unknown_host', 'unavailable_model'],
    'Model presets',
    errors,
  )) return;

  if (presets.schema_version !== 1) errors.push('Model presets schema_version must be 1.');
  if (JSON.stringify(presets.selection_order) !== JSON.stringify(selectionOrder)) {
    errors.push(`Model preset selection_order must be: ${selectionOrder.join(', ')}.`);
  }

  const profiles = new Set(policy?.profiles || []);
  const declaredProfiles = [...profiles].sort();
  const hosts = presets.hosts;
  if (!isObject(hosts) || Object.keys(hosts).length === 0) {
    errors.push('Model presets hosts must be a non-empty object.');
  } else {
    for (const requiredHost of ['claude-code', 'codex']) {
      if (!hosts[requiredHost]) errors.push(`Model presets are missing required host ${requiredHost}.`);
    }
    for (const [host, hostPolicy] of Object.entries(hosts)) {
      if (!/^[a-z0-9-]+$/.test(host)) errors.push(`Model preset host ${host} must be a lowercase slug.`);
      if (!checkKeys(hostPolicy, ['profiles'], `Model preset host ${host}`, errors)) continue;
      const hostProfiles = hostPolicy.profiles;
      if (!isObject(hostProfiles)) {
        errors.push(`Model preset host ${host} profiles must be an object.`);
        continue;
      }
      const actualProfiles = Object.keys(hostProfiles).sort();
      if (actualProfiles.length !== declaredProfiles.length
        || actualProfiles.some((profile, index) => profile !== declaredProfiles[index])) {
        errors.push(`Model preset host ${host} must define exactly the declared profiles.`);
      }
      for (const [profile, preset] of Object.entries(hostProfiles)) {
        if (!checkKeys(preset, ['model', 'effort'], `Model preset ${host}.${profile}`, errors)) continue;
        const validModel = preset.model === null
          || (typeof preset.model === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(preset.model));
        const validEffort = preset.effort === null
          || (typeof preset.effort === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(preset.effort));
        if (!validModel) errors.push(`Model preset ${host}.${profile}.model is invalid.`);
        if (!validEffort) errors.push(`Model preset ${host}.${profile}.effort is invalid.`);
        if (profile !== 'inherit' && preset.model === null) {
          errors.push(`Model preset ${host}.${profile}.model must be defined.`);
        }
      }
      if (hostProfiles.inherit?.model !== null || hostProfiles.inherit?.effort !== null) {
        errors.push(`Model preset ${host}.inherit must use null model and effort.`);
      }
    }
  }

  for (const key of ['unknown_host', 'unavailable_model']) {
    if (checkKeys(presets[key], ['fallback'], `Model presets ${key}`, errors)
      && presets[key].fallback !== 'inherit-active-model') {
      errors.push(`Model presets ${key} fallback must be inherit-active-model.`);
    }
  }
}

function validateManifest(manifest, errors) {
  if (!checkKeys(manifest, ['name', 'bundle_version', 'contract_versions'], 'Manifest', errors)) return;
  if (manifest.name !== 'phantom') errors.push('Manifest name must be phantom.');
  if (typeof manifest.bundle_version !== 'string'
    || !/^\d+\.\d+\.\d+$/.test(manifest.bundle_version)) {
    errors.push('Manifest bundle_version must be a semantic version.');
  }
  if (!checkKeys(
    manifest.contract_versions,
    Object.keys(requiredContractVersions),
    'Manifest contract_versions',
    errors,
  )) return;
  for (const [contract, version] of Object.entries(requiredContractVersions)) {
    if (manifest.contract_versions[contract] !== version) {
      errors.push(`Manifest contract version ${contract} must be ${version}.`);
    }
  }
}

function filesUnder(directory) {
  const files = [];
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) files.push(...filesUnder(path));
    else files.push(path);
  }
  return files;
}

function parseFrontmatter(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---\n/);
  if (!match) throw new Error('SKILL.md must start with YAML frontmatter.');
  const fields = {};
  for (const line of match[1].split('\n')) {
    const separator = line.indexOf(':');
    if (separator < 0) throw new Error(`Invalid frontmatter line: ${line}`);
    fields[line.slice(0, separator).trim()] = line.slice(separator + 1).trim();
  }
  return fields;
}

export function validateCommandAdapters(commandRoot = commandsDirectory, skillRoot = skillsDirectory) {
  const errors = [];
  const supportRoot = join(resolve(skillRoot, '..'), 'codex-support');
  const compatibilityFile = join(supportRoot, 'codex-compatibility.md');
  const resolverFile = join(supportRoot, 'resolve-codex-runtime.mjs');
  if (!existsSync(compatibilityFile)) {
    errors.push('Codex compatibility contract is missing at codex-support/codex-compatibility.md.');
  }
  if (!existsSync(resolverFile)) {
    errors.push('Codex runtime resolver is missing at codex-support/resolve-codex-runtime.mjs.');
  }
  if (existsSync(compatibilityFile)) {
    const compatibility = readFileSync(compatibilityFile, 'utf8');
    for (const requirement of [
      'resolve-codex-runtime.mjs',
      '--command <workflow-name>',
      '<preamble_files>',
      '<conditional_preamble_files>',
      '<portable_skill_root>/SKILL.md',
      '<compatibility_scripts_root>',
      'PHANTOM_DATA=<data_root>',
      '~/.phantom',
      'never write Codex workflow state under `.claude`',
    ]) {
      if (!compatibility.includes(requirement)) {
        errors.push(`Codex compatibility contract must define ${requirement}.`);
      }
    }
  }
  const commands = readdirSync(commandRoot)
    .filter((entry) => entry.endsWith('.md') && !entry.startsWith('_'))
    .map((entry) => entry.slice(0, -3))
    .sort();

  for (const command of commands) {
    const skillFile = join(skillRoot, command, 'SKILL.md');
    if (!existsSync(skillFile)) {
      errors.push(`Codex adapter is missing for commands/${command}.md.`);
      continue;
    }

    const content = readFileSync(skillFile, 'utf8');
    try {
      const fields = parseFrontmatter(content);
      const keys = Object.keys(fields).sort();
      if (keys.join(',') !== 'description,name') {
        errors.push(`skills/${command}/SKILL.md frontmatter must contain exactly name and description.`);
      }
      if (fields.name !== command) {
        errors.push(`skills/${command}/SKILL.md must declare name: ${command}.`);
      }
      if (!/^[a-z0-9-]{1,64}$/.test(fields.name || '')) {
        errors.push(`skills/${command}/SKILL.md name must be lowercase hyphen-case.`);
      }
      if (!fields.description || fields.description.length > 1024) {
        errors.push(`skills/${command}/SKILL.md description must contain 1-1024 characters.`);
      }
    } catch (error) {
      errors.push(`skills/${command}/SKILL.md: ${error.message}`);
    }

    if (!content.includes(`../../commands/${command}.md`)) {
      errors.push(`skills/${command}/SKILL.md must reference ../../commands/${command}.md.`);
    }
    if (!content.includes(codexCompatibilityReference)) {
      errors.push(`skills/${command}/SKILL.md must apply ${codexCompatibilityReference}.`);
    }
    if (content.indexOf(codexCompatibilityReference) > content.indexOf(`../../commands/${command}.md`)) {
      errors.push(`skills/${command}/SKILL.md must apply Codex compatibility before reading its command.`);
    }
    if (!content.includes(`workflow \`${command}\``)) {
      errors.push(`skills/${command}/SKILL.md must identify workflow \`${command}\`.`);
    }
  }

  const commandSet = new Set(commands);
  const orphanedAdapters = readdirSync(skillRoot)
    .filter((entry) => entry !== 'phantom' && existsSync(join(skillRoot, entry, 'SKILL.md')))
    .filter((entry) => !commandSet.has(entry))
    .sort();
  for (const adapter of orphanedAdapters) {
    errors.push(`Codex adapter skills/${adapter}/SKILL.md has no matching public command.`);
  }

  return errors;
}

export function validatePluginManifests(root = repositoryRoot) {
  const errors = [];
  const codexFile = root === repositoryRoot ? codexManifestFile : join(root, '.codex-plugin', 'plugin.json');
  const claudeFile = root === repositoryRoot ? claudeManifestFile : join(root, '.claude-plugin', 'plugin.json');
  const marketFile = root === repositoryRoot ? marketplaceFile : join(root, '.claude-plugin', 'marketplace.json');
  for (const file of [codexFile, claudeFile, marketFile]) {
    if (!existsSync(file)) errors.push(`${relative(root, file)} is missing.`);
  }
  if (errors.length) return errors;

  const codex = JSON.parse(readFileSync(codexFile, 'utf8'));
  const claude = JSON.parse(readFileSync(claudeFile, 'utf8'));
  const marketplace = JSON.parse(readFileSync(marketFile, 'utf8'));
  if (codex.name !== 'phantom') errors.push('.codex-plugin/plugin.json name must be phantom.');
  if (codex.skills !== './skills/') errors.push('.codex-plugin/plugin.json must expose ./skills/.');
  const interfaceFields = [
    'displayName',
    'shortDescription',
    'longDescription',
    'developerName',
    'category',
  ];
  if (!isObject(codex.interface)) {
    errors.push('.codex-plugin/plugin.json interface must be an object.');
  } else {
    for (const field of interfaceFields) {
      if (typeof codex.interface[field] !== 'string' || !codex.interface[field].trim()) {
        errors.push(`.codex-plugin/plugin.json interface.${field} must be a non-empty string.`);
      }
    }
    if (!Array.isArray(codex.interface.capabilities)
      || !codex.interface.capabilities.every((value) => typeof value === 'string' && value.trim())) {
      errors.push('.codex-plugin/plugin.json interface.capabilities must be an array of strings.');
    }
    if (!Array.isArray(codex.interface.defaultPrompt)
      || codex.interface.defaultPrompt.length === 0
      || codex.interface.defaultPrompt.length > 3
      || !codex.interface.defaultPrompt.every((value) => typeof value === 'string'
        && value.trim() && value.length <= 128)) {
      errors.push('.codex-plugin/plugin.json interface.defaultPrompt must contain 1-3 strings of at most 128 characters.');
    }
  }
  const discoveredSkillRoot = resolve(root, codex.skills || '');
  const relativeSkillRoot = relative(root, discoveredSkillRoot);
  if (relativeSkillRoot.startsWith('..') || !existsSync(discoveredSkillRoot)) {
    errors.push('.codex-plugin/plugin.json skills must resolve to a directory inside the plugin.');
  } else {
    for (const entry of readdirSync(discoveredSkillRoot)) {
      const child = join(discoveredSkillRoot, entry);
      if (entry.startsWith('.') || !statSync(child).isDirectory()) continue;
      if (!existsSync(join(child, 'SKILL.md'))) {
        errors.push(`Codex skill directory ${entry} is missing SKILL.md.`);
      }
    }
  }
  if (codex.version !== claude.version || codex.version !== marketplace.metadata?.version) {
    errors.push('Codex, Claude, and marketplace plugin versions must match.');
  }
  return errors;
}

export function validateSkill(skillDirectory = defaultSkillDirectory) {
  const errors = [];
  const skillFile = join(skillDirectory, 'SKILL.md');
  if (!existsSync(skillFile)) return ['SKILL.md is missing.'];

  const skillContent = readFileSync(skillFile, 'utf8');
  try {
    const fields = parseFrontmatter(skillContent);
    const keys = Object.keys(fields).sort();
    if (keys.join(',') !== 'description,name') errors.push('Frontmatter must contain exactly name and description.');
    if (fields.name !== skillDirectory.split(/[\\/]/).pop()) errors.push('Skill name must match its directory name.');
    if (!/^[a-z0-9-]{1,64}$/.test(fields.name || '')) errors.push('Skill name must be lowercase hyphen-case.');
    if (!fields.description || fields.description.length > 1024) errors.push('Description must contain 1-1024 characters.');
  } catch (error) {
    errors.push(error.message);
  }

  if (skillContent.split('\n').length > 500) errors.push('SKILL.md exceeds 500 lines.');

  const required = [
    'manifest.json',
    'references/capabilities.md',
    'references/models.md',
    'references/model-policy.json',
    'references/model-presets.json',
    'references/brainstorming.md',
    'references/planning.md',
    'references/review-html.md',
    'references/roles.md',
    'references/state.md',
    'references/workflows.md',
    'references/verification.md',
    'scripts/inspect-impact.mjs',
    'scripts/lib/decision-contracts.mjs',
    'scripts/phantom-state.mjs',
    'scripts/resolve-profile.mjs',
    'scripts/validate-review-html.mjs',
  ];
  for (const item of required) {
    if (!existsSync(join(skillDirectory, item))) errors.push(`Required portable resource is missing: ${item}`);
  }

  const modelPolicyFile = join(skillDirectory, 'references', 'model-policy.json');
  const modelPresetsFile = join(skillDirectory, 'references', 'model-presets.json');
  const manifestFile = join(skillDirectory, 'manifest.json');
  let modelPolicy = null;
  let modelPresets;
  let manifest;

  for (const file of filesUnder(skillDirectory)) {
    const content = file === skillFile ? skillContent : readFileSync(file, 'utf8');
    for (const [label, pattern] of forbiddenPatterns) {
      if (file === modelPresetsFile && controlledPresetPatterns.has(label)) continue;
      if (pattern.test(content)) errors.push(`${relative(skillDirectory, file)} contains forbidden ${label}.`);
    }
    if (extname(file) === '.json') {
      try {
        const parsed = JSON.parse(content);
        if (file === modelPolicyFile) modelPolicy = parsed;
        if (file === modelPresetsFile) modelPresets = parsed;
        if (file === manifestFile) manifest = parsed;
      } catch (error) {
        errors.push(`${relative(skillDirectory, file)} is invalid JSON: ${error.message}`);
      }
    }
    if (extname(file) === '.md') {
      for (const match of content.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)) {
        const target = match[1].split('#')[0];
        if (!target || /^[a-z]+:/i.test(target)) continue;
        if (!existsSync(resolve(dirname(file), target))) {
          errors.push(`${relative(skillDirectory, file)} links to missing resource: ${target}`);
        }
      }
    }
  }

  if (modelPolicy) {
    const profiles = new Set(modelPolicy.profiles || []);
    if (!profiles.has(modelPolicy.default_profile)) errors.push('Default model profile is not declared.');
    for (const [role, profile] of Object.entries(modelPolicy.roles || {})) {
      if (!profiles.has(profile)) errors.push(`Role ${role} uses undeclared profile ${profile}.`);
    }
  }
  if (modelPresets !== undefined) validatePresets(modelPresets, modelPolicy, errors);
  if (manifest !== undefined) validateManifest(manifest, errors);

  return [...new Set(errors)];
}

function main() {
  const skillDirectory = process.argv[2] ? resolve(process.argv[2]) : defaultSkillDirectory;
  const errors = [
    ...validateSkill(skillDirectory),
    ...(skillDirectory === defaultSkillDirectory ? validateCommandAdapters() : []),
    ...(skillDirectory === defaultSkillDirectory ? validatePluginManifests() : []),
  ];
  if (errors.length) {
    process.stderr.write(`${errors.map((error) => `- ${error}`).join('\n')}\n`);
    process.exitCode = 1;
    return;
  }
  process.stdout.write(`Portable skill is valid: ${skillDirectory}\n`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
