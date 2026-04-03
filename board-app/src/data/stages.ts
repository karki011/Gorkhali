/**
 * Flow and Stage definitions for the Straw Hat Crew Flow Simulator.
 * @author Subash Karki
 */

export interface Stage {
  id: string
  label: string
  active: string[]
  optional: string[]
  desc: string
  conditional: boolean
}

export interface Flow {
  id: string
  label: string
  icon: string
  desc: string
  stages: Stage[]
}

// --- 1. Feature Flow (existing /team:start) ---
const FEATURE_STAGES: Stage[] = [
  {
    id: 'setup',
    label: 'A: Setup',
    active: ['Luffy'],
    optional: [],
    desc: 'Luffy loads context: git branch → Jira ticket, reads CLAUDE.md, checks Obsidian vault, detects workflow type. Runs spawn decision function to determine inline vs delegate.',
    conditional: false,
  },
  {
    id: 'planning',
    label: 'B: Planning',
    active: ['Luffy', 'Dragon'],
    optional: ['Usopp', 'Jinbe'],
    desc: 'Luffy drafts the plan, then Dragon (Devil\'s Advocate) stress-tests it — challenging assumptions, finding blind spots, and questioning scope before user approval',
    conditional: false,
  },
  {
    id: 'contracts',
    label: 'C: Contracts',
    active: ['Luffy'],
    optional: [],
    desc: 'Feature/API/Testing/UI contracts created from templates. Pre-Execute Hook blocks if contracts incomplete.',
    conditional: false,
  },
  {
    id: 'execute',
    label: 'D: Execute',
    active: ['Franky', 'Nami', 'Sanji', 'Zoro'],
    optional: [],
    desc: 'Crew builds against locked contracts. Max 5 agents active. Worktree isolation for parallel agents. Lean context: agents get persona + contract only. Post-Agent Hook validates each output.',
    conditional: false,
  },
  {
    id: 'verify',
    label: 'Verify',
    active: ['Zoro', 'Chopper', 'Roger'],
    optional: [],
    desc: 'State checkpoint saved before transition. Zoro validates test coverage. Chopper runs lint + typecheck + build + tests. Roger reviews quality. Evidence before claims — no "should pass".',
    conditional: false,
  },
  {
    id: 'fixloop',
    label: 'Fix Loop',
    active: ['Kureha'],
    optional: ['Franky', 'Nami', 'Sanji', 'Zoro'],
    desc: 'Systematic debugging discipline: root cause BEFORE fixes. Kureha classifies failures, creates fix packet. 3+ fixes on same issue → question architecture. Max 3 loops before escalation.',
    conditional: true,
  },
  {
    id: 'quality',
    label: 'Quality Gate',
    active: ['Sengoku', 'Roger'],
    optional: [],
    desc: 'Sengoku simplifies code → Roger reviews diff → Full verify. Plan + session validators run. Clears for visual check or user testing.',
    conditional: false,
  },
  {
    id: 'visual',
    label: 'Visual Check',
    active: ['Smoker'],
    optional: ['Nami', 'Franky'],
    desc: 'Smoker uses Playwright MCP to navigate app (localhost:8080), take screenshots, and verify UI. Loops with Nami/Franky to fix visual issues. Max 3 loops.',
    conditional: true,
  },
  {
    id: 'wrap',
    label: 'Wrap',
    active: ['Robin', 'Luffy'],
    optional: [],
    desc: 'Robin writes Captain\'s Log chapter. Learnings/corrections/habits updated. Session archived.',
    conditional: false,
  },
]

// --- 2. Bug Fix Flow ---
const BUGFIX_STAGES: Stage[] = [
  {
    id: 'setup',
    label: 'A: Setup',
    active: ['Luffy'],
    optional: [],
    desc: 'Luffy loads context: git branch, Jira ticket, reads CLAUDE.md. Detects this is a bug fix workflow.',
    conditional: false,
  },
  {
    id: 'scout',
    label: 'B: Scout',
    active: ['Luffy', 'Dragon'],
    optional: ['Usopp', 'Jinbe'],
    desc: 'Luffy + scouts investigate the bug. Dragon challenges the diagnosis — is this the root cause or just a symptom?',
    conditional: false,
  },
  {
    id: 'execute',
    label: 'C: Execute',
    active: ['Franky', 'Nami', 'Sanji'],
    optional: [],
    desc: 'Targeted fix by the agent who owns the affected area. Scoped to minimal change — no refactoring.',
    conditional: false,
  },
  {
    id: 'verify',
    label: 'D: Verify',
    active: ['Zoro', 'Chopper'],
    optional: [],
    desc: 'Zoro validates the fix with regression tests. Chopper runs lint + typecheck + build + tests.',
    conditional: false,
  },
  {
    id: 'fixloop',
    label: 'Fix Loop',
    active: ['Kureha'],
    optional: ['Franky', 'Nami', 'Sanji'],
    desc: 'Kureha classifies remaining failures, creates fix packet. Max 3 loops before escalation.',
    conditional: true,
  },
  {
    id: 'wrap',
    label: 'E: Wrap',
    active: ['Robin', 'Luffy'],
    optional: [],
    desc: 'Robin logs the fix. Root cause + solution captured in fix journal. Session archived.',
    conditional: false,
  },
]

