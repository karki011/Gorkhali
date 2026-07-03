// Author: Subash Karki
// layout-audit.test.js — locks the pure geometry/classification/scoring math of
// scripts/layout-audit.js. These are the DOM-free exports; the require itself
// (with no window present) also proves the dual-context guard — a node load must
// not throw. DOM-dependent behavior is exercised with plain fake-shape objects
// (rects / minimal nodes mimicking Element), never a jsdom dependency, per the
// repo's zero-new-deps rule.
//
// Cases ported from lavish-axi test/artifact-sdk.test.js (MIT, © 2026 Kun Chen).
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  classifyHorizontalOverflow,
  classifyVerticalOverflow,
  fragmentsSignificantlyOverlap,
  resolveVisibleSpillCandidates,
  overflowSeverity,
  roundedOverflowPx,
  toPixelNumber,
  rectArea,
  ERROR_OVERFLOW_PX,
} = require('../scripts/layout-audit.js');

// Minimal fake element: parent chain + contains(), enough for spill dedup.
function node(children = []) {
  const el = {
    parentElement: null,
    children,
    contains(other) {
      let current = other;
      while (current) {
        if (current === this) return true;
        current = current.parentElement;
      }
      return false;
    },
  };
  for (const child of children) child.parentElement = el;
  return el;
}

test('1. require in node (no window) exposes the pure API without throwing', () => {
  assert.equal(typeof fragmentsSignificantlyOverlap, 'function');
  assert.equal(typeof classifyVerticalOverflow, 'function');
  assert.equal(typeof globalThis.window, 'undefined');
});

test('2. fragmentsSignificantlyOverlap ignores the reflow gap in a wrapped inline phrase', () => {
  const wrappedFragments = [
    { left: 620, right: 900, top: 100, bottom: 120, width: 280, height: 20 },
    { left: 0, right: 260, top: 120, bottom: 140, width: 260, height: 20 },
  ];
  const siblingInTheGap = [{ left: 300, right: 600, top: 100, bottom: 120, width: 300, height: 20 }];
  assert.equal(fragmentsSignificantlyOverlap(wrappedFragments, siblingInTheGap), false);
});

test('3. fragmentsSignificantlyOverlap flags real pixel intersection between rendered fragments', () => {
  const elFragments = [{ left: 0, right: 100, top: 0, bottom: 20, width: 100, height: 20 }];
  const otherFragments = [{ left: 40, right: 140, top: 5, bottom: 25, width: 100, height: 20 }];
  assert.equal(fragmentsSignificantlyOverlap(elFragments, otherFragments), true);
});

test('4. fragmentsSignificantlyOverlap ignores sub-threshold seam overlap between adjacent lines', () => {
  const elFragments = [{ left: 0, right: 200, top: 0, bottom: 20, width: 200, height: 20 }];
  const barelyTouching = [{ left: 199, right: 210, top: 0, bottom: 20, width: 11, height: 20 }];
  assert.equal(fragmentsSignificantlyOverlap(elFragments, barelyTouching), false);
});

test('5. classifyVerticalOverflow flags a fixed-height badge whose label spills with default overflow', () => {
  const finding = classifyVerticalOverflow({
    scrollHeight: 40,
    clientHeight: 24,
    overflowY: 'visible',
    hasText: true,
    isTruncated: false,
  });
  assert.deepEqual(finding, { overflowPx: 16, kind: 'clipped-text', clips: false });
});

test('6. classifyVerticalOverflow marks hidden/clip overflow-y as a hard clip', () => {
  const finding = classifyVerticalOverflow({
    scrollHeight: 40,
    clientHeight: 24,
    overflowY: 'hidden',
    hasText: true,
    isTruncated: false,
  });
  assert.deepEqual(finding, { overflowPx: 16, kind: 'clipped-text', clips: true });
});

