# Gorkhali Shadows -- Auto-Learning System

> See `reference/learning-system.md` for full protocol.

**Quick ref:** Load `learnings/INDEX.md` always. Domain files loaded per task classification. `[validated:5+]` auto-apply. `[failed]` blocked. Decay: 30d stale, 60d remove.

**Domain routing:** ui (*.tsx, components/), data (*.api.*, hooks/), auth (auth/, session/), testing (*.test.*), tooling (*.config.*), migration (migrations/), shadows (workflow, agent).

**Writes go through one locked API.** Never edit `INDEX.md` / `auto-captures.md` / domain files by hand from a workflow. The auto-capture and consolidation hooks and any portable workflow route writes through the canonical, concurrent-safe learning API (`skills/gorkhali/scripts/gorkhali-learning.mjs capture|consolidate`, candidates JSON on stdin). It takes a per-repo lock and never writes unlocked, so concurrent writers keep every entry. See `skills/gorkhali/references/state.md` § Learning index.
