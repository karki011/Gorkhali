// Author: Subash Karki
// tracker.js - resolves the ticket-tracker provider (jira | github | none) and
// hands back four operation descriptors: fetch, start, done, comment.
//
// jira runs only over MCP, so its descriptors carry kind: 'mcp' and a tool
// name a command can call directly - node itself cannot execute them.
// github descriptors carry kind: 'gh' and a literal command string.
// none descriptors are null; every op is inert.
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

function jiraOps() {
  return {
    fetch: {
      kind: 'mcp',
      tool: 'mcp__atlassian__getJiraIssue',
      args: { issueIdOrKey: '{ticket}' },
    },
    start: {
      kind: 'mcp',
      tool: 'mcp__atlassian__transitionJiraIssue',
      args: {
        issueIdOrKey: '{ticket}',
        targetNames: ['In Progress', 'Start Progress', 'In Development', 'Doing'],
      },
      prereq: 'mcp__atlassian__getTransitionsForJiraIssue',
    },
    done: {
      kind: 'mcp',
      tool: 'mcp__atlassian__transitionJiraIssue',
      args: { issueIdOrKey: '{ticket}', targetNames: ['Done', 'Closed', 'Resolved'] },
      prereq: 'mcp__atlassian__getTransitionsForJiraIssue',
    },
    comment: {
      kind: 'mcp',
      tool: 'mcp__atlassian__addCommentToJiraIssue',
      args: { issueIdOrKey: '{ticket}', commentBody: '{comment}' },
    },
  };
}

function githubOps() {
  return {
    fetch: { kind: 'gh', command: 'gh issue view {ticket} --json title,body,labels,state' },
    start: { kind: 'gh', command: 'gh issue edit {ticket} --add-assignee @me' },
    done: { kind: 'gh', command: 'gh issue close {ticket} --comment "{comment}"' },
    comment: { kind: 'gh', command: 'gh issue comment {ticket} --body "{comment}"' },
  };
}

function noneOps() {
  return { fetch: null, start: null, done: null, comment: null };
}

function buildOps(provider) {
  if (provider === 'jira') return jiraOps();
  if (provider === 'github') return githubOps();
  return noneOps();
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
  return { provider, ops: buildOps(provider) };
}

module.exports = { resolveTracker, PROVIDER_LINE };
