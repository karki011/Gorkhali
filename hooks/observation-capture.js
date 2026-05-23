// observation-capture.js — PostToolUse hook
// Silently captures tool events (Read, Edit, Write, Bash, Grep, Glob)
// and writes structural summaries to observations/{date}.jsonl
// Author: Subash Karki

const fs = require('fs');
const path = require('path');

const HOME = require('os').homedir();
const OBS_DIR = path.join(HOME, '.claude', 'team', 'observations');
const MAX_OUTPUT_SIZE = 10240; // 10KB — skip larger outputs
const MAX_OBS_LENGTH = 500;   // chars per observation line
const DEDUP_WINDOW = 60000;   // 60 seconds

// ── Deduplication (file-based — each hook invocation is a new process) ────────
const DEDUP_FILE = path.join(OBS_DIR, '.dedup.json');

function loadDedup() {
  try {
    const raw = fs.readFileSync(DEDUP_FILE, 'utf-8');
    return JSON.parse(raw);
  } catch { return {}; }
}

function isDuplicate(key) {
  fs.mkdirSync(OBS_DIR, { recursive: true });
  const now = Date.now();
  const map = loadDedup();

  // Prune expired entries
  let dirty = false;
  for (const k of Object.keys(map)) {
    if (now - map[k] > DEDUP_WINDOW) { delete map[k]; dirty = true; }
  }

  if (map[key]) {
    if (dirty) fs.writeFileSync(DEDUP_FILE, JSON.stringify(map));
    return true;
  }

  map[key] = now;
  fs.writeFileSync(DEDUP_FILE, JSON.stringify(map));
  return false;
}

