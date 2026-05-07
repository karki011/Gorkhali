# Phantom Works Crew -- Superpowers Discipline Context

> Loaded by commands that benefit from superpowers discipline enforcement.
> Always load `_shared.md` first.

---

## Superpowers Integration Map

These skills provide **discipline enforcement** at specific workflow phases.
The orchestrator invokes them by name -- do NOT duplicate their content here.

| Phase | Gap Addressed | Superpowers Skill | Trigger |
|-------|---------------|-------------------|---------|
| **B (Planning)** | Ad-hoc plan structure, no file mapping | `superpowers:writing-plans` | **INVOKE via Skill tool** at start of Phase B, before Explore/Plan agents |
| **B (Planning)** | No structured approach exploration | `superpowers:brainstorming` | Complex features (risk >= medium OR multiple subsystems) |
| **D (Dispatch)** | No formal agent isolation rules | `superpowers:dispatching-parallel-agents` | When spawning 2+ independent agents |
| **D (Dispatch)** | No two-stage review model | `superpowers:subagent-driven-development` | Optional: for spec-compliance + quality review pattern |
| **D→Fix** | No root-cause methodology | `superpowers:systematic-debugging` | Every fix loop entry (before Cortex (triage) triage) |
| **Verify** | No evidence-before-claims discipline | `superpowers:verification-before-completion` | Every verification phase, before any PASS/FAIL claim |

---

## Discipline Rules

### 1. Planning Discipline (Phase B)

> Source: `superpowers:writing-plans` + `superpowers:brainstorming`

- Plans MUST include a **File Structure section** mapping exact paths before task decomposition
- Tasks MUST be **bite-sized** (2-5 minutes each, one action per step)
- Plans MUST NOT contain **placeholders** (TBD, TODO, "similar to Task N", "add appropriate handling")
- After writing the plan, run **Self-Review**: spec coverage, placeholder scan, type consistency
- For complex features (risk >= medium): propose **2-3 approaches** with tradeoffs before settling on one

### 2. Dispatch Discipline (Phase D)

> Source: `superpowers:dispatching-parallel-agents`

- **One agent per independent problem domain**
- **No shared files** between parallel agents -- if two agents need the same file, run them sequentially or split the file first
- Each agent prompt MUST be: **focused** (one domain), **self-contained** (all needed context), **specific about output**
- For parallel agents that modify files: use `isolation: "worktree"` on the Agent tool call for system-enforced file isolation
- After all parallel agents return: **verify integration** -- check for conflicts, run full suite

### 3. Debugging Discipline (Fix Loop)

> Source: `superpowers:systematic-debugging`

- **Iron Law:** NO FIXES WITHOUT ROOT CAUSE INVESTIGATION FIRST
- Four phases: **Root Cause** -> **Pattern Analysis** -> **Hypothesis** -> **Implementation**
- Read error messages completely (stack traces, line numbers, exit codes)
- Form **single hypothesis**, test minimally, **one variable at a time**
- If **3+ fixes have failed** on the same issue: **STOP** -- question the architecture, escalate to user
- Never bundle multiple fixes. One change at a time.

### 4. Verification Discipline

> Source: `superpowers:verification-before-completion`

- **Iron Law:** NO COMPLETION CLAIMS WITHOUT FRESH VERIFICATION EVIDENCE
- Gate function: **IDENTIFY** command -> **RUN** it -> **READ** full output -> **VERIFY** claim matches -> **THEN** claim
- Red flags that mean STOP: "should pass", "probably works", "looks correct", any satisfaction before verification
- Agent success reports MUST be **independently verified** -- trust output, not reports
- Skip any step = lying, not verifying
