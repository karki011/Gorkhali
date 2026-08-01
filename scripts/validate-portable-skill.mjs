#!/usr/bin/env node
// Author: Subash Karki

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const defaultSkillDirectory = join(repositoryRoot, 'skills', 'phantom');
const skillsDirectory = join(repositoryRoot, 'skills');
const codexManifestFile = join(repositoryRoot, '.codex-plugin', 'plugin.json');
const claudeManifestFile = join(repositoryRoot, '.claude-plugin', 'plugin.json');
const marketplaceFile = join(repositoryRoot, '.claude-plugin', 'marketplace.json');
const publicActions = [
  'brainstorm',
  'close',
  'contract',
  'eval',
  'evolve',
  'execute',
  'fix',
  'greploop',
  'grill',
  'health',
  'hound',
  'learn',
  'loop',
  'pause',
  'recruit',
  'resume',
  'review',
  'scout',
  'sessions',
  'start',
  'status',
  'validate',
  'verify',
  'visual',
  'visualflow',
  'wire',
  'wrap',
];
const retiredRuntimeRoots = ['agents', 'codex-support', 'commands'];
const forbiddenEntrypointPatterns = [
  ['alternate runtime command', /\.\.\/\.\.\/commands\//],
  ['compatibility layer', /codex-support|compatibility (?:contract|layer)/i],
  ['delegated command', /delegated command|canonical preamble/i],
  ['deprecated alias', /\balias\b/i],
  ['provider-specific prompt', /provider-specific|Claude-specific|Codex-specific/i],
];

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
  aggregation_result: 2,
  authority_decision: 1,
  capability_ledger: 1,
  capability_probe: 1,
  capability_request: 1,
  decision_artifact: 3,
  defect_proof: 1,
  delegation: 2,
  evaluation_result: 1,
  host_adapter_execution: 2,
  impact_report: 1,
  isolated_executor: 1,
  model_policy: 2,
  model_presets: 1,
  model_routing: 1,
  state_envelope: 2,
  workflow_event: 2,
  workflow_output: 1,
  workflow_plan: 2,
  workspace_manifest: 2,
};
const riskLevels = ['low', 'moderate', 'high', 'critical'];
const criticalEligibleRoles = [
  'blade',
  'gaze',
  'sage',
  'lens',
  'archer',
  'rival',
  'plan-checker',
  'hound',
];
const criticalExemptRoles = ['apex', 'ward', 'sweep', 'warden'];
const CORE_SEMVER = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/;

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

function contractRegistryResources(skillDirectory, contracts, errors = null) {
  const issues = errors || [];
  if (!isObject(contracts)) {
    issues.push('Manifest contracts must be an object.');
    if (!errors) throw new Error(issues.join(' '));
    return [];
  }

  const resources = [];
  for (const contract of Object.keys(contracts).sort()) {
    const entry = contracts[contract];
    if (!checkKeys(entry, ['version', 'resources'], `Manifest contract ${contract}`, issues)) continue;
    if (!Number.isInteger(entry.version) || entry.version < 1) {
      issues.push(`Manifest contract ${contract}.version must be a positive integer.`);
      continue;
    }
    if (!Array.isArray(entry.resources) || entry.resources.length === 0) {
      issues.push(`Manifest contract ${contract}.resources must be a non-empty array.`);
      continue;
    }
    const sorted = [...entry.resources].sort();
    if (new Set(entry.resources).size !== entry.resources.length
      || JSON.stringify(sorted) !== JSON.stringify(entry.resources)) {
      issues.push(`Manifest contract ${contract}.resources must be unique and sorted.`);
      continue;
    }
    for (const resource of entry.resources) {
      if (typeof resource !== 'string' || !resource || resource.startsWith('/') || resource.includes('\\')) {
        issues.push(`Manifest contract ${contract} has an invalid resource path.`);
        continue;
      }
      const file = resolve(skillDirectory, resource);
      const local = relative(skillDirectory, file);
      if (local.startsWith('..') || resolve(skillDirectory, local) !== file) {
        issues.push(`Manifest contract ${contract} resource escapes the skill: ${resource}.`);
        continue;
      }
      if (!existsSync(file) || !statSync(file).isFile()) {
        issues.push(`Manifest contract ${contract} resource is missing: ${resource}.`);
        continue;
      }
      resources.push({ contract, version: entry.version, resource, file });
    }
  }
  if (!errors && issues.length > 0) throw new Error(issues.join(' '));
  return resources;
}

