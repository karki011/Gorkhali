# Coding Principles

These principles guide all code — human and machine-generated alike. Apply them as a checklist before writing or reviewing code.

---

## Core Principles

### KISS — Keep It Simple, Stupid

Write the simplest code that solves the problem. Avoid clever abstractions, nested ternaries, and multi-level indirection. If a developer can't understand it in 30 seconds, simplify it.

### YAGNI — You Aren't Gonna Need It

Don't build for hypothetical future requirements. No speculative abstractions, unused parameters, or "just in case" code paths. Add complexity only when a real requirement demands it.

### DRY — Don't Repeat Yourself

Extract shared logic only when duplication is **proven** (3+ occurrences). Premature DRY is worse than duplication — three similar lines beat a premature abstraction.

### SOLID

| Principle                     | Rule                                          | Pitfall to Avoid                                         |
| ----------------------------- | --------------------------------------------- | -------------------------------------------------------- |
| **S** — Single Responsibility | One reason to change per module/function       | Don't stuff unrelated logic into a "utils" file          |
| **O** — Open/Closed           | Extend via composition, not modification       | Don't modify working code when you can wrap or extend it |
| **L** — Liskov Substitution   | Subtypes must be substitutable for base types  | Don't override methods that break parent contracts       |
| **I** — Interface Segregation | Small, focused interfaces over fat ones        | Don't create god-types with 20+ optional fields          |
| **D** — Dependency Inversion  | Depend on abstractions, not concretions        | Don't hardcode dependencies — accept them as params      |

### SoC — Separation of Concerns

Keep data fetching, business logic, and presentation in separate layers. In this codebase: `features/*/api` → `features/*/domain` → `ui/*`. Each module owns one concern.

### CQS — Command-Query Separation

A function should either **do something** (command/mutation) or **return something** (query) — never both. Queries are side-effect-free; commands change state but don't return data. This makes code predictable and testable.

### TDA — Tell, Don't Ask

Don't interrogate an object's state and then act on it externally. Instead, **tell** the object what to do and let it handle its own logic. This keeps behavior with the data it operates on.

```ts
// Bad: asking then acting
if (user.role === 'admin') { grantAccess(user) }

// Good: telling
user.grantAccessIfAuthorized()
```

### GRASP — General Responsibility Assignment

Assign responsibilities to the class/module that has the **information** to fulfill them. Key patterns:
- **Information Expert** — the module with the data does the work
- **Creator** — the module that uses an object should create it
- **Controller** — a dedicated module handles system events, not UI components
- **Low Coupling / High Cohesion** — minimize dependencies, maximize focus

---

## Additional Principles

### Principle of Least Astonishment (POLA)

Code should behave as the reader expects. Name functions for what they **do**, not how they do it. A function called `getUser` should not silently create one.

### Composition Over Inheritance

Prefer composing small, focused functions/hooks over deep inheritance chains. In React, this means custom hooks + component composition — not HOC pyramids.

### Fail Fast, Fail Loud

Validate at boundaries (user input, API responses), then trust internal data. Don't wrap every function in try/catch — let unexpected errors surface immediately rather than hiding them behind silent fallbacks.

### Boy Scout Rule

Leave code cleaner than you found it — but **only in files you're already changing**. Don't refactor adjacent code or "improve" unrelated modules.

### Law of Demeter (Least Knowledge)

Don't reach through objects: `user.address.city.name` is a code smell. Each unit should only talk to its immediate collaborators, not their internals.

### Immutability by Default

Never mutate state or props directly. Use spread, `map`, `filter`, `reduce` for transformations. Mutations are the #1 source of subtle bugs.

### Explicit Over Implicit

Prefer named parameters, explicit returns, and clear control flow over magic. Avoid default exports, implicit type coercion, and side effects hidden in getters.

### Minimal API Surface

Expose only what consumers need. Use barrel exports (`index.ts`) to control the public API. Internal helpers stay internal — don't export "just in case."

### Referential Transparency

Given the same inputs, a function should always return the same output with no side effects. Pure functions are easier to test, compose, and reason about.

### Encapsulate What Varies

Identify what changes and isolate it behind a stable interface. When requirements shift, only the encapsulated part needs updating — the rest stays untouched.

### Favor Readability Over Cleverness

Readable code is maintainable code. Prefer verbose clarity over terse cleverness. Code is read 10x more often than it is written — optimize for the reader.

---

## Anti-Patterns: Must Avoid

| Anti-Pattern               | Why It Happens                          | What To Do Instead                               |
| -------------------------- | --------------------------------------- | ------------------------------------------------ |
| **Shotgun Surgery**        | Changing one behavior touches 10+ files | Consolidate related logic into one module        |
| **God Component**          | One component does everything           | Split into container + presentational components |
| **Prop Drilling**          | Passing props through 3+ levels         | Use context, composition, or state management    |
| **Premature Optimization** | Optimizing before measuring             | Profile first, optimize the measured bottleneck  |
| **Boolean Blindness**      | `doThing(true, false, true)`            | Use named options objects or enums               |
| **Stringly Typed**         | Using strings where types/enums belong  | Define discriminated unions or const objects     |
| **Copy-Paste Programming** | Duplicating code with minor tweaks      | Extract the variation into a parameter           |
| **Callback Hell**          | Deeply nested async callbacks           | Use async/await with flat control flow           |
| **Magic Numbers/Strings**  | Hardcoded values without explanation    | Extract to named constants                       |
| **Silent Swallowing**      | Empty catch blocks or ignored errors    | Log, rethrow, or handle explicitly               |
| **Feature Envy**           | A function uses another module's data more than its own | Move the logic to where the data lives |

---

## References

- [KISS, DRY, SOLID, YAGNI — A Simple Guide](https://medium.com/@hlfdev/kiss-dry-solid-yagni-a-simple-guide-to-some-principles-of-software-engineering-and-clean-code-05e60233c79f)
- [KISS, SOLID, YAGNI And Other Fun Acronyms](https://blog.bitsrc.io/kiss-solid-yagni-and-other-fun-acronyms-b5d207530335)
- Clean Code (Robert C. Martin)
- The Pragmatic Programmer (Hunt & Thomas)
