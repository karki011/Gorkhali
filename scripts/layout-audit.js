// Author: Subash Karki
// layout-audit.js — zero-dependency, browser-side layout auditor. Injected into
// any page (via browser_evaluate or an inline <script>), it defines
// window.__lavishAudit(), which synchronously walks the live DOM and returns a
// structured report of layout defects: page/element horizontal overflow, text
// that is clipped or spills its box, off-canvas children, and unrelated text
// that visually collides. Findings carry a selector, a kind, an overflow pixel
// count, and an error/warning severity so the caller can gate on real clips.
//
// Adapted from lavish-axi artifact-sdk.js (MIT, © 2026 Kun Chen) —
// github.com/kunchenguid/lavish-axi. The original is an in-iframe annotation
// SDK that schedules the audit off font-ready/ResizeObserver settle and posts
// results to a parent chrome. This port keeps the pure classification math and
// the DOM audit engine (lines 402-669) but drops the messaging and async-settle
// plumbing: an on-demand __lavishAudit() runs the same checks synchronously so a
// visual agent or a self-auditing artifact can pull the report when it wants it.
//
// DUAL-CONTEXT: the same file is both the injectable browser source AND a node
// module. Every DOM reference lives inside runAudit(); a `require()` in node with
// no window present exercises the pure geometry/scoring exports and never throws.

