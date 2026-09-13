// Author: Subash Karki
// Select the optional tracker preference. Lifecycle state and effects are in
// tracking.js, tracker-github.js, and references/tracking.md (Jira MCP).
//
// Provider resolution order:
//   1. config.provider - an explicit override, always wins.
//   2. The `tracker:` line in the preferences text lib/preferences.js
//      resolves (config.preferencesText, or a best-effort require('./preferences')
//      when the caller did not already resolve it). Line format:
//        tracker: jira|github|none
//   3. 'none' when nothing is configured.

'use strict';

const PROVIDERS = ['jira', 'github', 'none'];
const PROVIDER_LINE = /^\s*tracker\s*:\s*(jira|github|none)\s*$/im;

function readProviderFromText(text) {
  if (!text || typeof text !== 'string') return null;
  const match = text.match(PROVIDER_LINE);
  return match ? match[1].toLowerCase() : null;
}

function readProviderFromPreferencesFile(repoSlug, cwd) {
  let repoSlugMod;
  let preferences;
  try {
    repoSlugMod = require('./paths');
    preferences = require('./preferences');
  } catch (err) {
    return null;
  }
  try {
    const slug = repoSlug || repoSlugMod.repoSlug(cwd);
    const resolvedCwd = cwd || process.cwd();
    const { text } = preferences.readPreferences(slug, resolvedCwd);
    return readProviderFromText(text);
  } catch (err) {
    return null;
  }
}

function resolveTracker(config) {
  config = config || {};
  let provider = config.provider;
  if (!provider) {
    provider =
      readProviderFromText(config.preferencesText) ||
      readProviderFromPreferencesFile(config.repoSlug, config.cwd);
  }
  if (!PROVIDERS.includes(provider)) {
    provider = 'none';
  }
  return { provider };
}

module.exports = { resolveTracker, PROVIDER_LINE };
