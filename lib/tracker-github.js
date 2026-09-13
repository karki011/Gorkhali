// GitHub effects use fixed argument arrays and read-back, never interpolated shell commands.
'use strict';
const { execFileSync } = require('node:child_process');
const tracking = require('./tracking');
const PROJECT_QUERY = `query($id:ID!){ node(id:$id){ ... on Issue {
  projectItems(first:100){pageInfo{hasNextPage} nodes{id isArchived
    fieldValueByName(name:"Status"){... on ProjectV2ItemFieldSingleSelectValue{optionId name}}
    project{id title fields(first:100){pageInfo{hasNextPage} nodes{
      ... on ProjectV2SingleSelectField{id name options{id name}}
    }}}
  }}
}}}`;
const STATUS_MUTATION = `mutation($project:ID!,$item:ID!,$field:ID!,$option:String!){
 updateProjectV2ItemFieldValue(input:{projectId:$project,itemId:$item,fieldId:$field,value:{singleSelectOptionId:$option}}){projectV2Item{id}}
}`;
function client(cwd) {
  return (args, body) => {
    const raw = execFileSync('gh', [...args, '--hostname', 'github.com'], { cwd, encoding: 'utf8', input: body === undefined ? undefined : JSON.stringify(body), maxBuffer: 16 * 1024 * 1024, stdio: ['pipe', 'pipe', 'pipe'] });
    return raw.trim() ? JSON.parse(raw) : null;
  };
}
function graph(call, query, variables) {
  const result = call(['api', 'graphql', '--input', '-'], { query, variables });
  if (result?.errors?.length || !result?.data) throw new Error('GitHub Projects query failed; check project access and response errors');
  return result.data;
}
function observe(state, call) {
  const endpoint = `repos/${state.ticket.repo}/issues/${state.ticket.number}`;
  const issue = call(['api', endpoint]);
  if (issue.pull_request || issue.html_url?.toLowerCase() !== state.ticket.url) throw new Error('Expected the bound GitHub issue, not a PR or redirected ticket');
  const result = { attemptId: state.pending.id, ticketUrl: state.ticket.url, title: issue.title,
    body: issue.body ?? '', labels: issue.labels,
    source: `gh api ${endpoint}`, observedAt: new Date().toISOString(),
    status: { id: issue.state, name: issue.state }, assignees: issue.assignees.map((user) => user.login), closed: issue.state === 'closed', links: [] };
  if (state.pending.stage === 'intake') return result;
  if (state.pending.stage === 'start' && state.assignee === 'me' && (!issue.assignees.length || state.reassign)) result.currentUser = call(['api', 'user']).login;
  const projects = graph(call, PROJECT_QUERY, { id: issue.node_id }).node?.projectItems;
  if (!projects || projects.pageInfo?.hasNextPage) throw new Error('Cannot establish complete GitHub Projects membership');
  const candidates = projects.nodes.filter((entry) => (!entry.isArchived || (state.pending.stage === 'done' && state.projectId)) && (!state.projectId || entry.project.id === state.projectId));
  if (candidates.length !== 1) throw new Error(`Select one GitHub Project with an existing Status field and add the issue if needed. Available projects: ${candidates.map((entry) => `${entry.project.title} (${entry.project.id})`).join(', ') || 'none'}`);
  const item = candidates[0];
  if (item.project.fields.pageInfo?.hasNextPage) throw new Error('Cannot establish complete GitHub Project fields');
  const fields = item.project.fields.nodes.filter((field) => field.name === 'Status' && Array.isArray(field.options));
  if (fields.length !== 1) throw new Error('Selected GitHub Project must have one Status single-select field');
  const field = fields[0];
  Object.assign(result, { projectId: item.project.id, itemId: item.id, fieldId: field.id,
    status: { id: item.fieldValueByName?.optionId || 'unset', name: item.fieldValueByName?.name || 'Unset' }, transitions: field.options });
  if (state.pending.stage === 'review') {
    const pages = call(['api', `${endpoint}/comments?per_page=100`, '--paginate', '--slurp']);
    const comments = pages.flat();
    result.links = comments.filter((comment) => comment.body?.includes(state.pending.marker) && comment.body.includes(state.pending.pr))
      .map(() => ({ url: state.pending.pr, marker: state.pending.marker }));
  }
  return result;
}
function apply(state, action, observation, call) {
  const endpoint = `repos/${state.ticket.repo}/issues/${state.ticket.number}`;
  if (action.kind === 'assign') return call(['api', endpoint, '--method', 'PATCH', '--input', '-'], { assignees: action.replace ? [action.assignee] : [...observation.assignees, action.assignee] });
  if (action.kind === 'link') return call(['api', `${endpoint}/comments`, '--method', 'POST', '--input', '-'], { body: action.body });
  if (action.kind === 'close') return call(['api', endpoint, '--method', 'PATCH', '--input', '-'], { state: 'closed', state_reason: 'completed' });
  if (action.kind === 'transition') return graph(call, STATUS_MUTATION, { project: observation.projectId, item: observation.itemId, field: observation.fieldId, option: action.id });
  throw new Error('Unknown GitHub tracking operation');
}
// One mutation at most per invocation. A subsequent invocation always reads the provider first.
function sync(dir, cwd, call = client(cwd)) {
  const state = tracking.read(dir);
  if (state.decision === 'none' || !state.pending) return state;
  if (state.ticket.provider !== 'github') throw new Error('Use the connected Jira tools and tracking-observe for this ticket');
  try {
    const observation = observe(state, call);
    const decision = tracking.observe(dir, observation);
    if (!decision.action) return decision;
    apply(state, decision.action, observation, call);
    // Re-read on the next call even after an uncertain write outcome; never blindly replay.
    return { ...tracking.read(dir), needsReadBack: true };
  } catch (err) {
    tracking.fail(dir, err.message);
    throw err;
  }
}
module.exports = { sync, observe, apply };