// --- 3. Refactor Flow ---
const REFACTOR_STAGES: Stage[] = [
  {
    id: 'setup',
    label: 'A: Setup',
    active: ['Luffy'],
    optional: [],
    desc: 'Luffy loads context: identifies refactor scope, reads current patterns and architecture.',
    conditional: false,
  },
  {
    id: 'planning',
    label: 'B: Planning',
    active: ['Luffy', 'Law', 'Dragon'],
    optional: [],
    desc: 'Luffy + Law plan the refactor scope. Dragon challenges — is this refactor necessary? Are boundaries right? Rollback strategy solid?',
    conditional: false,
  },
  {
    id: 'contracts',
    label: 'C: Contracts',
    active: ['Luffy'],
    optional: [],
    desc: 'Feature + Testing contracts ensure behavior is preserved. Contract tests lock existing behavior before changes.',
    conditional: false,
  },
  {
    id: 'execute',
    label: 'D: Execute',
    active: ['Law'],
    optional: ['Franky'],
    desc: 'Law performs surgical refactoring. Franky assists with architecture restructuring. Behavior must not change.',
    conditional: false,
  },
  {
    id: 'verify',
    label: 'E: Verify',
    active: ['Zoro', 'Chopper', 'Roger'],
    optional: [],
    desc: 'Zoro validates all contract tests pass. Chopper runs full build. Roger reviews for KISS/DRY/SOLID compliance.',
    conditional: false,
  },
  {
    id: 'quality',
    label: 'F: Quality Gate',
    active: ['Sengoku', 'Roger'],
    optional: [],
    desc: 'Sengoku runs full quality gauntlet — refactors are high-risk. Simplify → Roger review → Full verify.',
    conditional: false,
  },
  {
    id: 'wrap',
    label: 'G: Wrap',
    active: ['Robin', 'Luffy'],
    optional: [],
    desc: 'Robin logs the refactor. Architecture decisions documented. Session archived.',
    conditional: false,
  },
]

// --- 4. Spike/Prototype Flow ---
const SPIKE_STAGES: Stage[] = [
  {
    id: 'setup',
    label: 'A: Setup',
    active: ['Luffy'],
    optional: [],
    desc: 'Luffy loads context: identifies the spike question and success criteria.',
    conditional: false,
  },
  {
    id: 'planning',
    label: 'B: Planning',
    active: ['Luffy', 'Yamato', 'Dragon'],
    optional: [],
    desc: 'Luffy + Yamato scope the spike. Dragon challenges — are we testing the right hypothesis? Is the timebox realistic?',
    conditional: false,
  },
  {
    id: 'execute',
    label: 'C: Execute',
    active: ['Yamato'],
    optional: [],
    desc: 'Yamato rapid-prototypes the solution. Speed over polish — prove the path works.',
    conditional: false,
  },
  {
    id: 'review',
    label: 'D: Review',
    active: ['Roger'],
    optional: [],
    desc: 'Roger advisory review — not a hard gate. Evaluates feasibility and flags risks for production path.',
    conditional: false,
  },
  {
    id: 'wrap',
    label: 'E: Wrap',
    active: ['Robin', 'Luffy'],
    optional: [],
    desc: 'Robin logs findings and spike outcome. No quality gauntlet needed — this is exploratory.',
    conditional: false,
  },
]

// --- 5. Quick Fix Flow (/team:quick) ---
const QUICKFIX_STAGES: Stage[] = [
  {
    id: 'execute',
    label: 'A: Execute',
    active: ['Franky'],
    optional: ['Nami', 'Sanji'],
    desc: 'Single agent applies the fix directly. Minimal scope — one file, one concern.',
    conditional: false,
  },
  {
    id: 'verify',
    label: 'B: Verify',
    active: ['Chopper'],
    optional: [],
    desc: 'Chopper only — runs lint + typecheck + build. Lightweight verification.',
    conditional: false,
  },
  {
    id: 'wrap',
    label: 'C: Wrap',
    active: ['Robin'],
    optional: [],
    desc: 'Minimal log entry. Session archived with one-liner summary.',
    conditional: false,
  },
]

// --- All Flows ---
export const FLOWS: Flow[] = [
  {
    id: 'feature',
    label: 'Feature',
    icon: '🚀',
    desc: 'Full feature development — /team:start',
    stages: FEATURE_STAGES,
  },
  {
    id: 'bugfix',
    label: 'Bug Fix',
    icon: '🐛',
    desc: 'Targeted bug investigation and fix',
    stages: BUGFIX_STAGES,
  },
  {
    id: 'refactor',
    label: 'Refactor',
    icon: '🔧',
    desc: 'Surgical code restructuring with safety nets',
    stages: REFACTOR_STAGES,
  },
  {
    id: 'spike',
    label: 'Spike',
    icon: '⚡',
    desc: 'Rapid prototype to prove a path',
    stages: SPIKE_STAGES,
  },
  {
    id: 'quickfix',
    label: 'Quick Fix',
    icon: '💨',
    desc: 'Minimal fix — /team:quick',
    stages: QUICKFIX_STAGES,
  },
]

// Backwards-compatible alias — points to the Feature flow stages
export const STAGES: Stage[] = FLOWS[0].stages
