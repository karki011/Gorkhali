// Ticket lifecycle policy and durable read-back evidence. Provider effects live outside this module.
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { writeJsonAtomic } = require('./session');
const { digest } = require('./git-state');

const STAGES = ['intake', 'start', 'review', 'done'];
const STATUS_NAMES = {
  start: ['In Progress', 'In Development', 'Doing'],
  review: ['In Review', 'Code Review', 'In Code Review', 'Review'],
  done: ['Done', 'Closed', 'Resolved'],
};
function text(value) { return typeof value === 'string' && value.trim().length > 0; }
function url(value) {
  const result = new URL(value);
  if (result.protocol !== 'https:' || result.username || result.password || result.port) throw new Error('Use a public HTTPS ticket URL without credentials');
  return result;
}
function parseTicket(reference, options = {}) {
  if (!text(reference)) throw new Error('Ticket number or URL required');
  const ref = reference.trim();
  let key = ref.toUpperCase(); let site = options.site;
  if (/^https?:/i.test(ref)) {
    const parsed = url(ref);
    const github = parsed.pathname.match(/^\/([^/]+)\/([^/]+)\/issues\/([1-9]\d*)\/?$/);
    if (parsed.hostname === 'github.com' && github) {
      const [, owner, repo, number] = github;
      if (!Number.isSafeInteger(Number(number))) throw new Error('Invalid issue number');
      if (!/^[\w.-]+$/.test(owner) || !/^[\w.-]+$/.test(repo)) throw new Error('Invalid GitHub repository');
      const repository = `${owner}/${repo}`.toLowerCase();
      return { provider: 'github', repo: repository, number: Number(number), url: `https://github.com/${repository}/issues/${number}` };
    }
    const browse = parsed.pathname.match(/\/browse\/([A-Za-z][A-Za-z0-9_]*-[1-9]\d*)\/?$/);
    key = (browse?.[1] || parsed.searchParams.get('selectedIssue') || '').toUpperCase();
    site = parsed.origin;
  }
  if (/^#?[1-9]\d*$/.test(ref)) {
    if (options.provider === 'jira') throw new Error('Provide the full Jira key or URL, not a bare number');
    if (!/^[\w.-]+\/[\w.-]+$/.test(options.repo || '')) throw new Error('A bare issue number needs its GitHub owner/repository');
    return parseTicket(`https://github.com/${options.repo}/issues/${ref.replace('#', '')}`);
  }
  if (!/^[A-Z][A-Z0-9_]*-[1-9]\d*$/.test(key) || !site) throw new Error('Provide a Jira key with its site, or a GitHub issue number/URL; clarify other trackers');
  const parsedSite = url(site);
  if (parsedSite.pathname !== '/' || parsedSite.search || parsedSite.hash || parsedSite.hostname === 'github.com') throw new Error('Jira site must be its HTTPS origin');
  return { provider: 'jira', key, site: parsedSite.origin, url: `${parsedSite.origin}/browse/${key}` };
}
function read(dir) {
  try { return JSON.parse(fs.readFileSync(path.join(dir, 'tracking.json'), 'utf8')); }
  catch (err) { if (err.code === 'ENOENT') return { decision: 'unanswered', stages: {} }; throw new Error('Unreadable tracking state; recover it before continuing'); }
}
function save(dir, state) { writeJsonAtomic(path.join(dir, 'tracking.json'), state); return state; }
function configure(dir, input) {
  const prior = read(dir);
  if (input.decision === 'none') {
    if (input.confirmed !== true || !text(input.reason)) throw new Error('Record the user decision to proceed without a ticket and its reason');
    if (prior.decision === 'ticket') throw new Error('A bound ticket cannot be silently dropped; finish or resolve its tracking updates');
    return save(dir, { decision: 'none', reason: input.reason, stages: {} });
  }
  const ticket = parseTicket(input.reference, input);
  if (prior.decision === 'ticket' && JSON.stringify(prior.ticket) !== JSON.stringify(ticket)) throw new Error('Session already tracks a different ticket');
  if (prior.pending || Object.keys(prior.stages || {}).length) throw new Error('Tracking configuration is already in use');
  if (input.assignee !== undefined && !text(input.assignee)) throw new Error('Assignee must be a login/account ID or me');
  if (input.reassign && input.confirmed !== true) throw new Error('Explicit reassignment authorization required');
  const statusNames = input.statusNames || {};
  if (Object.entries(statusNames).some(([stage, name]) => !STATUS_NAMES[stage] || !text(name))) throw new Error('Status mappings must name start, review, or done workflow statuses');
  return save(dir, { decision: 'ticket', ticket, assignee: input.assignee || 'me', reassign: input.reassign === true,
    projectId: input.projectId || null, statusNames, stages: {} });
}
function requireStage(dir, stage, pr) {
  const state = read(dir);
  if (state.decision === 'none') return;
  if (state.decision !== 'ticket') throw new Error('Ask whether the user has a ticket/task number or URL; record a ticket or their no-ticket decision');
  if (!state.stages[stage]) throw new Error(`Ticket ${stage} update needs successful read-back evidence; use tracking-begin`);
  if (pr && state.stages[stage].pr !== pr) throw new Error('Tracking receipt belongs to a different PR');
}
function settings(dir, input) {
  const state = read(dir);
  if (state.decision !== 'ticket' || input.confirmed !== true) throw new Error('A bound ticket and explicit workflow selection are required');
  if (!state.pending) throw new Error('Change mappings only to resolve a pending tracker update');
  const statusNames = { ...state.statusNames, ...input.statusNames };
  if (Object.entries(statusNames).some(([stage, name]) => !STATUS_NAMES[stage] || !text(name))) throw new Error('Invalid status mapping');
  if (input.projectId !== undefined && !text(input.projectId)) throw new Error('Select an observed project ID');
  const pending = { ...state.pending }; delete pending.action; delete pending.observation;
  return save(dir, { ...state, statusNames, projectId: input.projectId || state.projectId, pending, error: null });
}
function begin(dir, stage, context = {}) {
  if (!STAGES.includes(stage)) throw new Error('Unknown tracking stage');
  const state = read(dir);
  if (state.decision === 'none') return state;
  if (state.decision !== 'ticket') throw new Error('Resolve the ticket question first');
  if (stage !== 'intake') requireStage(dir, STAGES[STAGES.indexOf(stage) - 1]);
  if (state.stages[stage]) {
    if (['review', 'done'].includes(stage) && state.stages[stage].pr !== context.pr) throw new Error('Tracking receipt belongs to a different PR');
    return state;
  }
  if (state.pending) {
    if (state.pending.stage !== stage) throw new Error('Finish the pending tracker update first');
    if (['review', 'done'].includes(stage) && state.pending.pr !== context.pr) throw new Error('Pending tracking update belongs to a different PR');
    return state;
  }
  if (['review', 'done'].includes(stage) && !/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/pull\/[1-9]\d*$/.test(context.pr || '')) throw new Error('The shipped PR URL is required');
  const marker = context.pr ? `gorkhali-pr:${digest(`${state.ticket.url}:${context.pr}`).slice(0, 24)}` : null;
  return save(dir, { ...state, pending: { id: randomUUID(), stage, pr: context.pr || null, marker, startedAt: new Date().toISOString() }, error: null });
}
function validateObservation(state, observation) {
  const pending = state.pending;
  if (!pending || observation?.attemptId !== pending.id || observation.ticketUrl !== state.ticket.url) throw new Error('Observation must match this ticket and pending attempt');
  if (!text(observation.source) || !Number.isFinite(Date.parse(observation.observedAt)) || Date.parse(observation.observedAt) < Date.parse(pending.startedAt)) throw new Error('Fresh provider read-back with source and timestamp required');
  if (!text(observation.title) || !text(observation.status?.id) || !text(observation.status?.name) || !Array.isArray(observation.assignees) || observation.assignees.some((id) => !text(id))) throw new Error('Read ticket title, current status, and complete assignee list');
  if (observation.truncated) throw new Error('Complete provider observations required; paginate before continuing');
}
// This returns only the next external mutation. Re-read the provider after every mutation.
function nextAction(state, observation) {
  validateObservation(state, observation);
  const { stage, pr, marker } = state.pending;
  if (stage === 'intake') return null;
  if (stage === 'start') {
    if (observation.closed) throw new Error('Ticket is already closed; ask the user whether it should be reopened before starting');
    const desired = state.assignee === 'me' ? observation.currentUser : state.assignee;
    const needsAssign = state.reassign
      ? !(observation.assignees.length === 1 && observation.assignees[0] === desired)
      : observation.assignees.length === 0;
    if (needsAssign && !text(desired)) throw new Error('Resolve the authenticated tracker user before assigning');
    if (needsAssign) return { kind: 'assign', assignee: desired, replace: state.reassign };
  }
  if (stage === 'review') {
    if (!Array.isArray(observation.links)) throw new Error('Read all ticket comments/links to reconcile the PR link');
    if (!observation.links.some((link) => link.url === pr && link.marker === marker)) return { kind: 'link', pr, marker, body: `Pull request: ${pr}\n\n${marker}` };
  }
  const matchesStage = (name, target) => (state.statusNames[target] ? [state.statusNames[target]] : STATUS_NAMES[target])
    .some((value) => value.toLowerCase() === name?.toLowerCase());
  // An external workflow may already be ahead. Satisfy this stage without moving it backward.
  if (STAGES.slice(STAGES.indexOf(stage)).some((target) => matchesStage(observation.status.name, target))) {
    if (state.ticket.provider === 'github' && stage === 'done' && !observation.closed) return { kind: 'close' };
    return null;
  }
  const candidates = (observation.transitions || []).filter((entry) => text(entry.id) && matchesStage(entry.name, stage));
  if (candidates.length !== 1) throw new Error(`Choose an available ${stage} status mapping; found ${candidates.length} matching transitions`);
  return { kind: 'transition', id: candidates[0].id, name: candidates[0].name };
}
function observe(dir, observation) {
  const state = read(dir);
  const action = nextAction(state, observation);
  // Intake is a read; all later success requires a new provider observation after any effects.
  if (!action) {
    const stage = state.pending.stage;
    return save(dir, { ...state, projectId: observation.projectId || state.projectId, stages: { ...state.stages, [stage]: { ...observation, pr: state.pending.pr, recordedAt: new Date().toISOString() } }, pending: null, error: null });
  }
  if (JSON.stringify(state.pending.action) === JSON.stringify(action)) throw new Error('Previous tracker write is not visible in read-back; refresh or resolve the failed operation before retrying a mutation');
  save(dir, { ...state, error: null, pending: { ...state.pending, action, observation } });
  return { ...read(dir), action };
}
function fail(dir, message) {
  if (!text(message)) throw new Error('Tracker failure reason required');
  const state = read(dir);
  return save(dir, { ...state, error: message });
}
module.exports = { parseTicket, read, configure, settings, requireStage, begin, observe, nextAction, fail, STATUS_NAMES };
