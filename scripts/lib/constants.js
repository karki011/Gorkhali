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

  // extract-learnings.js subprocess kill timeout (memory-writer / memory-consolidator).
  EXTRACT_TIMEOUT_MS: numFromEnv('PHANTOM_EXTRACT_TIMEOUT_MS', 5000),

  // Dirname under ~/.claude for the mutable data root (PHANTOM_DATA env overrides the full path).
  PHANTOM_DATA_DIRNAME: 'phantom-data',

  // Learning retention tiers (evolution-runner). config.yaml learning.* documents these.
  LEARNING_STALE_DAYS: numFromEnv('PHANTOM_LEARNING_STALE_DAYS', 30),
  LEARNING_REMOVE_DAYS: numFromEnv('PHANTOM_LEARNING_REMOVE_DAYS', 60),
  LEARNING_DISTILL_CAP: numFromEnv('PHANTOM_LEARNING_DISTILL_CAP', 50),

  // Per-hook timeout default, in SECONDS (parity with hooks.json `timeout`).
  DEFAULT_HOOK_TIMEOUT_SECONDS: 10,

  // Preflight blast-radius ceiling: max unique plan.json files for an autonomous run.
  PREFLIGHT_MAX_FILES: intFromEnv('PHANTOM_PREFLIGHT_MAX_FILES', 10),

  // Staleness window for the current-session collision marker (preflight's
  // checkSessionCollision). A marker older than this is treated as absent.
  MARKER_FRESHNESS_MS: numFromEnv('PHANTOM_MARKER_FRESHNESS_MS', 12 * 60 * 60 * 1000),
};
