# Visual Inspection & Comparison Protocol

Reference for Lens agent — detailed browser backend commands, multi-viewport inspection, and re-inspection comparison.

## Browser Backends

### agent-browser (preferred)

Uses `agent-browser` CLI — a Rust daemon speaking CDP directly. Faster startup (persistent daemon), LLM-native accessibility snapshots with `@eN` element refs, session persistence across re-inspections.

**Detection:** Run `which agent-browser` — if found, use this backend.

**Navigation + Inspection:**
```bash
# Navigate (daemon keeps session alive between commands)
agent-browser --session-name lens-qa open <url>

# Accessibility snapshot — returns @eN-tagged element tree for LLM reasoning
agent-browser --session-name lens-qa snapshot

# Screenshot — saves to file for visual evidence
agent-browser --session-name lens-qa screenshot /tmp/lens-<route>.png

# Interact — use @eN refs from snapshot
agent-browser --session-name lens-qa click @e5
agent-browser --session-name lens-qa type @e3 "search query"

# Multi-viewport
agent-browser --session-name lens-qa set viewport 375 812   # mobile
agent-browser --session-name lens-qa screenshot /tmp/lens-<route>-mobile.png
agent-browser --session-name lens-qa set viewport 768 1024  # tablet
agent-browser --session-name lens-qa screenshot /tmp/lens-<route>-tablet.png
agent-browser --session-name lens-qa set viewport 1440 900  # desktop
agent-browser --session-name lens-qa screenshot /tmp/lens-<route>-desktop.png
```

**Do NOT fall back to playwright MCP tools (`mcp__plugin_playwright_*`) — agent-browser is the only Lens backend.**

## Visual Inspection Steps

For each route (same regardless of backend):

1. **Navigate** -- Load the page, wait for content
2. **Snapshot** -- Get accessibility tree (`agent-browser --session-name lens-qa snapshot`)
3. **Auth check** -- If snapshot shows login form, run Smart Auth Protocol (`reference/smart-auth.md`), then re-navigate
4. **Screenshot** -- Capture full page at default viewport
5. **Analyze** -- Check layout, typography, colors, responsiveness, empty states, loading states, alignment, completeness
6. **Interact** -- Test buttons, inputs, toggles, modals, navigation using element refs
7. **Multi-viewport** -- Repeat screenshots at mobile (375px), tablet (768px), desktop (1440px)

## Fix Loop Protocol

When issues are found:

1. Emit structured fix packets (see Lens agent fix packet format)
2. Apex assigns fix packets to Blade agents
3. Lens re-inspects after fix is applied (agent-browser: same daemon session, no re-auth needed)
4. Escalate to Apex when the visual fix-loop ceiling is reached (ceiling owned by `scripts/lib/constants.js` `VISUAL_LOOP_CEILING`, env override `PHANTOM_VISUAL_LOOP_CEILING` — not restated here)

## Comparison Protocol (Re-Inspection)

On each re-inspection pass, compare the current state against the previous screenshot for each issue:

- **FIXED** — issue is no longer visible
- **PERSISTS** — issue still present, unchanged
- **REGRESSED** — issue changed but is now worse (describe the regression)

Report comparison results before listing any new issues. New issues detected during re-inspection must be flagged separately with `[NEW]` prefix in the issue description.

## Autonomous Mode

When spawned with `autonomous: true`:

- Skip asking for confirmation on routes or actions
- Output fix packets immediately after analysis
- Stay active for re-inspection after fixes are applied (do not terminate after first pass)
- On re-inspection, compare current screenshots against previous ones and report status per issue
