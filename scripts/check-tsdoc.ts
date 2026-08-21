/**
 * Purpose: Validate TSDoc comments and line limits across TypeScript source files.
 * Responsibility: Verify module headers, exported entity TSDocs, and format limits.
 * Inputs/outputs: Read .ts files; exit code 0 on success or 1 on validation error.
 * Excludes: External AST generation, file formatting, and import graph validation.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

/**
 * Represents a violation of TSDoc or line formatting rules.
 */
export interface Violation {
  readonly file: string;
  readonly line: number;
  readonly message: string;
}

/**
 * Validates module-level TSDoc header contains the 4 required tags.
 * Returns array of violations if header is missing or incomplete.
 */
export function validateModuleHeader(filePath: string, content: string): Violation[] {
  const violations: Violation[] = [];
  const headerMatch = content.match(/^\/\*\*[\s\S]*?\*\//);
  if (!headerMatch) {
    violations.push({
      file: filePath,
      line: 1,
      message: 'Missing module-level TSDoc header',
    });
    return violations;
  }

  const header = headerMatch[0];
  const requiredTags = ['Purpose:', 'Responsibility:', 'Inputs/outputs:', 'Excludes:'];
  for (const tag of requiredTags) {
    if (!header.includes(tag)) {
      violations.push({
        file: filePath,
        line: 1,
        message: `Module header missing required tag "${tag}"`,
      });
    }
  }
  return violations;
}

/**
 * Checks physical line count and line width against engineering limits.
 * Returns violations for lines > 88 characters or files > 300 lines.
 */
export function validateLineLimits(filePath: string, content: string): Violation[] {
  const violations: Violation[] = [];
  const lines = content.split('\n');
  if (lines.length > 300) {
    violations.push({
      file: filePath,
      line: lines.length,
      message: `File exceeds 300 lines (actual: ${lines.length})`,
    });
  }
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    if (line.length > 88) {
      violations.push({
        file: filePath,
        line: i + 1,
        message: `Line exceeds 88 characters (actual: ${line.length})`,
      });
    }
  }
  return violations;
}

/**
 * Checks that exported functions, methods, classes, and interfaces have TSDoc.
 * Returns violations when exported items lack doc or functions have < 2 lines.
 */
export function validateExportedDocs(
  filePath: string,
  sourceFile: ts.SourceFile,
  content: string,
): Violation[] {
  const violations: Violation[] = [];

  function checkNode(node: ts.Node): void {
    const isExported =
      ts.canHaveModifiers(node) &&
      ts.getModifiers(node)?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);

    if (
      isExported &&
      (ts.isFunctionDeclaration(node) ||
        ts.isClassDeclaration(node) ||
        ts.isInterfaceDeclaration(node) ||
        ts.isTypeAliasDeclaration(node) ||
        ts.isEnumDeclaration(node))
    ) {
      const start = node.getStart(sourceFile);
      const comments = ts.getLeadingCommentRanges(content, node.pos);
      const hasJsDoc = comments?.some((c) => content.slice(c.pos, c.pos + 3) === '/**');

      const { line } = sourceFile.getLineAndCharacterOfPosition(start);
      if (!hasJsDoc) {
        violations.push({
          file: filePath,
          line: line + 1,
          message: `Exported declaration lacks TSDoc comment`,
        });
      } else if (ts.isFunctionDeclaration(node)) {
        const jsDocComment = comments?.find(
          (c) => content.slice(c.pos, c.pos + 3) === '/**',
        );
        if (jsDocComment) {
          const docText = content.slice(jsDocComment.pos, jsDocComment.end);
          const contentLines = docText
            .split('\n')
            .map((l) => l.replace(/^\s*\*\s?/, '').trim())
            .filter((l) => l.length > 0 && !l.startsWith('/**') && l !== '/');
          if (contentLines.length < 2) {
            violations.push({
              file: filePath,
              line: line + 1,
              message: `Exported function TSDoc requires >= 2 content lines`,
            });
          }
        }
      }
    }
    ts.forEachChild(node, checkNode);
  }

  ts.forEachChild(sourceFile, checkNode);
  return violations;
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
 * Runs all TSDoc and line limit validations across target directories.
 * Exits with status code 1 on failure or 0 on success.
 */
export function main(): void {
  const dirs = ['src', 'scripts', 'tests'];
  const allFiles = dirs.flatMap((d) => getTsFiles(path.resolve(process.cwd(), d)));
  let totalViolations: Violation[] = [];

  for (const file of allFiles) {
    const content = fs.readFileSync(file, 'utf-8');
    const sourceFile = ts.createSourceFile(file, content, ts.ScriptTarget.Latest, true);
    const v1 = validateModuleHeader(file, content);
    const v2 = validateLineLimits(file, content);
    const v3 = validateExportedDocs(file, sourceFile, content);
    totalViolations = totalViolations.concat(v1, v2, v3);
  }

  if (totalViolations.length > 0) {
    console.error(`Found ${totalViolations.length} TSDoc / line violations:`);
    for (const v of totalViolations) {
      console.error(`  ${v.file}:${v.line} - ${v.message}`);
    }
    process.exit(1);
  }
  console.log(`TSDoc validation passed on ${allFiles.length} files.`);
}

const currentFile = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === currentFile) {
  main();
}
