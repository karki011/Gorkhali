// Author: Subash Karki
// Static gate for AI-authored Gorkhali review pages. This deliberately validates
// safety and review coverage only; it never renders, sanitizes, or transforms
// HTML beyond atomically promoting an accepted candidate.

import { closeSync, fsyncSync, openSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { basename, dirname, resolve } from 'node:path';
import { TextDecoder } from 'node:util';
import { isMainModule } from './lib/portable.mjs';

const MAX_BYTES = 512 * 1024;
const SUPPORTED_TYPES = new Set(['plan', 'brainstorm']);
const FORBIDDEN_TAG_NAMES = new Set([
  'script', 'iframe', 'frame', 'frameset', 'object', 'embed', 'applet', 'base', 'link', 'form',
  'input', 'button', 'textarea', 'select', 'svg', 'math', 'template', 'noscript', 'dialog',
]);
const URL_BEARING_ATTRIBUTES = new Set([
  'src', 'srcset', 'action', 'formaction', 'poster', 'ping', 'background', 'xlink:href',
]);
const RAW_TEXT_TAGS = new Set(['style', 'title', 'textarea', 'script']);

const isObject = (value) => value != null && typeof value === 'object' && !Array.isArray(value);
const isText = (value) => typeof value === 'string' && value.trim() !== '';

const isEnvelope = (artifact) => isObject(artifact) && isText(artifact.artifact_type) && isObject(artifact.evidence);

const normalizedArtifact = (artifact) => isEnvelope(artifact) ? artifact.evidence : artifact;

const normalizeText = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();

const decodeEntities = (value) => String(value)
  .replace(/&#x([0-9a-f]+);?/gi, (_, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
  .replace(/&#([0-9]+);?/g, (_, decimal) => String.fromCodePoint(Number.parseInt(decimal, 10)))
  .replace(/&(amp|lt|gt|quot|apos);/gi, (_, name) => ({
    amp: '&',
    lt: '<',
    gt: '>',
    quot: '"',
    apos: "'",
  })[name.toLowerCase()]);

const tagEnd = (html, start) => {
  let quote = null;
  for (let cursor = start + 1; cursor < html.length; cursor += 1) {
    const character = html[cursor];
    if (quote && character === quote) quote = null;
    else if (!quote && (character === '"' || character === "'")) quote = character;
    else if (!quote && character === '>') return cursor;
  }
  return -1;
};

const parseTag = (html, start, end) => {
  const source = html.slice(start + 1, end);
  let cursor = 0;
  while (/\s/.test(source[cursor] || '')) cursor += 1;
  const closing = source[cursor] === '/';
  if (closing) cursor += 1;
  while (/\s/.test(source[cursor] || '')) cursor += 1;
  const nameStart = cursor;
  while (/[a-z0-9:-]/i.test(source[cursor] || '')) cursor += 1;
  if (cursor === nameStart) return null;
  const name = source.slice(nameStart, cursor).toLowerCase();

  const attributes = new Map();
  const duplicates = new Set();
  while (!closing && cursor < source.length) {
    while (/\s/.test(source[cursor] || '')) cursor += 1;
    if (cursor >= source.length) break;
    if (source[cursor] === '/') {
      cursor += 1;
      continue;
    }
    const attributeStart = cursor;
    while (!/[\s=/>]/.test(source[cursor] || '>')) cursor += 1;
    if (cursor === attributeStart) {
      cursor += 1;
      continue;
    }
    const attributeName = source.slice(attributeStart, cursor).toLowerCase();
    while (/\s/.test(source[cursor] || '')) cursor += 1;
    let value = null;
    if (source[cursor] === '=') {
      cursor += 1;
      while (/\s/.test(source[cursor] || '')) cursor += 1;
      const quote = source[cursor] === '"' || source[cursor] === "'" ? source[cursor] : null;
      if (quote) {
        cursor += 1;
        const valueStart = cursor;
        while (cursor < source.length && source[cursor] !== quote) cursor += 1;
        value = source.slice(valueStart, cursor);
        if (source[cursor] === quote) cursor += 1;
      } else {
        const valueStart = cursor;
        while (!/[\s>]/.test(source[cursor] || '>')) cursor += 1;
        value = source.slice(valueStart, cursor);
      }
    }
    if (attributes.has(attributeName)) duplicates.add(attributeName);
    else attributes.set(attributeName, value);
  }
  return {
    name,
    closing,
    attributes,
    duplicates,
    start,
    end: end + 1,
  };
};

const scanTags = (html) => {
  const tags = [];
  const lower = html.toLowerCase();
  let cursor = 0;
  while (cursor < html.length) {
    const start = html.indexOf('<', cursor);
    if (start < 0) break;
    const end = tagEnd(html, start);
    if (end < 0) break;
    const tag = parseTag(html, start, end);
    cursor = end + 1;
    if (!tag) continue;
    tags.push(tag);
    if (!tag.closing && RAW_TEXT_TAGS.has(tag.name)) {
      const closeStart = lower.indexOf(`</${tag.name}`, cursor);
      if (closeStart >= 0) {
        const closeEnd = tagEnd(html, closeStart);
        const closeTag = closeEnd >= 0 ? parseTag(html, closeStart, closeEnd) : null;
        if (closeTag) tags.push(closeTag);
        cursor = closeEnd >= 0 ? closeEnd + 1 : html.length;
      }
    }
  }
  return tags;
};

const openingTags = (html) => scanTags(html).filter((tag) => !tag.closing);

const elementRegion = (tags, name, { after = 0, before = Number.POSITIVE_INFINITY } = {}) => {
  for (let index = 0; index < tags.length; index += 1) {
    const opening = tags[index];
    if (opening.closing || opening.name !== name || opening.start < after || opening.end > before) continue;
    let depth = 1;
    for (let nested = index + 1; nested < tags.length; nested += 1) {
      const tag = tags[nested];
      if (tag.start >= before) break;
      if (tag.name !== name) continue;
      depth += tag.closing ? -1 : 1;
      if (depth === 0) return { opening, closing: tag };
    }
    return null;
  }
  return null;
};

const textFromHtml = (html) => {
  const tags = scanTags(html);
  let cursor = 0;
  let visible = '';
  for (let index = 0; index < tags.length; index += 1) {
    const tag = tags[index];
    if (tag.start < cursor) continue;
    visible += ` ${html.slice(cursor, tag.start)}`;
    cursor = tag.end;
    if (!tag.closing && RAW_TEXT_TAGS.has(tag.name)) {
      const closingIndex = tags.findIndex((candidate, candidateIndex) => (
        candidateIndex > index && candidate.closing && candidate.name === tag.name
      ));
      if (closingIndex >= 0) {
        cursor = tags[closingIndex].end;
        index = closingIndex;
      }
    }
  }
  return normalizeText(decodeEntities(`${visible} ${html.slice(cursor)}`));
};

const attribute = (tag, name) => tag.attributes.get(name) ?? null;
const decodedAttribute = (tag, name) => {
  const value = attribute(tag, name);
  return value == null ? null : decodeEntities(value);
};

const requiredStrings = (type, artifact) => {
  const data = normalizedArtifact(artifact);
  const errors = [];
  if (!isObject(data)) return { errors: ['canonical source must contain an object'], values: [] };

  const required = (value, label) => {
    if (!isText(value)) errors.push(`canonical ${label}: required non-empty string`);
    return isText(value) ? normalizeText(value) : null;
  };

  if (type === 'plan') {
    return {
      errors,
      values: [
        required(data.briefing?.tackling, 'briefing.tackling'),
        required(data.briefing?.problem, 'briefing.problem'),
        required(data.briefing?.how, 'briefing.how'),
        required(data.decision?.question, 'decision.question'),
        required(data.decision?.recommendation, 'decision.recommendation'),
        required(data.outcome?.goal, 'outcome.goal'),
      ].filter(Boolean),
    };
  }

  const selectedId = data.recommendedDefault?.id;
  const selected = Array.isArray(data.approaches)
    ? data.approaches.find((approach) => isObject(approach) && approach.id === selectedId)
    : null;
  return {
    errors,
    values: [
      required(data.decision?.question, 'decision.question'),
      required(selected?.name, 'recommended approach name'),
      required(data.recommendedDefault?.reason, 'recommendedDefault.reason'),
      required(data.directionGate?.question, 'directionGate.question'),
    ].filter(Boolean),
  };
};

const cspIndex = (html) => {
  const expected = new Map([
    ['default-src', "'none'"],
    ['style-src', "'unsafe-inline'"],
    ['base-uri', "'none'"],
    ['form-action', "'none'"],
  ]);
  let cursor = 0;
  for (const tag of openingTags(html)) {
    if (html.slice(cursor, tag.start).trim() || tag.name !== 'meta') return -1;
    cursor = tag.end;
    const httpEquiv = decodedAttribute(tag, 'http-equiv')?.toLowerCase();
    if (httpEquiv !== 'content-security-policy') {
      continue;
    }
    if (tag.duplicates.has('http-equiv') || tag.duplicates.has('content')) return -1;
    const content = decodedAttribute(tag, 'content');
    if (content == null) return -1;
    const policy = content.toLowerCase();
    const directives = policy.split(';').map((directive) => directive.trim()).filter(Boolean);
    if (directives.length !== expected.size) return -1;
    const seen = new Set();
    let valid = true;
    for (const directive of directives) {
      const [name, ...sources] = directive.split(/\s+/);
      if (seen.has(name) || !expected.has(name) || sources.length !== 1 || sources[0] !== expected.get(name)) {
        valid = false;
        break;
      }
      seen.add(name);
    }
    if (valid && seen.size === expected.size) return tag.start;
    return -1;
  }
  return -1;
};

const hasCharset = (tags) => tags
  .some((tag) => tag.name === 'meta' && decodedAttribute(tag, 'charset')?.toLowerCase() === 'utf-8');

const hasViewport = (tags) => tags.some((tag) => (
  tag.name === 'meta'
    && decodedAttribute(tag, 'name')?.toLowerCase() === 'viewport'
    && isText(decodedAttribute(tag, 'content'))
));

const containsUnsafeHref = (tags) => tags.some((tag) => (
  tag.attributes.has('href') && !decodedAttribute(tag, 'href')?.startsWith('#')
));

const containsUnsafeCss = (html, tags) => {
  const lower = html.toLowerCase();
  const css = [];
  for (const tag of tags) {
    const inline = decodedAttribute(tag, 'style');
    if (inline != null) css.push(inline);
    if (tag.name === 'style') {
      const close = lower.indexOf('</style', tag.end);
      css.push(html.slice(tag.end, close < 0 ? html.length : close));
    }
  }
  return css.some((value) => (
    /@import\b|\burl\s*\(|(?:-webkit-)?image-set\s*\(|https?:|file:|data:|blob:|expression\s*\(|-moz-binding\s*:|display\s*:\s*none|visibility\s*:\s*hidden|content-visibility\s*:\s*hidden|opacity\s*:\s*(?:0+(?:\.0+)?|\.0+)\s*(?:!important\s*)?(?:[;}"']|$)|\\(?:[0-9a-f]{1,6}\s?|[^\r\n])/i.test(value)
  ));
};

export function validateReviewHtml(type, artifact, html, { byteLength = Buffer.byteLength(String(html), 'utf8') } = {}) {
  const errors = [];
  if (!SUPPORTED_TYPES.has(type)) errors.push(`type must be plan or brainstorm, got "${type}"`);
  if (!Number.isFinite(byteLength) || byteLength > MAX_BYTES) errors.push(`candidate exceeds ${MAX_BYTES} byte limit`);
  if (String(html).includes('\0')) errors.push('candidate contains a NUL byte');

  const source = requiredStrings(type, artifact);
  errors.push(...source.errors);
  const candidate = String(html);
  const active = candidate.replace(/<!--[\s\S]*?-->/g, ' ');
  const scannedTags = scanTags(active);
  const tags = scannedTags.filter((tag) => !tag.closing);
  const htmlRegion = elementRegion(scannedTags, 'html');
  const documentBounds = htmlRegion ? {
    after: htmlRegion.opening.end,
    before: htmlRegion.closing.start,
  } : undefined;
  const headRegion = documentBounds && elementRegion(scannedTags, 'head', documentBounds);
  const bodyRegion = documentBounds && elementRegion(scannedTags, 'body', documentBounds);
  const mainRegion = bodyRegion && elementRegion(scannedTags, 'main', {
    after: bodyRegion.opening.end,
    before: bodyRegion.closing.start,
  });
  const head = headRegion ? active.slice(headRegion.opening.end, headRegion.closing.start) : '';
  const headTags = openingTags(head);
  const htmlTag = htmlRegion?.opening;
  const titleRegion = headRegion && elementRegion(scannedTags, 'title', {
    after: headRegion.opening.end,
    before: headRegion.closing.start,
  });

  if (!/^\s*<!doctype\s+html\s*>/i.test(active)) errors.push('missing <!doctype html>');
  if (!htmlTag || !isText(decodedAttribute(htmlTag, 'lang'))) errors.push('missing html lang attribute');
  if (!headRegion) errors.push('missing head element');
  if (!hasCharset(headTags)) errors.push('missing UTF-8 charset meta in head');
  if (!hasViewport(headTags)) errors.push('missing viewport meta in head');
  if (!titleRegion || !isText(active.slice(titleRegion.opening.end, titleRegion.closing.start))) errors.push('missing non-empty title in head');
  if (!bodyRegion) errors.push('missing body element');
  if (headRegion && bodyRegion && headRegion.closing.end > bodyRegion.opening.start) errors.push('head element must precede body');
  if (tags.filter((tag) => tag.name === 'h1').length !== 1) errors.push('document must contain exactly one h1');
  if (tags.filter((tag) => tag.name === 'main').length !== 1) errors.push('document must contain exactly one main');
  const policyIndex = cspIndex(head);
  if (policyIndex < 0) errors.push('missing required restrictive Content Security Policy meta in head');
  const firstStyle = headTags.find((tag) => tag.name === 'style')?.start ?? -1;
  if (policyIndex >= 0 && firstStyle >= 0 && policyIndex > firstStyle) errors.push('Content Security Policy meta must precede styles');

  if (tags.some((tag) => FORBIDDEN_TAG_NAMES.has(tag.name))) errors.push('contains a forbidden executable, embedded, control, or vector tag');
  if (tags.some((tag) => [...tag.attributes.keys()].some((name) => name.startsWith('on')))) errors.push('contains an inline event-handler attribute');
  if (tags.some((tag) => tag.attributes.has('hidden'))) errors.push('contains hidden review content');
  if (tags.some((tag) => [...URL_BEARING_ATTRIBUTES].some((name) => tag.attributes.has(name)))) errors.push('contains a URL-bearing attribute');
  if (containsUnsafeHref(tags)) errors.push('contains a non-fragment href');
  if (tags.some((tag) => (
    tag.name === 'meta' && decodedAttribute(tag, 'http-equiv')?.toLowerCase() === 'refresh'
  ))) {
    errors.push('contains a refresh meta');
  }
  if (containsUnsafeCss(active, tags)) errors.push('contains unsafe CSS, hidden content, or URL behavior');

  const mainStart = mainRegion?.opening.end ?? 0;
  const mainEnd = mainRegion?.closing.start ?? 0;
  const firstDetails = tags.find((tag) => (
    tag.name === 'details' && tag.start >= mainStart && tag.end <= mainEnd
  ));
  const firstTable = tags.find((tag) => (
    tag.name === 'table' && tag.start >= mainStart && tag.end <= mainEnd
  ));
  if (type === 'plan' && !firstDetails) errors.push('plan review must include a details element in main');
  if (type === 'brainstorm' && !firstTable) errors.push('brainstorm review must include a table in main');
  else if (type === 'brainstorm' && firstDetails && firstTable.start >= firstDetails.start) {
    errors.push('brainstorm comparison table must appear before details');
  }
  if (tags.some((tag) => (
    tag.name === 'details'
    && tag.start >= mainStart
    && tag.end <= mainEnd
    && tag.attributes.has('open')
  ))) {
    errors.push('details must not have an open attribute');
  }
  const decisionContent = active.slice(mainStart, firstDetails?.start ?? mainEnd);
  const visibleText = textFromHtml(decisionContent);
  for (const value of source.values) {
    if (!visibleText.includes(value)) errors.push(`missing canonical review text: ${value}`);
  }
  return { ok: errors.length === 0, errors, requiredText: source.values };
}

const parseArgs = (argv) => {
  const [type, ...rest] = argv;
  const options = { type };
  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];
    if (!['--source', '--candidate', '--out'].includes(token)) throw new Error(`unknown argument: ${token}`);
    const value = rest[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`${token} requires a path`);
    options[token.slice(2)] = value;
    index += 1;
  }
  return options;
};

const promote = (candidateBytes, output) => {
  const to = resolve(output);
  const temporary = resolve(dirname(to), `.${basename(to)}.${process.pid}.${randomUUID()}.tmp`);
  let descriptor;
  try {
    descriptor = openSync(temporary, 'wx', 0o600);
    writeFileSync(descriptor, candidateBytes);
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = undefined;
    renameSync(temporary, to);
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
    try { unlinkSync(temporary); } catch { /* promotion already renamed or never wrote */ }
  }
};

const usage = 'Usage: node validate-review-html.mjs <plan|brainstorm> --source <canonical-json> --candidate <candidate.html> --out <accepted.html>';

const main = () => {
  const options = parseArgs(process.argv.slice(2));
  if (!SUPPORTED_TYPES.has(options.type) || !options.source || !options.candidate || !options.out) throw new Error(usage);
  const sourceText = readFileSync(resolve(options.source), 'utf8');
  const candidatePath = resolve(options.candidate);
  if (statSync(candidatePath).size > MAX_BYTES) {
    process.stderr.write(`Invalid review HTML:\n- candidate exceeds ${MAX_BYTES} byte limit\n`);
    process.exitCode = 1;
    return;
  }
  const candidateBytes = readFileSync(candidatePath);
  let candidateHtml;
  try {
    candidateHtml = new TextDecoder('utf-8', { fatal: true }).decode(candidateBytes);
  } catch {
    process.stderr.write('Invalid review HTML:\n- candidate is not valid UTF-8\n');
    process.exitCode = 1;
    return;
  }
  const result = validateReviewHtml(options.type, JSON.parse(sourceText), candidateHtml, {
    byteLength: candidateBytes.byteLength,
  });
  if (!result.ok) {
    process.stderr.write(`Invalid review HTML:\n${result.errors.map((error) => `- ${error}`).join('\n')}\n`);
    process.exitCode = 1;
    return;
  }
  promote(candidateBytes, options.out);
  process.stdout.write(`${resolve(options.out)}\n`);
};

if (isMainModule(import.meta.url)) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
