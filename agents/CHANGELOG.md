# Straw Hat Crew Changelog

All notable upgrades, integrations, and changes to the Straw Hat Engineering Crew system.

Format: `## [version] — YYYY-MM-DD` with categories: Added, Changed, Enhanced, Fixed, Deprecated.

---

## [v2.3] — 2026-04-02

### Marketplace Plugin Integration Audit & Upgrade

**Added**
- **Silent Failure Hunter** → Sengoku gauntlet Step 2b — runs `pr-review-toolkit:silent-failure-hunter` in parallel with code-simplifier to catch silent failures, broad catches, empty catch blocks, and swallowed errors
- **Type Design Analyzer** → Roger's review (conditional) — spawns `pr-review-toolkit:type-design-analyzer` when `git diff` contains new `type`/`interface`/`enum` declarations to rate encapsulation and invariant quality
- **Comment Analyzer** → Robin's docs phase — spawns `pr-review-toolkit:comment-analyzer` after documentation work to verify comment accuracy and catch comment rot
- **Git History Review Lens** → Roger's triple-lens system — third reviewer that runs `git blame` analysis, checks code churn frequency, and cross-references prior PR feedback patterns
- **Multi-Approach Architecture** → Luffy Phase B step 7 — spawns 2 `feature-dev:code-architect` agents (minimal vs clean architecture) before Dragon challenge for features with 3+ new files
- **Marketplace Integration Map** → crew-handbook.md — single source of truth documenting which plugins are consumed by which crew members
- **ai-sdlc Dedup Guide** → crew-handbook.md — documents which ai-sdlc skills to use vs which overlap with Straw Hat
- **CHANGELOG.md** → this file — tracks all crew system upgrades for version history

**Enhanced**
- **Sengoku gauntlet** upgraded from v2.1 to v2.2 — now runs silent-failure-hunter in parallel with code-simplifier (zero extra wait time)
- **Roger review** upgraded from dual-lens to triple-lens — added git-history-aware reviewer + conditional type-design-analyzer
- **Franky** — added context7 MCP tool references for TanStack Query, TanStack Router, Jotai, React 19 live docs
- **Sanji** — added context7 MCP tool references for TanStack Query, MSW, Auth0 SDK live docs
- **Zoro** — added context7 MCP tool references for Vitest, Testing Library, MSW, React 19 testing live docs
- **Luffy Phase B** — renumbered steps 7-11 to accommodate multi-approach architecture (now steps 7-12)
- **crew-handbook Phase Task Order** — updated to reflect triple-lens Roger + enhanced Sengoku gauntlet

**Changed**
- Phase B now has 12 steps (was 11) — step 7 is multi-approach architecture, step 8 is Dragon challenge (was 7)

---

## [v2.2] — 2026-03-29

### Breadcrumbs Session (CP-39501)
- Board-sync hook improvements
- Session JSON array format fix
- Separator nesting fix for Chakra Breadcrumb

---

## [v2.1] — 2026-03-25

### Crew Architecture Optimization
- Generic crew + inheritance pattern
- Grand Fleet allies system
- Verify → Fix loop with Kureha triage
- Visual inspection with Smoker
- Validation scripts (plan, output, session)
- Board app (Vite + React + Hono)

---

## [v2.0] — 2026-03-20

### Initial Straw Hat Crew System
- Core crew: Luffy, Franky, Nami, Sanji, Zoro, Chopper, Robin, Usopp
- Roger quality gate
- Dragon devil's advocate
- Sengoku quality gauntlet
- Session management + learnings
- Board tracking + task hooks
- Obsidian vault integration
- Straw Hat Chronicles (Robin's stories)
