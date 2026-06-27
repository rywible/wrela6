import * as typescript from "typescript";

interface PolicyViolation {
  filePath: string;
  line: number;
  column: number;
  message: string;
}

const policyScriptPath = "scripts/check-policy.ts";
const checkedRoots = ["src", "tests", "scripts"] as const;
const allowedBunFilePaths = new Set([
  "src/frontend/lexer/bun-file-repository.ts",
  policyScriptPath,
]);

const bannedIdentifierSuggestions = new Map<string, string>([
  ["src", "source"],
  ["diag", "diagnostic"],
  ["diags", "diagnostics"],
  ["tok", "token"],
  ["toks", "tokens"],
  ["res", "result"],
  ["ctx", "context"],
  ["opts", "options"],
  ["repo", "repository"],
  ["impl", "implementation"],
  ["pos", "position"],
  ["err", "error"],
  ["fc", "fastCheck"],
]);

async function collectTypeScriptFiles(rootDirectory: string): Promise<string[]> {
  const files: string[] = [];
  const glob = new Bun.Glob("**/*.ts");

  for await (const relativePath of glob.scan({ cwd: rootDirectory })) {
    files.push(`${rootDirectory}/${relativePath}`);
  }

  return files;
}

async function readText(filePath: string): Promise<string> {
  return await Bun.file(filePath).text();
}

function normalizePath(filePath: string): string {
  return filePath.replaceAll("\\", "/");
}

function locationOf(
  sourceFile: typescript.SourceFile,
  offset: number,
): { line: number; column: number } {
  const location = sourceFile.getLineAndCharacterOfPosition(offset);

  return {
    line: location.line + 1,
    column: location.character + 1,
  };
}

function isPropertyNameIdentifier(identifier: typescript.Identifier): boolean {
  const parent = identifier.parent;

  return (
    (typescript.isPropertyAccessExpression(parent) && parent.name === identifier) ||
    (typescript.isPropertyAssignment(parent) && parent.name === identifier) ||
    (typescript.isMethodDeclaration(parent) && parent.name === identifier) ||
    (typescript.isPropertyDeclaration(parent) && parent.name === identifier)
  );
}

function checkIdentifiers(filePath: string, sourceText: string): PolicyViolation[] {
  const sourceFile = typescript.createSourceFile(
    filePath,
    sourceText,
    typescript.ScriptTarget.Latest,
    true,
    typescript.ScriptKind.TS,
  );
  const violations: PolicyViolation[] = [];

  function visit(syntaxNode: typescript.Node): void {
    if (typescript.isIdentifier(syntaxNode) && !isPropertyNameIdentifier(syntaxNode)) {
      const suggestion = bannedIdentifierSuggestions.get(syntaxNode.text);

      if (suggestion !== undefined) {
        const location = locationOf(sourceFile, syntaxNode.getStart(sourceFile));
        violations.push({
          filePath,
          line: location.line,
          column: location.column,
          message: `Use "${suggestion}" instead of shortened name "${syntaxNode.text}".`,
        });
      }
    }

    typescript.forEachChild(syntaxNode, visit);
  }

  visit(sourceFile);
  return violations;
}

