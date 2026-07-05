import { readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  compileUefiAArch64ImageWithTrace,
  compilerPackageInput,
  defaultUefiAArch64SourceRoots,
  type CompilerPackageInput,
  type CompilerSourceFileInput,
  type FixtureProjectFilesystem,
  type UefiAArch64TargetDiagnostic,
} from "../src/target/uefi-aarch64";
import {
  fixtureSpecForFullImageCase,
  packageInputForFullImageFixture,
  type FullImageValidationCaseKey,
} from "../src/validation/full-image";

export type StdlibVerificationCase = {
  readonly key: string;
  readonly modules: readonly string[];
  readonly packageInput: () =>
    | { readonly kind: "ok"; readonly value: CompilerPackageInput }
    | { readonly kind: "error"; readonly diagnostics: readonly UefiAArch64TargetDiagnostic[] };
};

export type StdlibVerificationCaseResult = {
  readonly key: string;
  readonly modules: readonly string[];
  readonly status: "passed" | "failed";
  readonly diagnostics: readonly string[];
};

export type StdlibVerificationReport = {
  readonly status: "passed" | "failed";
  readonly cases: readonly StdlibVerificationCaseResult[];
};

export type StdlibPublicSurfaceExport = {
  readonly name: string;
  readonly cases: readonly string[];
};

export type StdlibPublicSurfaceModule = {
  readonly moduleName: string;
  readonly exports: readonly StdlibPublicSurfaceExport[];
};

export const STDLIB_COMPATIBILITY_DOCUMENT_PATH = "docs/stdlib/compatibility.md";

const nodeFixtureProjectFilesystem: FixtureProjectFilesystem = Object.freeze({
  readDirectory: (path: string) => readdirSync(path),
  isDirectory: (path: string) => statSync(path).isDirectory(),
  readTextFile: (path: string) => readFileSync(path, "utf8"),
  realPath: (path: string) => realpathSync(path),
});

if (import.meta.main) {
  const report = runStdlibVerification(stdlibVerificationCases());
  console.log(formatStdlibVerificationReport(report));
  process.exit(report.status === "passed" ? 0 : 1);
}

export function documentedStdlibModules(): readonly string[] {
  const modules = documentedStdlibPublicSurface().map((moduleSurface) => moduleSurface.moduleName);
  if (modules.length === 0) {
    throw new Error(
      `No stdlib modules were documented under ${STDLIB_COMPATIBILITY_DOCUMENT_PATH}`,
    );
  }
  return modules;
}

export function documentedStdlibModulesFromMarkdown(markdown: string): readonly string[] {
  return documentedStdlibPublicSurfaceFromMarkdown(markdown).map(
    (moduleSurface) => moduleSurface.moduleName,
  );
}

export function documentedStdlibPublicSurface(): readonly StdlibPublicSurfaceModule[] {
  const modules = documentedStdlibPublicSurfaceFromMarkdown(
    readFileSync(STDLIB_COMPATIBILITY_DOCUMENT_PATH, "utf8"),
  );
  if (modules.length === 0) {
    throw new Error(
      `No stdlib modules were documented under ${STDLIB_COMPATIBILITY_DOCUMENT_PATH}`,
    );
  }
  return modules;
}

export function documentedStdlibPublicSurfaceFromMarkdown(
  markdown: string,
): readonly StdlibPublicSurfaceModule[] {
  const modules: StdlibPublicSurfaceModule[] = [];
  let currentModule:
    | { readonly moduleName: string; readonly exports: StdlibPublicSurfaceExport[] }
    | undefined;
  let currentExport: { readonly name: string; readonly cases: string[] } | undefined;
  let collectingCasesFor: { readonly name: string; readonly cases: string[] } | undefined;
  let inSupportedModulesSection = false;

  for (const line of markdown.split(/\r?\n/)) {
    if (/^##\s+Supported Modules\b/.test(line)) {
      inSupportedModulesSection = true;
      continue;
    }
    if (inSupportedModulesSection && /^##\s+/.test(line)) {
      break;
    }
    if (!inSupportedModulesSection) {
      continue;
    }
    const moduleMatch = /^- `([^`]+)`\s*$/.exec(line);
    if (moduleMatch?.[1] !== undefined) {
      currentModule = { moduleName: moduleMatch[1], exports: [] };
      modules.push(currentModule);
      currentExport = undefined;
      collectingCasesFor = undefined;
      continue;
    }
    const exportMatch = /^  - `([^`]+)`\s*$/.exec(line);
    if (exportMatch?.[1] !== undefined && currentModule !== undefined) {
      const name = publicSurfaceName(exportMatch[1]);
      currentExport = { name, cases: [] };
      currentModule.exports.push(currentExport);
      collectingCasesFor = undefined;
      continue;
    }
    if (line.startsWith("  - Cases:") && currentExport !== undefined) {
      currentExport.cases.push(...caseNamesFromBacktickedText(line));
      collectingCasesFor = currentExport;
      continue;
    }
    if (line.startsWith("    ") && collectingCasesFor !== undefined) {
      collectingCasesFor.cases.push(...caseNamesFromBacktickedText(line));
    }
  }

  return Object.freeze(modules);
}

