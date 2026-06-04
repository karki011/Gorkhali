# AI Agent Harness Landscape Survey
**Date:** 2026-06-03  
**Author:** Subash Karki  
**Purpose:** Identify what Phantom (Claude Code plugin) can learn from the current agent orchestration landscape.

---

## Comparison Table

| Framework | Stars | First Public | Latest | Distinctive Idea | Lang | Learn-for-Phantom |
|---|---|---|---|---|---|---|
| **OpenAI Agents SDK** | 26.9K | 2025-03 | v0.17.4 (2026-05) | Handoffs + parallel guardrails; agents-as-tools primitive | Python | Typed handoffs pattern, guardrail parallelism |
| **Microsoft Agent Framework** | 11K | 2025-04 | python-1.7.0 (2026-05) | Replaces AutoGen; A2A + MCP interop, graph workflows, time-travel checkpointing | Python/.NET | Graph-based workflow + time-travel debug |
| **Google ADK 2.0** | 20K | 2025-04 | v1.34.2 (2026-06) | GA 2.0 (2026-05-19): explicit graph execution, non-linear/cyclical patterns, Kotlin support | Python/Kotlin | Deterministic graph execution model |
| **AWS Strands** | 6K | 2025-05 | v1.42.0 (2026-06) | "Model-driven" — the model selects which tool to call next; minimal harness code | Python/TS | Inverting control: let model drive tool-selection loop |
| **Mastra** | 24.7K | 2024-08 | v1.37.0 (2026-05) | TS-native; durable workflows (suspend/resume over HTTP), `.then()/.branch()/.parallel()` graph API | TypeScript | Durable suspend/resume for human-in-the-loop |
| **LangGraph** | 33.7K | 2023-08 | active (2026) | State-machine graph with checkpointing, time-travel, persistence across failures | Python/JS | Checkpoint/restore pattern for long-running sessions |
| **PydanticAI** | 17.5K | 2024-06 | active (2026) | Type-safe agent outputs validated by Pydantic; model-agnostic with structured result types | Python | Typed result contracts between agent stages |
| **Letta (MemGPT)** | 23.1K | 2023-10 | active (2026) | Sleep-time compute: agents learn/consolidate offline between sessions; git-based context repos | Python | Cross-session memory architecture, sleep-time learning |
| **CrewAI** | 52.8K | 2023-10 | active (2026) | Role-based crew composition; highest adoption, enterprise flows | Python | Role + goal declaration patterns |
| **AutoGen / AG2** | — | 2023 | MAINTENANCE MODE | AutoGen → archived; successor is Microsoft Agent Framework | Python | Migrate attention to MAF |
| **Smolagents** | 27.7K | 2024-12 | active (2026) | CodeAgent: generates + executes Python code as the tool-call mechanism (not JSON) | Python | Code-as-tool execution strategy |
| **DSPy** | 34.8K | 2023-01 | v3.3.0b1 (2026) | Optimizer compiles prompt programs against a metric; ReActV2 module | Python | Programmatic prompt optimization, not hand-crafted prompts |
| **Agno (ex-Phidata)** | 40.5K | 2022-05 | active (2026) | High-perf runtime; multimodal + cron scheduler for agents/teams/workflows | Python | Cron-scheduled agent execution, context providers |
| **OpenHands** | 75.7K | 2024-03 | v1.7.0 (2026-05) | Large Codebase SDK: dependency-map-aware parallel agents; enterprise isolated sandboxes | Python | Conflict-free parallel agent execution on large repos |
| **SWE-agent** | 19.4K | 2024-04 | v1.1.0 (2026) | Interactive Agent Tools (IAT): real debugger/gdb integration; trajectory datasets for training | Python | Tool interface design for coding; trajectory data generation |
| **Aider** | 45.7K | 2023-05 | active (2026) | Whole-diff editing model; repo-map for context pruning (44K stars, most-used coding agent) | Python | Repo-map context pruning before editing |
| **Cline** | 62.7K | 2024-07 | active (2026) | VS Code extension; checkpoint/restore at any step; plan-before-act mode | TypeScript | Checkpoint-before-destructive-action pattern |
| **Claude Code SDK** | — | 2025 (SDK) | active (2026) | Non-interactive subprocess API; subagent spawning via `~/.claude/agents/`; plugin manifest | TypeScript/Any | Native subagent + plugin layer Phantom already uses |
| **Semantic Kernel** | — | 2023 | active (2026) | Microsoft's planner; merging into MAF | Python/.NET | Consumed by MAF; follow MAF instead |
| **Agent Squad** | — | renamed 2026 | active | AWS open-source multi-agent (renamed from Multi-Agent Orchestrator); distinct from Bedrock MAC | Python/TS | Routing/classifier architecture |

