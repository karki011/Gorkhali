# Phantom — Naming Specification

> **Author**: Subash Karki
> **Date**: 2026-05-27
> **Status**: Approved — rename applied

## Brand

- **Name**: Phantom
- **Tagline**: "Your shadow army of AI agents."
- **Signature command**: `/phantom arise`
- **Theme**: Solo Leveling / Korean manhwa system RPG
- **Target market**: US developers

## Core Metaphor

| Solo Leveling | Phantom |
|---|---|
| Shadow Monarch | The developer (you) |
| Shadow Army | The AI agent shadows |
| "Arise" | `/phantom arise` — summon an agent |
| The System | Phantom itself |
| Shadow Soldiers | Individual agents (Apex, Blade, etc.) |
| Gates / Dungeons | Tasks to clear |
| Ranks (E → SS) | Gate classification by complexity |
| EXP / Leveling | Learning system that grows per session |

## Shadow Army (Agent Roster)

All names are 4-6 characters, English, instantly clear to US developers.

| Role | Name | Chars | Description |
|---|---|---|---|
| Orchestrator | **Apex** | 4 | Plans, decomposes, coordinates — the Monarch's mind |
| Implementer | **Blade** | 5 | Writes code — sharp, fast, precise |
| Verifier | **Ward** | 4 | Build, lint, tests — gate guardian |
| Reviewer | **Gaze** | 4 | Quality gate, KISS/DRY — the all-seeing eye |
| Advisor | **Sage** | 4 | Brief wise counsel — system guide |
| Visual | **Lens** | 4 | Browser/screenshot — shadow eye |
| Cross-file | **Archer** | 6 | Structural review — precision at distance |
| Forensics | **Hound** | 5 | Root cause investigation — tracks the scent |
| Simplifier | **Sweep** | 5 | Cleans, simplifies — clears the field |
| Challenger | **Rival** | 5 | Adversarial plan review — the shadow that fights you |

### Full Rename Map

| Old Name | New Name |
|---|---|
| Cortex | **Apex** |
| Spark | **Blade** |
| Sentinel | **Ward** |
| Prism | **Gaze** |
| Oracle | **Sage** |
| Hawkeye | **Archer** |
| Detective | **Hound** |
| Simplifier | **Sweep** |
| Devil's Advocate | **Rival** |
| Lens | **Lens** (unchanged) |
| Crew (collective) | **Shadows** |
| Iron Laws | **Core Rules** |
| Temperature Review | **Power Level** |

## Gate System

Tasks are classified as Gates with manhwa-style ranks.

| Gate | Human Gates | Trigger | Manhwa |
|---|---|---|---|
| **E-Gate** | 0 | Trivial fix, known pattern | Solo clear |
| **B-Gate** | 0 (auto-plan) | Moderate, known domain | Small party |
| **A-Gate** | 1 | Plan required, some uncertainty | Raid strategy |
| **S-Gate** | 2 | Complex, novel domain | Boss fight |
| **SS-Gate** | 3 | Maximum orchestration | Dungeon break |

## Commands

All `/phantom` prefix. English verbs. One manhwa verb: `arise`.

### Core workflow
```
/phantom start {ticket}      # Enter the gate
/phantom verify              # Guardian check
/phantom fix                 # Repair failures
/phantom wrap                # Ship it (PR + learnings)
/phantom review              # Quality gate (Gaze)
/phantom scout               # Explore codebase
```

### The signature command
```
/phantom arise {role}        # Summon a shadow
```

### Session management
```
/phantom pause               # Save checkpoint
/phantom resume              # Load checkpoint
/phantom status              # Your stats + active gate
```

### Special
```
/phantom grill               # Challenge yourself before shipping
/phantom brainstorm          # Party strategy session
/phantom wire                # Map dependency topology
/phantom evolve              # Level up the system
/phantom hound               # Forensic investigation mode
```

## Learning System (EXP)

| Concept | Term | Description |
|---|---|---|
| Knowledge gained | **+EXP** | Patterns learned from each session |
| Validated patterns | **Skills** | EXP confirmed correct (validated:3+) |
| Failed approaches | **Debuffs** | Patterns that don't work (blocked) |
| System evolution | **Level Up** | When accumulated EXP upgrades system behavior |
| Quality score | **Power Level** | Session quality rating (0-100) |

## System Output Style

### Gate entry
```
⚡ PHANTOM
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

🚪 Gate: A-Rank · 8 files · moderate uncertainty

👻 Shadows assembling:
   → Apex — planning strategy
   → Blade ×2 — standing by
   → Ward — verification ready
   → Gaze — quality gate armed

📜 Contract: sessions/CP-1234/contract.json
```

### Completion
```
✅ Ward: build ✓ · lint ✓ · tests ✓
   Gaze: power level 94/100
   Rival: no challenges

🏆 +12 EXP — validation pattern learned
   Shadows dismissed. Ready to ship.
```

### Gate failure
```
❌ Gate breach — Ward failed
   build ✗ · 3 type errors in auth.service.ts

🔧 Phantom auto-routing to fix loop...
   Blade dispatched → attempt 1/3
```

## README Intro

> **Phantom** — a multi-agent development system that levels up with you.
>
> Inspired by Solo Leveling: you're the Monarch, your AI agents are the shadow army.
> Say `/phantom arise` and they answer.
>
> Every task is a Gate. Phantom reads the difficulty, assembles the right shadows,
> and clears it. After every run, the system gains EXP — learning what works,
> remembering what doesn't.
>
> Created by Subash Karki.

## Command Migration (team → phantom)

| Old | New |
|---|---|
| `/team:start` | `/phantom:start` |
| `/team:verify` | `/phantom:verify` |
| `/team:wrap` | `/phantom:wrap` |
| `/team:recruit` | `/phantom:arise` |
| `/team:brainstorm` | `/phantom:brainstorm` |
| `/team:grill` | `/phantom:grill` |
| `/team:detective` | `/phantom:hound` |
| `/team:fix` | `/phantom:fix` |
| `/team:scout` | `/phantom:scout` |
| `/team:wire` | `/phantom:wire` |
| `/team:review` | `/phantom:review` |
| `/team:pause` | `/phantom:pause` |
| `/team:resume` | `/phantom:resume` |
| `/team:evolve` | `/phantom:evolve` |
| `/team:status` | `/phantom:status` |