export function verifyDocumentedStdlibPublicSurface(input?: {
  readonly markdown?: string;
  readonly readSourceText?: (moduleName: string) => string | undefined;
}): readonly string[] {
  const documented = documentedStdlibPublicSurfaceFromMarkdown(
    input?.markdown ?? readFileSync(STDLIB_COMPATIBILITY_DOCUMENT_PATH, "utf8"),
  );
  const readSourceText = input?.readSourceText ?? readStdlibModuleSourceText;
  const diagnostics: string[] = [];

  for (const moduleSurface of documented) {
    const sourceText = readSourceText(moduleSurface.moduleName);
    if (sourceText === undefined) {
      diagnostics.push(`stdlib-public-surface:missing-module:${moduleSurface.moduleName}`);
      continue;
    }
    const actual = stdlibPublicSurfaceFromSource(sourceText);
    for (const documentedExport of moduleSurface.exports) {
      const actualExport = actual.get(documentedExport.name);
      if (actualExport === undefined) {
        diagnostics.push(
          `stdlib-public-surface:missing-export:${moduleSurface.moduleName}:${documentedExport.name}`,
        );
        continue;
      }
      for (const caseName of documentedExport.cases) {
        if (!actualExport.cases.has(caseName)) {
          diagnostics.push(
            `stdlib-public-surface:missing-case:${moduleSurface.moduleName}:${documentedExport.name}:${caseName}`,
          );
        }
      }
    }
  }

  return Object.freeze(diagnostics.sort());
}

export function stdlibVerificationCases(): readonly StdlibVerificationCase[] {
  return Object.freeze([
    publicSurfaceCase(),
    sourceCase({
      key: "stdlib-core-public-modules",
      modules: [
        "wrela_std.core.bits",
        "wrela_std.core.option",
        "wrela_std.core.result",
        "wrela_std.core.unit",
        "wrela_std.core.validation",
        "wrela_std.target.uefi.status",
      ],
      source: [
        "use Bits from wrela_std.core.bits",
        "use Option from wrela_std.core.option",
        "use Result from wrela_std.core.result",
        "use Unit from wrela_std.core.unit",
        "use Validation from wrela_std.core.validation",
        "use UefiStatus from wrela_std.target.uefi.status",
        "",
        "class StdlibCoreProbe:",
        "    bits: Bits[u64]",
        "    maybe_status: Option[UefiStatus]",
        "    result_status: Result[UefiStatus, UefiStatus]",
        "    unit: Unit",
        "    validation_status: Validation[UefiStatus, UefiStatus, UefiStatus]",
        "",
        "uefi image StdlibCoreProbeImage:",
        "    fn boot() -> UefiStatus:",
        "        UefiStatus.success",
      ].join("\n"),
    }),
    fixtureCase("stdlib-console", ["wrela_std.target.uefi.console"], {
      scenario: "smoke-console",
      stdlibMode: "toolchain-stdlib",
    }),
    sourceCase({
      key: "stdlib-memory",
      modules: ["wrela_std.target.uefi.memory"],
      source: [
        "use exit_boot_services_with_fresh_map from wrela_std.target.uefi.memory",
        "use UefiStatus from wrela_std.target.uefi.status",
        "",
        "uefi image StdlibMemoryProbeImage:",
        "    fn boot() -> UefiStatus:",
        "        exit_boot_services_with_fresh_map()",
      ].join("\n"),
    }),
    fixtureCase("stdlib-watchdog", ["wrela_std.target.uefi.watchdog"], {
      scenario: "watchdog-or-boot-policy",
      stdlibMode: "toolchain-stdlib",
    }),
    fixtureCase("stdlib-firmware", ["wrela_std.target.uefi.firmware"], {
      scenario: "packet-counter",
      stdlibMode: "toolchain-stdlib",
    }),
  ]);
}