---

## Framework Deep-Dives

### 1. OpenAI Agents SDK (v0.17.x, 2026-05)
**Purpose:** Production-ready Swarm successor — minimal primitives, big capability.  
**Distinctive ideas:**
- **Handoffs**: an agent can hand off execution to another agent as a typed primitive, not just a prompt trick. The receiving agent gets full context transfer.
- **Guardrails run in parallel** to the main agent loop. If a guardrail fires, execution aborts immediately — not after the fact.
- **Sandbox agents**: isolated workspaces with manifest-defined files; sessions are resumable.
- **Agents-as-tools**: any agent can be wrapped as a tool for another agent (vs. handoff which transfers control).
- MCP server tool integration is first-class (same API as function tools).

### 2. Microsoft Agent Framework (python-1.7.0, 2026-05-28)
**Purpose:** Enterprise successor to AutoGen (which is now archived/maintenance-only).  
**Distinctive ideas:**
- **A2A + MCP interop**: cross-runtime agent-to-agent protocol; agents in Python can call .NET agents.
- **Graph-based workflows**: sequential, concurrent, handoff, group-collaboration patterns with graph primitives.
- **Time-travel checkpointing**: replay or fork from any prior state in a workflow run.
- **Middleware pipeline**: request/response interceptors at the agent boundary (good for logging, auth, rate-limiting).
- **Human-in-the-loop** built into workflow graph as a first-class node type.

### 3. Google ADK 2.0 GA (v1.34.2, 2026-05-19 GA)
**Purpose:** Google's production agent framework; 2.0 is a major architectural shift.  
**Distinctive ideas:**
- **Explicit graph execution**: "weave deterministic code with adaptive AI reasoning" — not everything is LLM decisions.
- **Non-linear / cyclical execution**: loops and conditionals in the graph, not just DAGs.
- **Native inter-agent routing**: context variable propagation across agent handoffs without manual state passing.
- **Kotlin support** (ADK Kotlin added in 2.0 — mobile/JVM agents).
- Evaluation framework built-in (trajectory evaluation).

### 4. AWS Strands Agents (v1.42.0, 2026-06-01)
**Purpose:** AWS-origin, open-sourced May 2025; "model-driven" alternative to orchestrator-controlled frameworks.  
**Distinctive ideas:**
- **Model-driven loop**: the LLM decides which tool to invoke next (vs. the harness deciding). The SDK steps back.
- Built from Amazon's internal production systems (Alexa, Q Developer).
- MCP-first: MCP server clients are native.
- Python + TypeScript SDKs; 62 releases since May 2025 = very active.
- 6K stars despite only 1 month old at launch = significant initial velocity for an AWS project.

### 5. Mastra (v1.37.0, 2026-05-27, TypeScript)
**Purpose:** The definitive TS/JS agent framework — bundles into Next.js/Node directly.  
**Distinctive ideas:**
- **Durable workflows**: `.then()/.branch()/.parallel()` graph API with persistent state — suspend indefinitely, resume via HTTP POST.
- `POST /agents/:agentId/resume-stream` — resume suspended run with approval data.
- Integrates into existing React/Next.js apps without a separate service.
- 90 releases since April 2025 = fastest-iterating TS framework in the space.
- **Only serious TS-native framework** covering agents + workflows + memory + observability.

