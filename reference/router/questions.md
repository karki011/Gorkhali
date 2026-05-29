# Question-Asking Rules

## The Filter
```
For each potential question:
  Does answer change WHAT we build? -> NO -> auto-resolve silently (HOW question)
  Does answer change WHAT we build? -> YES -> Can codebase answer it? -> YES -> auto-resolve with citation
  Does answer change WHAT we build? -> YES -> Can codebase answer it? -> NO -> ASK THE HUMAN
```

## Batching
- 2-5 questions per batch, grouped by theme
- Each question includes recommended default
- 0 questions is valid: "All scope questions resolved from ticket AC and codebase patterns."
- Max 2 question rounds total (initial + follow-up)

## Good vs Bad
- **Bad** (auto-resolve): testing framework?, file structure?, naming?, error handling?, SOLID?
- **Good** (ask): performance target?, which auth pattern?, backward-compatible migration?, controlled vs uncontrolled?
