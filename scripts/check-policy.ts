import * as typescript from "typescript";

interface PolicyViolation {
  filePath: string;
  line: number;
  column: number;
  message: string;
}

const policyScriptPath = "scripts/check-policy.ts";
const checkedRoots = ["src", "tests", "scripts"] as const;
const allowedBunFilePaths = new Set(["src/lexer/bun-file-repository.ts", policyScriptPath]);

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
