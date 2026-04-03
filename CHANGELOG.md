# Straw Hat Engineering Crew — Version History
**Author: Subash Karki**

Track every iteration to the `/team` skill (now `/team:<subcommand>`), crew flow, and governance model.

---

## v2.5 — Performance & Efficiency Overhaul + Board Updates (2026-04-02)

### What Changed

| Area | v2.4 | v2.5 |
|------|------|------|
| **Spawn decision** | Always spawn agents | Smart decision: inline (<50 lines, 1 file) vs delegate (multi-file, parallel) |
| **Max active agents** | Unlimited | Max 5 execution agents simultaneously |
| **Context loading** | All agents load all 5 shared tiers (~20K tokens each) | Lean loading: agents get persona + contract only; Luffy holds full context |
| **Model routing** | Franky/Nami/Sanji/Zoro on Opus | Execution agents on Sonnet; Opus for orchestration + quality only |
| **File isolation** | Human-enforced "no shared files" rule | System-enforced `isolation: "worktree"` on parallel agents |
| **Checkpointing** | None — no rollback | Snapshots at each phase transition for rollback |
| **Handoff targets** | Dynamic (Luffy decides each time) | Declared per agent (Franky→Zoro→Chopper→Roger→Sengoku) |
| **Context compaction** | None — context grows unbounded | Summarize after each phase to prevent window exhaustion |

### Estimated Impact
- **40-60% token cost reduction** from model routing (Sonnet vs Opus for execution)
- **60-75K tokens saved per session** from lean context loading
- **Fewer unnecessary spawns** from inline execution of small tasks

### New Model Tiers

| Tier | Agents | Rationale |
|---|---|---|
| **opus** | Luffy, Roger, Sengoku, Shanks | Orchestration, quality gates, architecture review |
| **sonnet** | Franky, Nami, Sanji, Zoro, Smoker + all allies | Scoped execution (upgrade if complex) |
| **haiku** | Chopper | Lint/build verification |

### Handoff Graph

```
Sanji → Franky → Zoro → Chopper → Roger → Sengoku
Nami  → Zoro ↗         ↗ (visual: Smoker)
```

### Files Modified
- `luffy.md` — Spawn decision function, model tiers, context management
- `_shared-crew.md` — Lean context loading, handoff targets, model registry, max agents rule
- `_shared-superpowers.md` — Worktree isolation in dispatch discipline
- `start.md` — Checkpointing, worktree dispatch
- `execute.md` — Worktree dispatch
- `franky.md`, `nami.md`, `sanji.md`, `zoro.md`, `chopper.md`, `roger.md` — handoff_targets frontmatter

---

## v2.4 — Superpowers Discipline Integration (2026-04-02)

### What Changed

| Area | v2.3 | v2.4 |
|------|------|------|
| **Planning discipline** | Ad-hoc plan structure | `superpowers:writing-plans` enforced — file mapping, bite-sized tasks, no placeholders, self-review |
| **Dispatch discipline** | "parallel where independent" (informal) | `superpowers:dispatching-parallel-agents` enforced — one agent per domain, no shared files, verify integration |
| **Debugging discipline** | Kureha classifies failures | `superpowers:systematic-debugging` — root-cause investigation BEFORE fixes, 3-failure architecture escalation |
| **Verification discipline** | Chopper runs commands | `superpowers:verification-before-completion` — evidence before claims, no "should pass" |
| **Approach exploration** | Single plan from Luffy | `superpowers:brainstorming` for complex features — 2-3 approaches with tradeoffs |
| **Luffy implementation** | Soft convention | Hard rule: NEVER implement code directly, always delegate |
| **Shared context tiers** | 4 tiers (_shared, crew, contracts, board) | 5 tiers (+_shared-superpowers.md) |

### New Shared Context Tier

| Tier | File | Loaded By |
|------|------|-----------|
| **Superpowers** | `_shared-superpowers.md` | start, execute, fix, verify |

Contains integration map (6 skills → 4 phases) + 4 discipline rule blocks (Planning, Dispatch, Debugging, Verification).

### Superpowers Integration Map

