# Coding Principles

Apply as a checklist before writing or reviewing code. Extended examples in [coding-examples.md](coding-examples.md).

---

## Core Principles

- **KISS** -- Write the simplest code that solves the problem. If a developer can't understand it in 30 seconds, simplify.
- **YAGNI** -- Don't build for hypothetical futures. Add complexity only when a real requirement demands it.
- **DRY** -- Extract shared logic only when duplication is proven (3+ occurrences). Premature DRY is worse than duplication.
- **SOLID** -- Single Responsibility, Open/Closed, Liskov Substitution, Interface Segregation, Dependency Inversion. See [coding-examples.md](coding-examples.md) for table.
- **SoC** -- Keep data fetching, business logic, and presentation in separate layers. In this codebase: `features/*/api` -> `features/*/domain` -> `ui/*`.
- **CQS** -- A function either does something (command) or returns something (query), never both.
- **TDA** -- Tell the object what to do; don't interrogate its state and act externally.
- **GRASP** -- Assign responsibilities to the module that has the information. See [coding-examples.md](coding-examples.md) for key patterns.

## Additional Principles

- **POLA** -- Code should behave as the reader expects. Name functions for what they do.
- **Composition Over Inheritance** -- Prefer composing small functions/hooks over deep inheritance chains.
- **Fail Fast, Fail Loud** -- Validate at boundaries, then trust internal data. Don't wrap every function in try/catch.
- **Boy Scout Rule** -- Leave code cleaner than you found it, but only in files you're already changing.
- **Law of Demeter** -- Don't reach through objects (`user.address.city.name` is a code smell).
- **Immutability by Default** -- Never mutate state or props directly. Use spread, map, filter, reduce.
- **Explicit Over Implicit** -- Named parameters, explicit returns, clear control flow. No magic.
- **Minimal API Surface** -- Expose only what consumers need. Internal helpers stay internal.
- **Referential Transparency** -- Same inputs, same output, no side effects. Pure functions are easier to test.
- **Encapsulate What Varies** -- Isolate what changes behind a stable interface.
- **Favor Readability Over Cleverness** -- Readable code is maintainable code. Optimize for the reader.
- **Minimal Comments** -- The canonical rule and examples live in [comment-discipline.md](comment-discipline.md).

## Anti-Patterns

See [coding-examples.md](coding-examples.md) for the full anti-pattern table (Shotgun Surgery, God Component, Prop Drilling, Premature Optimization, Boolean Blindness, etc.).
