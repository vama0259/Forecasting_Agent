/**
 * Purpose: Verify Clean Architecture dependency rules across codebase layers.
 * Responsibility: Enforce inward-only imports and forbid illegal layer dependencies.
 * Inputs/outputs: Parse TypeScript import statements; exit 0 if valid, 1 on error.
 * Excludes: Runtime validation, syntax checking, and type generation.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

/**
 * Represents an architectural import violation.
 */
export interface ArchViolation {
  readonly file: string;
  readonly imported: string;
  readonly reason: string;
}

const FORBIDDEN_CORE_IMPORTS = [
  'src/adapters',
  'src/storage',
  'src/execution',
  'src/app',
  'pg',
  'fs',
  'node:fs',
  'node:http',
  'node:https',
  'node:net',
  'node:child_process',
];

/**
 * Extracts import/export module specifiers from a TypeScript source AST.
 * Returns array of module specifier strings found in the file.
 */
export function extractImports(sourceFile: ts.SourceFile): string[] {
  const imports: string[] = [];
  function visit(node: ts.Node): void {
    if (
      ts.isImportDeclaration(node) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      imports.push(node.moduleSpecifier.text);
    } else if (
      ts.isExportDeclaration(node) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      imports.push(node.moduleSpecifier.text);
    }
    ts.forEachChild(node, visit);
  }
  ts.forEachChild(sourceFile, visit);
  return imports;
}

/**
 * Validates that an import from a given file does not violate layer rules.
 * Returns violation description or null if import is architecturally sound.
 */
export function checkImportViolation(
  filePath: string,
  importPath: string,
): ArchViolation | null {
  const normalizedFile = filePath.replace(/\\/g, '/');

  if (normalizedFile.includes('/src/core/') || normalizedFile.startsWith('src/core/')) {
    for (const forbidden of FORBIDDEN_CORE_IMPORTS) {
      if (importPath === forbidden || importPath.startsWith(`${forbidden}/`)) {
        return {
          file: filePath,
          imported: importPath,
          reason: `Core layer cannot import from forbidden dependency "${forbidden}"`,
        };
      }
    }
    if (
      importPath.includes('/adapters') ||
      importPath.startsWith('adapters') ||
      importPath.includes('/storage') ||
      importPath.startsWith('storage') ||
      importPath.includes('/execution/') ||
      importPath.startsWith('execution/') ||
      importPath.includes('/app') ||
      importPath.startsWith('app')
    ) {
      return {
        file: filePath,
        imported: importPath,
        reason: 'Core layer cannot import from outer layers',
      };
    }
  }

  if (
    normalizedFile.includes('/src/storage/') ||
    normalizedFile.startsWith('src/storage/') ||
    normalizedFile.includes('/src/execution/') ||
    normalizedFile.startsWith('src/execution/')
  ) {
    if (
      importPath.includes('/adapters') ||
      importPath.startsWith('adapters') ||
      importPath.includes('/app') ||
      importPath.startsWith('app')
    ) {
      return {
        file: filePath,
        imported: importPath,
        reason: 'Use-case layer cannot directly import adapters or app',
      };
    }
  }

  return null;
}

/**
 * Recursively scans directory for TypeScript files to check.
 * Returns list of absolute file paths matching scan criteria.
 */
export function getTsFiles(dir: string): string[] {
  const results: string[] = [];
  if (!fs.existsSync(dir)) return results;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (
      entry.isDirectory() &&
      entry.name !== 'node_modules' &&
      entry.name !== 'dist' &&
      entry.name !== 'data'
    ) {
      results.push(...getTsFiles(fullPath));
    } else if (entry.isFile() && entry.name.endsWith('.ts')) {
      results.push(fullPath);
    }
  }
  return results;
}

/**
 * Runs architecture validation across all project TypeScript source files.
 * Exits with status code 1 on failure or 0 on success.
 */
export function main(): void {
  const srcDir = path.resolve(process.cwd(), 'src');
  const files = getTsFiles(srcDir);
  const violations: ArchViolation[] = [];

  for (const file of files) {
    const content = fs.readFileSync(file, 'utf-8');
    const sourceFile = ts.createSourceFile(file, content, ts.ScriptTarget.Latest, true);
    const imports = extractImports(sourceFile);
    for (const imp of imports) {
      const v = checkImportViolation(file, imp);
      if (v) violations.push(v);
    }
  }

  if (violations.length > 0) {
    console.error(`Found ${violations.length} architecture violations:`);
    for (const v of violations) {
      console.error(`  ${v.file} -> "${v.imported}": ${v.reason}`);
    }
    process.exit(1);
  }
  console.log(`Architecture validation passed on ${files.length} source files.`);
}

const currentFile = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === currentFile) {
  main();
}
