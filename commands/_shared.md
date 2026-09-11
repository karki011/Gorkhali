# Gorkhali Shared Context

Every `/gorkhali:*` command reads this before its own phases start.

## Paths and Session Model

`lib/paths.js` resolves one data root: `$GORKHALI_DATA`, else `$HOME/.gorkhali`. Everything mutable lives under it, never inside the project checkout. Inside the root: `repos/<repo>/sessions/<task>/`, where `<repo>` is a slug derived from the git remote and `<task>` is the ticket or task id.

`lib/session.js` owns that session directory: `plan.json`, `progress.json`, and a `scratch/` folder for anything a task needs to keep that is not the plan or the progress record. `openSession` creates the directory and a data-root sentinel marking which session is active; reopening an existing session never touches its `plan.json`. `closeSession`, `activeSession`, `readPlan`, `writePlan`, `readProgress`, and `appendProgress` cover the rest. No command writes these paths by hand.

## User Preferences

`lib/preferences.js` reads a capped, twenty-line preferences file: a per-repo copy first, a global copy only when the per-repo one is missing, never both merged together. Both live under the data root, never inside the project, and are never committed.

Every planner prompt, every brainstorm-phase prompt, every Opposition prompt, and every Engineer prompt carries the preference text verbatim, opened by the exact line `## User Preferences (verbatim)`. Omit the whole block when there is no preference text to show; never invent a substitute header.

## Tracker Adapter

`lib/tracker.js` resolves one provider, from an explicit override or from preferences, and returns four descriptors: fetch, start, done, comment. Two providers are runnable directly, one through a command line tool and one through an external tool a command calls by name, never by guessing its shape. The third, none, hands back every descriptor as null, so a command that consults it does nothing rather than acting on a ticket system that was never configured. A command executes whichever descriptor it needs as plain prose steps; nothing here is a script to invoke.

## Role and Tier

Six roles, three tiers, one tier-to-model mapping per host:

| Role | Tier |
|------|------|
| Engineer | balanced |
| Inspector | economy |
| Auditor | deep |
| Opposition | balanced |
| Detective | deep |
| Surveyor | balanced |

`lib/tiers.js` resolves a role to its tier (`config/role-tiers.json`) and a tier to a model for the active host (`config/hosts/`). An explicit model on the spawn always wins over the resolved one; an unrecognized host inherits whatever model is already running.

## Precedence

User intent beats auto-detection. Safety beats efficiency. When a rule above and a user's stated wish conflict, the user's wish wins unless following it would be unsafe; when speed and safety conflict, safety wins.
