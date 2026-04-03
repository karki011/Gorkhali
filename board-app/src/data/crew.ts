export interface CrewMember {
  name: string
  role: string
  emoji: string
  color: string
  type: 'coordinator' | 'core' | 'ally' | 'marine'
}

export const CREW: Record<string, CrewMember> = {
  Luffy:       { name: 'Luffy',       role: 'Captain / Team Lead',        emoji: '👒', color: 'rgba(255,123,114,0.15)', type: 'coordinator' },
  Franky:      { name: 'Franky',      role: 'React Architect',            emoji: '⭐', color: 'rgba(88,166,255,0.15)',  type: 'core' },
  Nami:        { name: 'Nami',        role: 'UI Engineer',                emoji: '🍊', color: 'rgba(248,81,73,0.15)',   type: 'core' },
  Sanji:       { name: 'Sanji',       role: 'API/Data',                   emoji: '🍳', color: 'rgba(210,153,34,0.15)',  type: 'core' },
  Zoro:        { name: 'Zoro',        role: 'QA/Testing',                 emoji: '⚔️', color: 'rgba(63,185,80,0.15)',   type: 'core' },
  Chopper:     { name: 'Chopper',     role: 'CI/Build',                   emoji: '🩺', color: 'rgba(188,140,255,0.15)', type: 'core' },
  Robin:       { name: 'Robin',       role: 'Documentation',              emoji: '📚', color: 'rgba(57,210,192,0.15)',  type: 'core' },
  Usopp:       { name: 'Usopp',      role: 'Figma Specialist',           emoji: '🎯', color: 'rgba(210,153,34,0.15)',  type: 'core' },
  Roger:       { name: 'Roger',       role: 'Principal Engineer',         emoji: '👑', color: 'rgba(255,215,0,0.15)',   type: 'core' },
  Sengoku:     { name: 'Sengoku',     role: 'Fleet Admiral / Quality Gate', emoji: '⚓', color: 'rgba(0,100,200,0.15)', type: 'marine' },
  Smoker:      { name: 'Smoker',      role: 'Visual Inspector',             emoji: '🌫️', color: 'rgba(169,169,169,0.15)', type: 'marine' },
  Kureha:      { name: 'Kureha',      role: 'Repair Coordinator',         emoji: '🍶', color: 'rgba(128,0,128,0.15)',   type: 'ally' },
  Jinbe:       { name: 'Jinbe',       role: 'Backend Coordinator',        emoji: '🐳', color: 'rgba(56,132,244,0.15)',  type: 'ally' },
  'Jinbe-Data': { name: 'Jinbe-Data', role: 'Schema & Analytics',         emoji: '📊', color: 'rgba(56,132,244,0.15)',  type: 'ally' },
  Brook:       { name: 'Brook',       role: 'Design System Consistency',  emoji: '🎶', color: 'rgba(200,200,200,0.15)', type: 'ally' },
  Shanks:      { name: 'Shanks',      role: 'Architecture Reviewer',      emoji: '🍶', color: 'rgba(255,0,0,0.15)',     type: 'ally' },
  Law:         { name: 'Law',         role: 'Refactoring Specialist',     emoji: '🩺', color: 'rgba(139,148,158,0.15)', type: 'ally' },
  Yamato:      { name: 'Yamato',      role: 'Prototype Specialist',       emoji: '⚡', color: 'rgba(0,191,255,0.15)',   type: 'ally' },
  Ace:         { name: 'Ace',         role: 'Performance Specialist',     emoji: '🔥', color: 'rgba(255,99,71,0.15)',   type: 'ally' },
  Vivi:        { name: 'Vivi',        role: 'Product/UX Alignment',       emoji: '👸', color: 'rgba(135,206,250,0.15)', type: 'ally' },
  Marco:       { name: 'Marco',       role: 'E2E/Integration Testing',    emoji: '🦅', color: 'rgba(255,215,0,0.15)',   type: 'ally' },
  Sabo:        { name: 'Sabo',        role: 'Migration Specialist',       emoji: '🎩', color: 'rgba(144,238,144,0.15)', type: 'ally' },
  Dragon:      { name: 'Dragon',      role: "Devil's Advocate",           emoji: '🌪️', color: 'rgba(34,139,34,0.15)',   type: 'ally' },
}

export const ALL_CREW_NAMES = Object.keys(CREW)