test('7. classifyVerticalOverflow ignores intentionally scrollable containers', () => {
  assert.equal(
    classifyVerticalOverflow({ scrollHeight: 400, clientHeight: 200, overflowY: 'auto', hasText: true, isTruncated: false }),
    null,
  );
});

test('8. classifyVerticalOverflow ignores boxes that simply grow to fit their content', () => {
  assert.equal(
    classifyVerticalOverflow({ scrollHeight: 100, clientHeight: 100, overflowY: 'visible', hasText: true, isTruncated: false }),
    null,
  );
});

test('9. classifyHorizontalOverflow distinguishes clipped text from generic scroll overflow', () => {
  assert.deepEqual(
    classifyHorizontalOverflow({ scrollWidth: 300, clientWidth: 200, overflowX: 'hidden', hasText: true, isTruncated: false }),
    { overflowPx: 100, kind: 'clipped-text' },
  );
  assert.deepEqual(
    classifyHorizontalOverflow({ scrollWidth: 300, clientWidth: 200, overflowX: 'visible', hasText: true, isTruncated: false }),
    { overflowPx: 100, kind: 'element-scroll-overflow' },
  );
});

test('10. resolveVisibleSpillCandidates keeps the deepest candidate for one bubbled spill', () => {
  const badge = node();
  const row = node([badge]);
  const section = node([row]);
  const candidates = [
    { el: section, selector: 'section', overflowPx: 16, spillBottom: 140 },
    { el: row, selector: '.row', overflowPx: 16, spillBottom: 140 },
    { el: badge, selector: '.badge', overflowPx: 16, spillBottom: 140 },
  ];
  assert.deepEqual(
    resolveVisibleSpillCandidates(candidates).map((c) => c.selector),
    ['.badge'],
  );
});

test('11. resolveVisibleSpillCandidates preserves ancestors with independent overflow', () => {
  const badge = node();
  const section = node([badge]);
  const candidates = [
    { el: section, selector: 'section', overflowPx: 48, spillBottom: 220 },
    { el: badge, selector: '.badge', overflowPx: 16, spillBottom: 140 },
  ];
  assert.deepEqual(
    resolveVisibleSpillCandidates(candidates).map((c) => c.selector),
    ['section', '.badge'],
  );
});

test('12. resolveVisibleSpillCandidates derives the spill edge from rect + overflow when spillBottom is absent', () => {
  const badge = node();
  const section = node([badge]);
  const candidates = [
    { el: section, selector: 'section', overflowPx: 16, rect: { bottom: 124 } },
    { el: badge, selector: '.badge', overflowPx: 16, rect: { bottom: 124 } },
  ];
  assert.deepEqual(
    resolveVisibleSpillCandidates(candidates).map((c) => c.selector),
    ['.badge'],
  );
});

test('13. overflowSeverity: error above the threshold, warning at or below', () => {
  assert.equal(overflowSeverity(ERROR_OVERFLOW_PX + 1), 'error');
  assert.equal(overflowSeverity(ERROR_OVERFLOW_PX), 'warning');
  assert.equal(overflowSeverity(0), 'warning');
  assert.equal(overflowSeverity(100, 200), 'warning');
});

test('14. roundedOverflowPx clamps negatives to 0 and rounds to one decimal', () => {
  assert.equal(roundedOverflowPx(-5), 0);
  assert.equal(roundedOverflowPx(16.04), 16);
  assert.equal(roundedOverflowPx(16.06), 16.1);
});

test('15. toPixelNumber parses px strings and falls back to 0 for junk', () => {
  assert.equal(toPixelNumber('12px'), 12);
  assert.equal(toPixelNumber('  3.5rem'), 3.5);
  assert.equal(toPixelNumber('auto'), 0);
  assert.equal(toPixelNumber(null), 0);
});

test('16. rectArea multiplies non-negative dimensions and floors negatives to 0', () => {
  assert.equal(rectArea({ width: 10, height: 4 }), 40);
  assert.equal(rectArea({ width: -10, height: 4 }), 0);
});