| Phase | Superpowers Skill | Trigger |
|-------|-------------------|---------|
| B (Planning) | `superpowers:writing-plans` | Always during plan creation |
| B (Planning) | `superpowers:brainstorming` | Complex features (risk >= medium) |
| D (Dispatch) | `superpowers:dispatching-parallel-agents` | 2+ independent agents |
| D (Dispatch) | `superpowers:subagent-driven-development` | Optional: spec + quality review |
| Fix Loop | `superpowers:systematic-debugging` | Every fix loop entry |
| Verify | `superpowers:verification-before-completion` | Every verification phase |

### Skills Evaluated but Skipped

| Skill | Why Skipped |
|-------|-------------|
| `test-driven-development` | Zoro already owns testing workflow |
| `executing-plans` | Team Phase D already handles execution |
| `using-git-worktrees` | Not part of team workflow |
| `finishing-a-development-branch` | Wrap phase already handles this |
| `requesting/receiving-code-review` | Roger already handles reviews |
| `explanatory-output-style` | Solo-session plugin — redundant with learnings system |

### Files Added/Modified

**New files:**
- `~/.claude/commands/team/_shared-superpowers.md` — Superpowers discipline context tier

**Modified files:**
- `~/.claude/commands/team/_shared.md` — Added Superpowers row to context tiers table
- `~/.claude/commands/team/start.md` — Planning discipline (Phase B) + dispatch discipline (Phase D)
- `~/.claude/commands/team/execute.md` — Dispatch discipline (Phase D)
- `~/.claude/commands/team/fix.md` — Debugging discipline before Kureha + architectural escalation
- `~/.claude/commands/team/verify.md` — Verification discipline after Roger gate
- `~/.claude/agents/straw-hat/luffy.md` — Added "NEVER IMPLEMENT CODE YOURSELF" as first critical rule
- `~/.claude/team/CHANGELOG.md` — This entry

---

## v2.3 — Marketplace Plugin Integration (2026-04-02)

### What Changed

| Area | v2.2 | v2.3 |
|------|------|------|
| **Silent failure detection** | None | Sengoku step 2b via `pr-review-toolkit:silent-failure-hunter` |
| **Type design quality** | None | Roger conditional via `pr-review-toolkit:type-design-analyzer` |
| **Comment accuracy** | None | Robin post-docs via `pr-review-toolkit:comment-analyzer` |
| **Git-history review** | None | Roger triple-lens #3 via `code-review` git-blame agents |
| **Multi-approach planning** | Single plan from Luffy | 2x `feature-dev:code-architect` agents in parallel |
| **Live docs** | Nami only | Franky, Sanji, Zoro all use `context7` MCP tools |

### New Files
- Marketplace Integration Map in `crew-handbook.md`
- ai-sdlc Dedup Guide in `crew-handbook.md`

---

## v2.2 — Full Crew Dashboard (2026-03-29)

### What Changed

| Area | v2.1 | v2.2 |
|------|------|------|
| **Board UI** | server.cjs (1700-line single-file HTML) | Vite + React + TypeScript app (`~/.claude/team/board-app/`) |
| **API server** | Raw Node.js http in server.cjs | Hono framework (`board-app/server/index.ts`) |
| **Rendering** | Server-rendered HTML string concatenation | React components with Motion animations |
| **Themes** | Dark + Light (CSS vars) | Dark + Light + Pirate (One Piece warm tones) |
| **Flow simulator** | Broken (script in innerHTML) | React Flow + Motion interactive 8-stage walkthrough |
| **Markdown** | Raw text / innerHTML | react-markdown for Captain's Log + Navigator's Notes |
| **Dropdowns** | Native `<select>` | Custom animated dropdowns with Motion |
| **Notifications** | None | SSE-powered toast notifications on new sessions |
| **Crew roster** | Static card grid | Click-to-popover with description, owns, skills, model |
| **Voyage Map** | Phase-per-column layout | Status-based kanban (Charted/Sailing/Inspection/Conquered) with expandable subtasks |
| **Session switching** | URL params only | Dropdown with status icons (✅⛵⏸️), persisted to localStorage |
| **server.cjs** | Primary (required) | Archived to `server.cjs.legacy` (fallback only) |

