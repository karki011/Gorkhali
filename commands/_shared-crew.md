# Team Skill — Crew Context

> Loaded by commands that spawn agents. Always load `_shared.md` first.

---

## Agent Registry

| Codename | Default Model | Role |
|----------|---------------|------|
| **Cortex** | opus | Plans, decomposes, coordinates, triages failures |
| **Spark** | sonnet | All implementation — spawned with ROLE FOCUS directives |
| **Sentinel** | sonnet | Repo-aware verification — discovers lint/build/test commands from repo context, runs them, reports evidence |
| **Prism** | opus | Quality gate — code review + gauntlet + architecture |
| **Oracle** | opus | On-demand guidance for Sparks (no tools, no output, <100 words) |
| **Lens** | sonnet | Figma extraction + visual verification (agent-browser preferred, Playwright fallback) |

### Model Override

Background agents can be spawned with a non-default model when the user requests it (e.g., "use opus for sparks", "spawn with sonnet").

**Supported values:** `opus` (Opus 4.6 with 1M context), `sonnet` (Sonnet 4.6 with 1M context)

**HARD RULE:** NEVER use model 4.7 variants — they are too slow. Only `"opus"` and `"sonnet"` (both resolve to 4.6).

**How to apply:**
- If the user specifies a model preference at session start or in a `/team:start` invocation, use that model for ALL background agent spawns regardless of the default in the registry above.
- If the user says "use opus" → all Spark/Sentinel/Lens agents spawn with `model: "opus"` instead of sonnet.
- If the user says "use sonnet" → all Prism/Oracle agents spawn with `model: "sonnet"` instead of opus.
- If no override → use the default model from the registry.
- The override applies to the current session only. It does NOT persist across sessions unless the user explicitly asks to remember it.

**In Agent() calls**, always set `model` to the resolved value:
```
model: "{user_override || registry_default}"
```

### Agent Spawning Rules

- Set `subagent_type` matching codename (e.g., `coder` for Spark, `verifier` for Sentinel, `reviewer` for Prism)
- Set `model` to the user's override if provided, otherwise the agent's default model from the registry
- Include in prompt: persona, assigned scope, contract section, relevant learnings
- **Include compact Intent Block in EVERY agent prompt:**
  `INTENT: [goal]. PRIORITY: [ranked priorities]. NON-NEGOTIABLE: [hard constraints].`
  Agents resolve ambiguity in favor of the stated priority.
- **For Spark instances, include ROLE FOCUS:** `ROLE FOCUS: [specialization]. [domain-specific instructions].`
- **Inject Anti-Repetition Signals into EVERY agent prompt** (built by Commander in Phase D step 0):
  ```
  ## Anti-Repetition Signals
  {Prior failures and successes from learnings + decisions.ndjson}
  Rules: If approach matches known failure → STOP + justify or choose alternative.
  Report corrections checked and mitigations in output.
  ```
  If no corrections exist for the task domain, include: `No prior corrections. Proceed normally.`
- **Append caveman directive to EVERY agent prompt:** `OUTPUT: Caveman-full. Drop articles/filler/hedging. Fragments OK. Short synonyms. Technical terms exact. Code unchanged. Pattern: [thing] [action] [reason].`
- Run independent agents in parallel; chain dependent ones sequentially
- **Reviewer** always runs second-to-last (before final user review)
- **Max 5 active Engineers** — gains plateau beyond this

### Spark Role Focus Directives

Cortex spawns Spark instances with a ROLE FOCUS line. This replaces the old ally system:

