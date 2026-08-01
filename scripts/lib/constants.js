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
  // auto-captures → domain-file graduation (validated:N+); also the validated-high
  // injection priority cutoff in memory-reader.
  GRADUATION_THRESHOLD: numFromEnv('PHANTOM_GRADUATION_THRESHOLD', 5),

  // domain file → global patterns promotion (evolution-runner Tier 2).
  PROMOTE_THRESHOLD: numFromEnv('PHANTOM_PROMOTE_THRESHOLD', 5),

  // extract-learnings.js subprocess kill timeout (memory-writer).
  EXTRACT_TIMEOUT_MS: numFromEnv('PHANTOM_EXTRACT_TIMEOUT_MS', 5000),

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
  // instead of LLM judgment. No writer exists yet -- see
  // skills/phantom/references/evolution.md
  // "Computed validation" for the writer that has to be added and by whom.
  LEARNING_CITATION_FIELD: 'learningsCited',

  // Per-hook timeout default, in SECONDS (parity with hooks.json `timeout`).
  DEFAULT_HOOK_TIMEOUT_SECONDS: 10,

};