### 6. LangGraph (33.7K stars, 2023 → active 2026)
**Purpose:** State-machine graph orchestration; the orchestration layer under many production agent systems.  
**Distinctive ideas:**
- **Checkpointing**: any state snapshot is persisted; resume from failure, not from scratch.
- **Time-travel**: fork from any historical checkpoint.
- Short-term (working) + long-term (cross-session) memory as distinct concepts.
- Human-in-the-loop: inspect + modify agent state mid-run.
- LangSmith integration: full trace/replay of execution graph.

### 7. Letta / MemGPT (23.1K stars)
**Purpose:** Memory-first agents that learn across sessions.  
**Distinctive ideas:**
- **Sleep-time compute**: agent runs offline processing between sessions (consolidation, learning).
- **Context repositories**: git-based memory — agent's knowledge is version-controlled.
- **Continual learning in token space** (published research).
- "Letta Code" — a coding-specific agent that remembers past sessions and prior mistakes.

### 8. Smolagents (27.7K stars, HuggingFace, 2024-12)
**Purpose:** Minimal HF framework; notable for CodeAgent.  
**Distinctive ideas:**
- **CodeAgent**: instead of JSON tool calls, the agent writes Python code that is executed. Tools are just importable functions. This is the most deterministic tool-use pattern — the code IS the plan.
- Very small surface area (intentional "smol").