### New Architecture

```
~/.claude/team/board-app/
├── server/index.ts    # Hono API (port 3847) — reads ~/.claude/team/ files
├── src/
│   ├── App.tsx         # Shell: sticky header, tabs, theme toggle, dropdowns
│   ├── components/
│   │   ├── VoyageMap.tsx      # Kanban board (4 status columns)
│   │   ├── FlowSimulator.tsx  # React Flow + Motion 8-stage simulator
│   │   ├── CrewRoster.tsx     # Bento grid + detail popover
│   │   ├── CaptainsLog.tsx    # Side-nav + react-markdown chapters
│   │   ├── NavigatorNotes.tsx # Side-nav + markdown learnings
│   │   ├── PastVoyages.tsx    # Completed session cards
│   │   ├── Dropdown.tsx       # Custom animated dropdown
│   │   └── Toast.tsx          # SSE-powered notification system
│   ├── hooks/
│   │   ├── useApi.ts          # Fetch + SSE hooks (repo-aware)
│   │   └── useTheme.ts        # Dark/Light/Pirate theme cycling
│   ├── data/
│   │   ├── crew.ts            # 21 crew members + details
│   │   └── stages.ts          # 8 flow stages
│   └── types.ts               # API response types
├── package.json               # Vite + React + Hono + Motion + React Flow
└── vite.config.ts             # Proxy /api/* + /events to :3847
```

### Commands Updated

| Command | Before | After |
|---------|--------|-------|
| `/team:board` | `node server.cjs` on :3847 | `pnpm dev:all` → Hono :3847 + Vite :3848 |
| `/team:board-stop` | Kill :3847 | Kill :3847 + :3848 |

### Tech Stack

| Dependency | Purpose |
|-----------|---------|
| Vite 8 | Dev server + HMR |
| React 19 | UI framework |
| TypeScript 5.9 | Type safety |
| Hono 4 | API server (replaces raw http) |
| @xyflow/react | Flow simulator graph |
| motion | Page transitions, card animations, toast |
| react-markdown | Chapter + learnings rendering |
| tsx | TypeScript server runner |

---

## v2.1 — Fix Loop Integration (2026-03-28)

### What Changed

| Area | v2.0 (Contract-First) | v2.1 (Fix Loop Integration) |
|------|----------------------|------------------------------|
| **Verification** | Roger reviews (advisory/mandatory) | Structured verify phase with JSON result in session state |
| **Failure handling** | Ad-hoc — Luffy re-spawns agents manually | Formal fix loop: Kureha triages → scoped repairs → re-verify (max 3x) |
| **Repair coordination** | None — Luffy does everything | Kureha (new ally) creates fix packets with failure classification |
| **Hook checkpoints** | 4 (pre-plan, pre-execute, post-agent, pre-wrap) | 5 (+post-verify: routes to wrap or fix loop) |
| **Contracts** | 4 templates (feature, API, testing, UI) | 5 (+fix packet template) |
| **Allies** | 10 | 11 (+Kureha — Repair Coordinator) |
| **Commands** | 14 | 16 (+verify, fix) |
| **Phase transitions** | Implicit | Explicit state machine with allowed/blocked transitions |
| **Crew Flow tab** | Static diagram | Interactive 8-stage simulation with Back/Next/Reset/Auto-play |
| **Workflow patterns** | 5 | 6 (+fix loop) |
| **Board "How It Works"** | 4 cards | 5 (+Verify → Fix Loop card) |

### New Commands (v2.1)

| Command | Purpose |
|---------|---------|
| `/team:verify` | Run explicit verification (Zoro → Chopper → Roger), capture result in session JSON |
| `/team:fix` | Start fix loop from latest failed verification (blocks if no failures recorded) |

### New Agent (v2.1)

| Agent | Type | Specialty |
|-------|------|-----------|
| **Kureha** 🍶 | Ally | Verification triage, fix packets, failure classification, repair routing |

### Fix Loop Design

```
Execute → Verify
              ↓
         PASS → Sengoku/Wrap
         FAIL → Kureha diagnoses → fix packet → scoped repairs → re-verify
                    ↓ (max 3x)
              ESCALATE → ask user
```

