import * as typescript from "typescript";

export interface PolicyViolation {
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

const layoutForbiddenModulePathPatterns = [
  /[^"']*\/frontend\//,
  /[^"']*\/parser\//,
  /[^"']*\/proof\//,
  /[^"']*\/codegen\//,
  /[^"']*\/linker\//,
  /[^"']*pe-coff/i,
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
  /^(?:bun:|node:fs|node:path|node:os|node:process|fs|path|os|process)/,
] as const;

const proofCheckForbiddenModulePathPatterns = [
  /[^"']*\/frontend\//,
  /[^"']*\/lexer\//,
  /[^"']*\/parser\//,
  /[^"']*\/semantic\/names\//,
  /[^"']*\/semantic\/item-index\//,
  /[^"']*\/semantic\/surface\/(?!resource-kind)/,
  /[^"']*\/hir\/.*lowerer/,
  /[^"']*\/proof-mir\/(?:lower|draft|canonicalization)\//,
  /[^"']*\/(?:opt|optimization|codegen|linker)\//,
  /[^"']*(?:aarch64|pe-coff)/i,
  /^(?:bun:|node:fs|node:path|node:os|node:process|fs|path|os|process)/,
] as const;

const optIrForbiddenModulePathPatterns = [
  /[^"']*\/scorecard\//,
  /[^"']*\/benchmark\//,
  /[^"']*\/frontend(?:\/|["'])/,
  /[^"']*\/lexer\//,
  /[^"']*\/parser(?:\/|["'])/,
  /[^"']*\/hir\/.*lowerer/,
  /[^"']*\/proof-mir\/(?:lower|draft|canonicalization)\//,
  /[^"']*\/(?:codegen|linker)\//,
  /[^"']*(?:aarch64|pe-coff)/i,
  /^(?:bun:|node:fs|node:path|node:os|node:process|bun|fs|path|os|process)/,
] as const;

const peCoffImportForbiddenSourceRoots = [
  "src/frontend/",
  "src/parser/",
  "src/layout/",
  "src/proof/",
  "src/proof-mir/",
  "src/proof-check/",
  "src/opt-ir/",
  "src/mono/",
  "src/linker/",
  "src/target/aarch64/",
] as const;

export type AArch64TargetImportPolicyDiagnosticCode =
  | "AARCH64_TARGET_HOST_STATE_IMPORT"
  | "AARCH64_TARGET_OPT_IR_PASS_INTERNAL_IMPORT"
  | "AARCH64_TARGET_ENCODER_LINKER_OBJECT_IMPORT"
  | "AARCH64_TARGET_REGISTER_ALLOCATOR_INTERNAL_IMPORT";

const aarch64TargetImportPolicyMessages: Record<AArch64TargetImportPolicyDiagnosticCode, string> = {
  AARCH64_TARGET_HOST_STATE_IMPORT:
    "src/target/aarch64 must not import filesystem APIs, Bun APIs, process APIs, OS APIs, or host runtime state.",
  AARCH64_TARGET_OPT_IR_PASS_INTERNAL_IMPORT:
    "src/target/aarch64 must not import OptIR pass internals.",
  AARCH64_TARGET_ENCODER_LINKER_OBJECT_IMPORT:
    "src/target/aarch64 machine IR lowering must not import encoder, linker, PE-COFF, relocation generation, or object/image writer internals.",
  AARCH64_TARGET_REGISTER_ALLOCATOR_INTERNAL_IMPORT:
    "src/target/aarch64 machine IR lowering must not import register allocator internals.",
};

const aarch64HostStateModulePattern =
  /^(?:bun(?::|$)|node:(?:fs|path|os|process)|fs$|path$|os$|process$|node:fs|node:path|node:os|node:process)/;
const uefiAArch64HostStateModulePattern =
  /^(?:bun(?::|$)|node:(?:fs|path|os|process|child_process)|fs$|path$|os$|process$|child_process$|node:fs|node:path|node:os|node:process|node:child_process)/;

function normalizedModuleSpecifier(value: string): string {
  return normalizePath(value).replaceAll("../", "/").replaceAll("./", "/");
}

function isAArch64TargetSource(filePath: string): boolean {
  return normalizePath(filePath).startsWith("src/target/aarch64/");
}

function checkAArch64ImportBoundary(input: {
  importer: string;
  imported: string;
}): AArch64TargetImportPolicyDiagnosticCode[] {
  if (!isAArch64TargetSource(input.importer)) {
    return [];
  }

  const imported = normalizedModuleSpecifier(input.imported);
  const diagnostics: AArch64TargetImportPolicyDiagnosticCode[] = [];

  if (aarch64HostStateModulePattern.test(input.imported)) {
    diagnostics.push("AARCH64_TARGET_HOST_STATE_IMPORT");
  }
  if (/\/opt-ir\/passes(?:\/|$)/.test(imported)) {
    diagnostics.push("AARCH64_TARGET_OPT_IR_PASS_INTERNAL_IMPORT");
  }
  if (
    /\/(?:codegen|encoder|linker|object-writer|object_writer|image-writer|image_writer|pe-coff)(?:\/|$)/i.test(
      imported,
    )
  ) {
    diagnostics.push("AARCH64_TARGET_ENCODER_LINKER_OBJECT_IMPORT");
  }
  if (/\/register-(?:allocator|allocation)(?:\/|$)/i.test(imported)) {
    diagnostics.push("AARCH64_TARGET_REGISTER_ALLOCATOR_INTERNAL_IMPORT");
  }

  return diagnostics;
}

interface ImportedModuleSpecifier {
  moduleSpecifier: string;
  line: number;
  column: number;
}

function importedSpecifiers(
  filePath: string,
  sourceText: string,
): readonly ImportedModuleSpecifier[] {
  const sourceFile = typescript.createSourceFile(
    filePath,
    sourceText,
    typescript.ScriptTarget.Latest,
    true,
    typescript.ScriptKind.TS,
  );
  const specifiers: ImportedModuleSpecifier[] = [];

  function addSpecifier(moduleSpecifier: typescript.StringLiteral): void {
    specifiers.push({
      moduleSpecifier: moduleSpecifier.text,
      ...locationOf(sourceFile, moduleSpecifier.getStart(sourceFile)),
    });
  }

  function visit(syntaxNode: typescript.Node): void {
    if (
      typescript.isImportDeclaration(syntaxNode) &&
      typescript.isStringLiteral(syntaxNode.moduleSpecifier)
    ) {
      addSpecifier(syntaxNode.moduleSpecifier);
    } else if (
      typescript.isExportDeclaration(syntaxNode) &&
      syntaxNode.moduleSpecifier !== undefined &&
      typescript.isStringLiteral(syntaxNode.moduleSpecifier)
    ) {
      addSpecifier(syntaxNode.moduleSpecifier);
    } else if (
      typescript.isImportEqualsDeclaration(syntaxNode) &&
      typescript.isExternalModuleReference(syntaxNode.moduleReference) &&
      typescript.isStringLiteral(syntaxNode.moduleReference.expression)
    ) {
      addSpecifier(syntaxNode.moduleReference.expression);
    }

    typescript.forEachChild(syntaxNode, visit);
  }

  visit(sourceFile);
  return specifiers;
}

function moduleSpecifierMatchesPattern(input: {
  moduleSpecifier: string;
  pattern: RegExp;
  includeBarrelMatch: boolean;
}): boolean {
  const { moduleSpecifier, pattern, includeBarrelMatch } = input;
  if (pattern.test(moduleSpecifier) || pattern.test(normalizedModuleSpecifier(moduleSpecifier))) {
    return true;
  }

  if (includeBarrelMatch && pattern.source.endsWith("\\/")) {
    const barrelPattern = new RegExp(`${pattern.source.slice(0, -2)}$`, pattern.flags);
    return (
      barrelPattern.test(moduleSpecifier) ||
      barrelPattern.test(normalizedModuleSpecifier(moduleSpecifier))
    );
  }

  const exactSegmentPattern = new RegExp(pattern.source.replaceAll(`(?:\\/|["'])`, "$"));
  return (
    exactSegmentPattern.test(moduleSpecifier) ||
    exactSegmentPattern.test(normalizedModuleSpecifier(moduleSpecifier))
  );
}

function findFirstForbiddenImport(
  imports: readonly ImportedModuleSpecifier[],
  patterns: readonly RegExp[],
  options: { includeBarrelMatch: boolean },
): ImportedModuleSpecifier | undefined {
  return imports.find((imported) =>
    patterns.some((pattern) =>
      moduleSpecifierMatchesPattern({
        moduleSpecifier: imported.moduleSpecifier,
        pattern,
        includeBarrelMatch: options.includeBarrelMatch,
      }),
    ),
  );
}

function checkAArch64ImportBoundaryForFile(
  filePath: string,
  sourceText: string,
): PolicyViolation[] {
  const violations: PolicyViolation[] = [];
  for (const imported of importedSpecifiers(filePath, sourceText)) {
    for (const code of checkAArch64ImportBoundary({
      importer: filePath,
      imported: imported.moduleSpecifier,
    })) {
      violations.push({
        filePath,
        line: imported.line,
        column: imported.column,
        message: aarch64TargetImportPolicyMessages[code],
      });
    }
  }
  return violations;
}

function isPureUefiAArch64TargetSource(filePath: string): boolean {
  const normalizedPath = normalizePath(filePath);
  return (
    normalizedPath.startsWith("src/target/uefi-aarch64/") &&
    !normalizedPath.endsWith("qemu-smoke-host.ts")
  );
}

function isEarlierCompilerPhaseForUefiBoundary(filePath: string): boolean {
  const normalizedPath = normalizePath(filePath);
  return [
    "src/frontend/",
    "src/semantic/",
    "src/hir/",
    "src/mono/",
    "src/layout/",
    "src/proof-mir/",
    "src/proof-check/",
    "src/opt-ir/",
    "src/linker/",
    "src/pe-coff/",
    "src/target/aarch64/",
  ].some((root) => normalizedPath.startsWith(root));
}

function checkUefiAArch64ImportBoundaryForFile(
  filePath: string,
  sourceText: string,
): PolicyViolation[] {
  const violations: PolicyViolation[] = [];
  for (const imported of importedSpecifiers(filePath, sourceText)) {
    if (
      isPureUefiAArch64TargetSource(filePath) &&
      uefiAArch64HostStateModulePattern.test(imported.moduleSpecifier)
    ) {
      violations.push({
        filePath,
        line: imported.line,
        column: imported.column,
        message:
          "Pure UEFI AArch64 target-driver modules must not import filesystem, process, OS, subprocess, Bun, or host runtime modules.",
      });
    }
    if (
      isEarlierCompilerPhaseForUefiBoundary(filePath) &&
      /(?:\/target\/uefi-aarch64|\/uefi-aarch64)(?:\/|$)/.test(
        normalizedModuleSpecifier(imported.moduleSpecifier),
      )
    ) {
      violations.push({
        filePath,
        line: imported.line,
        column: imported.column,
        message:
          "Earlier compiler phases and lower target layers must not import the UEFI AArch64 target driver.",
      });
    }
  }
  return violations;
}

function checkLayoutImportBoundary(filePath: string, sourceText: string): PolicyViolation[] {
  const normalizedPath = normalizePath(filePath);
  if (!normalizedPath.startsWith("src/layout/")) {
    return [];
  }

  const violations: PolicyViolation[] = [];
  const imported = findFirstForbiddenImport(
    importedSpecifiers(filePath, sourceText),
    layoutForbiddenModulePathPatterns,
    { includeBarrelMatch: false },
  );
  if (imported !== undefined) {
    violations.push({
      filePath,
      line: imported.line,
      column: imported.column,
      message:
        "src/layout must not import parser, AST, Proof-MIR, codegen, linker, or PE-COFF modules.",
    });
  }
  return violations;
}

function checkProofMirImportBoundary(filePath: string, sourceText: string): PolicyViolation[] {
  const normalizedPath = normalizePath(filePath);
  if (!normalizedPath.startsWith("src/proof-mir/")) {
    return [];
  }

  const violations: PolicyViolation[] = [];
  const imported = findFirstForbiddenImport(
    importedSpecifiers(filePath, sourceText),
    proofMirForbiddenModulePathPatterns,
    { includeBarrelMatch: true },
  );
  if (imported !== undefined) {
    violations.push({
      filePath,
      line: imported.line,
      column: imported.column,
      message:
        "src/proof-mir must not import frontend, lexer, parser, name resolution, item index, proof checker, codegen, linker, target backend, or host/runtime modules.",
    });
  }
  return violations;
}

function checkOptIrImportBoundary(filePath: string, sourceText: string): PolicyViolation[] {
  const normalizedPath = normalizePath(filePath);
  if (!normalizedPath.startsWith("src/opt-ir/")) {
    return [];
  }

  const violations: PolicyViolation[] = [];
  const imported = findFirstForbiddenImport(
    importedSpecifiers(filePath, sourceText),
    optIrForbiddenModulePathPatterns,
    { includeBarrelMatch: true },
  );
  if (imported !== undefined) {
    violations.push({
      filePath,
      line: imported.line,
      column: imported.column,
      message:
        "src/opt-ir must not import frontend, parser, HIR lowering internals, Proof MIR construction internals, target backends, scorecard baselines, benchmark data, linker, PE-COFF, Bun, or filesystem modules.",
    });
  }
  return violations;
}

function checkProofCheckImportBoundary(filePath: string, sourceText: string): PolicyViolation[] {
  const normalizedPath = normalizePath(filePath);
  if (!normalizedPath.startsWith("src/proof-check/")) {
    return [];
  }

  const violations: PolicyViolation[] = [];
  if (
    /node:crypto/.test(sourceText) &&
    normalizedPath !== "src/proof-check/authority/canonical-serialization.ts"
  ) {
    violations.push({
      filePath,
      line: 1,
      column: 1,
      message: "node:crypto is only allowed in proof-check authority canonical serialization.",
    });
  }
  const imported = findFirstForbiddenImport(
    importedSpecifiers(filePath, sourceText),
    proofCheckForbiddenModulePathPatterns,
    { includeBarrelMatch: true },
  );
  if (imported !== undefined) {
    violations.push({
      filePath,
      line: imported.line,
      column: imported.column,
      message:
        "src/proof-check must not import frontend, lexer, parser, semantic internals, HIR lowering internals, Proof MIR lowering internals, optimization, target backend, linker, PE-COFF, Bun, or filesystem modules.",
    });
  }
  return violations;
}

function checkPeCoffImportBoundary(filePath: string, sourceText: string): PolicyViolation[] {
  const normalizedPath = normalizePath(filePath);
  if (
    normalizedPath === "src/index.ts" ||
    !peCoffImportForbiddenSourceRoots.some((root) => normalizedPath.startsWith(root))
  ) {
    return [];
  }

  for (const imported of importedSpecifiers(filePath, sourceText)) {
    if (/\/pe-coff(?:\/|$)/i.test(normalizedModuleSpecifier(imported.moduleSpecifier))) {
      return [
        {
          filePath,
          line: imported.line,
          column: imported.column,
          message:
            "Earlier compiler phases and target internals must not import PE/COFF writer modules.",
        },
      ];
    }
  }
  return [];
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

export function checkPolicyFileText(filePath: string, sourceText: string): PolicyViolation[] {
  return [
    ...checkIdentifiers(filePath, sourceText),
    ...checkLayoutImportBoundary(filePath, sourceText),
    ...checkProofMirImportBoundary(filePath, sourceText),
    ...checkProofCheckImportBoundary(filePath, sourceText),
    ...checkOptIrImportBoundary(filePath, sourceText),
    ...checkAArch64ImportBoundaryForFile(filePath, sourceText),
    ...checkUefiAArch64ImportBoundaryForFile(filePath, sourceText),
    ...checkPeCoffImportBoundary(filePath, sourceText),
    ...checkTextPolicies(filePath, sourceText),
  ];
}

export function checkPolicyTextForTest(input: {
  filePath: string;
  sourceText: string;
}): PolicyViolation[] {
  return checkPolicyFileText(input.filePath, input.sourceText);
}

export function checkImportPolicyForTest(input: {
  importer: string;
  imported: string;
}): AArch64TargetImportPolicyDiagnosticCode[] {
  return checkAArch64ImportBoundary(input);
}

export async function runPolicyCheck(): Promise<void> {
  const files = (
    await Promise.all(checkedRoots.map((root) => collectTypeScriptFiles(root)))
  ).flat();
  const violations: PolicyViolation[] = [];

  for (const filePath of files) {
    const sourceText = await readText(filePath);
    violations.push(...checkPolicyFileText(filePath, sourceText));
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

if (import.meta.main) {
  await runPolicyCheck();
}