(function (root) {
  'use strict';

  // Below this the element scroll is treated as flush, not overflow (1px of
  // sub-pixel rounding is normal). Above ERROR_OVERFLOW_PX a generic overflow is
  // an error rather than a warning — a few pixels of spill is cosmetic, more is a
  // real break.
  var OVERFLOW_EPSILON = 1;
  var ERROR_OVERFLOW_PX = 4;

  function toPixelNumber(value) {
    var parsed = Number.parseFloat(String(value || '0'));
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function roundedOverflowPx(value) {
    return Math.round(Math.max(0, value) * 10) / 10;
  }

  function overflowSeverity(overflowPx, errorOverflowPx) {
    var threshold = Number.isFinite(errorOverflowPx) ? errorOverflowPx : ERROR_OVERFLOW_PX;
    return overflowPx > threshold ? 'error' : 'warning';
  }

  function rectArea(rect) {
    return Math.max(0, rect.width) * Math.max(0, rect.height);
  }

  // Wrapped inline text (a bold phrase or code token that breaks across a line)
  // reports one getBoundingClientRect() spanning both lines, so a bounding-box
  // test "overlaps" everything sitting in the reflow gap between the fragments
  // even though nothing is drawn there. Comparing real per-line fragments
  // (getClientRects()) only flags overlap where rendered pixels actually collide.
  function fragmentsSignificantlyOverlap(fragmentsA, fragmentsB, opts) {
    var options = opts || {};
    var minAreaRatio = options.minAreaRatio === undefined ? 0.25 : options.minAreaRatio;
    var minAreaPx = options.minAreaPx === undefined ? 24 : options.minAreaPx;

    function rectAreaOf(rect) {
      return Math.max(0, rect.width) * Math.max(0, rect.height);
    }

    function intersectionAreaOf(a, b) {
      var width = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left));
      var height = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
      return width * height;
    }

    for (var i = 0; i < fragmentsA.length; i += 1) {
      var a = fragmentsA[i];
      var threshold = Math.min(rectAreaOf(a) * minAreaRatio, minAreaPx);
      for (var j = 0; j < fragmentsB.length; j += 1) {
        if (intersectionAreaOf(a, fragmentsB[j]) >= threshold) return true;
      }
    }
    return false;
  }

  // scrollWidth/scrollHeight can only exceed clientWidth/clientHeight when the box
  // is size-constrained (a fixed width, or a flex/grid item smaller than its
  // content) — a box that grows to fit its content always has scrollHeight ===
  // clientHeight, so this never false-positives on ordinary auto-sized elements.
  function classifyHorizontalOverflow(input) {
    var scrollWidth = input.scrollWidth;
    var clientWidth = input.clientWidth;
    var overflowX = input.overflowX;
    var hasText = input.hasText;
    var isTruncated = input.isTruncated;
    var epsilon = input.epsilon === undefined ? 1 : input.epsilon;

    var overflowPx = clientWidth > 0 ? scrollWidth - clientWidth : 0;
    if (overflowPx <= epsilon) return null;
    var clipsText = hasText && (overflowX === 'hidden' || overflowX === 'clip') && !isTruncated;
    return { overflowPx: overflowPx, kind: clipsText ? 'clipped-text' : 'element-scroll-overflow' };
  }

  // Fixed-size badges/buttons/pills usually leave overflow at its default
  // "visible" — the text isn't clipped, it spills out of the box and overlaps
  // neighbors, which is just as broken. Only "auto"/"scroll" are treated as
  // intentional. `clips` distinguishes a hard clip (hidden/clip — content gone)
  // from a visible spill; a spill bubbles into every unconstrained block
  // ancestor's scrollHeight too, so callers dedup against the innermost element
  // actually responsible before reporting.
  function classifyVerticalOverflow(input) {
    var scrollHeight = input.scrollHeight;
    var clientHeight = input.clientHeight;
    var overflowY = input.overflowY;
    var hasText = input.hasText;
    var isTruncated = input.isTruncated;
    var epsilon = input.epsilon === undefined ? 1 : input.epsilon;

    var overflowPx = clientHeight > 0 ? scrollHeight - clientHeight : 0;
    if (overflowPx <= epsilon) return null;
    var scrollable = overflowY === 'auto' || overflowY === 'scroll';
    if (scrollable || !hasText || isTruncated) return null;
    var clips = overflowY === 'hidden' || overflowY === 'clip';
    return { overflowPx: overflowPx, kind: 'clipped-text', clips: clips };
  }

  // A visible spill bubbles up every unconstrained block ancestor, so the same
  // spill shows up as a candidate at multiple depths sharing one bottom edge.
  // Keep only the innermost element responsible for each distinct spill edge.
  function resolveVisibleSpillCandidates(spillCandidates, opts) {
    var epsilon = (opts && opts.epsilon !== undefined) ? opts.epsilon : 1;

    function spillBottomEdge(candidate) {
      var explicit = Number(candidate.spillBottom);
      if (Number.isFinite(explicit)) return explicit;
      var rectBottom = Number(candidate.rect && candidate.rect.bottom);
      var overflowPx = Number(candidate.overflowPx);
      if (!Number.isFinite(rectBottom) || !Number.isFinite(overflowPx)) return null;
      return rectBottom + overflowPx;
    }

    function sameSpillEdge(candidate, other) {
      var candidateBottom = spillBottomEdge(candidate);
      var otherBottom = spillBottomEdge(other);
      return candidateBottom !== null && otherBottom !== null && Math.abs(candidateBottom - otherBottom) <= epsilon;
    }

    return spillCandidates.filter(function (candidate) {
      return !spillCandidates.some(function (other) {
        return other.el !== candidate.el && candidate.el.contains(other.el) && sameSpillEdge(candidate, other);
      });
    });
  }

  // ---- DOM audit engine — only reachable in a browser (all globals live here) ----

  function runAudit() {
    var viewportWidth = window.innerWidth || document.documentElement.clientWidth || 0;

    function isLavishUi(el) {
      return !!(el && el.closest && el.closest('[data-lavish-ui]'));
    }

    function selector(el) {
      if (!el || !el.tagName) return '';
      var parts = [];
      var node = el;
      while (node && node.nodeType === 1 && parts.length < 5) {
        var part = node.tagName.toLowerCase();
        if (node.id) {
          part += '#' + CSS.escape(node.id);
          parts.unshift(part);
          break;
        }
        var parent = node.parentElement;
        if (parent) {
          var same = Array.prototype.slice.call(parent.children).filter(function (x) {
            return x.tagName === node.tagName;
          });
          if (same.length > 1) part += ':nth-of-type(' + (same.indexOf(node) + 1) + ')';
        }
        parts.unshift(part);
        node = parent;
      }
      return parts.join(' > ');
    }

    function elementText(el) {
      return String((el && (el.innerText || el.textContent)) || '')
        .trim()
        .replace(/\s+/g, ' ');
    }

    function hasReadableText(el) {
      return elementText(el).length > 0;
    }

    function isVisibleForLayoutAudit(el, rect) {
      var box = rect || el.getBoundingClientRect();
      if (!el || isLavishUi(el) || box.width <= 0 || box.height <= 0) return false;
      var style = getComputedStyle(el);
      return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
    }

    function isIntentionalHorizontalScroller(el) {
      if (!el || el === document.body || el === document.documentElement) return false;
      var overflowX = getComputedStyle(el).overflowX;
      return overflowX === 'auto' || overflowX === 'scroll';
    }

    function hasIntentionalHorizontalScrollerAncestor(el) {
      var node = el;
      while (node && node.nodeType === 1 && node !== document.body && node !== document.documentElement) {
        if (isIntentionalHorizontalScroller(node)) return true;
        node = node.parentElement;
      }
      return false;
    }

    function contentBoxRect(el) {
      var rect = el.getBoundingClientRect();
      var style = getComputedStyle(el);
      return {
        left: rect.left + toPixelNumber(style.borderLeftWidth) + toPixelNumber(style.paddingLeft),
        right: rect.right - toPixelNumber(style.borderRightWidth) - toPixelNumber(style.paddingRight),
        top: rect.top + toPixelNumber(style.borderTopWidth) + toPixelNumber(style.paddingTop),
        bottom: rect.bottom - toPixelNumber(style.borderBottomWidth) - toPixelNumber(style.paddingBottom),
      };
    }

    function collectLayoutAuditElements() {
      var elements = [];
      function walk(el) {
        if (!(el instanceof Element) || isLavishUi(el)) return;
        if (isIntentionalHorizontalScroller(el)) return;
        elements.push(el);
        for (var i = 0; i < el.children.length; i += 1) walk(el.children[i]);
      }
      if (document.body) walk(document.body);
      return elements;
    }

    function pushLayoutFinding(findings, seen, finding) {
      var selectorValue = finding.selector || '';
      var key = finding.kind + ':' + selectorValue;
      if (seen.has(key)) return;
      seen.add(key);
      findings.push({
        selector: selectorValue,
        kind: String(finding.kind || 'layout-warning'),
        overflowPx: roundedOverflowPx(finding.overflowPx),
        viewportWidth: Math.round(Number(finding.viewportWidth) || window.innerWidth || 0),
        severity: finding.severity === 'warning' ? 'warning' : 'error',
      });
    }

    function isIntentionalTextTruncation(style) {
      return style.textOverflow === 'ellipsis' || Number.parseInt(style.webkitLineClamp || '0', 10) > 0;
    }

    function auditElementOverflow(el, findings, seen, spillCandidates) {
      if (el === document.body || el === document.documentElement || hasIntentionalHorizontalScrollerAncestor(el)) return;

      var rect = el.getBoundingClientRect();
      if (!isVisibleForLayoutAudit(el, rect)) return;

      var style = getComputedStyle(el);
      var hasText = hasReadableText(el);
      var isTruncated = isIntentionalTextTruncation(style);

      var horizontal = classifyHorizontalOverflow({
        scrollWidth: el.scrollWidth,
        clientWidth: el.clientWidth,
        overflowX: style.overflowX,
        hasText: hasText,
        isTruncated: isTruncated,
        epsilon: OVERFLOW_EPSILON,
      });
      if (horizontal) {
        pushLayoutFinding(findings, seen, {
          selector: selector(el),
          kind: horizontal.kind,
          overflowPx: horizontal.overflowPx,
          viewportWidth: viewportWidth,
          severity: horizontal.kind === 'clipped-text' ? 'error' : overflowSeverity(horizontal.overflowPx),
        });
      }

      var vertical = classifyVerticalOverflow({
        scrollHeight: el.scrollHeight,
        clientHeight: el.clientHeight,
        overflowY: style.overflowY,
        hasText: hasText,
        isTruncated: isTruncated,
        epsilon: OVERFLOW_EPSILON,
      });
      if (vertical) {
        if (vertical.clips) {
          pushLayoutFinding(findings, seen, {
            selector: selector(el),
            kind: vertical.kind,
            overflowPx: vertical.overflowPx,
            viewportWidth: viewportWidth,
            severity: 'error',
          });
        } else {
          spillCandidates.push({
            el: el,
            selector: selector(el),
            overflowPx: vertical.overflowPx,
            viewportWidth: viewportWidth,
            spillBottom: rect.bottom + vertical.overflowPx,
          });
        }
      }

      var parent = el.parentElement;
      if (!parent || parent === document.body || parent === document.documentElement) return;
      if (hasIntentionalHorizontalScrollerAncestor(parent)) return;

      var parentBox = contentBoxRect(parent);
      var parentOverflowPx = rect.right - parentBox.right;
      if (parentOverflowPx > OVERFLOW_EPSILON && rectArea(rect) > 1) {
        var positionedOffCanvas =
          style.position === 'absolute' || style.position === 'fixed' || style.position === 'sticky';
        pushLayoutFinding(findings, seen, {
          selector: selector(el),
          kind: 'element-parent-overflow',
          overflowPx: parentOverflowPx,
          viewportWidth: viewportWidth,
          severity: positionedOffCanvas ? 'warning' : overflowSeverity(parentOverflowPx),
        });
      }
    }

    function resolveSpillCandidates(spillCandidates, findings, seen) {
      var visible = resolveVisibleSpillCandidates(spillCandidates, { epsilon: OVERFLOW_EPSILON });
      for (var i = 0; i < visible.length; i += 1) {
        var candidate = visible[i];
        pushLayoutFinding(findings, seen, {
          selector: candidate.selector,
          kind: 'clipped-text',
          overflowPx: candidate.overflowPx,
          viewportWidth: candidate.viewportWidth,
          severity: 'error',
        });
      }
    }

    // getClientRects() returns one rect per rendered line fragment; falls back to
    // the bounding rect for elements the browser doesn't fragment (replaced els).
    function elementLineFragments(el) {
      var rects = Array.prototype.slice.call(el.getClientRects()).filter(function (r) {
        return r.width > 0 && r.height > 0;
      });
      if (rects.length) return rects;
      var rect = el.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 ? [rect] : [];
    }

    function auditOverlappingText(elements, findings, seen) {
      var candidates = elements
        .filter(function (el) {
          return el.children.length === 0 && hasReadableText(el);
        })
        .filter(function (el) {
          return isVisibleForLayoutAudit(el);
        })
        .filter(function (el) {
          return getComputedStyle(el).position === 'static';
        })
        .slice(0, 200);

      for (var c = 0; c < candidates.length; c += 1) {
        var el = candidates[c];
        var fragments = elementLineFragments(el);
        var flagged = false;

        for (var f = 0; f < fragments.length && !flagged; f += 1) {
          var rect = fragments[f];
          if (rectArea(rect) < 16) continue;
          var points = [
            { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 },
            { x: rect.left + Math.min(4, rect.width / 2), y: rect.top + Math.min(4, rect.height / 2) },
            { x: rect.right - Math.min(4, rect.width / 2), y: rect.bottom - Math.min(4, rect.height / 2) },
          ];
          for (var p = 0; p < points.length; p += 1) {
            var point = points[p];
            if (point.x < 0 || point.y < 0 || point.x > viewportWidth || point.y > window.innerHeight) continue;
            var top = document.elementFromPoint(point.x, point.y);
            if (!(top instanceof Element) || top === el || el.contains(top) || top.contains(el) || isLavishUi(top)) continue;
            if (hasIntentionalHorizontalScrollerAncestor(top)) continue;
            if (getComputedStyle(top).position !== 'static') continue;
            if (!fragmentsSignificantlyOverlap([rect], elementLineFragments(top))) continue;
            pushLayoutFinding(findings, seen, {
              selector: selector(el),
              kind: 'overlapping-text',
              overflowPx: 0,
              viewportWidth: viewportWidth,
              // Heuristic and sampling-based even after fragment-aware matching, so
              // it stays a warning rather than an error the way a real clip does.
              severity: 'warning',
            });
            flagged = true;
            break;
          }
        }
      }
    }

    var findings = [];
    var seen = new Set();

    var pageOverflowPx = document.documentElement.scrollWidth - viewportWidth;
    if (pageOverflowPx > OVERFLOW_EPSILON) {
      pushLayoutFinding(findings, seen, {
        selector: 'html',
        kind: 'page-horizontal-overflow',
        overflowPx: pageOverflowPx,
        viewportWidth: viewportWidth,
        severity: overflowSeverity(pageOverflowPx),
      });
    }

    var elements = collectLayoutAuditElements();
    var spillCandidates = [];
    for (var i = 0; i < elements.length; i += 1) {
      auditElementOverflow(elements[i], findings, seen, spillCandidates);
    }
    resolveSpillCandidates(spillCandidates, findings, seen);
    auditOverlappingText(elements, findings, seen);

    var errors = findings.filter(function (finding) {
      return finding.severity === 'error';
    }).length;

    return {
      viewportWidth: viewportWidth,
      findings: findings,
      counts: { error: errors, warning: findings.length - errors, total: findings.length },
    };
  }

  var api = {
    OVERFLOW_EPSILON: OVERFLOW_EPSILON,
    ERROR_OVERFLOW_PX: ERROR_OVERFLOW_PX,
    toPixelNumber: toPixelNumber,
    roundedOverflowPx: roundedOverflowPx,
    overflowSeverity: overflowSeverity,
    rectArea: rectArea,
    fragmentsSignificantlyOverlap: fragmentsSignificantlyOverlap,
    classifyHorizontalOverflow: classifyHorizontalOverflow,
    classifyVerticalOverflow: classifyVerticalOverflow,
    resolveVisibleSpillCandidates: resolveVisibleSpillCandidates,
    runAudit: runAudit,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }

  if (typeof window !== 'undefined') {
    // The one entry point an injected snippet or a self-auditing artifact calls.
    window.__lavishAudit = function () {
      return runAudit();
    };
  }

  return api;
})(typeof globalThis !== 'undefined' ? globalThis : this);

// CLI harness (node only). `--source` emits the inject-ready snippet a caller
// feeds to browser_evaluate; anything else prints usage. Guarded so the browser
// context — where require/module are absent — never reaches this block.
if (typeof require !== 'undefined' && typeof module !== 'undefined' && require.main === module) {
  var fs = require('fs');
  var arg = process.argv[2];
  if (arg === '--source') {
    process.stdout.write(fs.readFileSync(__filename, 'utf8'));
  } else {
    process.stdout.write(
      [
        'layout-audit.js — zero-dependency browser layout auditor.',
        '',
        'Usage:',
        '  node scripts/layout-audit.js --source   Emit the inject-ready browser snippet.',
        '  node scripts/layout-audit.js --help     Show this help.',
        '',
        'Inject the --source output via browser_evaluate, then call window.__lavishAudit()',
        'to get the structured layout report ({ viewportWidth, findings, counts }).',
        '',
      ].join('\n'),
    );
  }
}