function publicSurfaceCase(): StdlibVerificationCase {
  return Object.freeze({
    key: "stdlib-public-surface",
    modules: documentedStdlibModules(),
    packageInput: () => {
      const diagnostics = verifyDocumentedStdlibPublicSurface();
      if (diagnostics.length > 0) {
        return {
          kind: "error" as const,
          diagnostics: diagnostics.map(stdlibPublicSurfaceDiagnostic),
        };
      }
      return compilerPackageInput({
        packageKey: "stdlib-public-surface",
        entryModuleName: "image",
        sourceRoots: [
          { kind: "project", rootKey: "project", rootPath: "src", trustedForAuthority: false },
          ...defaultUefiAArch64SourceRoots({ projectSourceRoot: "src" }).filter(
            (root) => root.kind === "toolchain",
          ),
        ],
        sourceFiles: [
          {
            sourceKey: "src/image.wr",
            moduleName: "image",
            text: [
              "use UefiStatus from wrela_std.target.uefi.status",
              "",
              "uefi image StdlibPublicSurfaceProbeImage:",
              "    fn boot() -> UefiStatus:",
              "        UefiStatus.success",
            ].join("\n"),
          },
          ...toolchainStdlibSourceFiles(),
        ],
      });
    },
  });
}

export function runStdlibVerification(
  cases: readonly StdlibVerificationCase[],
): StdlibVerificationReport {
  const results = cases.map(runStdlibVerificationCase);
  return Object.freeze({
    status: results.every((result) => result.status === "passed") ? "passed" : "failed",
    cases: Object.freeze(results),
  });
}

export function formatStdlibVerificationReport(report: StdlibVerificationReport): string {
  const lines = [`stdlib:${report.status}`];
  for (const result of report.cases) {
    lines.push(`case ${result.key} ${result.status} modules=${result.modules.join(",")}`);
    for (const diagnostic of result.diagnostics) lines.push(`  diagnostic ${diagnostic}`);
  }
  return lines.join("\n");
}

function runStdlibVerificationCase(testCase: StdlibVerificationCase): StdlibVerificationCaseResult {
  const packageInput = testCase.packageInput();
  if (packageInput.kind === "error") {
    return failedCase(testCase, packageInput.diagnostics.map(diagnosticStableDetail));
  }

  const result = compileUefiAArch64ImageWithTrace({
    packageInput: packageInput.value,
    smoke: { kind: "disabled" },
  });
  if (result.kind === "error") {
    return failedCase(testCase, result.diagnostics.map(diagnosticStableDetail));
  }

  return Object.freeze({
    key: testCase.key,
    modules: testCase.modules,
    status: "passed" as const,
    diagnostics: Object.freeze([]),
  });
}

function failedCase(
  testCase: StdlibVerificationCase,
  diagnostics: readonly string[],
): StdlibVerificationCaseResult {
  return Object.freeze({
    key: testCase.key,
    modules: testCase.modules,
    status: "failed" as const,
    diagnostics: Object.freeze([...diagnostics]),
  });
}

function stdlibPublicSurfaceDiagnostic(stableDetail: string): UefiAArch64TargetDiagnostic {
  return {
    code: "UEFI_AARCH64_PIPELINE_FAILED",
    ownerKey: "stdlib-public-surface",
    stableDetail,
  };
}

function publicSurfaceName(surfaceText: string): string {
  const match = /^([A-Za-z_][A-Za-z0-9_]*)/.exec(surfaceText);
  return match?.[1] ?? surfaceText;
}

