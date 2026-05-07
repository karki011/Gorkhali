export interface CrewMember {
  name: string
  role: string
  emoji: string
  color: string
  type: 'coordinator' | 'core' | 'ally' | 'marine'
}

export const CREW: Record<string, CrewMember> = {
  Cortex:      { name: 'Cortex',      role: 'Team Lead / Orchestrator',     emoji: '🧠', color: 'rgba(255,123,114,0.15)', type: 'coordinator' },
  Spark:       { name: 'Spark',       role: 'Implementation Engineer',      emoji: '⚡', color: 'rgba(88,166,255,0.15)',  type: 'core' },
  Sentinel:    { name: 'Sentinel',    role: 'QA / Build Verification',      emoji: '🛡️', color: 'rgba(63,185,80,0.15)',   type: 'core' },
  Prism:       { name: 'Prism',       role: 'Quality Gate / Code Review',   emoji: '🔷', color: 'rgba(188,140,255,0.15)', type: 'core' },
  Oracle:      { name: 'Oracle',      role: 'On-Demand Advisor',            emoji: '🔮', color: 'rgba(255,215,0,0.15)',   type: 'core' },
  Lens:        { name: 'Lens',        role: 'Visual Pipeline / Figma + Playwright', emoji: '🔍', color: 'rgba(210,153,34,0.15)',  type: 'core' },
}

export const ALL_CREW_NAMES = Object.keys(CREW)

export const CREW_DETAILS: Record<string, { desc: string; owns: string; skills: string; model: string }> = {
  Cortex:      { desc: 'The orchestrator who charts the course. Breaks down requirements into tasks for each crew member, ensures no file ownership conflicts, and manages session lifecycle.', owns: 'Task decomposition, crew selection, contracts, session lifecycle', skills: '/team:start, /team:wrap', model: 'opus' },
  Spark:       { desc: 'The implementation engine. Spawned with ROLE FOCUS directives for specialization — React Architecture, UI Engineering, API Integration, Refactoring, Performance, Migration, Backend Coordination, Prototyping, Product Alignment, Documentation, or E2E Testing.', owns: 'All implementation — hooks, state, components, APIs, refactoring, performance, migration, prototyping, docs', skills: '/feature-api, /figma-implement', model: 'sonnet' },
  Sentinel:    { desc: 'The quality shield. Tests against contracts, hunts edge cases, guards from regressions, and runs the full build verification pipeline.', owns: 'Tests, mocks, a11y audits, edge cases, lint, typecheck, build verification', skills: '/verify, /vitest-testing', model: 'sonnet' },
  Prism:       { desc: 'The quality gate — enforces KISS, DRY, SOLID, YAGNI. Runs the full gauntlet: simplify, code review, full verify. If Prism approves, it ships.', owns: 'Code review, KISS/DRY/SOLID, TypeScript quality, repo conventions, full quality gauntlet', skills: 'Code review, Simplify + Verify', model: 'opus' },
  Oracle:      { desc: 'The decisive advisor. Provides short, structured guidance when Spark agents hit hard decisions. No tools, no code — just clear direction in under 100 words.', owns: 'On-demand guidance, decision framework, architecture advice', skills: 'Advisory guidance', model: 'opus' },
  Lens:        { desc: 'The visual inspector. Extracts specs from Figma designs and verifies built UI matches using Playwright screenshots. Observation only — no code.', owns: 'Figma extraction, component specs, visual verification via Playwright, screenshot analysis', skills: '/figma-implement, Visual inspection, Playwright MCP', model: 'sonnet' },
}
