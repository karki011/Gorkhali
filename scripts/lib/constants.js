// Author: Subash Karki
// constants.js — single source of truth for Phantom runtime constants.
// Dep-free (no requires) so any consumer can load it fail-open. Env overrides are
// numeric-validated and fail open to the default on missing/garbage values.
// Exception: check-learnings-index.js hard-requires its libs deliberately — it's a CLI checker, crash == failed check.

'use strict';

function numFromEnv(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

// Loop ceilings must be whole numbers: a fractional ceiling (e.g. 2.5) would silently
// grant an extra attempt through >= comparisons. Floats fall back to the default.
function intFromEnv(name, fallback) {
  const n = numFromEnv(name, fallback);
  return Number.isInteger(n) ? n : fallback;
}

module.exports = {
  // Verify/fix loop hard stop — enforced by hooks/loop-controller.js (loop authority).
  FIX_LOOP_CEILING: intFromEnv('PHANTOM_FIX_LOOP_CEILING', 2),

  // Visual (Lens) fix loop — separate loop from the verify/fix loop above.
  VISUAL_LOOP_CEILING: intFromEnv('PHANTOM_VISUAL_LOOP_CEILING', 3),

  // auto-captures → domain-file graduation (validated:N+); also the validated-high
  // injection priority cutoff in memory-reader.
  GRADUATION_THRESHOLD: numFromEnv('PHANTOM_GRADUATION_THRESHOLD', 5),

  // domain file → global patterns promotion (evolution-runner Tier 2).
  PROMOTE_THRESHOLD: numFromEnv('PHANTOM_PROMOTE_THRESHOLD', 5),

  // extract-learnings.js subprocess kill timeout (memory-writer).
  EXTRACT_TIMEOUT_MS: numFromEnv('PHANTOM_EXTRACT_TIMEOUT_MS', 5000),

  // Legacy data-root dirname, retained ONLY as a migration source. The canonical
  // mutable data root is now ~/.phantom (PHANTOM_DATA overrides the full path),
  // resolved by the shared codec at skills/phantom/scripts/lib/shared-state.cjs.
  PHANTOM_DATA_DIRNAME: 'phantom-data',

  // Learning retention tiers (evolution-runner); tune via the PHANTOM_LEARNING_* env vars below.
  LEARNING_STALE_DAYS: numFromEnv('PHANTOM_LEARNING_STALE_DAYS', 30),
  LEARNING_REMOVE_DAYS: numFromEnv('PHANTOM_LEARNING_REMOVE_DAYS', 60),
  LEARNING_DISTILL_CAP: numFromEnv('PHANTOM_LEARNING_DISTILL_CAP', 50),

  // Injection budget PARTITION (hooks/memory-reader.js). Slots are partitioned, not
  // purely ranked, because a pure ranking cannot work on this corpus: it holds 14
  // [failed] corrections against 4 [validated:N] patterns, so any ranking that puts
  // corrections first fills every slot with corrections forever and no validated
  // pattern is ever reachable (measured: 4 corrections dated 2026-07-02 returned for
  // every prompt, 0 validated entries reachable at any prompt). The correction cap is
  // what makes a validated slot reachable; the validated floor is what claims it.
  // CORRECTION + VALIDATED must stay <= SLOTS or the floor cannot be honoured.
  INJECTION_SLOTS: intFromEnv('PHANTOM_INJECTION_SLOTS', 5),
  INJECTION_CORRECTION_SLOTS: intFromEnv('PHANTOM_INJECTION_CORRECTION_SLOTS', 3),
  INJECTION_VALIDATED_SLOTS: intFromEnv('PHANTOM_INJECTION_VALIDATED_SLOTS', 1),

  // context.json field naming the learning entries a session actually recalled, by
  // `[keyword]`. Read by evolution-runner to DERIVE [validated:N] from artifacts
  // instead of LLM judgment. No writer exists yet -- see reference/evolution.md
  // "Computed validation" for the writer that has to be added and by whom.
  LEARNING_CITATION_FIELD: 'learningsCited',

  // Per-hook timeout default, in SECONDS (parity with hooks.json `timeout`).
  DEFAULT_HOOK_TIMEOUT_SECONDS: 10,

  // Preflight blast-radius ceiling: max unique plan.json files for an autonomous run.
  PREFLIGHT_MAX_FILES: intFromEnv('PHANTOM_PREFLIGHT_MAX_FILES', 10),

  // Staleness window for the current-session collision marker (preflight's
  // checkSessionCollision). A marker older than this is treated as absent.
  MARKER_FRESHNESS_MS: numFromEnv('PHANTOM_MARKER_FRESHNESS_MS', 12 * 60 * 60 * 1000),

  // UNATTENDED-RUN spend ceiling, USD. Binds ONLY unattended runs (scripts/run-guard.js
  // --unattended / PHANTOM_UNATTENDED=1); an interactive session is never capped because
  // the watching human IS the ceiling. Deliberately conservative: one autonomous ticket
  // run to a draft PR, not a day of them. Fractional is legal here (unlike the loop
  // ceilings above) — a $2.50 ceiling is still a meaningful ceiling.
  SPEND_CEILING_USD: numFromEnv('PHANTOM_SPEND_CEILING_USD', 5),

  // Unattended stuck detection: N occurrences of the SAME failure class halt the run.
  // 2 matches the fix-loop rule it shares an authority with (hooks/loop-controller.js) —
  // "fails twice with the same error class → the approach is wrong".
  STUCK_REPEAT_LIMIT: intFromEnv('PHANTOM_STUCK_REPEAT_LIMIT', 2),
};
