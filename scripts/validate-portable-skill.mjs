#!/usr/bin/env node
// Author: Subash Karki

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const defaultSkillDirectory = join(repositoryRoot, 'skills', 'phantom');
const commandsDirectory = join(repositoryRoot, 'commands');
const skillsDirectory = join(repositoryRoot, 'skills');
const codexManifestFile = join(repositoryRoot, '.codex-plugin', 'plugin.json');
const kimiManifestFile = join(repositoryRoot, '.kimi-plugin', 'plugin.json');
const claudeManifestFile = join(repositoryRoot, '.claude-plugin', 'plugin.json');
const marketplaceFile = join(repositoryRoot, '.claude-plugin', 'marketplace.json');
const hostCompatibilityReference = '../../host-support/compatibility.md';

const forbiddenPatterns = [
  ['provider directory', /\.(?:claude|codex|gemini|kimi)(?:\/|\\)/i],
  ['provider environment', /\b(?:CLAUDE|CODEX|GEMINI|ANTHROPIC|OPENAI|KIMI|MOONSHOT)_[A-Z0-9_]+\b/],
  ['provider name', /\b(?:Claude|Codex|Gemini|Anthropic|OpenAI|Kimi|Moonshot)\b/i],
  ['provider model alias', /\b(?:opus|sonnet|haiku|fable|gpt-[A-Za-z0-9.-]+|kimi-[A-Za-z0-9.-]+)\b/i],
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
  defect_proof: 1,
  delegation: 2,
  impact_report: 1,
  model_policy: 2,
  model_presets: 1,
  model_routing: 1,
  state_envelope: 1,
};
const lifecycleContractResources = [
  'references/state.md',
  'references/planning.md',
  'references/execution.md',
  'references/verification.md',
  'references/shipping.md',
  'scripts/lib/defect-proof.mjs',
  'scripts/phantom-state.mjs',
];
const riskLevels = ['low', 'moderate', 'high', 'critical'];
const criticalEligibleRoles = [
  'engineer',
  'auditor',
  'advisor',
  'surveyor',
  'justice',
  'opposition',
  'detective',
];
const criticalExemptRoles = ['chief', 'inspector', 'steward', 'clerk'];
const activeRoles = [
  'chief', 'engineer', 'inspector', 'auditor', 'advisor', 'surveyor', 'justice', 'opposition',
  'detective', 'steward', 'clerk',
];

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
    for (const requiredHost of ['claude-code', 'codex', 'kimi']) {
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
        // `inherit` and `frontier` may both carry a null model: both mean
        // "keep the active/session model" (orchestration-only compute).
        if (!['inherit', 'frontier'].includes(profile) && preset.model === null) {
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

function lifecycleContractDigest(skillDirectory) {
  const hash = createHash('sha256');
  for (const resource of lifecycleContractResources) {
    const file = join(skillDirectory, resource);
    if (!existsSync(file)) continue;
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
    ['name', 'bundle_version', 'contract_resource_digest', 'contract_versions'],
    'Manifest',
    errors,
  )) return;
  if (manifest.name !== 'phantom') errors.push('Manifest name must be phantom.');
  if (typeof manifest.bundle_version !== 'string'
    || !/^\d+\.\d+\.\d+$/.test(manifest.bundle_version)) {
    errors.push('Manifest bundle_version must be a semantic version.');
  } else {
    const [major, minor] = manifest.bundle_version.split('.').map(Number);
    if (major < 2 || (major === 2 && minor < 2)) {
      errors.push('Manifest bundle_version must be at least 2.2.0 for the defect-proof lifecycle contract.');
    }
  }
  if (manifest.contract_resource_digest !== lifecycleContractDigest(skillDirectory)) {
    errors.push(
      'Manifest contract_resource_digest is stale for lifecycle contract resources; '
      + 'bump bundle_version and refresh the digest.',
    );
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
  if (policy.roles?.chief !== 'frontier') errors.push('Model policy Chief must use frontier.');
  if (JSON.stringify(Object.keys(policy.roles || {}).sort())
    !== JSON.stringify([...activeRoles].sort())) {
    errors.push('Model policy roles must contain exactly the active portable roles.');
  }
  if (policy.roles?.opposition !== 'balanced') {
    errors.push('Model policy ordinary opposition must use balanced.');
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
  const supportRoot = join(resolve(skillRoot, '..'), 'host-support');
  const compatibilityFile = join(supportRoot, 'compatibility.md');
  const resolverFile = join(supportRoot, 'resolve-runtime.mjs');
  if (!existsSync(compatibilityFile)) {
    errors.push('Host compatibility contract is missing at host-support/compatibility.md.');
  }
  if (!existsSync(resolverFile)) {
    errors.push('Host runtime resolver is missing at host-support/resolve-runtime.mjs.');
  }
  const legacySupportRoot = join(resolve(skillRoot, '..'), 'codex-support');
  for (const [shim, label] of [
    [join(legacySupportRoot, 'codex-compatibility.md'), 'Codex compatibility shim'],
    [join(legacySupportRoot, 'resolve-codex-runtime.mjs'), 'Codex resolver shim'],
  ]) {
    if (!existsSync(shim)) {
      errors.push(`${label} is missing at ${relative(resolve(skillRoot, '..'), shim)}.`);
    }
  }
  if (existsSync(compatibilityFile)) {
    const compatibility = readFileSync(compatibilityFile, 'utf8');
    for (const requirement of [
      'resolve-runtime.mjs',
      '--host <host-key>',
      '--command <workflow-name>',
      '<preamble_files>',
      '<conditional_preamble_files>',
      '<portable_skill_root>/SKILL.md',
      '<compatibility_scripts_root>',
      'PHANTOM_DATA=<data_root>',
      '~/.phantom',
      'never write workflow state under `.claude`',
      'User instructions, repository instructions, and runtime safety',
      'The portable skill and its references',
      'Compatible legacy command intent',
      'Legacy or provider-specific mechanics',
      'may not add or override delegation, approval,',
      'phase, state-path, or lifecycle authority',
    ]) {
      if (!compatibility.includes(requirement)) {
        errors.push(`Host compatibility contract must define ${requirement}.`);
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
      errors.push(`Host adapter is missing for commands/${command}.md.`);
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

    if (command === 'start') {
      const normalizedContent = content.replace(/\s+/g, ' ');
      for (const reference of ['../phantom/SKILL.md', '../phantom/references/planning.md']) {
        if (!content.includes(reference)) errors.push(`skills/start/SKILL.md must directly load ${reference}.`);
      }
      for (const legacyReference of [hostCompatibilityReference, '../../commands/start.md', '_shared']) {
        if (content.includes(legacyReference)) {
          errors.push(`skills/start/SKILL.md normal activation must not load ${legacyReference}.`);
        }
      }
      for (const [label, pattern] of [
        ['local planning and implementation only', /local planning and implementation only/i],
        ['implementation authorization', /implementation\s+authorization/i],
        ['no implicit PR lifecycle', /no implicit PR lifecycle/i],
        ['separate explicit shipping authorization', /shipping requires separate, explicit authorization/i],
      ]) {
        if (!pattern.test(normalizedContent)) errors.push(`skills/start/SKILL.md must define ${label}.`);
      }
    } else {
      if (!content.includes(`../../commands/${command}.md`)) {
        errors.push(`skills/${command}/SKILL.md must reference ../../commands/${command}.md.`);
      }
      if (!content.includes(hostCompatibilityReference)) {
        errors.push(`skills/${command}/SKILL.md must apply ${hostCompatibilityReference}.`);
      }
      if (content.indexOf(hostCompatibilityReference) > content.indexOf(`../../commands/${command}.md`)) {
        errors.push(`skills/${command}/SKILL.md must apply host compatibility before reading its command.`);
      }
      if (!content.includes(`workflow \`${command}\``)) {
        errors.push(`skills/${command}/SKILL.md must identify workflow \`${command}\`.`);
      }
    }
  }

  const commandSet = new Set(commands);
  const orphanedAdapters = readdirSync(skillRoot)
    .filter((entry) => entry !== 'phantom' && existsSync(join(skillRoot, entry, 'SKILL.md')))
    .filter((entry) => !commandSet.has(entry))
    .sort();
  for (const adapter of orphanedAdapters) {
    errors.push(`Host adapter skills/${adapter}/SKILL.md has no matching public command.`);
  }

  return errors;
}

export function validatePluginManifests(root = repositoryRoot) {
  const errors = [];
  const codexFile = root === repositoryRoot ? codexManifestFile : join(root, '.codex-plugin', 'plugin.json');
  const claudeFile = root === repositoryRoot ? claudeManifestFile : join(root, '.claude-plugin', 'plugin.json');
  const marketFile = root === repositoryRoot ? marketplaceFile : join(root, '.claude-plugin', 'marketplace.json');
  const kimiFile = root === repositoryRoot ? kimiManifestFile : join(root, '.kimi-plugin', 'plugin.json');
  for (const file of [codexFile, claudeFile, marketFile, kimiFile]) {
    if (!existsSync(file)) errors.push(`${relative(root, file)} is missing.`);
  }
  if (errors.length) return errors;

  const claude = JSON.parse(readFileSync(claudeFile, 'utf8'));
  const marketplace = JSON.parse(readFileSync(marketFile, 'utf8'));
  const interfaceFields = [
    'displayName',
    'shortDescription',
    'longDescription',
    'developerName',
    'category',
  ];
  const skillManifests = [
    ['.codex-plugin/plugin.json', codexFile],
    ['.kimi-plugin/plugin.json', kimiFile],
  ];
  const versions = [];
  for (const [label, file] of skillManifests) {
    const plugin = JSON.parse(readFileSync(file, 'utf8'));
    versions.push(plugin.version);    if (plugin.name !== 'phantom') errors.push(`${label} name must be phantom.`);
    if (plugin.skills !== './skills/') errors.push(`${label} must expose ./skills/.`);
    if (!isObject(plugin.interface)) {
      errors.push(`${label} interface must be an object.`);
    } else {
      for (const field of interfaceFields) {
        if (typeof plugin.interface[field] !== 'string' || !plugin.interface[field].trim()) {
          errors.push(`${label} interface.${field} must be a non-empty string.`);
        }
      }
      if (!Array.isArray(plugin.interface.capabilities)
        || !plugin.interface.capabilities.every((value) => typeof value === 'string' && value.trim())) {
        errors.push(`${label} interface.capabilities must be an array of strings.`);
      }
      if (!Array.isArray(plugin.interface.defaultPrompt)
        || plugin.interface.defaultPrompt.length === 0
        || plugin.interface.defaultPrompt.length > 3
        || !plugin.interface.defaultPrompt.every((value) => typeof value === 'string'
          && value.trim() && value.length <= 128)) {
        errors.push(`${label} interface.defaultPrompt must contain 1-3 strings of at most 128 characters.`);
      }
    }
    const discoveredSkillRoot = resolve(root, plugin.skills || '');
    const relativeSkillRoot = relative(root, discoveredSkillRoot);
    if (relativeSkillRoot.startsWith('..') || !existsSync(discoveredSkillRoot)) {
      errors.push(`${label} skills must resolve to a directory inside the plugin.`);
    } else {
      for (const entry of readdirSync(discoveredSkillRoot)) {
        const child = join(discoveredSkillRoot, entry);
        if (entry.startsWith('.') || !statSync(child).isDirectory()) continue;
        if (!existsSync(join(child, 'SKILL.md'))) {
          errors.push(`${label} skill directory ${entry} is missing SKILL.md.`);
        }
      }
    }
  }

  // Kimi Code manifest extras: plugin-shipped agents and hook gates. Hook
  // commands run with cwd = plugin root and receive KIMI_PLUGIN_ROOT, so only
  // './' paths inside the plugin are allowed.
  const kimiPlugin = JSON.parse(readFileSync(kimiFile, 'utf8'));
  const kimiLabel = '.kimi-plugin/plugin.json';
  if (kimiPlugin.agents !== undefined) {
    const agentsRoot = resolve(root, kimiPlugin.agents || '');
    if (typeof kimiPlugin.agents !== 'string' || !kimiPlugin.agents.startsWith('./')
      || relative(root, agentsRoot).startsWith('..') || !existsSync(agentsRoot)) {
      errors.push(`${kimiLabel} agents must be a './' path to a directory inside the plugin.`);
    } else if (!readdirSync(agentsRoot).some((entry) => entry.endsWith('.md'))) {
      errors.push(`${kimiLabel} agents directory must contain at least one agent file.`);
    }
  }
  const kimiHookEvents = new Set([
    'UserPromptSubmit', 'UserPromptQueued', 'PreToolUse', 'Stop', 'TurnStarted',
    'PostToolUse', 'PostToolUseFailure', 'PermissionRequest', 'PermissionResult',
    'SessionStart', 'SessionEnd', 'SessionHeartbeat', 'SubagentStart', 'SubagentStop',
    'TaskStarted', 'StopFailure', 'Interrupt', 'PreCompact', 'PostCompact', 'Notification',
  ]);
  if (kimiPlugin.hooks !== undefined) {
    if (!Array.isArray(kimiPlugin.hooks)) {
      errors.push(`${kimiLabel} hooks must be an array.`);
    } else {
      kimiPlugin.hooks.forEach((hook, index) => {
        const hookLabel = `${kimiLabel} hooks[${index}]`;
        if (!isObject(hook)) {
          errors.push(`${hookLabel} must be an object.`);
          return;
        }
        if (!kimiHookEvents.has(hook.event)) {
          errors.push(`${hookLabel} event must be a known Kimi Code hook event.`);
        }
        if (hook.matcher !== undefined && typeof hook.matcher !== 'string') {
          errors.push(`${hookLabel} matcher must be a string when present.`);
        }
        if (typeof hook.command !== 'string' || !hook.command.includes('./')) {
          errors.push(`${hookLabel} command must reference a './' path inside the plugin.`);
          return;
        }
        const commandPath = hook.command.split(' ').find((part) => part.startsWith('./'));
        const resolvedCommand = resolve(root, commandPath || '');
        if (!commandPath || relative(root, resolvedCommand).startsWith('..') || !existsSync(resolvedCommand)) {
          errors.push(`${hookLabel} command path must resolve to a file inside the plugin.`);
        }
        if (hook.timeout !== undefined
          && (!Number.isInteger(hook.timeout) || hook.timeout < 1 || hook.timeout > 600)) {
          errors.push(`${hookLabel} timeout must be an integer between 1 and 600.`);
        }
      });
    }
  }

  if (new Set([...versions, claude.version, marketplace.metadata?.version]).size !== 1) {
    errors.push('Codex, Claude, Kimi, and marketplace plugin versions must match.');
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
    'references/execution.md',
    'references/planning.md',
    'references/review-html.md',
    'references/roles.md',
    'references/shipping.md',
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

  const lifecycleContract = {
    'references/state.md': [
      'schema_version: 1',
      '--mode to-plan',
      '--gate direction',
      '--gate plan',
      '--gate wiring',
      '--scope implementation',
      '--scope ship-pr',
      '--scope ship-draft-pr',
      'worktree_fingerprint',
      'record_sequence',
      'SHA-256 digest',
      'The authoritative review must have a later',
    ],
    'scripts/phantom-state.mjs': [
      "const ROUTES = new Set(['lite', 'direct', 'plan', 'brainstorm', 'full'])",
      "'ship-pr'",
      "'ship-draft-pr'",
      'worktreeFingerprint',
      'APPROVAL_ARTIFACTS',
      'artifact_bindings',
      'latestRecordSequence',
      "command === 'approve'",
      "command === 'authorize'",
      "command === 'execute'",
      "command === 'verify'",
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
