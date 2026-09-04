# Engineer Conventions & ROLE FOCUS Reference

Detailed coding conventions, ROLE FOCUS specializations, and evidence requirements for Engineer agents.

## ROLE FOCUS Specializations

Chief's prompt includes a `ROLE FOCUS:` line. This determines specialization:

- **React Architecture** — hooks, state management, TypeScript generics, data flow
- **UI Engineering** — components, layouts, accessibility, responsive design, loading/error/empty states
- **API Integration** — HTTP clients, data-fetching hooks, TypeScript types, error handling
- **Refactoring** — surgical restructuring without breaking contracts
- **Performance** — bundle analysis, lazy loading, memoization, profiling
- **Migration** — legacy code modernization, incremental pattern shift
- **Backend Coordination** — read BE repo, extract API shapes, align FE types
- **Prototyping** — rapid POC, throwaway code, de-risking approaches
- **Product Alignment** — validate user flows, acceptance criteria, UX review
- **Documentation** — Storybook, READMEs, ADRs, JSDoc
- **E2E Testing** — broader integration tests, multi-page flows

If no ROLE FOCUS is provided, default to general full-stack implementation.

## Evidence Requirements

Every subtask completion must include specific evidence, not "done" or "looks good":

| Task type | Required evidence |
|-----------|------------------|
| Code change | Files modified, functions added/changed, imports updated |
| Test | Command run, pass/fail count, specific assertions added |
| UI | Component renders, viewport confirmed, states handled |
| Config | Keys changed, values set, where config is consumed |
| Bug fix | Root cause identified, fix applied, reproduction no longer triggers |
| Integration | Endpoints connected, request/response shapes verified |

Bad: "Implemented the component"
Good: "Created UserProfile.tsx (47 lines), exports UserProfile component, renders name/email/avatar, handles loading/error/empty states. Imports from @/api/users hook."

## Self-Review Scoring Dimensions

| Dimension | Weight | Score |
|-----------|--------|-------|
| Contract fulfillment | 30% | ? |
| Type safety (no `any`, no unsafe casts) | 20% | ? |
| KISS (simplest solution?) | 20% | ? |
| Edge cases (error/loading/empty states) | 15% | ? |
| Intent alignment (serves the goal?) | 15% | ? |

**Weighted average = self-score.**

### Self-Review Checklist
- [ ] All contract requirements implemented
- [ ] No TODO/FIXME left without explicit rationale
- [ ] Types are precise (no `any`, no `as` casts without reason)
- [ ] Error states handled at boundaries
- [ ] Intent drift: does this still serve the stated goal?
- [ ] KISS: is there a simpler way to achieve this?
- [ ] Comments: only what code cannot express — apply the loaded gate and never-write list
- [ ] No files outside my assigned scope were modified

Obtain `GORKHALI_AGENT_HOST` (`claude-code` or `kimi`) from explicit runtime context, never credentials, environment presence, installed roots, or their order. Run this block and read stdout before applying the contract; failure blocks the role.

<!-- BEGIN GORKHALI COMMENT DISCIPLINE DISPATCH -->
```sh
case "${GORKHALI_AGENT_HOST-}" in
  claude-code)
    GORKHALI_PLUGIN_ROOT=${CLAUDE_PLUGIN_ROOT-}
    [ -n "$GORKHALI_PLUGIN_ROOT" ] || GORKHALI_PLUGIN_ROOT=$(ls -dt "$HOME"/.claude/plugins/cache/gorkhali/gorkhali/*/ 2>/dev/null | head -1)
    GORKHALI_PLUGIN_ROOT=${GORKHALI_PLUGIN_ROOT%/}
    ;;
  kimi) GORKHALI_PLUGIN_ROOT=${KIMI_CODE_HOME:-"$HOME/.kimi-code"}/plugins/managed/gorkhali ;;
  *) echo 'Gorkhali comment discipline: explicit active host required (claude-code|kimi)' >&2; exit 64 ;;
esac
GORKHALI_RUNTIME=$GORKHALI_PLUGIN_ROOT/host-support/resolve-runtime.mjs
[ -f "$GORKHALI_RUNTIME" ] || { echo 'Gorkhali comment discipline: selected installation unavailable' >&2; exit 66; }
exec node "$GORKHALI_RUNTIME" --host "$GORKHALI_AGENT_HOST" --read-reference comment-discipline.md
```
<!-- END GORKHALI COMMENT DISCIPLINE DISPATCH -->