// ── Structural extraction (Read captures) ──────────────────────────────────────
function extractStructure(content, filePath) {
  if (!content || typeof content !== 'string') return 'empty';
  const parts = [];

  // Imports
  const imports = content.match(/^(?:import|from|require|use)\s+.+$/gm);
  if (imports) parts.push(`imports: ${imports.length}`);

  // Exports
  const exports = content.match(/^export\s+(?:default\s+)?(?:class|function|const|let|type|interface|enum)\s+(\w+)/gm);
  if (exports) {
    const names = exports.map(e => e.match(/(\w+)$/)?.[1]).filter(Boolean);
    if (names.length) parts.push(`exports: ${names.slice(0, 8).join(', ')}${names.length > 8 ? ` +${names.length - 8}` : ''}`);
  }

  // Functions/methods
  const funcs = content.match(/(?:function|const|let|var)\s+(\w+)\s*(?:=\s*(?:async\s*)?\(|[(<])/gm);
  const methods = content.match(/(?:async\s+)?(\w+)\s*\([^)]*\)\s*[:{]/gm);
  const allFuncs = new Set(
    [...(funcs || []), ...(methods || [])]
      .map(f => f.match(/(\w+)/)?.[1])
      .filter(Boolean)
  );
  if (allFuncs.size) parts.push(`functions: ${allFuncs.size}`);

  // Classes
  const classes = content.match(/class\s+(\w+)/g);
  if (classes) {
    const names = classes.map(c => c.replace('class ', ''));
    parts.push(`classes: ${names.slice(0, 5).join(', ')}${names.length > 5 ? ` +${names.length - 5}` : ''}`);
  }

  // Types/interfaces (TS)
  const types = content.match(/(?:type|interface)\s+(\w+)/g);
  if (types) parts.push(`types: ${types.length}`);

  // Line count
  const lineCount = content.split('\n').length;
  parts.push(`${lineCount} lines`);

  return parts.join(' | ') || `${lineCount} lines`;
}

// ── Per-tool observation builders ──────────────────────────────────────────────
function buildReadObs(input, output) {
  const filePath = input.file_path || '';
  if (!filePath) return null;

  const key = `Read:${filePath}`;
  if (isDuplicate(key)) return null;

  const content = typeof output === 'string' ? output : (output?.content || '');
  if (content.length > MAX_OUTPUT_SIZE) {
    return { tool: 'Read', file: filePath, summary: 'output too large, skipped' };
  }

  return {
    tool: 'Read',
    file: filePath,
    summary: extractStructure(content, filePath),
  };
}

function buildEditObs(input, output) {
  const filePath = input.file_path || '';
  if (!filePath) return null;

  const key = `Edit:${filePath}`;
  if (isDuplicate(key)) return null;

  const oldStr = input.old_string || '';
  const newStr = input.new_string || '';
  const oldLines = oldStr.split('\n').length;
  const newLines = newStr.split('\n').length;

  return {
    tool: 'Edit',
    file: filePath,
    summary: `replaced ${oldLines} lines → ${newLines} lines`,
  };
}

function buildWriteObs(input, output) {
  const filePath = input.file_path || '';
  if (!filePath) return null;

  const key = `Write:${filePath}`;
  if (isDuplicate(key)) return null;

  const content = input.content || '';
  const lines = content.split('\n').length;

  return {
    tool: 'Write',
    file: filePath,
    summary: `created/overwrote file (${lines} lines)`,
  };
}

function buildBashObs(input, output) {
  const command = input.command || '';
  if (!command) return null;

  // Truncate long commands
  const shortCmd = command.length > 120 ? command.slice(0, 117) + '...' : command;
  const key = `Bash:${shortCmd}`;
  if (isDuplicate(key)) return null;

  const stdout = typeof output === 'string' ? output : (output?.stdout || output?.content || '');
  const exitCode = typeof output === 'object' ? (output.exit_code ?? output.exitCode ?? 0) : 0;

  // First 3 lines of output
  const lines = stdout.split('\n').filter(Boolean).slice(0, 3);
  const preview = lines.join(' | ').slice(0, 200);

  return {
    tool: 'Bash',
    command: shortCmd,
    exitCode,
    summary: preview || '(no output)',
  };
}

function buildGrepObs(input, output) {
  const pattern = input.pattern || input.regex || '';
  const filePath = input.path || input.file_path || '.';

  const key = `Grep:${pattern}:${filePath}`;
  if (isDuplicate(key)) return null;

  const content = typeof output === 'string' ? output : (output?.content || '');
  const matchCount = content ? content.split('\n').filter(Boolean).length : 0;

  return {
    tool: 'Grep',
    pattern: pattern.slice(0, 80),
    scope: filePath,
    summary: `${matchCount} matches`,
  };
}

function buildGlobObs(input, output) {
  const pattern = input.pattern || '';

  const key = `Glob:${pattern}`;
  if (isDuplicate(key)) return null;

  const content = typeof output === 'string' ? output : (output?.content || '');
  const matchCount = content ? content.split('\n').filter(Boolean).length : 0;

  return {
    tool: 'Glob',
    pattern: pattern.slice(0, 80),
    summary: `${matchCount} files found`,
  };
}

// ── Main ───────────────────────────────────────────────────────────────────────
try {
  const event = JSON.parse(process.argv[2] || '{}');
  const toolName = event.tool_name || '';
  const toolInput = event.tool_input || {};
  const toolOutput = event.tool_output || {};

  const BUILDERS = {
    Read: buildReadObs,
    Edit: buildEditObs,
    Write: buildWriteObs,
    Bash: buildBashObs,
    Grep: buildGrepObs,
    Glob: buildGlobObs,
  };

  if (!BUILDERS[toolName]) process.exit(0);

  const obs = BUILDERS[toolName](toolInput, toolOutput);
  if (!obs) process.exit(0);

  // Attach timestamp and session
  obs.ts = new Date().toISOString();
  obs.session = process.env.CLAUDE_SESSION_ID || 'unknown';

  // Enforce max line length
  let line = JSON.stringify(obs);
  if (line.length > MAX_OBS_LENGTH) {
    // Trim summary to fit
    const overhead = line.length - (obs.summary || '').length;
    const maxSummary = MAX_OBS_LENGTH - overhead - 5;
    if (maxSummary > 10 && obs.summary) {
      obs.summary = obs.summary.slice(0, maxSummary) + '...';
      line = JSON.stringify(obs);
    }
  }

  // Write to date-keyed NDJSON file
  fs.mkdirSync(OBS_DIR, { recursive: true });
  const date = new Date().toISOString().slice(0, 10);
  fs.appendFileSync(path.join(OBS_DIR, `${date}.jsonl`), line + '\n');
} catch {
  // Never break the workflow — silent on errors
}
