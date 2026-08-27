// Author: Subash Karki
// learnings-cited.js — durable store for which learning keywords a session
// actually recalled. Sidecar `learnings-cited.json` is the source of truth:
// Phase A may rewrite context.json, and the first UserPromptSubmit often fires
// before context.json exists. When context.json is already a valid JSON object,
// citations are also merged onto it (and onto evidence.learningsCited when
// evidence is a plain object) so the portable envelope carries the same field.
'use strict';

const fs = require('fs');
const path = require('path');
const { atomicUpdate, readFileSafe } = require('./atomic');

const CITATION_FILE = 'learnings-cited.json';

let CITATION_FIELD = 'learningsCited';
try {
  const C = require('./constants');
  CITATION_FIELD = C.LEARNING_CITATION_FIELD ?? CITATION_FIELD;
} catch (_) { /* fail open: lib missing → inline default */ }

const ATOMIC_OPTS = { onContended: 'run-unlocked' };

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Trim, strip one surrounding `[]` pair, lowercase. Empty after that is ''. */
function normalizeKeyword(raw) {
  return String(raw == null ? '' : raw).trim().replace(/^\[|\]$/g, '').toLowerCase();
}

/** Unique normalized keywords, first-seen order. Non-arrays yield []. */
function uniqueKeywords(raws) {
  const seen = new Set();
  const out = [];
  if (!Array.isArray(raws)) return out;
  for (const raw of raws) {
    const keyword = normalizeKeyword(raw);
    if (!keyword || seen.has(keyword)) continue;
    seen.add(keyword);
    out.push(keyword);
  }
  return out;
}

function citedFrom(value) {
  return uniqueKeywords(Array.isArray(value) ? value : []);
}

function parseObject(text) {
  if (text == null || text === '') return null;
  try {
    const value = JSON.parse(text);
    return isPlainObject(value) ? value : null;
  } catch (_) {
    return null;
  }
}

function mergeKeywords(existing, incoming) {
  return uniqueKeywords([...existing, ...incoming]);
}

function sameList(a, b) {
  return a.length === b.length && a.every((item, i) => item === b[i]);
}

function sidecarPath(sessionDir) {
  return path.join(sessionDir, CITATION_FILE);
}

function contextPath(sessionDir) {
  return path.join(sessionDir, 'context.json');
}

/**
 * Union sidecar + context.json top-level + context.evidence, first-seen order.
 * Missing or unparseable sources contribute nothing. Never throws.
 */
function readSessionCited(sessionDir) {
  try {
    const sidecar = parseObject(readFileSafe(sidecarPath(sessionDir)));
    const context = parseObject(readFileSafe(contextPath(sessionDir)));
    const evidence = context && isPlainObject(context.evidence) ? context.evidence : null;
    return uniqueKeywords([
      ...citedFrom(sidecar && sidecar[CITATION_FIELD]),
      ...citedFrom(context && context[CITATION_FIELD]),
      ...citedFrom(evidence && evidence[CITATION_FIELD]),
    ]);
  } catch (_) {
    return [];
  }
}

function writeSidecar(sessionDir, incoming) {
  atomicUpdate(
    sidecarPath(sessionDir),
    (current) => {
      const parsed = parseObject(current);
      const existing = citedFrom(parsed && parsed[CITATION_FIELD]);
      const merged = mergeKeywords(existing, incoming);
      if (parsed && sameList(existing, merged) && parsed.schema_version === 1) return null;
      return JSON.stringify({ schema_version: 1, [CITATION_FIELD]: merged }, null, 2) + '\n';
    },
    ATOMIC_OPTS,
  );
}

function mergeContext(sessionDir, incoming) {
  const file = contextPath(sessionDir);
  // Never create context.json from this writer.
  if (!fs.existsSync(file)) return;
  atomicUpdate(
    file,
    (current) => {
      // Never clobber a parse-failed (or non-object) context.json.
      const parsed = parseObject(current);
      if (!parsed) return null;
      const next = { ...parsed };
      const top = mergeKeywords(citedFrom(parsed[CITATION_FIELD]), incoming);
      next[CITATION_FIELD] = top;
      let evidenceChanged = false;
      if (isPlainObject(parsed.evidence)) {
        const evidenceCited = mergeKeywords(citedFrom(parsed.evidence[CITATION_FIELD]), incoming);
        next.evidence = { ...parsed.evidence, [CITATION_FIELD]: evidenceCited };
        evidenceChanged = !sameList(citedFrom(parsed.evidence[CITATION_FIELD]), evidenceCited);
      }
      if (!evidenceChanged && sameList(citedFrom(parsed[CITATION_FIELD]), top)) return null;
      return JSON.stringify(next, null, 2) + '\n';
    },
    ATOMIC_OPTS,
  );
}

/**
 * Record `keywords` against an existing session directory. Empty after
 * normalize is a no-op. Sidecar is always the durable write; context.json is
 * merged only when it already exists and parses as a JSON object.
 */
function recordSessionCited(sessionDir, keywords) {
  const incoming = uniqueKeywords(keywords);
  if (incoming.length === 0) return;
  writeSidecar(sessionDir, incoming);
  mergeContext(sessionDir, incoming);
}

module.exports = {
  CITATION_FILE,
  normalizeKeyword,
  uniqueKeywords,
  readSessionCited,
  recordSessionCited,
};