### 9. PydanticAI (17.5K stars, 2024-06)
**Purpose:** Type-safe agent framework from the Pydantic team.  
**Distinctive ideas:**
- Agent functions declare **typed result models**; the LLM must conform to the schema.
- **Dependency injection** for agent context (like FastAPI's `Depends`).
- Model-agnostic; works with Claude, OpenAI, Gemini, Ollama.
- Tight validation between agent stages = catch errors at boundary, not downstream.

### 10. OpenHands v1.7.0 (75.7K stars, 2026-05)
**Purpose:** End-to-end coding agent platform — plan → code → apply → verify.  
**Distinctive ideas:**
- **Large Codebase SDK**: maps repo dependency graph before dispatching parallel agents; ensures correct change ordering.
- **Conflict-free parallel agents**: multiple agents work simultaneously without clobbering each other.
- Runs in isolated sandbox (on-prem or private cloud).
- SDK for embedding into your own workflows.

### 11. SWE-agent v1.1.0 (19.4K stars, 2024-04)
**Purpose:** Princeton/CMU research → production coding agent; NeurIPS 2024.  
**Distinctive ideas:**
- **Interactive Agent Tools (IAT)**: real debugger (`gdb`) integrated as an agent tool — not simulated.
- Generates training trajectory datasets (used to fine-tune coding models).
- Configurable **summarizers** for long tool outputs.
- CTF (offensive security) + SWE benchmark modes.

### 12. Aider (45.7K stars)
**Purpose:** Terminal-based pair programmer; most widely used coding agent tool.  
**Distinctive ideas:**
- **Repo-map**: indexes the entire repo into a dependency-aware context map; prunes to relevant files before each LLM call.
- Whole-diff output format: agent produces a git-diff, not prose with code snippets.
- Architect mode: separate planning pass (stronger model) before implementation pass (faster model).

### 13. Cline (62.7K stars, VS Code)
**Purpose:** VS Code coding agent extension.  
**Distinctive ideas:**
- **Checkpoint/restore**: snapshot the full workspace before any destructive action; restore to any checkpoint.
- **Plan mode**: agent must present a plan and get approval before executing.
- Tool approval per-category (not per-call).

### 14. DSPy v3.3 (34.8K stars)
**Purpose:** Programmatic LM — express tasks as typed signatures, compile to optimized prompts.  
**Distinctive ideas:**
- **GEPA optimizer**: given examples + a metric, auto-tunes prompts until quality converges.
- **ReActV2 module** (latest): improved reasoning+acting loop.
- Prompts as compiled artifacts (`.save("rag.v2.json")`) — version-controlled, not hand-crafted strings.

### 15. Agno ex-Phidata (40.5K stars)
**Purpose:** High-performance agent runtime with scheduler.  
**Distinctive ideas:**
- **AgentOS scheduler**: run agents/teams/workflows on cron schedules with Mongo/Postgres backends.
- Multimodal file search (Gemini integration).
- Context providers: Gmail, Calendar, GDrive, Slack as first-class context sources.

---

## Ranked Shortlist: Top 6 for Phantom Deep-Dive

### #1. LangGraph
**Reason:** State-machine checkpointing + time-travel is the most mature solution to Phantom's biggest unsolved problem — session recovery after context loss / failure mid-workflow. 33.7K stars, battle-tested.

### #2. Microsoft Agent Framework (MAF)
**Reason:** Most structurally similar to what Phantom is building (multi-agent graph orchestration, MCP-first, Python+TS); just GA'd 1.0 with A2A cross-agent protocol — Phantom could adopt A2A as its agent wire format.

### #3. Mastra
**Reason:** Only serious TS-native framework; durable suspend/resume over HTTP is directly applicable to Phantom's human-in-the-loop gates and the edit-gate pattern. Phantom's frontend is SolidJS — a JS/TS-native harness is the natural complement.

### #4. Google ADK 2.0
**Reason:** GA graph execution model that explicitly mixes deterministic code with LLM reasoning — this is exactly Phantom's architecture need. Non-linear/cyclical graph support (loops + conditionals) goes beyond what most frameworks offer.

### #5. Letta (sleep-time compute + context repos)
**Reason:** Phantom's learnings/memory system is hand-rolled. Letta's sleep-time compute (offline consolidation) and git-based context repositories are research-backed approaches that directly improve what Phantom's `learnings/` tries to do.

### #6. OpenHands Large Codebase SDK
**Reason:** Phantom dispatches parallel agents against codebases. OpenHands' dependency-map-aware parallel dispatch (conflict-free ordering) is the production-proven solution to the same problem — directly stealable.

---

## Most Surprising Finding

**AutoGen is dead — Microsoft Agent Framework is the real news of 2025.**

AutoGen (the dominant multi-agent framework of 2023-2024) entered maintenance mode in 2025. Microsoft quietly shipped its replacement — Microsoft Agent Framework (MAF) — created April 2025, already at 11K stars, with a stable 1.0 API commitment, bi-weekly releases, A2A cross-runtime protocol, and an explicit migration guide from AutoGen. This is not a rename — it's a ground-up rewrite with graph-based workflows, time-travel checkpointing, middleware pipelines, and both Python and .NET support. It merges AutoGen's multi-agent concepts with Semantic Kernel's planner patterns. Almost nobody in the community is talking about it yet relative to its capability level. For Phantom (which operates in the same multi-agent orchestration space), MAF's graph workflow primitives + A2A wire protocol are the most transferable ideas in the entire landscape right now.

---

## Notes on Missing/Changed Items
- **AWS Multi-Agent Orchestrator** renamed to **Agent Squad** (2026) to avoid confusion with Bedrock's managed MAC.
- **AWS Strands** (not to be confused with Agent Squad) is a separate open-source SDK from AWS, first released May 2025.
- **AutoGen/AG2**: AutoGen = maintenance mode → Microsoft Agent Framework. AG2 is a community fork of AutoGen.
- **Devin / Amp / Factory / Trae**: closed-source commercial products; no public SDK/harness to study.
- **DSPy 3.x**: most recent is v3.3.0b1 — significant rewrite with GEPA optimizer and ReActV2.