function caseNamesFromBacktickedText(text: string): readonly string[] {
  const names: string[] = [];
  for (const match of text.matchAll(/`([^`]+)`/g)) {
    const caseName = /^([A-Za-z_][A-Za-z0-9_]*)/.exec(match[1] ?? "")?.[1];
    if (caseName !== undefined) names.push(caseName);
  }
  return names;
}

function stdlibPublicSurfaceFromSource(
  sourceText: string,
): ReadonlyMap<string, { readonly cases: ReadonlySet<string> }> {
  const exports = new Map<string, { readonly cases: Set<string> }>();
  let currentEnum: { readonly cases: Set<string> } | undefined;

  for (const line of sourceText.split(/\r?\n/)) {
    if (line.trim() === "" || line.trimStart().startsWith("//")) {
      continue;
    }
    const topLevel = !line.startsWith(" ");
    if (topLevel) {
      currentEnum = undefined;
      const enumMatch = /^enum\s+([A-Za-z_][A-Za-z0-9_]*)/.exec(line);
      if (enumMatch?.[1] !== undefined) {
        currentEnum = addSourceExport(exports, enumMatch[1]);
        continue;
      }
      const classMatch = /^(?:(?:unique|edge)\s+)*class\s+([A-Za-z_][A-Za-z0-9_]*)/.exec(line);
      if (classMatch?.[1] !== undefined) {
        addSourceExport(exports, classMatch[1]);
        continue;
      }
      const functionMatch = /^(?:platform\s+)?fn\s+([A-Za-z_][A-Za-z0-9_]*)/.exec(line);
      if (functionMatch?.[1] !== undefined) {
        addSourceExport(exports, functionMatch[1]);
      }
      continue;
    }
    if (currentEnum !== undefined) {
      const caseName = /^([A-Za-z_][A-Za-z0-9_]*)/.exec(line.trim())?.[1];
      if (caseName !== undefined) currentEnum.cases.add(caseName);
    }
  }

  return exports;
}

function addSourceExport(
  exports: Map<string, { readonly cases: Set<string> }>,
  name: string,
): { readonly cases: Set<string> } {
  const existing = exports.get(name);
  if (existing !== undefined) return existing;
  const entry = { cases: new Set<string>() };
  exports.set(name, entry);
  return entry;
}

function readStdlibModuleSourceText(moduleName: string): string | undefined {
  try {
    return readFileSync(stdlibPathForModule(moduleName), "utf8");
  } catch {
    return undefined;
  }
}

function stdlibPathForModule(moduleName: string): string {
  return `stdlib/${moduleName.replace(/^wrela_std\./, "wrela-std.").replace(/\./g, "/")}.wr`;
}

function sourceCase(input: {
  readonly key: string;
  readonly modules: readonly string[];
  readonly source: string;
}): StdlibVerificationCase {
  return Object.freeze({
    key: input.key,
    modules: Object.freeze([...input.modules]),
    packageInput: () =>
      compilerPackageInput({
        packageKey: input.key,
        entryModuleName: "image",
        sourceRoots: [
          { kind: "project", rootKey: "project", rootPath: "src", trustedForAuthority: false },
          ...defaultUefiAArch64SourceRoots({ projectSourceRoot: "src" }).filter(
            (root) => root.kind === "toolchain",
          ),
        ],
        sourceFiles: [
          {
            sourceKey: "src/image.wr",
            moduleName: "image",
            text: input.source,
          },
          ...toolchainStdlibSourceFiles(),
        ],
      }),
  });
}

function fixtureCase(
  key: string,
  modules: readonly string[],
  caseKey: FullImageValidationCaseKey,
): StdlibVerificationCase {
  return Object.freeze({
    key,
    modules: Object.freeze([...modules]),
    packageInput: () =>
      packageInputForFullImageFixture(
        fixtureSpecForFullImageCase(caseKey),
        nodeFixtureProjectFilesystem,
      ),
  });
}

function diagnosticStableDetail(diagnostic: UefiAArch64TargetDiagnostic): string {
  return `${diagnostic.code}:${diagnostic.stableDetail}`;
}

function toolchainStdlibSourceFiles(root = "stdlib/wrela-std"): readonly CompilerSourceFileInput[] {
  const files: CompilerSourceFileInput[] = [];
  visitStdlibDirectory(root, root, files);
  return Object.freeze(files.sort((left, right) => left.sourceKey.localeCompare(right.sourceKey)));
}

function visitStdlibDirectory(
  root: string,
  directory: string,
  files: CompilerSourceFileInput[],
): void {
  for (const entry of [...readdirSync(directory)].sort()) {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) {
      visitStdlibDirectory(root, path, files);
      continue;
    }
    if (!entry.endsWith(".wr")) continue;
    const pathWithinRoot = path.slice(root.length + 1).replace(/\\/g, "/");
    files.push(
      Object.freeze({
        sourceKey: `${root}/${pathWithinRoot}`,
        moduleName: `wrela_std.${pathWithinRoot.slice(0, -".wr".length).replace(/\//g, ".")}`,
        text: readFileSync(path, "utf8"),
      }),
    );
  }
}
