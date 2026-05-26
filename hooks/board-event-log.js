#!/usr/bin/env node
// =============================================================================
// Phantom Works — Append-Only Event Logger
// Author: Subash Karki
//
// Captures raw TaskCreate/TaskUpdate/CortexDecision events as NDJSON.
// Zero translation — stores exactly what Claude reports.
// Decision events enable strategy performance tracking and anti-repetition.
// Replaces the 944-line board-sync.js.
// =============================================================================

const fs = require('fs')
const path = require('path')
const { execSync } = require('child_process')

const HOME = require('os').homedir()
const EVENTS_DIR = path.join(HOME, '.claude', 'team', 'events')

const getRepo = () => {
  try {
    return path.basename(
      execSync('git rev-parse --show-toplevel', {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      }).trim()
    )
  } catch {
    return path.basename(process.cwd()) || '_default'
  }
}

let input = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', (chunk) => { input += chunk })
process.stdin.on('end', () => {
  try {
    const data = JSON.parse(input)
    if (!data.tool_name) return

    const repo = getRepo()
    const dir = path.join(EVENTS_DIR, repo)
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })

    const event = {
      ts: new Date().toISOString(),
      tool: data.tool_name,
      input: data.tool_input ?? {},
      result: data.tool_result ?? null,
    }

    fs.appendFileSync(path.join(dir, 'task-events.ndjson'), JSON.stringify(event) + '\n')

    // Extract Cortex decision events from TaskCreate subjects
    const subject = (data.tool_input?.subject ?? '')
    if (subject.startsWith('[Cortex] DECISION:')) {
      const decisionEvent = {
        ts: new Date().toISOString(),
        tool: 'CortexDecision',
        input: data.tool_input ?? {},
        result: data.tool_result ?? null,
      }
      fs.appendFileSync(path.join(dir, 'decisions.ndjson'), JSON.stringify(decisionEvent) + '\n')
    }
  } catch {
    // Never break the workflow — silent on errors
  }
})
