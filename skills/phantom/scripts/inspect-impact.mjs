#!/usr/bin/env node
// Author: Subash Karki

import { execFileSync } from 'node:child_process';
import {
  existsSync,
  lstatSync,
  readFileSync,
  readdirSync,
  realpathSync,
  statSync,
} from 'node:fs';
import { dirname, extname, isAbsolute, join, relative, resolve } from 'node:path';
import { isMainModule, parseArgs } from './lib/portable.mjs';

const EXTENSIONS = new Map([
  ['.js', 'javascript'], ['.jsx', 'javascript'], ['.mjs', 'javascript'], ['.cjs', 'javascript'],
  ['.ts', 'typescript'], ['.tsx', 'typescript'], ['.mts', 'typescript'], ['.cts', 'typescript'],
  ['.py', 'python'], ['.go', 'go'], ['.rs', 'rust'],
  ['.c', 'c'], ['.h', 'c'], ['.cc', 'cpp'], ['.cpp', 'cpp'], ['.cxx', 'cpp'], ['.hpp', 'cpp'],
]);
const SKIP_DIRECTORIES = new Set([
  '.git', '.next', '.venv', '__pycache__', 'build', 'coverage', 'dist',
  'node_modules', 'target', 'vendor',
]);
const JS_EXTENSIONS = ['.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx', '.mts', '.cts'];
const RIPGREP_EXCLUDED_GLOBS = [...SKIP_DIRECTORIES].map((directory) => `**/${directory}/**`);
const DEFAULTS = {
  depth: 2,
  maxBytes: 50 * 1024 * 1024,
  maxEdges: 500,
  maxFileBytes: 200 * 1024,
  maxFiles: 5000,
  maxResults: 200,
  maxWarnings: 500,
};

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
}

function boundedInteger(value, fallback, label, maximum = fallback) {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > maximum) {
    throw new Error(`${label} must be an integer from 1 to ${maximum}.`);
  }
  return parsed;
}

function toPosix(path) {
  return path.split('\\').join('/');
}

function insideWorkspace(workspace, path) {
  const rel = relative(workspace, path);
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel);
}

function safeTarget(workspace, value) {
  const candidate = resolve(workspace, value);
  if (!existsSync(candidate)) throw new Error(`Target does not exist: ${value}`);
  const real = realpathSync(candidate);
  if (real !== workspace && !insideWorkspace(workspace, real)) {
    throw new Error(`Target escapes the workspace: ${value}`);
  }
  if (!statSync(real).isFile()) throw new Error(`Target is not a file: ${value}`);
  return toPosix(relative(workspace, real));
}

function walkFiles(workspace, limit) {
  const found = [];
  const maxEntries = limit * 10;
  let entriesVisited = 0;
  let symlinks = 0;
  let truncated = false;
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      entriesVisited += 1;
      if (entriesVisited > maxEntries) {
        truncated = true;
        return true;
      }
      const absolute = join(directory, entry.name);
      if (entry.isSymbolicLink()) {
        symlinks += 1;
        continue;
      }
      if (entry.isDirectory()) {
        if (!SKIP_DIRECTORIES.has(entry.name) && visit(absolute)) return true;
      } else if (entry.isFile() && EXTENSIONS.has(extname(entry.name).toLowerCase())) {
        found.push(toPosix(relative(workspace, absolute)));
        if (found.length > limit) {
          truncated = true;
          return true;
        }
      }
    }
    return false;
  };
  visit(workspace);
  return {
    files: found.slice(0, limit),
    filesDiscovered: found.length,
    skipped: truncated ? 1 : 0,
    symlinks,
  };
}

function discoverFiles(workspace, limit) {
  try {
    const output = execFileSync(
      'git',
      ['-C', workspace, 'ls-files', '--cached', '--others', '--exclude-standard', '-z'],
      { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] },
    );
    const files = output.split('\0')
      .filter((path) => path && EXTENSIONS.has(extname(path).toLowerCase()))
      .map(toPosix)
      .sort();
    return {
      discovery: 'git',
      files: files.slice(0, limit),
      filesDiscovered: files.length,
      skipped: Math.max(0, files.length - limit),
      symlinks: 0,
    };
  } catch {
    return { discovery: 'walk', ...walkFiles(workspace, limit) };
  }
}

