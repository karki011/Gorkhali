# Coding Principles -- Extended Examples

Companion to `coding-principles.md`. Full examples and rationale for each principle.

---

## TDA -- Tell, Don't Ask (Example)

```ts
// Bad: asking then acting
if (user.role === 'admin') { grantAccess(user) }

// Good: telling
user.grantAccessIfAuthorized()
```

## GRASP -- General Responsibility Assignment

Assign responsibilities to the class/module that has the **information** to fulfill them. Key patterns:
- **Information Expert** -- the module with the data does the work
- **Creator** -- the module that uses an object should create it
- **Controller** -- a dedicated module handles system events, not UI components
- **Low Coupling / High Cohesion** -- minimize dependencies, maximize focus

## SOLID -- Table Reference

| Principle | Rule | Pitfall to Avoid |
|-----------|------|------------------|
| **S** -- Single Responsibility | One reason to change per module/function | Don't stuff unrelated logic into a "utils" file |
| **O** -- Open/Closed | Extend via composition, not modification | Don't modify working code when you can wrap or extend it |
| **L** -- Liskov Substitution | Subtypes must be substitutable for base types | Don't override methods that break parent contracts |
| **I** -- Interface Segregation | Small, focused interfaces over fat ones | Don't create god-types with 20+ optional fields |
| **D** -- Dependency Inversion | Depend on abstractions, not concretions | Don't hardcode dependencies -- accept them as params |

## Minimal Comments (Example)

See the canonical rule and examples in [comment-discipline.md](comment-discipline.md).

## Anti-Patterns: Must Avoid

| Anti-Pattern | Why It Happens | What To Do Instead |
|--------------|----------------|--------------------|
| **Shotgun Surgery** | Changing one behavior touches 10+ files | Consolidate related logic into one module |
| **God Component** | One component does everything | Split into container + presentational components |
| **Prop Drilling** | Passing props through 3+ levels | Use context, composition, or state management |
| **Premature Optimization** | Optimizing before measuring | Profile first, optimize the measured bottleneck |
| **Boolean Blindness** | `doThing(true, false, true)` | Use named options objects or enums |
| **Stringly Typed** | Using strings where types/enums belong | Define discriminated unions or const objects |
| **Copy-Paste Programming** | Duplicating code with minor tweaks | Extract the variation into a parameter |
| **Callback Hell** | Deeply nested async callbacks | Use async/await with flat control flow |
| **Magic Numbers/Strings** | Hardcoded values without explanation | Extract to named constants |
| **Silent Swallowing** | Empty catch blocks or ignored errors | Log, rethrow, or handle explicitly |
| **Feature Envy** | A function uses another module's data more than its own | Move the logic to where the data lives |

## References

- [KISS, DRY, SOLID, YAGNI -- A Simple Guide](https://medium.com/@hlfdev/kiss-dry-solid-yagni-a-simple-guide-to-some-principles-of-software-engineering-and-clean-code-05e60233c79f)
- [KISS, SOLID, YAGNI And Other Fun Acronyms](https://blog.bitsrc.io/kiss-solid-yagni-and-other-fun-acronyms-b5d207530335)
- Clean Code (Robert C. Martin)
- The Pragmatic Programmer (Hunt & Thomas)
