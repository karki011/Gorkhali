# Run Artifacts Schema

Layout of per-run artifact files under `${PHANTOM_DATA}/repos/<REPO>/sessions/<TICKET>/runs/<ts>/`.

## Directory Layout

| Path | Written by | Description |
|------|------------|-------------|
| `plan.json` | `phantom:start` | Snapshot of `plan.json` at run start |
| `preflight.json` | `phantom:start` (preflight step) | Preflight check results (branch, dirty state, CI) |
| `checkpoints/` | `phantom:execute` | **Phase 1 (future):** home for checkpoints once the run lifecycle launcher creates run dirs. See note below. |
| `verify-result.json` | `phantom:verify` | Output of the verify gate (tests, lint, typecheck) |
| `pr-url.txt` | `phantom:wrap` | Plain-text file containing the PR URL after merge/open |

## `runs/current` Pointer Convention

`runs/current` is a plain-text file containing the active `<ts>` value (e.g. `20260611T143000Z`).

- Written by `phantom:start` when a new run begins.
- Overwritten each time a new run is started for the same ticket.
- Consumers read this file to locate the current run dir without scanning the directory.
- Path is computed by `currentRunPointer(ticket, repo)` in `scripts/lib/phantom-paths.js` / `phantom_current_run_pointer` in `scripts/lib/phantom-paths.sh`.

## Notes

- **Checkpoints — Phase 0 (current):** `phantom:start`, `phantom:execute`, and `phantom:resume` write and read checkpoints at `{SESSION_DIR}/checkpoints/` (i.e. `${PHANTOM_DATA}/repos/<REPO>/sessions/<TICKET>/checkpoints/`). The run lifecycle launcher does not yet create run dirs, so checkpoints live at the session level.
- **Checkpoints — Phase 1 (future):** once the run lifecycle launcher (`phantom:start`) creates run dirs, checkpoints will move to `runs/<ts>/checkpoints/` (the row above). No prose currently writes there.
- All other paths are relative to the run dir: `${PHANTOM_DATA}/repos/<REPO>/sessions/<TICKET>/runs/<ts>/`.
- The `<ts>` segment is an ISO-8601 compact timestamp (e.g. `20260611T143000Z`) assigned by `phantom:start`.
