# Gorkhali Shadows -- Auto-Learning System

> Full protocol: `reference/learning-system.md`.

**Read path (lean).** Parent session only: `hooks/memory-reader.js` injects ≤1600 chars, ranked, 5 slots. Match by prompt keywords **and** touched file paths (`scripts/lib/domains.js` `fileDomain`). No match → INDEX one-liners, never every domain file. Subagents do not get this hook. Grep `learnings/INDEX.md` for the files you will edit; read that domain file only if you need the full correction. The INDEX is the on-demand catalog.

**Write path (automatic, lean).** Failed Bash → `hooks/observation-writer.js` → `observations/YYYY-MM-DD.jsonl` → Stop `memory-writer.js` → `gorkhali-learning.mjs capture`. Successful edits are not learnings. Do not append wrap.json. Skill-level evolve/promote stays `/gorkhali:evolve`.
