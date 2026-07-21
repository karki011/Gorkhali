#!/usr/bin/env node
// Author: Subash Karki

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { isMainModule, parseArgs } from './lib/portable.mjs';
import { validateDecisionContract } from './lib/decision-contracts.mjs';
import { REVIEW_STYLE } from './lib/review-style.mjs';

const escapeHtml = (value) =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const isObject = (value) => value != null && typeof value === 'object' && !Array.isArray(value);
const humanize = (value) => {
  const text = String(value)
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .trim()
    .toLowerCase();
  return text ? text[0].toUpperCase() + text.slice(1) : '';
};
const slug = (value) =>
  humanize(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

const hasContent = (value) =>
  value != null &&
  (typeof value !== 'object' ||
    (Array.isArray(value) ? value.length > 0 : Object.keys(value).length > 0));
const asArray = (value) => (Array.isArray(value) ? value : []);
const asText = (value) => (typeof value === 'string' ? value.trim() : '');
const isNonBlockingQuestion = (value) => isObject(value) && value.blocking === false;
const section = (title, body, className = '') => ({ title, body, className });
const indexById = (items) => new Map(asArray(items).map((item) => [item.id, item]));
const componentChips = (items) => `<div class="chip-list">${asArray(items)
  .map((item) => `<span class="component-chip">${escapeHtml(item)}</span>`)
  .join('')}</div>`;

const renderValue = (value, depth = 0) => {
  if (value == null || value === '') return '<span class="muted">Not specified</span>';
  if (typeof value !== 'object') return escapeHtml(value);
  if (depth >= 4) return `<pre>${escapeHtml(JSON.stringify(value, null, 2))}</pre>`;
  if (Array.isArray(value)) {
    if (value.length === 0) return '<span class="muted">None recorded</span>';
    if (value.every((item) => item == null || typeof item !== 'object')) {
      return `<ul class="clean-list">${value.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>`;
    }
    return `<div class="card-grid">${value
      .map((item) => `<div class="card compact-card">${renderValue(item, depth + 1)}</div>`)
      .join('')}</div>`;
  }
  return `<dl>${Object.entries(value)
    .map(
      ([key, item]) =>
        `<div class="row"><dt>${escapeHtml(humanize(key))}</dt><dd>${renderValue(item, depth + 1)}</dd></div>`,
    )
    .join('')}</dl>`;
};

const renderList = (items, className = 'clean-list') => {
  const values = asArray(items);
  if (!values.length) return '<p class="muted">None recorded.</p>';
  return `<ul class="${className}">${values
    .map((item) => `<li>${isObject(item) ? renderValue(item) : escapeHtml(item)}</li>`)
    .join('')}</ul>`;
};

const statusTone = (value) => {
  const key = String(value ?? '').toLowerCase();
  if (['verified', 'ready', 'low', 'high-confidence', 'delegated'].includes(key)) return ' good';
  if (['pending', 'unknown', 'medium', 'needs-decision', 'blocked'].includes(key)) return ' warn';
  if (['high', 'critical', 'failed'].includes(key)) return ' bad';
  return '';
};

const badge = (value, label = '', tone = statusTone(value)) =>
  value == null || value === ''
    ? ''
    : `<span class="badge${tone}">${label ? `${escapeHtml(label)} ` : ''}${escapeHtml(value)}</span>`;

const reversibilityTone = (value) => ({ high: ' good', medium: ' warn', low: ' bad' })[value] || '';

const metric = (value, label) =>
  `<div class="metric"><strong>${escapeHtml(value)}</strong><span>${escapeHtml(label)}</span></div>`;

const reviewHero = (type, data) => {
  const isPlan = type === 'plan';
  const title = data.title || data.outcome?.goal || data.decision?.question || humanize(type);
  const subtitle = isPlan ? data.problem : data.problem || data.decision?.outcome;
  const meta = (isPlan
    ? [badge('Implementation dossier'), badge(data.depth, 'Depth:'), badge(data.decision?.status, 'Status:')]
    : [
      badge('Exploration workbench'),
      badge(data.depth, 'Depth:'),
      badge(data.phase, 'Phase:'),
      badge(data.stance?.mode, 'Stance:'),
      badge(asArray(data.evidence).length, 'Evidence:'),
      badge(asArray(data.ideas).length, 'Ideas:'),
    ]).filter(Boolean).join('');
  return `<div class="hero-kicker">${isPlan ? 'Implementation readiness review' : 'Structured exploration review'}</div><h1>${escapeHtml(title)}</h1>${subtitle ? `<p class="hero-subtitle">${escapeHtml(subtitle)}</p>` : ''}<div class="hero-meta">${meta}</div>`;
};

const decisionBrief = (data) => {
  const decision = isObject(data.decision) ? data.decision : {};
  const pending = [
    ...asArray(data.decisions_for_approval),
    ...asArray(data.open_questions).filter((question) => !isNonBlockingQuestion(question)),
  ];
  return `<div class="decision-spine">
    <article class="card recommendation decision-primary">
      <div class="eyebrow">Recommended direction</div>
      <h3>${escapeHtml(decision.recommendation || 'Recommendation not recorded')}</h3>
      ${decision.question ? `<div class="approval-question"><span>Approval question</span><strong>${escapeHtml(decision.question)}</strong></div>` : ''}
      ${renderList(decision.rationale, 'rationale-list')}
      ${decision.acceptedTradeoff ? `<div class="accepted-tradeoff"><strong>Accepted tradeoff</strong><p>${escapeHtml(decision.acceptedTradeoff)}</p></div>` : ''}
      ${decision.confidence ? `<div class="decision-confidence">${badge(`${decision.confidence}-confidence`, 'Confidence:')}</div>` : ''}
    </article>
    <aside class="card needs-call decision-rail">
      <div class="rail-heading"><div><div class="eyebrow">Human gate</div><h3>Needs your call</h3></div>${badge(decision.status)}</div>
      ${pending.length ? renderList(pending, 'decision-list') : '<p class="muted">No blocking human decision recorded.</p>'}
    </aside>
  </div>`;
};

const summarySentence = (label, value) => {
  const text = asText(value);
  if (!text) return '';
  return `${label}: ${text}${/[.!?]$/.test(text) ? '' : '.'}`;
};

const planSummary = (data) => {
  const authored = asText(data.summary);
  const summary = authored || [
    summarySentence('Problem', data.problem),
    summarySentence('Chosen direction', data.decision?.recommendation),
    summarySentence('What this plan puts in place', data.solution_shape?.summary),
    summarySentence('Expected result', data.outcome?.goal),
  ].filter(Boolean).join(' ');
  return `<article class="plan-summary" aria-label="Plan in plain language"><div class="eyebrow">The plan in plain language</div><p>${escapeHtml(summary)}</p></article>`;
};

const outcomePanel = (data) => `<div class="outcome-band">
  <div class="band-panel outcome-panel"><div class="eyebrow">Target outcome</div><p class="outcome-goal">${escapeHtml(data.outcome?.goal || '')}</p></div>
  <div class="band-panel"><div class="eyebrow">Definition of done</div>${renderList(data.outcome?.doneWhen, 'check-list')}</div>
</div>`;

const scopePanel = (scope) => `<div class="scope-grid">
  <div class="band-panel scope-in"><div class="eyebrow">In scope</div>${renderList(scope?.in)}</div>
  <div class="band-panel scope-out"><div class="eyebrow">Out of scope</div>${renderList(scope?.out)}</div>
  <div class="band-panel scope-constraint"><div class="eyebrow">Hard constraints</div>${renderList(scope?.constraints)}</div>
</div>`;

const architecturePanel = (shape) => {
  if (!isObject(shape)) return '';
  const flow = asArray(shape.dataFlow);
  return `<div class="architecture-grid">
    <div class="card architecture-summary"><div class="eyebrow">Solution shape</div><p class="architecture-lead">${escapeHtml(shape.summary || '')}</p>${componentChips(asArray(shape.components).map((item) => isObject(item) ? item.name || item.component || JSON.stringify(item) : item))}</div>
    <div class="card flow-card"><div class="eyebrow">Data flow</div><ol class="flow-track" aria-label="Solution data flow">${flow.map((step, index) => `<li><span>${index + 1}</span><p>${escapeHtml(isObject(step) ? step.step || step.name || JSON.stringify(step) : step)}</p></li>`).join('')}</ol></div>
  </div>`;
};

const evidenceLedger = (items) => `<div class="evidence-ledger">${asArray(items).map((item, index) => {
  const evidence = isObject(item) ? item : { claim: item };
  return `<article class="evidence-item"><div class="evidence-index">E${String(index + 1).padStart(2, '0')}</div><div class="evidence-body"><div class="evidence-meta">${badge(evidence.status)}<span>${escapeHtml(evidence.source || 'Source not recorded')}</span></div><h3>${escapeHtml(evidence.claim || '')}</h3>${evidence.implication ? `<p><strong>Decision implication:</strong> ${escapeHtml(evidence.implication)}</p>` : ''}</div></article>`;
}).join('')}</div>`;

const alternativesPanel = (alternatives) => `<div class="alternative-grid">${asArray(alternatives).map((item, index) => {
  const option = isObject(item) ? item : { name: item };
  return `<article class="card alternative-card"><div class="card-head"><span class="option-index">${String(index + 1).padStart(2, '0')}</span><h3>${escapeHtml(option.name || option.option || `Alternative ${index + 1}`)}</h3></div>${option.summary || option.description ? `<p>${escapeHtml(option.summary || option.description)}</p>` : ''}${hasContent(option.benefits) ? `<div class="mini-block"><strong>Benefits</strong>${renderList(option.benefits)}</div>` : ''}${hasContent(option.tradeoffs || option.costs) ? `<div class="mini-block"><strong>Tradeoffs</strong>${renderList(option.tradeoffs || option.costs)}</div>` : ''}${option.reasonNotSelected || option.rejectedBecause ? `<div class="rejected"><strong>Why not selected</strong><p>${escapeHtml(option.reasonNotSelected || option.rejectedBecause)}</p></div>` : ''}${option.conditionsWouldChange ? `<div class="mini-block"><strong>Reconsider when</strong><p>${escapeHtml(option.conditionsWouldChange)}</p></div>` : ''}</article>`;
}).join('')}</div>`;

const riskRegister = (risks) => `<div class="risk-grid">${asArray(risks).map((item, index) => {
  const risk = isObject(item) ? item : { risk: item };
  return `<article class="card risk-card"><div class="card-head"><span class="option-index">R${index + 1}</span><div>${badge(risk.impact, 'Impact:')}${badge(risk.likelihood, 'Likelihood:')}</div></div><h3>${escapeHtml(risk.risk || risk.title || '')}</h3>${risk.trigger ? `<p><strong>Trigger:</strong> ${escapeHtml(risk.trigger)}</p>` : ''}${risk.mitigation ? `<p><strong>Mitigation:</strong> ${escapeHtml(risk.mitigation)}</p>` : ''}${risk.recovery || risk.reversibility ? `<p><strong>Recovery:</strong> ${escapeHtml(risk.recovery || risk.reversibility)}</p>` : ''}</article>`;
}).join('')}</div>`;

const validationPanel = (validation) => `<div class="validation-grid">
  <div class="card validation-strategy"><div class="eyebrow">Validation strategy</div><p class="architecture-lead">${escapeHtml(validation?.strategy || '')}</p></div>
  <div class="band-panel"><div class="eyebrow">Success conditions</div>${renderList(validation?.definitionOfDone, 'check-list')}</div>
  <div class="band-panel"><div class="eyebrow">Concrete checks</div>${renderList(validation?.checks, 'command-list')}</div>
</div>`;

const taskDossier = (task, index) => {
  const value = isObject(task) ? task : { description: task };
  const interfaces = hasContent(value.consumes) || hasContent(value.produces)
    ? `<div class="interface-contract"><div><strong>Consumes</strong>${renderList(value.consumes)}</div><div><strong>Produces</strong>${renderList(value.produces)}</div></div>`
    : '';
  return `<article class="task-card"><div class="task-head"><div><span class="task-id">${escapeHtml(value.id || `T${index + 1}`)}</span><h3>${escapeHtml(value.description || value.action || '')}</h3></div><div>${badge(value.profile, 'Profile:')}${asArray(value.dependsOn).map((id) => badge(id, 'After:')).join('')}</div></div>${value.action && value.action !== value.description ? `<p class="task-action">${escapeHtml(value.action)}</p>` : ''}${interfaces}<div class="task-columns"><div><strong>Files</strong>${renderList(value.files, 'file-list')}<div class="mini-block"><strong>Read first</strong>${renderList(value.read_first, 'file-list')}</div></div><div><strong>Acceptance criteria</strong>${renderList(value.acceptance_criteria, 'check-list')}</div></div><div class="task-footer">${value.verify ? `<div><strong>Verify</strong><code>${escapeHtml(value.verify)}</code></div>` : ''}${value.risk ? `<div><strong>Risk</strong><span>${escapeHtml(value.risk)}</span></div>` : ''}${value.recovery ? `<div><strong>Recovery</strong><span>${escapeHtml(value.recovery)}</span></div>` : ''}</div></article>`;
};

const executionAppendix = (data) => `<details class="execution-details"><summary><span class="execution-summary-copy"><strong>Implementation details</strong><small>Open after the direction is approved and implementation begins.</small></span>${badge(asArray(data.tasks).length, 'Tasks:')}</summary><div class="execution-body"><div class="execution-meta">${badge(data.route, 'Route:')}${badge(data.devilsAdvocateVerdict, 'Challenge:')}</div><div class="task-stack">${asArray(data.tasks).map(taskDossier).join('')}</div></div></details>`;

const recommendationPanel = (data) => {
  const approaches = asArray(data.approaches);
  const recommendation = isObject(data.recommendedDefault) ? data.recommendedDefault : {};
  const selected = indexById(approaches).get(recommendation.id) || {};
  const confidence = recommendation.confidence
    ? badge(`${recommendation.confidence}-confidence`, 'Confidence:')
    : '';
  const nextAction = recommendation.nextAction
    ? `<span><strong>Next:</strong> ${escapeHtml(recommendation.nextAction)}</span>`
    : '';
  return `<div class="decision-spine">
    <article class="card recommendation decision-primary">
      <div class="eyebrow">Recommended direction</div>
      <div class="recommended-title">${badge('Recommended')}<h3>${escapeHtml(selected.name || recommendation.id || 'No recommendation')}</h3></div>
      ${selected.thesis ? `<p class="architecture-lead">${escapeHtml(selected.thesis)}</p>` : ''}
      <p>${escapeHtml(recommendation.reason || '')}</p>
      ${recommendation.acceptedTradeoff ? `<div class="accepted-tradeoff"><strong>Accepted tradeoff</strong><p>${escapeHtml(recommendation.acceptedTradeoff)}</p></div>` : ''}
      <div class="decision-confidence">${confidence}${nextAction}</div>
      <div class="metric-strip">
        ${metric(approaches.length, 'options')}
        ${metric(asArray(data.evidence).length, 'evidence items')}
        ${metric(asArray(data.decision?.evaluationCriteria).length, 'criteria')}
      </div>
    </article>
    <aside class="card exploration-status decision-rail">
      <div class="eyebrow">Exploration status</div>
      <h3>${escapeHtml(humanize(data.phase || 'decision'))}</h3>
      <dl><div class="row"><dt>Stance</dt><dd>${escapeHtml(humanize(data.stance?.mode || ''))}</dd></div><div class="row"><dt>Why this stance</dt><dd>${escapeHtml(data.stance?.reason || '')}</dd></div></dl>
    </aside>
  </div>`;
};

const comparisonTable = (approaches, recommendedId) => `<div class="table-wrap" role="region" aria-label="Approach comparison; scroll horizontally for more columns" tabindex="0"><table>
  <caption>Side-by-side comparison of brainstorm approaches</caption>
  <thead><tr>${['Approach', 'Thesis', 'Effort', 'Risk', 'Reversibility', 'When to pick']
    .map((label) => `<th scope="col">${label}</th>`)
    .join('')}</tr></thead>
  <tbody>${asArray(approaches)
    .map((approach) => `<tr${approach.id === recommendedId ? ' class="recommended-row"' : ''}><th scope="row"><div>${approach.id === recommendedId ? badge('Recommended') : ''}<strong>${escapeHtml(approach.name)}</strong></div></th><td>${escapeHtml(approach.thesis)}</td><td>${badge(approach.effort)}</td><td>${badge(approach.risk)}</td><td>${badge(approach.reversibility, '', reversibilityTone(approach.reversibility))}</td><td>${escapeHtml(approach.whenToPick)}</td></tr>`)
    .join('')}</tbody>
</table></div>`;

const approachDossiers = (approaches, recommendedId) => `<div class="approach-grid">${asArray(approaches).map((approach, index) => `<article class="approach-card${approach.id === recommendedId ? ' selected' : ''}"><div class="approach-head"><span class="option-index">${String(index + 1).padStart(2, '0')}</span><div>${approach.id === recommendedId ? badge('Recommended') : ''}<div class="eyebrow">${escapeHtml(approach.whyLens || 'Decision lens')}</div><h3>${escapeHtml(approach.name)}</h3><p>${escapeHtml(approach.thesis)}</p></div></div><p class="approach-description">${escapeHtml(approach.description)}</p><div class="approach-meta">${badge(approach.effort, 'Effort:')}${badge(approach.risk, 'Risk:')}${badge(approach.reversibility, 'Reversible:', reversibilityTone(approach.reversibility))}</div>${hasContent(approach.benefits) ? `<div class="mini-block"><strong>Benefits</strong>${renderList(approach.benefits)}</div>` : ''}${hasContent(approach.tradeoffs) ? `<div class="mini-block"><strong>Tradeoffs</strong>${renderList(approach.tradeoffs)}</div>` : ''}<div class="approach-split"><div><strong>What breaks</strong>${renderList(approach.whatBreaks)}</div><div><strong>When to pick</strong><p>${escapeHtml(approach.whenToPick)}</p></div></div>${hasContent(approach.mutualExclusivity) ? `<div class="mini-block"><strong>Rules out</strong>${renderList(approach.mutualExclusivity)}</div>` : ''}${approach.failureMode ? `<div class="rejected"><strong>Failure mode</strong><p>${escapeHtml(approach.failureMode)}</p></div>` : ''}</article>`).join('')}</div>`;

const experimentPanel = (experiment) => {
  if (!isObject(experiment)) return '';
  if (experiment.status === 'not-applicable') return `<div class="card experiment-card"><div class="eyebrow">Experiment not required</div><p>${escapeHtml(experiment.reason)}</p></div>`;
  const stages = [
    ['Question', experiment.question],
    ['Method', experiment.method],
    ['Success signal', experiment.successSignal],
    ['Cost', experiment.cost],
  ];
  return `<ol class="experiment-track" aria-label="Cheapest experiment steps">${stages.map(([label, value], index) => `<li><span>${index + 1}</span><div><strong>${label}</strong><p>${escapeHtml(value || '')}</p></div></li>`).join('')}</ol>`;
};

const changeLedger = (changeSet) => {
  const labels = [
    ['added', 'Added'],
    ['modified', 'Modified'],
    ['removed', 'Removed'],
    ['unchanged', 'Unchanged'],
  ];
  return `<div class="change-ledger">${labels.map(([key, label]) => `<article class="change-column change-${key}"><div class="eyebrow">${label}</div>${renderList(changeSet?.[key])}</article>`).join('')}</div>`;
};

const scenarioPanel = (scenarios) => `<div class="scenario-grid">${asArray(scenarios).map((scenario) => `<article class="scenario-card"><div class="scenario-id">${escapeHtml(scenario.id)}</div><dl><div><dt>Given</dt><dd>${escapeHtml(scenario.given)}</dd></div><div><dt>When</dt><dd>${escapeHtml(scenario.when)}</dd></div><div><dt>Then</dt><dd>${escapeHtml(scenario.then)}</dd></div></dl></article>`).join('')}</div>`;

const coveragePanel = (coverage) => `<div class="table-wrap coverage-table" role="region" aria-label="Requirement coverage; scroll horizontally for more columns" tabindex="0"><table>
  <caption>Requirement to scenario, task, and verification coverage</caption>
  <thead><tr><th scope="col">Requirement</th><th scope="col">Scenarios</th><th scope="col">Tasks</th><th scope="col">Proof</th></tr></thead>
  <tbody>${asArray(coverage).map((item) => `<tr><th scope="row">${escapeHtml(item.requirement)}</th><td>${asArray(item.scenarioIds).map((id) => badge(id)).join('')}</td><td>${asArray(item.taskIds).map((id) => badge(id)).join('')}</td><td>${renderList(item.checks, 'command-list')}</td></tr>`).join('')}</tbody>
</table></div>`;

const readinessPanel = (readiness) => `<div class="readiness-card readiness-${String(readiness?.verdict || '').toLowerCase()}"><div><div class="eyebrow">Implementation readiness</div><h3>${escapeHtml(readiness?.verdict || 'Not assessed')}</h3></div><div><strong>Why</strong>${renderList(readiness?.reasons, 'check-list')}</div><div><strong>Unresolved</strong>${renderList(readiness?.unresolved)}</div></div>`;

const explorationStage = (phase) => {
  const stages = [
    ['frame', 'Frame'],
    ['diverge', 'Diverge'],
    ['cluster', 'Connect'],
    ['converge', 'Converge'],
    ['decision', 'Decide'],
  ];
  const active = stages.findIndex(([id]) => id === phase);
  return `<ol class="exploration-stagebar" aria-label="Brainstorm progress">${stages.map(([id, label], index) => `<li${index === active ? ' aria-current="step"' : ''}${index <= active ? ' class="complete"' : ''}><span>${index + 1}</span><strong>${label}</strong></li>`).join('')}</ol>`;
};

const explorationFrame = (data) => `<div class="exploration-frame">${explorationStage(data.phase)}<div class="frame-grid"><article><div class="eyebrow">Decision question</div><h3>${escapeHtml(data.decision?.question || '')}</h3><p>${escapeHtml(data.decision?.outcome || '')}</p></article><article><div class="eyebrow">Audience and non-goals</div><strong>Audience</strong>${renderList(data.decision?.audience)}<div class="mini-block"><strong>Non-goals</strong>${renderList(data.decision?.nonGoals)}</div></article><article><div class="eyebrow">Evaluation criteria</div>${componentChips(data.decision?.evaluationCriteria)}</article><article><div class="eyebrow">Constraints</div>${renderList(data.decision?.constraints)}</article></div></div>`;

const ideaField = (ideas) => {
  const lanes = new Map();
  for (const idea of asArray(ideas)) {
    const lens = idea.lens || 'Unclassified';
    if (!lanes.has(lens)) lanes.set(lens, []);
    lanes.get(lens).push(idea);
  }
  return `<div class="idea-field">${[...lanes.entries()].map(([lens, laneIdeas]) => `<section class="idea-lane" aria-label="${escapeHtml(humanize(lens))} ideas"><div class="lane-heading"><div class="eyebrow">Lens</div><h3>${escapeHtml(humanize(lens))}</h3>${badge(laneIdeas.length, 'Ideas:')}</div><div class="idea-stack">${laneIdeas.map((idea) => `<article class="idea-card"><div class="idea-meta"><span class="idea-id">${escapeHtml(idea.id)}</span>${badge(humanize(idea.technique), 'Technique:')}</div><h3>${escapeHtml(idea.title)}</h3><p>${escapeHtml(idea.summary)}</p>${hasContent(idea.evidence) ? `<div class="idea-detail"><strong>Evidence</strong>${renderList(idea.evidence)}</div>` : ''}${hasContent(idea.assumptions) ? `<div class="idea-detail"><strong>Assumptions</strong>${renderList(idea.assumptions)}</div>` : ''}</article>`).join('')}</div></section>`).join('')}</div>`;
};

const clusterBoard = (clusters) => `<div class="cluster-board">${asArray(clusters).map((cluster) => `<article class="cluster-card"><div class="cluster-head"><span>${escapeHtml(cluster.id)}</span><div><div class="eyebrow">Connection</div><h3>${escapeHtml(cluster.name)}</h3></div></div><p>${escapeHtml(cluster.insight)}</p><div class="chip-list">${asArray(cluster.ideaIds).map((id) => badge(id)).join('')}</div></article>`).join('')}</div>`;

const shortlistPanel = (data) => {
  const byId = indexById(data.approaches);
  return `<div class="convergence-funnel"><div class="funnel-label"><span>Divergence</span><strong>${asArray(data.ideas).length} ideas</strong></div><div class="funnel-label"><span>Connections</span><strong>${asArray(data.clusters).length} clusters</strong></div><div class="funnel-label selected"><span>Shortlist</span><strong>${asArray(data.shortlist).length} directions</strong></div></div><div class="shortlist-grid">${asArray(data.shortlist).map((item) => `<article class="shortlist-card"><div class="eyebrow">Shortlisted direction</div><h3>${escapeHtml(byId.get(item.approachId)?.name || item.approachId)}</h3>${componentChips(item.drivers)}<div class="mini-block"><strong>Reservation</strong><p>${escapeHtml(item.reservation)}</p></div></article>`).join('')}</div>${comparisonTable(data.approaches, data.recommendedDefault?.id)}${approachDossiers(data.approaches, data.recommendedDefault?.id)}`;
};

const dissentPanel = (dissent, approaches) => {
  const approach = indexById(approaches).get(dissent?.approachId);
  return `<article class="dissent-card"><div><div class="eyebrow">Strongest dissenting case</div><h3>${escapeHtml(approach?.name || dissent?.approachId || '')}</h3></div><p>${escapeHtml(dissent?.case || '')}</p><div class="reconsider-trigger"><strong>Reconsider when</strong><p>${escapeHtml(dissent?.trigger || '')}</p></div></article>`;
};

const directionGatePanel = (gate, approaches) => {
  const byId = indexById(approaches);
  return `<div class="direction-gate"><div><div class="eyebrow">Direction gate</div><h3>${escapeHtml(gate?.question || '')}</h3></div><div class="gate-options">${asArray(gate?.options).map((id) => `<span>${escapeHtml(byId.get(id)?.name || id)}</span>`).join('')}</div></div>`;
};

const planSections = (data) => {
  const sections = [
    section('Plan summary', planSummary(data), 'plan-summary-section'),
    section('What we picked', decisionBrief(data)),
  ];
  if (hasContent(data.change_set)) sections.push(section('What changes', changeLedger(data.change_set)));
  if (hasContent(data.outcome)) sections.push(section('Outcome and success', outcomePanel(data)));
  if (hasContent(data.scope)) sections.push(section('Scope and constraints', scopePanel(data.scope)));
  if (hasContent(data.scenarios)) sections.push(section('Behavior scenarios', scenarioPanel(data.scenarios)));
  if (hasContent(data.solution_shape)) sections.push(section('Solution architecture', architecturePanel(data.solution_shape)));
  if (hasContent(data.coverage)) sections.push(section('Requirement coverage', coveragePanel(data.coverage)));
  if (hasContent(data.research)) sections.push(section('Research findings', renderValue(data.research)));
  if (hasContent(data.evidence)) sections.push(section('Evidence', evidenceLedger(data.evidence)));
  if (hasContent(data.alternatives)) sections.push(section('Alternatives and tradeoffs', alternativesPanel(data.alternatives)));
  if (hasContent(data.assumptions)) sections.push(section('Assumptions', renderValue(data.assumptions)));
  const nonBlockingQuestions = asArray(data.open_questions).filter(isNonBlockingQuestion);
  if (nonBlockingQuestions.length) sections.push(section('Open questions', renderValue(nonBlockingQuestions)));
  if (hasContent(data.risks)) sections.push(section('Risks and reversibility', riskRegister(data.risks)));
  if (hasContent(data.validation)) sections.push(section('Validation strategy', validationPanel(data.validation)));
  if (hasContent(data.readiness)) sections.push(section('Readiness verdict', readinessPanel(data.readiness)));
  if (hasContent(data.tasks)) sections.push(section('Execution appendix', executionAppendix(data), 'execution-section'));
  return sections;
};

const brainstormSections = (data) => {
  const sections = [];
  if (hasContent(data.recommendedDefault)) sections.push(section('Current direction', recommendationPanel(data)));
  if (hasContent(data.decision)) sections.push(section('Frame and stance', explorationFrame(data)));
  if (hasContent(data.evidence)) sections.push(section('Evidence', evidenceLedger(data.evidence)));
  if (hasContent(data.ideas)) sections.push(section('Divergence field', ideaField(data.ideas)));
  if (hasContent(data.clusters)) sections.push(section('Connections and clusters', clusterBoard(data.clusters)));
  if (hasContent(data.shortlist)) sections.push(section('Convergence and shortlist', shortlistPanel(data), 'convergence-section'));
  if (hasContent(data.dissent)) sections.push(section('Dissenting case', dissentPanel(data.dissent, data.approaches)));
  if (hasContent(data.cheapestExperiment)) sections.push(section('Cheapest experiment', experimentPanel(data.cheapestExperiment)));
  if (asArray(data.openQuestions).length) sections.push(section('Open questions', renderValue(data.openQuestions)));
  if (hasContent(data.directionGate)) sections.push(section('Direction gate', directionGatePanel(data.directionGate, data.approaches)));
  return sections;
};

export const renderReviewHtml = (type, artifact, { source = '' } = {}) => {
  const data = isObject(artifact?.evidence) ? artifact.evidence : artifact;
  const errors = validateDecisionContract(type, data, { requireV3: true });
  if (errors.length) throw new Error(`Invalid ${type} decision contract: ${errors.join('; ')}`);
  const sections = type === 'brainstorm' ? brainstormSections(data) : planSections(data);
  const title = data.title || data.outcome?.goal || data.decision?.question || humanize(type);
  const toc = sections
    .map((item) => `<a class="chip" href="#${slug(item.title)}">${escapeHtml(item.title)}</a>`)
    .join('');
  const body = sections
    .map((item) => `<section id="${slug(item.title)}"${item.className ? ` class="${item.className}"` : ''}><h2>${escapeHtml(item.title)}</h2>${item.body}</section>`)
    .join('\n');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(
    title,
  )}</title><style>${REVIEW_STYLE}</style></head><body class="review-${type}"><a class="skip" href="#main">Skip to content</a><header><div class="header-inner">${reviewHero(
    type,
    data,
  )}<nav aria-label="Review sections">${toc}</nav></div></header><main id="main">${body}</main><footer>${
    source ? `Generated from ${escapeHtml(source)} · ` : ''
  }JSON is the source of truth; this review page is generated.</footer></body></html>`;
};

const main = () => {
  const args = parseArgs(process.argv.slice(2));
  const type = args._[0];
  const input = args.input || args._[1];
  if (!['plan', 'brainstorm'].includes(type) || !input) {
    throw new Error('Usage: render-review.mjs <plan|brainstorm> --input <json-file> [--out <html-file>]');
  }
  const source = resolve(input);
  const artifact = JSON.parse(readFileSync(source, 'utf8'));
  const target = resolve(args.out || join(dirname(source), `${type}.html`));
  writeFileSync(target, renderReviewHtml(type, artifact, { source }));
  process.stdout.write(`${target}\n`);
};

if (isMainModule(import.meta.url)) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
