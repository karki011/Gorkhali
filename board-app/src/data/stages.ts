/**
 * Flow and Stage definitions for the Phantom Works Flow Simulator.
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

// --- 1. Feature Flow (/team:start) ---
const FEATURE_STAGES: Stage[] = [
  {
    id: 'setup',
    label: 'A: Context',
    active: ['Cortex'],
    optional: [],
    desc: 'Cortex loads context: git branch, learnings, domain classification. Starts board server, runs Pre-Plan Hook to classify task type and risk.',
    conditional: false,
  },
  {
    id: 'planning',
    label: 'B: Planning',
    active: ['Cortex'],
    optional: ['Oracle'],
    desc: 'Cortex captures Intent, runs anti-repetition check against learnings + decisions.ndjson, spawns Explore (opus) scouts for codebase research. Decomposition validation + Red Team review (risk >= medium). Emits DECISION:route event.',
    conditional: false,
  },
  {
    id: 'contracts',
    label: 'C: Contracts',
    active: ['Cortex'],
    optional: [],
    desc: 'Contracts created from templates. Pre-Execute Hook blocks if contracts incomplete. User confirms "Execute now".',
    conditional: false,
  },
  {
    id: 'antirepetition',
    label: 'Pre-Execute',
    active: ['Cortex'],
    optional: [],
    desc: 'Anti-Repetition Loader runs: scans learnings corrections + decisions.ndjson failures. Builds Anti-Repetition Block injected into every agent prompt.',
    conditional: false,
  },
  {
    id: 'execute',
    label: 'D: Execute',
    active: ['Spark'],
    optional: ['Oracle'],
    desc: 'Spark instances build against contracts with ROLE FOCUS directives. Oracle on-demand for hard decisions (max 3 calls each). Assembly consistency check after 2+ agents complete.',
    conditional: false,
  },
  {
    id: 'verify',
    label: 'Verify',
    active: ['Sentinel'],
    optional: [],
    desc: 'Sentinel runs full verification: lint, typecheck, build, tests. State checkpoint saved before transition.',
    conditional: false,
  },
  {
    id: 'fixloop',
    label: 'Fix Loop',
    active: ['Cortex', 'Spark'],
    optional: [],
    desc: 'Cortex (triage) diagnoses failures, creates scoped repair assignments. Spark fixes only the failing scope. Max 3 loops. Same failure twice → writes correction to learnings + escalates.',
    conditional: true,
  },
  {
    id: 'quality',
    label: 'Quality Gate',
    active: ['Prism'],
    optional: [],
    desc: 'Prism runs quality gauntlet (risk >= medium) or advisory review (low risk). Simplify → code review → full verify. If Prism approves, it ships.',
    conditional: false,
  },
  {
    id: 'visual',
    label: 'Visual Check',
    active: ['Lens'],
    optional: ['Spark'],
    desc: 'Lens uses Playwright to navigate app, take screenshots, verify UI against specs. Spark fixes visual issues. Max 3 loops.',
    conditional: true,
  },
  {
    id: 'outcome',
    label: 'Outcome',
    active: ['Cortex'],
    optional: [],
    desc: 'Cortex emits DECISION:outcome event (route, outcome, fix loops, corrections). Learnings updated. Session archived.',
    conditional: false,
  },
]

// --- 2. Bug Fix Flow ---
const BUGFIX_STAGES: Stage[] = [
  {
    id: 'setup',
    label: 'A: Context',
    active: ['Cortex'],
    optional: [],
    desc: 'Cortex loads context: git branch, learnings. Classifies as bug fix workflow.',
    conditional: false,
  },
  {
    id: 'scout',
    label: 'B: Scout',
    active: ['Cortex'],
    optional: ['Oracle'],
    desc: 'Cortex investigates the bug with scout agents. Red Team challenges diagnosis — root cause or symptom?',
    conditional: false,
  },
  {
    id: 'execute',
    label: 'C: Execute',
    active: ['Spark'],
    optional: ['Oracle'],
    desc: 'Spark (Solo) applies targeted fix. Minimal scope — one concern, no refactoring. Oracle available for hard decisions.',
    conditional: false,
  },
  {
    id: 'verify',
    label: 'D: Verify',
    active: ['Sentinel'],
    optional: [],
    desc: 'Sentinel validates fix with regression tests + full build verification.',
    conditional: false,
  },
  {
    id: 'fixloop',
    label: 'Fix Loop',
    active: ['Cortex', 'Spark'],
    optional: [],
    desc: 'Cortex triages remaining failures. Spark applies scoped repairs. Max 3 loops.',
    conditional: true,
  },
  {
    id: 'outcome',
    label: 'E: Outcome',
    active: ['Cortex'],
    optional: [],
    desc: 'Cortex logs the fix. Root cause + solution captured. DECISION:outcome emitted. Session archived.',
    conditional: false,
  },
]

// --- 3. Refactor Flow ---
const REFACTOR_STAGES: Stage[] = [
  {
    id: 'setup',
    label: 'A: Context',
    active: ['Cortex'],
    optional: [],
    desc: 'Cortex loads context: identifies refactor scope, reads current patterns and architecture.',
    conditional: false,
  },
  {
    id: 'planning',
    label: 'B: Planning',
    active: ['Cortex'],
    optional: ['Oracle'],
    desc: 'Cortex plans refactor scope. Red Team challenges — is this refactor necessary? Boundaries right? Rollback strategy solid? Oracle consulted for architecture decisions.',
    conditional: false,
  },
  {
    id: 'contracts',
    label: 'C: Contracts',
    active: ['Cortex'],
    optional: [],
    desc: 'Contracts lock existing behavior before changes. Contract tests ensure behavior preserved.',
    conditional: false,
  },
  {
    id: 'execute',
    label: 'D: Execute',
    active: ['Spark'],
    optional: [],
    desc: 'Spark (Refactoring focus) performs surgical restructuring. Behavior must not change.',
    conditional: false,
  },
  {
    id: 'verify',
    label: 'E: Verify',
    active: ['Sentinel', 'Prism'],
    optional: [],
    desc: 'Sentinel validates all contract tests pass + full build. Prism reviews for KISS/DRY/SOLID compliance.',
    conditional: false,
  },
  {
    id: 'quality',
    label: 'F: Quality Gate',
    active: ['Prism'],
    optional: [],
    desc: 'Prism runs full gauntlet — refactors are high-risk. Simplify → code review → full verify.',
    conditional: false,
  },
  {
    id: 'outcome',
    label: 'G: Outcome',
    active: ['Cortex'],
    optional: [],
    desc: 'Cortex logs the refactor. Architecture decisions documented. DECISION:outcome emitted. Session archived.',
    conditional: false,
  },
]

// --- 4. Spike/Prototype Flow ---
const SPIKE_STAGES: Stage[] = [
  {
    id: 'setup',
    label: 'A: Context',
    active: ['Cortex'],
    optional: [],
    desc: 'Cortex loads context: identifies the spike question and success criteria.',
    conditional: false,
  },
  {
    id: 'planning',
    label: 'B: Planning',
    active: ['Cortex', 'Oracle'],
    optional: [],
    desc: 'Cortex + Oracle scope the spike. Is the hypothesis right? Timebox realistic? Oracle provides architecture guidance upfront.',
    conditional: false,
  },
  {
    id: 'execute',
    label: 'C: Execute',
    active: ['Spark'],
    optional: ['Oracle'],
    desc: 'Spark (Prototyping focus) rapid-prototypes the solution. Speed over polish — prove the path works.',
    conditional: false,
  },
  {
    id: 'review',
    label: 'D: Review',
    active: ['Prism'],
    optional: [],
    desc: 'Prism advisory review — not a hard gate. Evaluates feasibility and flags risks for production path.',
    conditional: false,
  },
  {
    id: 'outcome',
    label: 'E: Outcome',
    active: ['Cortex'],
    optional: [],
    desc: 'Cortex logs findings and spike outcome. No quality gauntlet — this is exploratory. DECISION:outcome emitted.',
    conditional: false,
  },
]

// --- 5. Quick Fix Flow (/team:quick) ---
const QUICKFIX_STAGES: Stage[] = [
  {
    id: 'execute',
    label: 'A: Execute',
    active: ['Spark'],
    optional: ['Oracle'],
    desc: 'Spark (Solo) applies the fix directly. Minimal scope — one file, one concern. Oracle available if stuck.',
    conditional: false,
  },
  {
    id: 'verify',
    label: 'B: Verify',
    active: ['Sentinel'],
    optional: [],
    desc: 'Sentinel runs lint + typecheck + build. Lightweight verification.',
    conditional: false,
  },
  {
    id: 'outcome',
    label: 'C: Outcome',
    active: ['Cortex'],
    optional: [],
    desc: 'Minimal log entry. DECISION:outcome emitted. Session archived.',
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
