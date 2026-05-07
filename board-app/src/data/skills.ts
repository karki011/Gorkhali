// =============================================================================
// Phantom Works Board — Skills Data
// Author: Subash Karki
//
// Hardcoded registry of all /team:* slash commands.
// =============================================================================

export interface Skill {
  name: string
  command: string
  description: string
  category: 'workflow' | 'board' | 'quality' | 'session'
}

export const SKILLS: Skill[] = [
  { name: 'Start',    command: '/team:start',    description: 'Plan → contracts → approve → execute a new task',         category: 'workflow' },
  { name: 'Execute',  command: '/team:execute',  description: 'Execute a saved plan (blocks without contracts)',          category: 'workflow' },
  { name: 'Contract', command: '/team:contract', description: 'Create contract from template (feature/api/testing/ui)',   category: 'workflow' },
  { name: 'Scout',    command: '/team:scout',    description: 'Run background scouts for missing context',                category: 'workflow' },
  { name: 'Recruit',  command: '/team:recruit',  description: 'Spawn a specialized Spark with ROLE FOCUS',               category: 'workflow' },
  { name: 'Verify',   command: '/team:verify',   description: 'Run verification: Sentinel (build) → Prism (review)',     category: 'quality' },
  { name: 'Fix',      command: '/team:fix',      description: 'Start fix loop from latest failed verification',           category: 'quality' },
  { name: 'Review',   command: '/team:review',   description: 'Trigger Prism quality gate on current work',              category: 'quality' },
  { name: 'Visual',   command: '/team:visual',   description: 'Trigger Lens visual inspection on current task',          category: 'quality' },
  { name: 'Validate', command: '/team:validate', description: 'Run validation checks (plan/output/session/all)',          category: 'quality' },
  { name: 'Eval',     command: '/team:eval',     description: 'Evaluate crew performance with rubric',                   category: 'quality' },
  { name: 'Status',   command: '/team:status',   description: 'Current task board',                                      category: 'board' },
  { name: 'Board',    command: '/team:board',    description: 'Start live board server + open browser',                  category: 'board' },
  { name: 'Sessions', command: '/team:sessions', description: 'List all sessions with status',                           category: 'session' },
  { name: 'Pause',    command: '/team:pause',    description: 'Quick save — step away',                                  category: 'session' },
  { name: 'Resume',   command: '/team:resume',   description: 'Resume a paused/wrapped session',                         category: 'session' },
  { name: 'Wrap',     command: '/team:wrap',     description: 'Full shutdown with learnings + eval',                     category: 'session' },
  { name: 'Learn',    command: '/team:learn',    description: 'Capture a learning mid-session',                          category: 'session' },
]
