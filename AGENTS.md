# Agent Engineering Rules

These rules apply to every human and coding agent working in this repository.
They are mandatory unless an approved ADR records a narrower exception.

## Required reading

Before writing code, read:

- `docs/engineering-standards.md`;
- both foundation ADRs in `docs/superpowers/specs/`;
- the implementation plan for the task.

## Architecture

- Use Clean Architecture; source dependencies point toward core policy.
- Apply SOLID pragmatically to every module, class, and public contract.
- Prefer composition and injected interfaces over inheritance.
- Keep infrastructure behind consumer-owned ports.
- Keep forecasting, industry, Podman, PostgreSQL, and UI details out of core.
- Use OOP for stateful behavior, policies, use cases, and adapters.
- Use pure functions for stateless transformations; do not wrap them in classes.
- Never introduce a pattern, interface, or abstraction without a current consumer.
- No inheritance deeper than one level; framework-required inheritance needs a note.

## File and line limits

- Every handwritten source file has exactly one primary responsibility.
- A handwritten source file must not exceed 300 physical lines.
- A handwritten line must not exceed 88 characters.
- Split by responsibility before either limit is exceeded.
- Do not compress readable code merely to satisfy a line limit.

Exemptions are limited to generated files, lockfiles, SQL migrations, snapshots,
machine-produced fixtures, and vendored code. Mark generated files clearly. A
handwritten exemption requires an ADR; review convenience is not an exemption.

## Documentation

- Every handwritten source file begins with a module TSDoc block.
- The block has four content lines: purpose, responsibility, inputs/outputs,
  and exclusions.
- Every exported function, method, class, and interface has TSDoc.
- Exported functions and methods have at least two concise content lines:
  behavior/contract, then result/failure or side-effect information.
- Document private functions only when intent, invariant, or failure is unclear.
- Explain why and boundaries; never narrate obvious syntax.
- Update documentation when behavior changes.

## TypeScript

- Use Node.js 24 LTS, ESM, TypeScript strict mode, and pnpm.
- Do not use `any`; use `unknown` plus validated narrowing at trust boundaries.
- Validate external input at runtime before converting it to domain values.
- Prefer immutable values and readonly types.
- Use explicit result/error types for expected failures.
- Never use non-null assertions to hide an unproved invariant.
- Stream large inputs, outputs, and logs with backpressure.
- Keep CPU-heavy work outside the Node.js event loop.

## Testing and verification

- Use test-driven development: failing test, minimal implementation, refactor.
- Test contracts through ports and adapters, not private implementation details.
- Run unit, integration, architecture, formatting, type, and security checks.
- Real Podman behavior requires real rootless-Podman conformance tests.
- Every bug fix includes a regression test that fails without the fix.
- Never claim completion without fresh command output proving it.

## Change discipline

- Preserve unrelated user changes.
- Do not copy legacy TCS, finance, M8, debate, or harness assumptions.
- Do not add Docker code to orchestration; only a future adapter may use it.
- Keep commits focused and independently reviewable.
- Reject overengineering even when it appears professionally sophisticated.

## Review questions

Before accepting a change, answer:

1. What is the file's one responsibility?
2. Which dependency points inward, and which port owns the boundary?
3. Could composition replace inheritance?
4. Is every abstraction used now?
5. Are all trust-boundary values validated?
6. Do cancellation, partial failure, and retries remain correct?
7. Are the 300-line and 88-character limits satisfied?
8. Does fresh verification prove the stated outcome?
