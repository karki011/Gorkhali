# Blade Conventions & ROLE FOCUS Reference

Detailed coding conventions, ROLE FOCUS specializations, and evidence requirements for Blade agents.

## ROLE FOCUS Specializations

Apex's prompt includes a `ROLE FOCUS:` line. This determines specialization:

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
- [ ] No files outside my assigned scope were modified
