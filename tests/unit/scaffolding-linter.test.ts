/**
 * Purpose: Unit tests for scaffolding validation scripts and AST linters.
 * Responsibility: Verify TSDoc validation, line limit checks, and architecture rules.
 * Inputs/outputs: Synthetic TypeScript code strings; assertions on violations.
 * Excludes: Live filesystem operations and external compiler executions.
 */

import { describe, it, expect } from 'vitest';
import ts from 'typescript';
import {
  validateModuleHeader,
  validateLineLimits,
  validateExportedDocs,
} from '../../scripts/check-tsdoc.js';
import { checkImportViolation } from '../../scripts/check-architecture.js';

describe('Scaffolding Linters & Enforcement', () => {
  it('passes a fully compliant TypeScript file', () => {
    const validContent = `/**
 * Purpose: Example valid module.
 * Responsibility: Demonstrate compliance with all engineering standards.
 * Inputs/outputs: Input string; returns transformed string.
 * Excludes: Outer layer adapters and persistent storage.
 */

/**
 * Transforms an input string into upper case representation.
 * Returns uppercase string or throws TypeError on invalid input.
 */
export function transformText(input: string): string {
  return input.toUpperCase();
}
`;
    const sourceFile = ts.createSourceFile(
      'src/core/test.ts',
      validContent,
      ts.ScriptTarget.Latest,
      true,
    );
    const headerViolations = validateModuleHeader('src/core/test.ts', validContent);
    const lineViolations = validateLineLimits('src/core/test.ts', validContent);
    const docViolations = validateExportedDocs(
      'src/core/test.ts',
      sourceFile,
      validContent,
    );

    expect(headerViolations).toHaveLength(0);
    expect(lineViolations).toHaveLength(0);
    expect(docViolations).toHaveLength(0);
  });

  it('detects missing Excludes tag in module TSDoc header', () => {
    const invalidHeader = `/**
 * Purpose: Example incomplete module.
 * Responsibility: Demonstrate header tag validation.
 * Inputs/outputs: None.
 */
`;
    const violations = validateModuleHeader('src/core/test.ts', invalidHeader);
    expect(violations.length).toBeGreaterThan(0);
    expect(violations.some((v) => v.message.includes('Excludes:'))).toBe(true);
  });

  it('detects lines exceeding 88 characters', () => {
    const longLineContent = [
      '/**',
      ' * Purpose: Test line width.',
      ' * Responsibility: Test line length verification.',
      ' * Inputs/outputs: None.',
      ' * Excludes: None.',
      ' */',
      'const a = "this string is intentionally super long and exceeds limit ' +
        'by a substantial margin";',
    ].join('\n');
    const violations = validateLineLimits('src/core/test.ts', longLineContent);
    expect(violations.length).toBeGreaterThan(0);
    expect(violations[0]?.message).toContain('Line exceeds 88 characters');
  });

  it('detects forbidden imports inside src/core/', () => {
    const violation = checkImportViolation('src/core/policies/cutoff.ts', 'pg');
    expect(violation).not.toBeNull();
    expect(violation?.reason).toContain('Core layer cannot import');

    const adapterViolation = checkImportViolation(
      'src/core/policies/cutoff.ts',
      '../../adapters/postgres/postgres-pool.js',
    );
    expect(adapterViolation).not.toBeNull();
  });
});