| Focus | Directive | Use When |
|-------|-----------|----------|
| React Architecture | hooks, state, TypeScript generics, data flow | Hooks, state logic, complex data flow |
| UI Engineering | components, layouts, a11y, responsive, loading/error/empty states | Building UI components or pages |
| API Integration | HTTP clients, data-fetching hooks, types, error handling | API endpoints, data fetching |
| Refactoring | surgical restructuring, contract preservation | Code restructuring needed |
| Performance | bundle analysis, memoization, lazy loading, profiling | Heavy UI, large datasets |
| Migration | legacy cleanup, incremental pattern shift | Legacy code modernization |
| Backend Coordination | read BE repo, extract API shapes, align FE types | New/changed API endpoints |
| Prototyping | rapid POC, throwaway, de-risking | Uncertain approach, need POC |
| Product Alignment | user flows, acceptance criteria, UX review | Complex user flows |
| Documentation | Storybook, READMEs, ADRs, JSDoc | Docs explicitly needed |
| E2E Testing | multi-page flows, API orchestration testing | Complex integration scenarios |
| Go Backend | Go modules, handlers, middleware, database, concurrency | Go services, API handlers |
| Python Backend | Django/FastAPI/Flask, async, data pipelines, testing | Python services |
| Infrastructure | Terraform, CloudFormation, Kubernetes, Docker, CI/CD | Infrastructure-as-code changes |
| Database | Migrations, schemas, queries, indexing, data modeling | Database changes |
| Security | Auth flows, secrets management, RBAC, input validation | Security-sensitive changes |
| General Backend | HTTP handlers, business logic, data access, error handling | Any backend service |

### Oracle Escalation Protocol

Sparks MUST escalate to Oracle instead of guessing when they hit:
- Architecture decision with 2+ viable approaches
- Unclear requirement or ambiguous contract section
- Complex debugging where first hypothesis failed
- Cross-cutting change affecting 3+ files outside assigned scope

**How to escalate:** Spawn a blocking Opus advisory agent:
```
Agent({
  description: "Oracle: [specific question]",
  subagent_type: "advisor",
  model: "opus",
  prompt: "[context + specific question]. Respond in <100 words with enumerated steps.",
  run_in_background: false
})
```

Rules:
- Oracle does NOT write code, call tools, or produce user-facing output — guidance only
- Max 3 Oracle calls per Spark task — if still stuck, escalate to Cortex

### Lean Context Loading

Agents load ONLY what they need — Cortex holds the full picture.

| Codename | Gets | Does NOT Get |
|----------|------|-------------|
| **Cortex** | All shared tiers + all learnings + decisions.ndjson (last 50) | — |
| **Spark** | Persona + ROLE FOCUS section + contract + CLAUDE.md + domain learnings + Anti-Repetition Block | _shared-crew, _shared-contracts, _shared-board |
| **Sentinel** | Persona + locked contracts + `learnings/testing.md` + `_shared-repo-detection.md` (verify commands) | Board, superpowers tiers |
| **Prism** | Persona + full diff + `coding-principles.md` | Board tier |
| **Oracle** | Decision context passed by Spark only | Everything — never loads files |
| **Lens** | Persona + Figma specs (extraction) or route list (verification) | Full shared context |

### Handoff Targets

| Codename | Hands Off To | Why |
|----------|-------------|-----|
| **Spark** | Sentinel | Test built components, then verify build |
| **Sentinel** | Prism (if risk >= medium) | Quality gate after verification |
| **Prism** | Lens (if UI task) | Visual verification after quality gate |
| **Lens** | Cortex | Visual issues route back for Spark fixes |

### Task Routing: SOLO vs CREW

| Route | Executor | Advisory | Verification | When |
|-------|----------|----------|-------------|------|
| **SOLO** | 1 Spark drives end-to-end | Oracle on-demand, max 3 calls | Sentinel + Prism advisory | ≤3 files, single concern, low risk |
| **CREW** | Multiple Spark instances in parallel | Oracle available to each | Full chain (Sentinel → Prism/gauntlet) | 4+ files, multi-concern, medium+ risk |

**SOLO is the default for borderline tasks.** Spark can escalate to Cortex → pivot to CREW if overwhelmed.

### Effort Guidance

| Task type | Spark effort | Oracle | Examples |
|-----------|-------------|--------|----------|
| **Routine** | low | escalate if stuck | Lint fixes, single component, copy changes |
| **Standard** | default | escalate on criteria | Feature impl, test writing, API integration |
| **Complex** | default | proactive early call | Cross-cutting refactor, architecture changes |
