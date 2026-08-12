# Optional Lens visual protocol

Load this reference only for an explicitly requested Lens inspection.

## Resolve the worktree URL

Use an exact HTTP(S) dev-server URL supplied by the user when one is present.
Otherwise:

1. Obtain the canonical current worktree path and exact Git branch from the
   caller or the current workspace.
2. Open `http://localhost:3333`.
3. Match a workspace card by exact canonical worktree path first.
4. Only when no path match exists, use an exact branch match that identifies
   exactly one card. Never use substring, normalized-prefix, or fuzzy matching.
5. If the matched card is running, follow only its displayed Dev link. Do not
   infer the application port from repository configuration or another card.
6. If the manager is unavailable, the card is absent or ambiguous, or no
   running Dev link is displayed, ask through the caller for the exact URL.
   Include `http://localhost:3333`, the branch, and the worktree path so the
   user can start the correct server and paste its displayed Dev link.

Keep the Lens inspection pending while waiting for that URL. Do not convert it
to a pass, failure, or checklist-only flow. Never click Start/Restart Dev,
guess a port, or select a different worktree on the user's behalf.

## Browser backend

Use the browser backend supplied by the caller. When `agent-browser` is the
available backend, use one persistent `lens-qa` session. If no supported browser
backend is available, report a skipped check and observation gap; do not install
software or substitute an unverified pass.

## Per-route inspection

For every assigned route:

1. Navigate and wait for the intended state.
2. Capture a fresh accessibility snapshot.
3. If authentication blocks the route, apply `smart-auth.md`.
4. Capture screenshots for each assigned viewport and state.
5. Exercise only the assigned interactions.
6. After each state-changing action, capture a fresh snapshot and screenshot.
7. Compare the observation with the supplied expectation or design reference.

For `agent-browser`, the core commands are:

```text
agent-browser --session-name lens-qa open <url>
agent-browser --session-name lens-qa snapshot -i
agent-browser --session-name lens-qa screenshot <evidence-path>
agent-browser --session-name lens-qa set viewport <width> <height>
```

Element references belong only to the snapshot that produced them. Never carry
a reference across navigation, modal changes, or another snapshot.

## Evidence boundary

Lens reports evidence and gaps only. It does not edit files, dispatch repair
agents, retry fixes, write a specialist review artifact, or claim the user's
confirmation. A failed or blocked optional Lens pass does not change the normal
verification lifecycle; the user may continue with the human checklist.
