# Engineering Standards

This document defines how production code is designed and reviewed.
Mechanical rules are enforced by formatting, linting, and architecture tests.

## 1. Design hierarchy

Apply principles in this order:

1. Correctness and trust-boundary safety.
2. Clean Architecture dependency direction.
3. SOLID responsibilities and contracts.
4. Simplicity: KISS and YAGNI.
5. DRY after duplication represents the same knowledge.
6. Patterns only when a demonstrated problem needs them.

Do not use SOLID as permission to create speculative interfaces or classes.

## 2. Object-oriented design

Use classes when code owns state, enforces invariants, coordinates a use case,
or implements a replaceable port. Typical examples are repositories, policies,
brokers, stores, collectors, and runtime adapters.

Use a pure function when the operation is stateless and deterministic. Parsing,
canonicalization, hashing, mapping, and narrow validation usually fit functions.
Wrapping a pure transformation in a class does not improve object orientation.

Rules:

- Encapsulate mutable state; never expose writable internal collections.
- Construct valid objects or fail; do not permit partially valid instances.
- Inject external dependencies through narrow consumer-owned interfaces.
- Separate commands that change state from queries that return state.
- Prefer value objects to unvalidated primitive strings at domain boundaries.

## 3. SOLID

### Single Responsibility

Each file, class, and function has one reason to change. A use case coordinates;
a repository persists; an adapter translates; a policy decides. Split behavior
when its reasons for change or its dependencies differ.

### Open/Closed

Extend behavior through an existing port only when a second implementation or
current variation exists. Do not create extension points for imagined users.

### Liskov Substitution

Every port implementation preserves input requirements, output guarantees,
failure types, cancellation behavior, and side effects. An adapter cannot
silently weaken a mandatory runtime or storage control.

### Interface Segregation

Define the smallest interface required by its consumer. Avoid universal service,
repository, context, or manager interfaces. Split read and write capabilities
when consumers need different authority.

### Dependency Inversion

Core policy owns interfaces. Infrastructure implements them. The composition
root is the only place that constructs concrete PostgreSQL, filesystem, Podman,
provider, or UI dependencies.

## 4. Composition over inheritance

Compose behavior through constructor injection and small interfaces. Do not use
inheritance for code reuse. One inheritance level is allowed only when a real
subtype contract or required framework API exists and Liskov substitution is
tested. Record the reason beside the declaration.

## 5. Source-file contract

Every handwritten source file:

- serves one primary objective;
- contains at most 300 physical lines;
- uses lines no longer than 88 characters;
- starts with a four-content-line module TSDoc block;
- exports a small cohesive surface;
- contains no unrelated convenience helpers.

Required module header:

```ts
/**
 * Purpose: Verify and materialize immutable artifact bytes.
 * Responsibility: Enforce size and SHA-256 before exposing a staged file.
 * Inputs/outputs: Accept an artifact key; return a verified staging path.
 * Excludes: Metadata persistence, authorization, and container mounting.
 */
```

The four content lines are mandatory. Opening and closing markers do not count.

## 6. Function contract

Every exported function and method has at least two concise TSDoc content lines.
Line one states behavior and preconditions. Line two states the result, expected
failure, or material side effect.

```ts
/**
 * Materializes an artifact only after verifying its expected size and hash.
 * Returns a trusted path or throws ArtifactCorruptedError without promotion.
 */
async function materializeVerified(...): Promise<VerifiedFile> {
  // Implementation.
}
```

Exported classes and interfaces describe their invariant and boundary. Private
functions need documentation only when names and types cannot express intent.
Redundant comments that restate the code are prohibited.

Functions should normally stay below 40 physical lines and four parameters.
Exceeding either is a review signal, not an automatic failure. Prefer a parameter
object when arguments form one concept; do not hide unrelated arguments in one.

## 7. Naming and types

- Use domain language, not `manager`, `helper`, `util`, `data`, or `thing`.
- Name interfaces by capability; do not prefix them with `I`.
- Use branded/value-object identifiers across domain boundaries.
- Model valid states with discriminated unions and exhaustive checks.
- Use `unknown` for untrusted values and validate before use.
- Never use `any`, unchecked casts, or non-null assertions as shortcuts.
- Keep transport, database, and runtime DTOs outside core entities.

## 8. Error and cancellation rules

- Expected failures use stable typed codes and structured context.
- Unexpected failures retain their cause without leaking secrets.
- Every I/O operation has a timeout or a bounded owning lifecycle.
- Cancellation reaches the real resource; promise rejection alone is inadequate.
- Cleanup is idempotent and independently recorded.
- Partial failure cannot publish or mark incomplete evidence as complete.

## 9. Enforcement configuration

The scaffold must configure:

- Prettier `printWidth: 88`;
- ESLint `max-len: 88` with narrow URL/import/generated exceptions;
- ESLint `max-lines: 300` for handwritten TypeScript;
- strict TypeScript with `noUncheckedIndexedAccess`;
- import-boundary and circular-dependency checks;
- TSDoc validation for modules and exported APIs;
- a custom check for four-line module and two-line exported-function docs;
- architecture tests for inward dependency direction;
- CI failure on formatting, lint, type, test, architecture, or security errors.

Generated files, frozen lockfiles, SQL migrations, snapshots, vendored code, and
machine-produced fixtures are excluded from line and documentation checks. Their
directories must be explicit; filename-based ad hoc exclusions are prohibited.

## 10. Review evidence

A reviewer rejects code when:

- responsibilities are mixed to stay below the file limit;
- classes exist only to satisfy an OOP slogan;
- patterns or ports have no current consumer;
- inheritance replaces straightforward composition;
- comments describe syntax rather than decisions or invariants;
- formatting passes but trust-boundary behavior is untested;
- mocked tests are presented as PostgreSQL or Podman integration evidence;
- completion is claimed without fresh verification output.

Mechanical compliance is necessary, not sufficient. A 200-line file with two
reasons to change still violates the standard, while an exempt generated file
may exceed 300 lines without harming the design.
