# Research: Phantom Skills & Team Skill v2

Research repository for Claude Code skill system improvements. Contains audit, architecture design, and implementation plans for the Team Skill v2 redesign.

**Author:** Subash Karki

## Contents

### Audit
- `team-skill-audit-2026-05-22.md` — Comprehensive audit of the team skill system. Identified 3 critical bugs, 5 structural issues. Rated 70% production-ready.

### Architecture
- `team-skill-architecture-brainstorm.md` — Four-lens brainstorm (AI, user, UX, DX). Core insight: files are truth, context is ephemeral. Artifact-passing pipeline. Devil's Advocate reviewed (verdict: REVISE → applied 5 revisions).

### Design Spec
- `docs/superpowers/specs/2026-05-22-team-skill-v2-design.md` — 14-section production spec. Covers artifact schemas, temperature review, self-evolution, Haiku sidecar, migration strategy.

### Implementation Plans
- `docs/superpowers/plans/2026-05-22-team-skill-v2-wave1.md` — Wave 1: Fix bugs (pause/resume, wrap ships, artifact validation)
- `docs/superpowers/plans/2026-05-22-team-skill-v2-wave2.md` — Wave 2: Temperature review + deduplication
- `docs/superpowers/plans/2026-05-22-team-skill-v2-wave3.md` — Wave 3: Artifact architecture + slim skills
- `docs/superpowers/plans/2026-05-22-team-skill-v2-wave4.md` — Wave 4: Self-evolution + sidecar

## Results (v1 → v2)

| Metric | v1 | v2 |
|--------|----|----|
| Shared context preamble | 1,108 lines | 296 lines (-73%) |
| start.md | 518 lines | 61 lines (-88%) |
| Verify pipeline | 7+ steps, 3-5 spawns | 3 steps, 1 spawn |
| wrap.md ships code | No (zero git ops) | Yes (commit, PR, Greptile, Jira) |
| pause → resume | Broken (file mismatch) | Fixed (same JSON) |
| Iron Laws structural | 1/13 | 10+/13 |
| Reference library | 1 file | 10 files (819 lines) |
| Self-evolution | None | 3-tier (auto-promote, skill edit, skill spawn) |
