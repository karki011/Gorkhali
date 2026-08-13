// Author: Subash Karki
// review-finding.js — identity and disposition for ONE review finding (B9).
// No project deps (node's crypto only) so any consumer can load it: the validator
// (scripts/validate-artifact.js) enforces the shape, the loop controller
// (hooks/loop-controller.js) records the outcome, and a miner reading artifacts
// off disk must reach the same id without either of them.
//
// WHY A CONTENT-DERIVED ID AND NOT A UUID: the question B9 exists to answer is
// "was THIS finding acted on?", and answering it means recognising the same
// finding across re-review rounds. A random id mints a new identity every round,
// so a carried-over finding and a freshly invented one become indistinguishable
// and nothing can be counted. A content hash is stateless: any consumer holding
// the finding recomputes the same id with no ledger to keep in sync.
//
// WHAT THE ID IS DERIVED FROM, and what is deliberately left out:
//   in:  the cited file (or component) + the finding's claim text.
//   out: `line`      — a fix upstream shifts line numbers, and a finding that
//                      merely moved is the SAME finding.
//        `severity`  — it is re-scored between rounds, and B10 unified the
//                      four vocabularies of F9; folding it in would have
//                      silently re-id'd every finding in the corpus on the day
//                      B10 landed. (It did not: B10 shipped and the ids held.)
//        `disposition` — the outcome must not change the identity it attaches to.
// Known limit, stated rather than hidden: a reviewer that REWORDS the same claim
// in round 2 produces a different id. Text equality is the honest bound of a
// hash; semantic matching is not attempted here.
//
// B9 IS BEHAVIOR-NEUTRAL: reviewers do not write ids. Ids are assigned
// mechanically (assignFindingIds) after the reviewer has reported, so nothing
// about what a reviewer reports changes.

'use strict';

const crypto = require('crypto');

// `f_` prefix keeps ids greppable and gives the validator a checkable format.
// 12 hex = 48 bits: collision-free for the tens-of-findings scale of one review.
const FINDING_ID_PREFIX = 'f_';
const FINDING_ID_RE = /^f_[0-9a-f]{12}$/;

// The only legal dispositions. One home for the enum: validate-artifact.js
// enforces it and loop-controller.js writes it — neither keeps a private list.
const DISPOSITIONS = ['fixed', 'dismissed', 'deferred'];

// A dismissal or a deferral is a claim that needs support: nothing in the diff
// evidences it, so the reason is the only record of why. `fixed` needs none —
// the changed code is the evidence.
const DISPOSITIONS_REQUIRING_REASON = ['dismissed', 'deferred'];

// Claim-text keys in precedence order. B10 collapsed the three finding shapes
// onto one — `evidence` is the canonical key — but the legacy keys still name
// the claim on every artifact written before it (`issue` from the
// temperature-review prompt, `message` from the verification schema), so the id
// must stay derivable from whichever one is present. Imported rather than
// re-listed: scripts/lib/review-standard.js owns the shape, and a second copy
// of this list here is precisely the F9 pattern.
const { CLAIM_KEYS } = require('./review-standard');

// Path normalization only: no case folding, because POSIX paths are
// case-sensitive and `src/Foo.ts` is not `src/foo.ts`.
function normalizePath(value) {
  return String(value == null ? '' : value)
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\.\//, '');
}

// Claim normalization: whitespace and case are formatting, not content, so a
// re-wrapped or re-capitalized claim keeps its id.
function normalizeClaim(value) {
  return String(value == null ? '' : value).trim().replace(/\s+/g, ' ').toLowerCase();
}

/**
 * The canonical string the id hashes. Exported so a mismatch can be explained
 * ("these two findings hash apart because their claim text differs") rather
 * than merely reported. Parts are joined by the ASCII unit separator, which
 * cannot occur in a path or a reviewer's prose, so no part can bleed into the
 * next and forge a collision.
 */
function canonicalFindingKey(finding) {
  const f = finding && typeof finding === 'object' ? finding : {};
  const where = normalizePath(f.file || f.component || '');
  const claimKey = CLAIM_KEYS.find((key) => typeof f[key] === 'string' && f[key].trim() !== '');
  return [where, normalizeClaim(claimKey ? f[claimKey] : '')].join('\u001f');
}

/** The stable id for a finding: `f_` + first 12 hex of sha256(canonical key). */
function findingId(finding) {
  const digest = crypto.createHash('sha256').update(canonicalFindingKey(finding), 'utf8').digest('hex');
  return FINDING_ID_PREFIX + digest.slice(0, 12);
}

/**
 * Stamp the derived id onto every finding that lacks one, in place. An id
 * already present is left alone: it may have been written against claim text
 * that was later reworded, and overwriting it would silently break the link to
 * a disposition already recorded against it. Returns the same array.
 */
function assignFindingIds(findings) {
  if (!Array.isArray(findings)) return [];
  for (const finding of findings) {
    if (!finding || typeof finding !== 'object' || Array.isArray(finding)) continue;
    if (typeof finding.id === 'string' && finding.id.trim() !== '') continue;
    finding.id = findingId(finding);
  }
  return findings;
}

module.exports = {
  FINDING_ID_PREFIX,
  FINDING_ID_RE,
  DISPOSITIONS,
  DISPOSITIONS_REQUIRING_REASON,
  CLAIM_KEYS,
  canonicalFindingKey,
  findingId,
  assignFindingIds,
};