**Failure classes:** `build` · `type` · `contract` · `ui` · `a11y` · `test` · `performance` · `docs` · `integration`

**Stop conditions:**
- Max 3 loops → escalate
- Same failure twice → write learning + escalate
- Contract must change → return to contract phase
- Scope expansion → return to planning

### Verification Result Schema (in session JSON)

```json
{
  "verification": {
    "status": "pass | fail",
    "loop": 0,
    "results": { "lint": "pass", "typecheck": "pass", "build": "pass", "tests": "pass", "roger": "skipped" },
    "failures": [{ "class": "type", "description": "...", "file": "...", "owner": "Franky", "pre_existing": false }]
  }
}
```

### Interactive Crew Flow Simulation

The Crew Flow tab is now an interactive 8-stage walkthrough:
1. **Setup** — Luffy loads context
2. **Planning** — Questions, codebase inventory, scouts
3. **Contracts** — Lock feature/API/testing/UI contracts
4. **Execute** — Core crew builds in parallel
5. **Verify** — Zoro tests, Chopper builds, Roger reviews
6. **Fix Loop** — Kureha triages (conditional, dashed border)
7. **Quality Gate** — Sengoku gauntlet
8. **Wrap** — Robin chronicles, learnings captured

Controls: ← Back · Next → · Reset · ▶ Auto-play (2s)

### YAGNI Decisions (proposed but cut)

| Proposal | Why cut |
|----------|---------|
| Named modes (Voyage, Buster Call, etc.) | Auto-detection already works — modes add selection overhead |
| `active-notes.md` | Duplicates session JSON — one source of truth |
| `latest-verification.json` (separate file) | Lives in session JSON instead |
| Brook repurposed as Repair Coordinator | Role conflict — Brook stays as design system ally |
| 7-phase flow (A-G) | Fix loop is a sub-cycle in verify, not a separate top-level phase |

### Files Added/Modified

**New files:**
- `~/.claude/agents/straw-hat/allies/kureha.md` — Repair Coordinator
- `.claude/contracts/fixes/_template.md` — Fix packet template
- `.claude/hooks/post-verify.md` — Post-verify routing hook
- `.claude/rules/phase-transitions.md` — State machine rules

**Modified files:**
- `~/.claude/commands/team.md` — v2.1 help, Kureha ally, Post-Verify Hook, Phase D fix loop, `/team:verify`, `/team:fix`
- `~/.claude/agents/straw-hat/luffy.md` — Kureha in Grand Fleet + model tiers
- `~/.claude/agents/straw-hat/crew-handbook.md` — Verify → Fix Loop section
- `~/.claude/team/server.cjs` — Kureha roster/details, new commands, fix contract, interactive crew flow simulation
- `~/.claude/team/CHANGELOG.md` — This entry

---

## v2.0 — Contract-First Governance (2026-03-28)

### What Changed

| Area | v1 (Session-Based) | v2 (Contract-First Governance) |
|------|--------------------|---------------------------------|
| **Execution gate** | Plan approval only | Contracts required before execution |
| **Lifecycle phases** | A (context) → B (plan) → C (execute) | A (context) → B (plan) → C (contract) → D (execute) |
| **Hook checkpoints** | None | Pre-plan, pre-execute, post-agent, pre-wrap |
| **Quality gates** | Roger review (advisory) | Roger + Sengoku (full gauntlet: simplify → review → verify) |
| **Contracts** | None | 4 templates: feature, API, testing, UI |
| **Contract storage** | N/A | `sessions/{ticket}/contracts/` + `.claude/contracts/` |
| **Evaluation** | None | Crew rubric scoring (1-5 per agent, per area) |
| **Allies** | 8 (Jinbe, Law, Shanks, Yamato, Vivi, Ace, Sabo, Marco) | 10 (+Brook, Jinbe-Data) |
| **Commands** | 9 (start, execute, resume, sessions, status, pause, wrap, learn, board) | 14 (+contract, scout, review, eval, recruit) |
| **Agent definitions** | Inline in server.cjs only | `.claude/agents/` files + AGENTS.md governance |
| **Skills** | Referenced ad-hoc | 7 formal skills in `.claude/skills/` |
| **Rules** | CLAUDE.md only | `.claude/rules/` (code-style, naming, repo-boundaries) |
| **Board tabs** | 5 (board, crew, history, story, learnings, flow) | 7 (+contracts tab) |
| **Persistence** | State, decisions, learnings | +Contracts, evaluations |
| **Workflow patterns** | 4 (feature, bug, review, refactor) | 5 (+contract-first) |

