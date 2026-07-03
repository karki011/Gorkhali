// Author: Subash Karki
// render-output.js - shared output vocabulary: count phrasing, numbered help
// hints, the "already: true" idempotent no-op marker, and a single render()
// that prints one plain result object in stable key order at the very end of
// a command - never mid-computation.
//
// Adapted from gh-axi format.ts and toon.ts (MIT, (c) 2026 Kun Chen) -
// github.com/kunchenguid/gh-axi. Both originals build TOON-encoded blocks via
// the @toon-format/toon package; this port keeps only the plain-object
// "key: value" vocabulary (count/help/already phrasing) and drops the TOON
// dependency entirely - render() is a dependency-free line-per-key
// formatter, not a TOON encoder.
'use strict';

/**
 * formatCount(opts) -> string
 *
 * opts: { count, limit, totalCount, apiLimitHit, displayLimit }. Mirrors
 * gh-axi's formatCountLine phrasing exactly:
 *   count: N                                     - simple count
 *   count: N of T total                          - totalCount known
 *   count: N (showing first N)                   - truncated by limit or displayLimit
 *   count: N+ (GitHub search API limit reached)  - search API limit
 * totalCount takes priority over limit/displayLimit truncation messages.
 */
function formatCount(opts = {}) {
  const { count, limit, totalCount, apiLimitHit, displayLimit } = opts;

  if (apiLimitHit) {
    return `count: ${count}+ (GitHub search API limit reached)`;
  }

  if (totalCount !== undefined && totalCount !== null) {
    return `count: ${count} of ${totalCount} total`;
  }

  if (displayLimit !== undefined && count > displayLimit) {
    return `count: ${count} (showing first ${displayLimit})`;
  }

  if (limit !== undefined && count === limit && count > 0) {
    return `count: ${count} (showing first ${count})`;
  }

  return `count: ${count}`;
}

/**
 * renderHelp(lines) -> string
 *
 * Numbered "help[N]:" block, one indented line per hint. Empty input renders
 * nothing so render() can skip a `help` key with no hints.
 */
function renderHelp(lines) {
  if (!lines || lines.length === 0) return '';
  const indented = lines.map((line) => `  ${line}`).join('\n');
  return `help[${lines.length}]:\n${indented}`;
}

/**
 * withAlready(fields) -> object
 *
 * The idempotent no-op convention (gh-axi pr.ts's close/reopen/ready): a
 * command that finds its target already in the requested state returns the
 * same identifying fields a real change would, plus `already: true`
 * appended last - a no-op re-run still gets a result the caller can key off.
 */
function withAlready(fields) {
  return { ...fields, already: true };
}

function formatValue(value) {
  if (Array.isArray(value)) {
    return value.length > 0 ? value.join(',') : 'none';
  }
  if (value === undefined || value === null) return 'null';
  return String(value);
}

/**
 * render(result) -> string
 *
 * Takes ONE plain object built by a command after all its work is done and
 * renders it in the object's own key order - the render-once discipline:
 * build the result, call render() a single time at the end, never
 * console.log mid-computation. A `count` key (a formatCount opts object)
 * and a `help` key (an array of hint strings) get their special phrasing;
 * every other key prints as `key: value`.
 */
function render(result) {
  const lines = [];
  for (const key of Object.keys(result)) {
    const value = result[key];
    if (key === 'count' && value && typeof value === 'object' && !Array.isArray(value)) {
      lines.push(formatCount(value));
    } else if (key === 'help' && Array.isArray(value)) {
      const block = renderHelp(value);
      if (block) lines.push(block);
    } else {
      lines.push(`${key}: ${formatValue(value)}`);
    }
  }
  return lines.join('\n');
}

module.exports = {
  formatCount,
  renderHelp,
  withAlready,
  render,
};

// CLI: node scripts/lib/render-output.js --help
// Demo of the vocabulary only - real commands import render-output as a
// library and call render() once, at the end, with their own result object.
if (require.main === module) {
  const demo = withAlready({ number: 42, state: 'closed' });
  demo.count = { count: 3, totalCount: 12 };
  demo.help = ['gh pr view 42', 'gh pr reopen 42'];
  process.stdout.write(`${render(demo)}\n`);
}