function referenceTerms(target) {
  const extension = extname(target);
  const withoutExtension = extension ? target.slice(0, -extension.length) : target;
  const basename = withoutExtension.split('/').at(-1);
  return [...new Set([
    target,
    withoutExtension,
    extension ? `${basename}${extension}` : null,
    basename ? (basename.length >= 4 ? basename : `/${basename}`) : null,
  ].filter(Boolean))].sort();
}

function referenceScanResult(status, candidates, failedTargets, truncated) {
  return { tool: 'ripgrep', status, candidates, failed_targets: failedTargets, truncated };
}

function scanTextReferences(workspace, targets, options) {
  const candidates = [];
  const failedTargets = [];
  let resultCount = 0;
  let truncated = false;

  for (const target of targets) {
    if (resultCount >= options.maxResults) {
      truncated = true;
      break;
    }
    const args = [
      '--files-with-matches',
      '--fixed-strings',
      '--hidden',
      '--no-messages',
      '--null',
      '--sort',
      'path',
      '--max-filesize',
      String(options.maxFileBytes),
      ...RIPGREP_EXCLUDED_GLOBS.flatMap((glob) => ['--glob', `!${glob}`]),
      ...referenceTerms(target).flatMap((term) => ['-e', term]),
      '--',
      '.',
    ];
    let output;
    try {
      output = execFileSync('rg', args, {
        cwd: workspace,
        encoding: 'utf8',
        maxBuffer: 16 * 1024 * 1024,
        stdio: ['ignore', 'pipe', 'ignore'],
      });
    } catch (error) {
      if (error.code === 'ENOENT') {
        return referenceScanResult('unavailable', candidates, [], truncated);
      }
      if (error.status === 1) {
        output = '';
      } else {
        failedTargets.push(target);
        continue;
      }
    }

    const files = [...new Set(output.split('\0')
      .map((path) => toPosix(path.replace(/^\.\//, '')))
      .filter((path) => path && path !== target))]
      .sort();
    const remaining = options.maxResults - resultCount;
    if (files.length > remaining) truncated = true;
    const boundedFiles = files.slice(0, remaining);
    resultCount += boundedFiles.length;
    candidates.push({ target, files: boundedFiles });
  }

  return referenceScanResult(failedTargets.length ? 'partial' : 'complete', candidates, failedTargets, truncated);
}

function matches(content, pattern, group = 1) {
  return [...content.matchAll(pattern)].map((match) => match[group]).filter(Boolean);
}

function importRequests(node, goModule) {
  const requests = [];
  const add = (kind, specifier, warn = true) => requests.push({ kind, specifier, warn });
  if (node.language === 'javascript' || node.language === 'typescript') {
    const specs = [
      ...matches(node.content, /(?:import|export)\s+(?:[^'";]*?\s+from\s+)?['"]([^'"]+)['"]/g),
      ...matches(node.content, /\b(?:require|import)\s*\(\s*['"]([^'"]+)['"]\s*\)/g),
    ];
    for (const spec of specs) if (spec.startsWith('.')) add('relative', spec);
  } else if (node.language === 'python') {
    for (const match of node.content.matchAll(/^\s*from\s+([.\w]+)\s+import\s+([^\n#]+)/gm)) {
      const [, spec, imported] = match;
      if (/^\.+$/.test(spec)) {
        for (const name of imported.replace(/[()]/g, '').split(',')) {
          const moduleName = name.trim().split(/\s+as\s+/)[0];
          if (moduleName && moduleName !== '*') add('python', `${spec}${moduleName}`);
        }
      } else {
        add('python', spec, spec.startsWith('.'));
      }
    }
    for (const imported of matches(node.content, /^\s*import\s+([^\n#]+)/gm)) {
      for (const name of imported.split(',')) {
        const spec = name.trim().split(/\s+as\s+/)[0];
        if (spec) add('python', spec, false);
      }
    }
  } else if (node.language === 'go') {
    const specs = matches(node.content, /^\s*import\s+(?:\w+\s+)?["`]([^"`]+)["`]/gm);
    for (const block of matches(node.content, /\bimport\s*\(([\s\S]*?)\)/g)) {
      specs.push(...matches(block, /["`]([^"`]+)["`]/g));
    }
    for (const spec of specs) {
      if (goModule && (spec === goModule || spec.startsWith(`${goModule}/`))) add('go', spec);
    }
  } else if (node.language === 'rust') {
    for (const spec of matches(node.content, /^\s*mod\s+([A-Za-z_][\w]*)\s*;/gm)) add('rust-mod', spec);
    for (const spec of matches(node.content, /^\s*use\s+crate::([A-Za-z_][\w:]*)/gm)) add('rust-use', spec);
    for (const imports of matches(node.content, /^\s*use\s+crate::\{([^}]+)\}/gm)) {
      for (const name of imports.split(',')) {
        const spec = name.trim().split(/\s+as\s+/)[0];
        if (spec && spec !== 'self') add('rust-use', spec);
      }
    }
  } else if (node.language === 'c' || node.language === 'cpp') {
    for (const spec of matches(node.content, /^\s*#\s*include\s*"([^"]+)"/gm)) add('c-include', spec);
  }
  return requests;
}

function firstExisting(candidates, paths) {
  return candidates.map(toPosix).find((candidate) => paths.has(candidate)) || null;
}

function withExtensions(base, extensions) {
  return [base, ...extensions.map((extension) => `${base}${extension}`), ...extensions.map((extension) => `${base}/index${extension}`)];
}

function resolveRequest(node, request, paths, byDirectory, goModule) {
  const directory = dirname(node.path);
  if (request.kind === 'relative') {
    return firstExisting(withExtensions(toPosix(join(directory, request.specifier)), JS_EXTENSIONS), paths);
  }
  if (request.kind === 'c-include') {
    return firstExisting([toPosix(join(directory, request.specifier))], paths);
  }
  if (request.kind === 'python') {
    const leading = request.specifier.match(/^\.+/)?.[0].length || 0;
    let base = leading ? directory : '';
    for (let index = 1; index < leading; index += 1) base = dirname(base);
    const moduleName = request.specifier.slice(leading).replaceAll('.', '/');
    const modulePath = toPosix(join(base, moduleName));
    return firstExisting([`${modulePath}.py`, `${modulePath}/__init__.py`], paths);
  }
  if (request.kind === 'go') {
    const packagePath = request.specifier.slice(goModule.length).replace(/^\//, '');
    return byDirectory.get(packagePath)?.filter((path) => path.endsWith('.go') && !path.endsWith('_test.go')) || [];
  }
  if (request.kind === 'rust-mod') {
    const base = toPosix(join(directory, request.specifier));
    return firstExisting([`${base}.rs`, `${base}/mod.rs`], paths);
  }
  if (request.kind === 'rust-use') {
    const segments = request.specifier.split('::');
    while (segments.length) {
      const base = `src/${segments.join('/')}`;
      const match = firstExisting([`${base}.rs`, `${base}/mod.rs`], paths);
      if (match) return match;
      segments.pop();
    }
  }
  return null;
}

function readGoModule(workspace, maxFileBytes) {
  const file = join(workspace, 'go.mod');
  try {
    const metadata = lstatSync(file);
    if (metadata.isSymbolicLink() || !metadata.isFile() || metadata.size > maxFileBytes) {
      return { module: '', skipped: 1 };
    }
    const real = realpathSync(file);
    if (!insideWorkspace(workspace, real)) return { module: '', skipped: 1 };
    const module = readFileSync(real, 'utf8').match(/^module\s+(\S+)/m)?.[1] || '';
    return { module, skipped: 0 };
  } catch (error) {
    return { module: '', skipped: error.code === 'ENOENT' ? 0 : 1 };
  }
}

function buildGraph(workspace, options) {
  const discovered = discoverFiles(workspace, options.maxFiles);
  const supported = discovered.files;
  const skipped = {
    discovery_limit: discovered.skipped,
    large: 0,
    symlink: discovered.symlinks,
    unreadable: 0,
    byte_limit: 0,
    edge_limit: 0,
    warning_limit: 0,
    go_module: 0,
  };
  const unresolved = [];
  const nodes = new Map();
  let bytesRead = 0;
  for (const path of supported) {
    const absolute = join(workspace, path);
    try {
      const metadata = lstatSync(absolute);
      if (metadata.isSymbolicLink()) {
        skipped.symlink += 1;
        continue;
      }
      if (metadata.size > options.maxFileBytes) {
        skipped.large += 1;
        continue;
      }
      if (bytesRead + metadata.size > options.maxBytes) {
        skipped.byte_limit += 1;
        continue;
      }
      const content = readFileSync(absolute, 'utf8');
      bytesRead += metadata.size;
      nodes.set(path, { content, language: EXTENSIONS.get(extname(path).toLowerCase()), path });
    } catch {
      skipped.unreadable += 1;
    }
  }

  const paths = new Set(nodes.keys());
  const byDirectory = new Map();
  for (const path of paths) {
    const directory = toPosix(dirname(path)) === '.' ? '' : toPosix(dirname(path));
    if (!byDirectory.has(directory)) byDirectory.set(directory, []);
    byDirectory.get(directory).push(path);
  }
  for (const files of byDirectory.values()) files.sort();
  const moduleResult = readGoModule(workspace, options.maxFileBytes);
  const goModule = moduleResult.module;
  skipped.go_module = moduleResult.skipped;

  const edges = [];
  const edgeKeys = new Set();
  for (const node of nodes.values()) {
    for (const request of importRequests(node, goModule)) {
      const resolved = resolveRequest(node, request, paths, byDirectory, goModule);
      const targets = Array.isArray(resolved) ? resolved : resolved ? [resolved] : [];
      if (!targets.length && request.warn) {
        if (unresolved.length < options.maxWarnings) {
          unresolved.push({ path: node.path, specifier: request.specifier });
        } else {
          skipped.warning_limit += 1;
        }
      }
      for (const target of targets) {
        if (target === node.path) continue;
        const key = `${node.path}\0${target}`;
        if (edgeKeys.has(key)) continue;
        if (edges.length >= options.maxEdges) {
          skipped.edge_limit += 1;
          continue;
        }
        edgeKeys.add(key);
        edges.push({ source: node.path, target, type: 'imports' });
      }
    }
  }
  edges.sort((a, b) => a.source.localeCompare(b.source) || a.target.localeCompare(b.target));
  return {
    bytesRead,
    discovery: discovered.discovery,
    filesDiscovered: discovered.filesDiscovered,
    nodes,
    edges,
    skipped,
    unresolved,
  };
}

function traverse(targets, graph, depth, reverseOnly = false) {
  const neighbors = new Map();
  const add = (from, to, relation) => {
    if (!neighbors.has(from)) neighbors.set(from, []);
    neighbors.get(from).push({ path: to, relation });
  };
  for (const edge of graph.edges) {
    add(edge.source, edge.target, 'dependency');
    add(edge.target, edge.source, 'importer');
  }
  for (const list of neighbors.values()) list.sort((a, b) => a.path.localeCompare(b.path));
  const seen = new Map(targets.map((path) => [path, { distance: 0, path, relation: 'target', via: null }]));
  const queue = [...targets];
  for (let index = 0; index < queue.length; index += 1) {
    const current = queue[index];
    const currentDistance = seen.get(current).distance;
    if (currentDistance >= depth) continue;
    for (const next of neighbors.get(current) || []) {
      if (reverseOnly && next.relation !== 'importer') continue;
      if (seen.has(next.path)) continue;
      seen.set(next.path, { distance: currentDistance + 1, path: next.path, relation: next.relation, via: current });
      queue.push(next.path);
    }
  }
  return [...seen.values()].sort((a, b) => a.distance - b.distance || a.path.localeCompare(b.path));
}

function inspect(workspace, targets, options) {
  const graph = buildGraph(workspace, options);
  const warnings = [];
  for (const target of targets) {
    if (!graph.nodes.has(target)) warnings.push(`Target is outside supported source coverage: ${target}`);
  }
  const allContext = traverse(targets, graph, options.depth);
  const context = allContext.slice(0, options.maxResults);
  const allBlast = traverse(targets, graph, Number.MAX_SAFE_INTEGER, true).filter((item) => item.distance > 0);
  const blast = allBlast.slice(0, options.maxResults);
  const contextPaths = new Set(context.map((item) => item.path));
  const relevantEdges = graph.edges
    .filter((edge) => contextPaths.has(edge.source) && contextPaths.has(edge.target));
  const languages = {};
  for (const node of graph.nodes.values()) languages[node.language] = (languages[node.language] || 0) + 1;
  const skippedCount = Object.values(graph.skipped).reduce((sum, count) => sum + count, 0);
  const truncated = skippedCount > 0 || allContext.length > options.maxResults || allBlast.length > options.maxResults;
  const unresolvedWarnings = graph.unresolved
    .filter((item) => contextPaths.has(item.path))
    .map((item) => `Unresolved local import in ${item.path}: ${item.specifier}`);
  const warningList = [...new Set([...warnings, ...unresolvedWarnings])].sort();
  const partial = truncated || warningList.length > 0;
  const referenceScan = partial
    ? scanTextReferences(workspace, targets, options)
    : referenceScanResult('skipped', [], [], false);
  return {
    schema_version: 1,
    status: partial ? 'partial' : 'complete',
    source: 'bundled-local-analysis',
    query: { targets, depth: options.depth },
    coverage: {
      discovery: graph.discovery,
      files_discovered: graph.filesDiscovered,
      files_indexed: graph.nodes.size,
      bytes_read: graph.bytesRead,
      skipped: graph.skipped,
      truncated,
      languages: Object.fromEntries(Object.entries(languages).sort()),
    },
    context: {
      files: context.map((item) => ({ ...item, relevance: Number((1 / (item.distance + 1)).toFixed(3)) })),
      edges: relevantEdges,
    },
    blast_radius: {
      directly_affected: blast.filter((item) => item.distance === 1).map((item) => item.path),
      transitively_affected: blast.filter((item) => item.distance > 1).map((item) => item.path),
      impact_score: graph.nodes.size ? Number((allBlast.length / graph.nodes.size).toFixed(3)) : 0,
    },
    related_files: context.filter((item) => item.distance > 0).map((item) => item.path),
    reference_scan: referenceScan,
    warnings: warningList.slice(0, 100),
  };
}

function main() {
  try {
    const args = parseArgs(process.argv.slice(2));
    if (args._[0] !== 'inspect' || args._.length < 2) {
      throw new Error('Usage: inspect-impact.mjs inspect --workspace <repo> [--depth 2] <relative-file> [...]');
    }
    const workspace = realpathSync(resolve(args.workspace || process.cwd()));
    const options = {
      depth: boundedInteger(args.depth, DEFAULTS.depth, 'depth', 4),
      maxBytes: boundedInteger(args['max-bytes'], DEFAULTS.maxBytes, 'max-bytes'),
      maxEdges: boundedInteger(args['max-edges'], DEFAULTS.maxEdges, 'max-edges'),
      maxFileBytes: boundedInteger(args['max-file-bytes'], DEFAULTS.maxFileBytes, 'max-file-bytes'),
      maxFiles: boundedInteger(args['max-files'], DEFAULTS.maxFiles, 'max-files'),
      maxResults: boundedInteger(args['max-results'], DEFAULTS.maxResults, 'max-results'),
      maxWarnings: DEFAULTS.maxWarnings,
    };
    const targets = [...new Set(args._.slice(1).map((target) => safeTarget(workspace, target)))].sort();
    process.stdout.write(`${JSON.stringify(inspect(workspace, targets, options), null, 2)}\n`);
  } catch (error) {
    fail(error.message);
  }
}

if (isMainModule(import.meta.url)) main();