### New Commands (v2)

| Command | Purpose |
|---------|---------|
| `/team:contract <type>` | Create contract from template (feature, api, testing, ui) |
| `/team:scout [area]` | Run background scouts for missing context |
| `/team:review` | Trigger Roger quality gate on current work |
| `/team:eval` | Evaluate crew performance with rubric |
| `/team:recruit <ally>` | Bring in a temporary ally |

### New Agents (v2)

| Agent | Type | Specialty |
|-------|------|-----------|
| **Brook** | Ally | Design system consistency across surfaces |
| **Jinbe-Data** | Ally | Large schema, analytics, data contracts |

### Hook System (v2)

| Hook | Fires | Enforces |
|------|-------|----------|
| Pre-Plan | Before `/team:start` planning | Task classification, gap detection, scout decision |
| Pre-Execute | Before execution begins | Contract existence, owner assignment, skill listing |
| Post-Agent | After each agent completes | Output validation, handoff capture, downstream unblock |
| Pre-Wrap | Before `/team:wrap` | Implementation notes, test status, review status |

### Crew Flow Changes (v2)

**v1 Flow:**
```
You → /team:start → Luffy (plan) → Crew (execute) → Roger (review) → wrap
```

**v2 Flow:**
```
You → /team:start
  → Pre-Plan Hook (classify, detect gaps)
  → Luffy (plan + scout if needed)
  → Contract Phase (feature/api/testing/ui)
  → Pre-Execute Hook (blocks if contracts missing)
  → Crew (execute against contracts)
  → Post-Agent Hook (validate, handoff)
  → Roger/Sengoku (quality gate)
  → Pre-Wrap Hook (verify completeness)
  → Eval (crew scoring)
  → wrap (learnings + story)
```

### Files Added/Modified

**New files:**
- `.claude/AGENTS.md` — Operating model and governance
- `.claude/agents/*.md` — 9 core crew + 10 allies
- `.claude/contracts/` — 4 contract templates
- `.claude/hooks/` — 4 hook definitions
- `.claude/skills/` — 7 reusable skills
- `.claude/evals/evaluation.md` — Crew rubric
- `.claude/rules/` — 3 repo-wide rules

**Modified files:**
- `~/.claude/commands/team.md` — Full rewrite with contract-first governance
- `~/.claude/team/server.cjs` — New roster entries, commands, tabs, flow diagram

---

## v1.0 — Session-Based Crew (initial)

### Core Features
- Session lifecycle: start, execute, resume, pause, wrap
- Crew roster with personas (Luffy, Franky, Nami, Sanji, Zoro, Chopper, Robin, Usopp, Roger)
- 8 Grand Fleet allies (Jinbe, Law, Shanks, Yamato, Vivi, Ace, Sabo, Marco)
- Sengoku as quality gate (marine)
- Live board server on port 3847
- Captain's Log (Robin writes story chapters on wrap)
- Learnings system (patterns, corrections, habits)
- Decision trail (global + per-session)
- Multi-repo support
- Multi-session support with session switcher
- Board tabs: Voyage Map, Crew Roster, Past Voyages, Captain's Log, Navigator's Notes, Crew Flow

### Architecture
- All state in `~/.claude/team/repos/{REPO_NAME}/`
- Global story in `~/.claude/team/story/`
- Zero-dependency Node.js server
- SSE for real-time updates
- File watchers with debounced broadcasts

### Crew Flow
```
You → /team:start → Plan (Phase B) → Approve → Execute (Phase C)
  → Luffy coordinates → Fan-out to crew → Roger reviews → wrap
```