const layoutImportForbiddenPatterns = [
  /from\s+["'][^"']*\/frontend\//,
  /from\s+["'][^"']*\/parser\//,
  /from\s+["'][^"']*\/proof\//,
  /from\s+["'][^"']*\/codegen\//,
  /from\s+["'][^"']*\/linker\//,
  /from\s+["'][^"']*pe-coff/i,
] as const;

const proofMirForbiddenModulePathPatterns = [
  /[^"']*\/frontend\//,
  /[^"']*\/lexer\//,
  /[^"']*\/parser\//,
  /[^"']*\/semantic\/names\//,
  /[^"']*\/semantic\/item-index\//,
  /[^"']*\/proof\//,
  /[^"']*\/codegen\//,
  /[^"']*\/linker\//,
  /[^"']*(?:aarch64|pe-coff)/i,
  /(?:bun:|node:fs|node:path|node:os|node:process|fs|path|os|process)/,
] as const;

function expandImportBoundaryPatterns(pathPatterns: readonly RegExp[]): RegExp[] {
  const patterns: RegExp[] = [];
  for (const pathPattern of pathPatterns) {
    const pathSource = pathPattern.source;
    patterns.push(new RegExp(`from\\s+["']${pathSource}`));
    patterns.push(new RegExp(`import\\s+["']${pathSource}`));
    patterns.push(new RegExp(`import\\s+\\w+\\s*=\\s*require\\(\\s*["']${pathSource}`));
  }
  return patterns;
}

const proofMirImportForbiddenPatterns = expandImportBoundaryPatterns(
  proofMirForbiddenModulePathPatterns,
);

function checkLayoutImportBoundary(filePath: string, sourceText: string): PolicyViolation[] {
  const normalizedPath = normalizePath(filePath);
  if (!normalizedPath.startsWith("src/layout/")) {
    return [];
  }

  const violations: PolicyViolation[] = [];
  for (const pattern of layoutImportForbiddenPatterns) {
    if (pattern.test(sourceText)) {
      violations.push({
        filePath,
        line: 1,
        column: 1,
        message:
          "src/layout must not import parser, AST, Proof-MIR, codegen, linker, or PE-COFF modules.",
      });
      break;
    }
  }
  return violations;
}

function checkProofMirImportBoundary(filePath: string, sourceText: string): PolicyViolation[] {
  const normalizedPath = normalizePath(filePath);
  if (!normalizedPath.startsWith("src/proof-mir/")) {
    return [];
  }

  const violations: PolicyViolation[] = [];
  for (const pattern of proofMirImportForbiddenPatterns) {
    if (pattern.test(sourceText)) {
      violations.push({
        filePath,
        line: 1,
        column: 1,
        message:
          "src/proof-mir must not import frontend, lexer, parser, name resolution, item index, proof checker, codegen, linker, target backend, or host/runtime modules.",
      });
      break;
    }
  }
  return violations;
}

function checkTextPolicies(filePath: string, sourceText: string): PolicyViolation[] {
  const violations: PolicyViolation[] = [];
  const normalizedPath = normalizePath(filePath);

  if (
    !normalizedPath.startsWith("tests/") &&
    normalizedPath !== policyScriptPath &&
    /fast-check/.test(sourceText)
  ) {
    violations.push({
      filePath,
      line: 1,
      column: 1,
      message: "fast-check is test-only and must not be imported outside tests.",
    });
  }

  if (normalizedPath.startsWith("tests/") && /\b(mock|spyOn|jest\.fn)\b/.test(sourceText)) {
    violations.push({
      filePath,
      line: 1,
      column: 1,
      message: "Use fakes through dependency injection. Do not use mocks or spies.",
    });
  }

  if (/\bBun\.file\s*\(/.test(sourceText) && !allowedBunFilePaths.has(normalizedPath)) {
    violations.push({
      filePath,
      line: 1,
      column: 1,
      message: "Bun.file is only allowed at the file repository edge.",
    });
  }

  if (normalizedPath.startsWith("src/") && /#[A-Za-z_][A-Za-z0-9_]*/.test(sourceText)) {
    violations.push({
      filePath,
      line: 1,
      column: 1,
      message: "Use TypeScript private fields instead of # private fields in runtime source.",
    });
  }

  return violations;
}

async function main(): Promise<void> {
  const files = (
    await Promise.all(checkedRoots.map((root) => collectTypeScriptFiles(root)))
  ).flat();
  const violations: PolicyViolation[] = [];

  for (const filePath of files) {
    const sourceText = await readText(filePath);
    violations.push(...checkIdentifiers(filePath, sourceText));
    violations.push(...checkLayoutImportBoundary(filePath, sourceText));
    violations.push(...checkProofMirImportBoundary(filePath, sourceText));
    violations.push(...checkTextPolicies(filePath, sourceText));
  }

  if (violations.length > 0) {
    for (const violation of violations) {
      console.error(
        `${violation.filePath}:${violation.line}:${violation.column} ${violation.message}`,
      );
    }

    process.exit(1);
  }
}

await main();