export function lifecycleContractDigest(skillDirectory, contracts) {
  let registry = contracts;
  if (registry === undefined) {
    const manifest = JSON.parse(readFileSync(join(skillDirectory, 'manifest.json'), 'utf8'));
    registry = manifest.contracts;
  }
  const resources = contractRegistryResources(skillDirectory, registry);
  const hash = createHash('sha256');
  for (const { contract, version, resource, file } of resources) {
    hash.update(contract);
    hash.update('\0');
    hash.update(String(version));
    hash.update('\0');
    hash.update(resource);
    hash.update('\0');
    hash.update(readFileSync(file));
    hash.update('\0');
  }
  return `sha256:${hash.digest('hex')}`;
}

function validateManifest(manifest, errors, skillDirectory) {
  if (!checkKeys(
    manifest,
    ['name', 'bundle_version', 'contract_resource_digest', 'contracts'],
    'Manifest',
    errors,
  )) return;
  if (manifest.name !== 'phantom') errors.push('Manifest name must be phantom.');
  if (typeof manifest.bundle_version !== 'string'
    || !CORE_SEMVER.test(manifest.bundle_version)) {
    errors.push('Manifest bundle_version must be a strict core SemVer x.y.z string.');
  } else {
    const [major, minor] = manifest.bundle_version.split('.').map(Number);
    if (major < 3) {
      errors.push('Manifest bundle_version must be at least 3.0.0 for the deterministic workflow contract.');
    }
  }
  const resources = contractRegistryResources(skillDirectory, manifest.contracts, errors);
  if (!checkKeys(
    manifest.contracts,
    Object.keys(requiredContractVersions),
    'Manifest contracts',
    errors,
  )) return;
  for (const [contract, version] of Object.entries(requiredContractVersions)) {
    if (manifest.contracts[contract]?.version !== version) {
      errors.push(`Manifest contract version ${contract} must be ${version}.`);
    }
  }

  const registeredSchemaCounts = new Map();
  for (const { resource } of resources) {
    if (!resource.startsWith('schemas/') || !resource.endsWith('.schema.json')) continue;
    registeredSchemaCounts.set(resource, (registeredSchemaCounts.get(resource) || 0) + 1);
  }
  const schemaDirectory = join(skillDirectory, 'schemas');
  const publicSchemas = existsSync(schemaDirectory)
    ? filesUnder(schemaDirectory)
      .map((file) => relative(skillDirectory, file))
      .filter((file) => file.endsWith('.schema.json'))
    : [];
  for (const schema of publicSchemas) {
    const count = registeredSchemaCounts.get(schema) || 0;
    if (count === 0) {
      errors.push(`Public contract schema is not registered in the manifest: ${schema}.`);
    } else if (count !== 1) {
      errors.push(`Public contract schema must have exactly one manifest owner: ${schema}.`);
    }
  }

  const migrationDirectory = join(skillDirectory, 'scripts', 'lib', 'session-migration');
  if (existsSync(migrationDirectory) && statSync(migrationDirectory).isDirectory()) {
    for (const file of filesUnder(migrationDirectory).filter((item) => extname(item) === '.mjs')) {
      const resource = relative(skillDirectory, file).split('\\').join('/');
      const owners = resources
        .filter((entry) => entry.resource === resource)
        .map((entry) => entry.contract);
      if (owners.length !== 1 || owners[0] !== 'state_envelope') {
        errors.push(
          `Session migration module must have exactly one manifest owner, state_envelope: ${resource}.`,
        );
      }
    }
  }

  try {
    if (manifest.contract_resource_digest !== lifecycleContractDigest(skillDirectory, manifest.contracts)) {
      errors.push(
        'Manifest contract_resource_digest is stale for registered contract resources; '
        + 'bump bundle_version and refresh the digest.',
      );
    }
  } catch (error) {
    errors.push(`Manifest contract registry cannot be digested: ${error.message}`);
  }
}

