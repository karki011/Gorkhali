# Handbook: Plugin Integrations

## Marketplace Plugin Integration Map

The crew system integrates with official marketplace plugins. Source of truth for which plugins are used where.

### Plugins Consumed by Crew Members

| Plugin | Used By | How |
|---|---|---|
| `pr-review-toolkit:code-simplifier` | Prism (gauntlet mode) (Step 2a) | Parallel polish pass in quality gauntlet |
| `pr-review-toolkit:silent-failure-hunter` | Prism (gauntlet mode) (Step 2b) | Parallel error handling audit in quality gauntlet |
| `pr-review-toolkit:type-design-analyzer` | Prism (conditional) | Type design quality check when new types in diff |
| `pr-review-toolkit:comment-analyzer` | Spark (Documentation focus) (post-docs) | Verifies comment accuracy after documentation work |
| `feature-dev:code-reviewer` | Prism (conditional) | Generic bug/security/quality review alongside Prism |
| `feature-dev:code-architect` | Cortex (Phase B) | Multi-approach architecture for features with 3+ new files |
| `context7` | Spark (UI focus), Spark (React Arch focus), Spark (API focus), Sentinel | Live library docs lookup |
| `playwright` | Lens | Visual inspection via Playwright MCP tools |
| `figma` | Lens (design extraction mode) | Design spec extraction via Figma MCP |
| `atlassian` | Cortex (Phase A) | Jira ticket lookup and status transitions |
| `commit-commands` | Cortex (/team:wrap) | Git commit + PR creation |

### ai-sdlc Dedup: What to Use From Each System

The `ai-sdlc` plugin has workflow overlap with the crew system. **The crew system is the primary workflow.** Use these ai-sdlc skills as standalone supplements:

| ai-sdlc Skill | Use When |
|---|---|
| `/ai-sdlc:pre-commit` | Quick quality check before commit (lighter than Prism (gauntlet mode)) |
| `/ai-sdlc:rfr` | Generate Ready for Review Confluence doc for an Epic |
| `/ai-sdlc:drift-check` | Detect drift between PLAN.md, git, Jira, filesystem |
| `/ai-sdlc:audit` | Comprehensive code audit (supplements Prism) |
| `/ai-sdlc:proofread` | Proofread markdown documents |

**Do NOT use** (redundant): `/ai-sdlc:new-session`, `/ai-sdlc:save-session`, `/ai-sdlc:resume-session`, `/ai-sdlc:checkpoint`, `/ai-sdlc:create-pr`