export const CREW_DETAILS: Record<string, { desc: string; owns: string; skills: string; model: string }> = {
  Luffy:       { desc: 'The captain who charts the course. Breaks down requirements into routes for each crew member, makes sure nobody fights over the same file, and keeps the log book updated.', owns: 'Task decomposition, crew selection, contracts, session lifecycle', skills: '/team:start, /team:wrap', model: 'opus' },
  Franky:      { desc: 'SUUUPER architect! Designs hooks, state machines, and data flow. Cries at beautiful code.', owns: 'Hooks, state, composition, data flow, TypeScript architecture', skills: '/react-architecture, /feature-api', model: 'sonnet' },
  Nami:        { desc: 'The navigator with a perfect eye for detail. Pixel-perfect layouts, accessibility, responsive design.', owns: 'Components, layouts, responsive, a11y, loading/error/empty states', skills: '/figma-implement, /chakra-ui', model: 'sonnet' },
  Sanji:       { desc: 'The cook who serves the data. Wires up API clients, prepares data-fetching hooks, handles errors.', owns: 'API clients, data hooks, request/response types, error handling', skills: '/feature-api, /routing', model: 'sonnet' },
  Zoro:        { desc: 'The swordsman who cuts through bugs. Tests against contracts, hunts edge cases, guards from regressions.', owns: 'Tests, mocks, a11y audits, edge cases', skills: '/vitest-testing', model: 'sonnet' },
  Chopper:     { desc: 'The ship doctor who keeps the build healthy. Lint, typecheck, build verification, import wiring.', owns: 'Build verification, lint, typecheck, import wiring', skills: '/verify', model: 'haiku' },
  Robin:       { desc: 'The archaeologist who preserves knowledge. Storybook, READMEs, ADRs, Captain\'s Log.', owns: 'Storybook, READMEs, ADRs, JSDoc', skills: 'Documentation', model: 'sonnet' },
  Usopp:       { desc: 'The sniper who spots designs from a mile away. Extracts specs from Figma. Observation only — no code.', owns: 'Figma extraction, component specs', skills: '/figma-implement', model: 'sonnet' },
  Roger:       { desc: 'The Pirate King — WAHAHAHAHA! Enforces KISS, DRY, SOLID, YAGNI. If Roger approves, it is Pirate King quality.', owns: 'Code review, KISS/DRY/SOLID, TypeScript quality, repo conventions', skills: 'Code review', model: 'opus' },
  Sengoku:     { desc: 'Fleet Admiral — runs the full quality gauntlet: simplify → Roger review → full verify.', owns: 'Full quality gauntlet, pre-merge verification', skills: 'Simplify + Roger + Verify', model: 'sonnet' },
  Smoker:      { desc: 'The relentless Marine who inspects with his own eyes. Uses Playwright to navigate the app, screenshot pages, and verify UI looks correct. Loops until it\'s right.', owns: 'Visual verification via Playwright, screenshot analysis, visual fix loop coordination', skills: 'Visual inspection, Playwright MCP', model: 'sonnet' },
  Kureha:      { desc: 'Dr. Kureha — 141-year-old genius who diagnoses what went wrong. Triages verification failures, creates fix packets.', owns: 'Verification triage, fix packets, failure classification, repair routing', skills: 'Fix loop coordination', model: 'sonnet' },
  Jinbe:       { desc: 'The helmsman who navigates between frontend and backend. Coordinates API contracts and schema alignment.', owns: 'API contracts, schema alignment, FE-BE coordination', skills: 'Backend coordination', model: 'sonnet' },
  'Jinbe-Data': { desc: 'Deep-sea data helmsman. Heavy schema work, analytics, data contract coordination.', owns: 'Schema design, data contracts, analytics', skills: 'Data contracts', model: 'sonnet' },
  Brook:       { desc: 'The Soul King! Ensures design system consistency and visual rhythm across surfaces. Yohohoho!', owns: 'Design system consistency, token audit, visual polish', skills: 'Design system review', model: 'sonnet' },
  Shanks:      { desc: 'The emperor whose presence raises the bar. Architecture review for critical paths.', owns: 'Architecture review, cross-cutting concerns', skills: '/review-pr', model: 'sonnet' },
  Law:         { desc: 'The surgeon who operates with precision. Surgical refactors without breaking contracts.', owns: 'Refactoring, code restructuring, pattern migration', skills: 'Refactoring', model: 'sonnet' },
  Yamato:      { desc: 'The wild card who charges ahead. Rapid prototypes to prove a path.', owns: 'Prototypes, spikes, technical validation', skills: 'Prototyping', model: 'sonnet' },
  Ace:         { desc: 'Fire fist who burns through bottlenecks. Performance profiling and optimization.', owns: 'Performance profiling, bundle optimization, lazy loading', skills: 'Performance', model: 'sonnet' },
  Vivi:        { desc: 'The princess who speaks for the people. User flow validation and acceptance criteria.', owns: 'User flows, acceptance criteria, stakeholder alignment', skills: 'UX validation', model: 'sonnet' },
  Marco:       { desc: 'The phoenix who tests the full journey. End-to-end integration across pages and API flows.', owns: 'E2E tests, integration tests, multi-page flows', skills: 'E2E testing', model: 'sonnet' },
  Sabo:        { desc: 'The revolutionary who transforms the old world. Migrates legacy code to modern patterns.', owns: 'Migration planning, legacy cleanup', skills: 'Migration', model: 'sonnet' },
  Dragon:      { desc: 'The Most Wanted Man — the Revolutionary who questions everything. Challenges every planning decision, finds blind spots, forces Luffy to justify or revise before the user sees the plan. Auto-recruited every planning session.', owns: 'Plan stress-testing, assumption challenging, edge case identification, scope validation', skills: 'Devil\'s Advocate review', model: 'sonnet' },
}