function validateModelPolicy(policy, errors) {
  if (!checkKeys(
    policy,
    ['schema_version', 'profiles', 'default_profile', 'risk_levels', 'critical_elevation', 'roles'],
    'Model policy',
    errors,
  )) return;
  if (policy.schema_version !== 2) errors.push('Model policy schema_version must be 2.');
  if (JSON.stringify(policy.risk_levels) !== JSON.stringify(riskLevels)) {
    errors.push(`Model policy risk_levels must be: ${riskLevels.join(', ')}.`);
  }
  const elevation = policy.critical_elevation;
  if (checkKeys(
    elevation,
    ['risk', 'profile', 'eligible_roles', 'exempt_roles'],
    'Model policy critical_elevation',
    errors,
  )) {
    if (elevation.risk !== 'critical') {
      errors.push('Model policy critical_elevation.risk must be critical.');
    }
    if (elevation.profile !== 'deep') {
      errors.push('Model policy critical_elevation.profile must be deep.');
    }
    if (JSON.stringify(elevation.eligible_roles) !== JSON.stringify(criticalEligibleRoles)) {
      errors.push('Model policy critical_elevation.eligible_roles is invalid.');
    }
    if (JSON.stringify(elevation.exempt_roles) !== JSON.stringify(criticalExemptRoles)) {
      errors.push('Model policy critical_elevation.exempt_roles is invalid.');
    }
  }
  if (policy.roles?.apex !== 'frontier') errors.push('Model policy Apex must use frontier.');
  for (const role of ['rival', 'plan-checker']) {
    if (policy.roles?.[role] !== 'balanced') {
      errors.push(`Model policy ordinary ${role} must use balanced.`);
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

export function validateActionEntrypoints(skillRoot = skillsDirectory) {
  const errors = [];
  const root = resolve(skillRoot, '..');
  for (const retired of retiredRuntimeRoots) {
    const retiredRoot = join(root, retired);
    if (existsSync(retiredRoot) && filesUnder(retiredRoot).length > 0) {
      errors.push(`Retired runtime surface must be absent: ${retired}/.`);
    }
  }

  for (const action of publicActions) {
    const skillFile = join(skillRoot, action, 'SKILL.md');
    if (!existsSync(skillFile)) {
      errors.push(`Public action skill is missing: skills/${action}/SKILL.md.`);
      continue;
    }

    const content = readFileSync(skillFile, 'utf8');
    try {
      const fields = parseFrontmatter(content);
      const keys = Object.keys(fields).sort();
      if (keys.join(',') !== 'description,name') {
        errors.push(`skills/${action}/SKILL.md frontmatter must contain exactly name and description.`);
      }
      if (fields.name !== action) {
        errors.push(`skills/${action}/SKILL.md must declare name: ${action}.`);
      }
      if (!/^[a-z0-9-]{1,64}$/.test(fields.name || '')) {
        errors.push(`skills/${action}/SKILL.md name must be lowercase hyphen-case.`);
      }
      if (!fields.description || fields.description.length > 1024) {
        errors.push(`skills/${action}/SKILL.md description must contain 1-1024 characters.`);
      }
    } catch (error) {
      errors.push(`skills/${action}/SKILL.md: ${error.message}`);
    }

    if (!content.includes('Read `../phantom/SKILL.md` completely')) {
      errors.push(`skills/${action}/SKILL.md must load the portable skill directly.`);
    }
    if (!content.includes(`Portable action: \`${action}\`.`)) {
      errors.push(`skills/${action}/SKILL.md must declare portable action ${action}.`);
    }
    if (content.split('\n').length > 80) {
      errors.push(`skills/${action}/SKILL.md exceeds 80 lines.`);
    }
    for (const [label, pattern] of forbiddenEntrypointPatterns) {
      if (pattern.test(content)) {
        errors.push(`skills/${action}/SKILL.md contains forbidden ${label}.`);
      }
    }
  }

  const declared = new Set(publicActions);
  const unexpectedActions = readdirSync(skillRoot)
    .filter((entry) => entry !== 'phantom' && existsSync(join(skillRoot, entry, 'SKILL.md')))
    .filter((entry) => !declared.has(entry))
    .sort();
  for (const action of unexpectedActions) {
    errors.push(`Unexpected or deprecated public action: skills/${action}/SKILL.md.`);
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
      if (filesUnder(child).length > 0 && !existsSync(join(child, 'SKILL.md'))) {
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
    'scripts/lib/legacy-session-classifier.mjs',
    'scripts/lib/session-migration/atomic-journal.mjs',
    'scripts/lib/session-migration/durable-publication.mjs',
    'scripts/migrate-session-state.mjs',
    'scripts/phantom-state.mjs',
    'scripts/resolve-profile.mjs',
    'scripts/validate-review-html.mjs',
  ];
  for (const item of required) {
    if (!existsSync(join(skillDirectory, item))) errors.push(`Required portable resource is missing: ${item}`);
  }

  const lifecycleContract = {
    'references/state.md': [
      'schema_version: 2',
      '--mode to-plan',
      '--gate direction',
      '--gate plan',
      '--gate wiring',
      '--scope implementation',
      '--scope ship-draft-pr',
      'worktree_fingerprint',
      'record_sequence',
      'SHA-256 digest',
      'advance-workflow.mjs',
      'Verification and review run artifacts are unsupported',
    ],
    'references/workflows.md': [
      '`direct`',
      '`plan`',
      '`brainstorm`',
      '`full`',
      'direction before plan approval',
      'approved wiring',
      '`--mode to-plan`',
      '`ship-draft-pr` authorization is separate',
      'route and material intent do not change',
      'wiring approval binds the current passed plan plus decisions',
      'A newer fingerprint makes earlier evidence stale',
    ],
    'scripts/phantom-state.mjs': [
      "const ROUTES = new Set(['direct', 'plan', 'brainstorm', 'full'])",
      "'ship-draft-pr'",
      'worktreeFingerprint',
      'APPROVAL_ARTIFACTS',
      'artifact_bindings',
      'latestRecordSequence',
      'DECISION_ARTIFACTS',
      'replayCurrentWorkflow',
      "command === 'approve'",
      "command === 'authorize'",
      "command === 'execute'",
      "command === 'ship'",
      "command === 'complete'",
    ],
  };
  for (const [resource, requirements] of Object.entries(lifecycleContract)) {
    const file = join(skillDirectory, resource);
    if (!existsSync(file)) continue;
    const content = readFileSync(file, 'utf8');
    const normalizedContent = content.replace(/\s+/g, ' ');
    for (const requirement of requirements) {
      if (!normalizedContent.includes(requirement.replace(/\s+/g, ' '))) {
        errors.push(`${resource} must define portable lifecycle contract token: ${requirement}.`);
      }
    }
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
    validateModelPolicy(modelPolicy, errors);
    const profiles = new Set(modelPolicy.profiles || []);
    if (!profiles.has(modelPolicy.default_profile)) errors.push('Default model profile is not declared.');
    for (const [role, profile] of Object.entries(modelPolicy.roles || {})) {
      if (!profiles.has(profile)) errors.push(`Role ${role} uses undeclared profile ${profile}.`);
    }
  }
  if (modelPresets !== undefined) validatePresets(modelPresets, modelPolicy, errors);
  if (manifest !== undefined) validateManifest(manifest, errors, skillDirectory);

  return [...new Set(errors)];
}

function main() {
  const skillDirectory = process.argv[2] ? resolve(process.argv[2]) : defaultSkillDirectory;
  const errors = [
    ...validateSkill(skillDirectory),
    ...(skillDirectory === defaultSkillDirectory ? validateActionEntrypoints() : []),
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
