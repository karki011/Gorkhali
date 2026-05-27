#!/usr/bin/env node
// Author: Subash Karki
// hook-router.js — Unified entry point for all Phantom hooks.
// Usage: node hook-router.js --event=PreToolUse --tool=Edit [--phase=B] [--session-id=xxx]
//        node hook-router.js --list | --dry-run
// Env fallbacks: HOOK_EVENT, HOOK_TOOL, HOOK_PHASE, HOOK_SESSION_ID

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const TEAM_DIR = path.join(require('os').homedir(), '.claude', 'team');
const HOOKS_DIR = path.join(TEAM_DIR, 'hooks');
const STATE_DIR = path.join(TEAM_DIR, 'state');
const SESSION_STATE = path.join(STATE_DIR, '.hook-session-state.json');

function parseArgs() {
  const a = { event: '', tool: '', phase: '', sessionId: '', list: false, dryRun: false };
  for (const v of process.argv.slice(2)) {
    if (v === '--list') a.list = true;
    else if (v === '--dry-run') a.dryRun = true;
    else if (v.startsWith('--')) { const [k, val] = v.slice(2).split('=', 2); a[k.replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = val || ''; }
  }
  a.event = a.event || process.env.HOOK_EVENT || '';
  a.tool = a.tool || process.env.HOOK_TOOL || '';
  a.phase = a.phase || process.env.HOOK_PHASE || '';
  a.sessionId = a.sessionId || process.env.HOOK_SESSION_ID || process.env.CLAUDE_SESSION_ID || '';
  return a;
}

function loadConfig() {
  let hooks = [];
  try { hooks = JSON.parse(fs.readFileSync(path.join(HOOKS_DIR, 'hooks-config.json'), 'utf-8')).hooks || []; }
  catch (e) { process.stderr.write(`hook-router: bad config: ${e.message}\n`); return []; }
  try {
    const lp = path.join(HOOKS_DIR, 'hooks-config.local.json');
    if (fs.existsSync(lp)) {
      for (const o of (JSON.parse(fs.readFileSync(lp, 'utf-8')).hooks || [])) {
        const i = hooks.findIndex(h => h.name === o.name);
        i >= 0 ? hooks[i] = { ...hooks[i], ...o } : hooks.push(o);
      }
    }
  } catch {}
  return hooks.map(h => ({ priority: 100, enabled: true, once: false, matcher: '.*', input: 'arg1-json', ...h }));
}

function loadSessionState(sid) {
  try { const d = JSON.parse(fs.readFileSync(SESSION_STATE, 'utf-8')); if (d.sessionId === sid) return d; } catch {}
  return { sessionId: sid, fired: [] };
}
function saveSessionState(s) { fs.mkdirSync(STATE_DIR, { recursive: true }); fs.writeFileSync(SESSION_STATE, JSON.stringify(s)); }

function listHooks(hooks) {
  const nw = Math.max(...hooks.map(h => h.name.length), 4);
  const ew = Math.max(...hooks.map(h => h.event.length), 5);
  console.log(`${'NAME'.padEnd(nw)}  ${'EVENT'.padEnd(ew)}  PRI  ON   ONCE  SCRIPT`);
  console.log('-'.repeat(nw + ew + 30));
  for (const h of hooks.sort((a, b) => a.priority - b.priority))
    console.log(`${h.name.padEnd(nw)}  ${h.event.padEnd(ew)}  ${String(h.priority).padStart(3)}  ${h.enabled ? 'yes' : 'no '}  ${h.once ? 'yes' : 'no '}  ${h.script}`);
  console.log(`\n${hooks.length} hooks (${hooks.filter(h => h.enabled).length} enabled)`);
}

function executeHook(hook, args) {
  const sp = path.resolve(TEAM_DIR, hook.script);
  if (!fs.existsSync(sp)) { process.stderr.write(`hook-router: not found: ${sp}\n`); return 1; }
  const isJS = sp.endsWith('.js'), isSh = sp.endsWith('.sh');
  const cmd = isJS ? process.execPath : isSh ? '/bin/bash' : sp;
  const sa = isJS || isSh ? [sp] : [];
  const payload = JSON.stringify({ tool_name: args.tool, tool_input: {}, tool_output: {}, session_id: args.sessionId, phase: args.phase });
  if (hook.input === 'arg1-json') sa.push(payload);
  else if (hook.input === 'arg2-json') sa.push('', payload);
  const r = spawnSync(cmd, sa, {
    cwd: process.cwd(),
    env: { ...process.env, HOOK_SESSION_ID: args.sessionId },
    stdio: [hook.input === 'stdin-json' ? 'pipe' : 'inherit', 'pipe', 'pipe'],
    timeout: 10000,
    input: hook.input === 'stdin-json' ? payload : undefined,
  });
  if (r.stdout?.length) process.stdout.write(r.stdout);
  if (r.stderr?.length) process.stderr.write(r.stderr);
  return r.status ?? 0;
}

function main() {
  const args = parseArgs();
  const hooks = loadConfig();
  if (args.list) { listHooks(hooks); return; }
  if (!args.event) { process.stderr.write('hook-router: --event required (or set HOOK_EVENT)\n'); process.exit(2); }

  const target = args.tool || args.phase || '';
  const matching = hooks
    .filter(h => h.enabled && h.event === args.event)
    .filter(h => !h.matcher || h.matcher === '.*' || (() => { try { return new RegExp(h.matcher).test(target); } catch { return false; } })())
    .sort((a, b) => a.priority - b.priority);

  const state = loadSessionState(args.sessionId);
  const toRun = matching.filter(h => !(h.once && state.fired.includes(h.name)));

  if (args.dryRun) {
    console.log(`Event: ${args.event} | Target: ${target || '(none)'}`);
    console.log(`Matched ${matching.length} hooks, ${toRun.length} will run:`);
    toRun.forEach(h => console.log(`  [${h.priority}] ${h.name} → ${h.script}${h.once ? ' (once)' : ''}`));
    return;
  }

  let exit = 0;
  for (const hook of toRun) {
    const code = executeHook(hook, args);
    if (hook.once) { state.fired.push(hook.name); saveSessionState(state); }
    if (code !== 0) { exit = code; break; }
  }
  process.exit(exit);
}

main();
