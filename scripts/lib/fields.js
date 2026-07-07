// Author: Subash Karki
// fields.js - plain-object --fields validation and projection: parseFields
// validates a comma-separated field list against a known set, pickFields
// projects an object down to just those keys (in requested order), and
// resolveFields picks between --full, an explicit --fields list, and a
// feature's default field set. No FieldDef/TOON type system here - this
// port works on plain objects only.
//
// Adapted from gh-axi (github.com/kunchenguid/gh-axi) (MIT, (c) 2026 Kun Chen).
// gh-axi's fields.ts validates --fields against a FieldDef map and returns
// TOON extraction defs; this port drops the FieldDef/TOON layer entirely -
// parseFields returns field NAMES, and pickFields does the actual
// projection on a plain object.
'use strict';

const { PhantomError, reportError, VALIDATION_ERROR } = require('./axi-error');

// validNames may be an array of names or a map keyed by name (gh-axi's
// `available` shape) - either way we only care about the key set.
function _namesOf(x) {
  if (Array.isArray(x)) return x.slice();
  if (x && typeof x === 'object') return Object.keys(x);
  return [];
}

/**
 * parseFields(fieldsArg, validNames) -> string[]
 *
 * fieldsArg undefined/empty -> []. Otherwise split on ',', trim, drop empty
 * segments, dedup. Any name not in validNames throws a PhantomError
 * (VALIDATION_ERROR) listing the unknown names in supplied order and the
 * full valid set sorted alphabetically.
 */
function parseFields(fieldsArg, validNames) {
  if (!fieldsArg) return [];

  const requested = [...new Set(
    fieldsArg.split(',').map((f) => f.trim()).filter(Boolean),
  )];

  const valid = new Set(_namesOf(validNames));
  const unknown = requested.filter((f) => !valid.has(f));
  if (unknown.length > 0) {
    const sorted = [...valid].sort().join(', ');
    throw new PhantomError(
      `Unknown field(s): ${unknown.join(', ')}. Available: ${sorted}`,
      VALIDATION_ERROR,
      [`Choose from: ${sorted}`],
    );
  }

  return requested;
}

/**
 * pickFields(obj, fields) -> object
 *
 * New object holding only `fields`, in the order given. Empty fields ->
 * the original object, unchanged.
 */
function pickFields(obj, fields) {
  if (!fields || fields.length === 0) return obj;
  const picked = {};
  for (const f of fields) picked[f] = obj[f];
  return picked;
}

/**
 * resolveFields({ fieldsArg, full, defaultFields, allFields }) -> string[]
 *
 * full === true -> allFields; else fieldsArg present -> parseFields(fieldsArg,
 * allFields); else -> defaultFields. Keep defaultFields minimal - it's the
 * schema shown when the caller asks for neither --full nor --fields.
 */
function resolveFields({ fieldsArg, full, defaultFields, allFields } = {}) {
  if (full === true) return _namesOf(allFields);
  if (fieldsArg !== undefined) return parseFields(fieldsArg, allFields);
  return _namesOf(defaultFields);
}

module.exports = { parseFields, pickFields, resolveFields };

// CLI: node fields.js parse <comma-list> --valid a,b,c
//      node fields.js pick <json|-> --fields a,b   # '-' or omitted json reads stdin
if (require.main === module) {
  const [, , cmd, ...rest] = process.argv;

  function usage() {
    process.stderr.write(
      'Usage:\n' +
      '  node fields.js parse <comma-list> --valid a,b,c\n' +
      '  node fields.js pick <json|-> --fields a,b   # \'-\' or omitted json reads stdin\n',
    );
    process.exit(2);
  }

  function flagValue(name) {
    const i = rest.indexOf(name);
    return i === -1 ? undefined : rest[i + 1];
  }

  if (!cmd || cmd === '--help') usage();

  if (cmd === 'parse') {
    const fieldsArg = rest[0];
    const validArg = flagValue('--valid');
    if (!fieldsArg || fieldsArg.startsWith('--') || !validArg) usage();
    const validNames = validArg.split(',').map((s) => s.trim()).filter(Boolean);
    try {
      const result = parseFields(fieldsArg, validNames);
      process.stdout.write(result.map((f) => `${f}\n`).join(''));
      process.exitCode = 0;
    } catch (err) {
      reportError(err, process.stderr);
    }
  } else if (cmd === 'pick') {
    const jsonArg = rest[0] && !rest[0].startsWith('--') ? rest[0] : undefined;
    const fieldsArg = flagValue('--fields');
    if (!fieldsArg) usage();
    const fields = fieldsArg.split(',').map((s) => s.trim()).filter(Boolean);

    const finish = (raw) => {
      let obj;
      try {
        obj = JSON.parse(raw);
      } catch (err) {
        reportError(new PhantomError(`invalid JSON: ${err.message}`, VALIDATION_ERROR), process.stderr);
        return;
      }
      process.stdout.write(`${JSON.stringify(pickFields(obj, fields))}\n`);
      process.exitCode = 0;
    };

    if (jsonArg === undefined || jsonArg === '-') {
      let raw = '';
      process.stdin.setEncoding('utf8');
      process.stdin.on('data', (chunk) => { raw += chunk; });
      process.stdin.on('end', () => finish(raw));
    } else {
      finish(jsonArg);
    }
  } else {
    usage();
  }
}
