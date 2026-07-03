import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const VALIDATION_SOURCE_ROOT = "src/validation";
const FULL_IMAGE_SOURCE_ROOT = "src/validation/full-image";
const FULL_IMAGE_REFERENCE_CHECKER_ROOT = "src/validation/full-image/reference-checkers";

const REQUIRED_STAGE_KEYS = [
  "target-driver-authenticate",
  "frontend",
  "semantic",
  "monomorphization",
  "layout-facts",
  "proof-mir",
  "proof-check",
  "opt-ir",
  "aarch64-lowering",
  "aarch64-backend",
  "static-char16-objects",
  "validation-fixture-objects",
  "runtime-helper-objects",
  "synthetic-entry-object",
  "linker",
  "pe-coff-writer",
] as const;

const ALLOWED_EXTRA_STAGE_KEYS = ["artifact-sink", "qemu-smoke"] as const;

const REQUIRED_CASES = [
  ["smoke-console", "toolchain-stdlib"],
  ["smoke-console", "ejected-stdlib"],
  ["smoke-console", "direct-platform"],
  ["packet-counter", "toolchain-stdlib"],
  ["packet-counter", "ejected-stdlib"],
  ["packet-counter", "direct-platform"],
  ["status-error", "toolchain-stdlib"],
  ["watchdog-or-boot-policy", "toolchain-stdlib"],
] as const;

const REQUIRED_FULL_IMAGE_FILES = [
  "binary-structure-checker.ts",
  "determinism.ts",
  "diagnostics.ts",
  "fixture-catalog.ts",
  "index.ts",
  "matrix.ts",
  "qemu.ts",
  "report.ts",
  "runner.ts",
  "self-contained-checker.ts",
  "source-authority.ts",
  "stage-trail.ts",
] as const;

const REQUIRED_REFERENCE_CHECKERS = [
  "aarch64-object-reference.ts",
  "index.ts",
  "linked-layout-reference.ts",
  "opt-ir-reference.ts",
  "pe-coff-reference.ts",
  "proof-fact-reference.ts",
  "semantic-platform-reference.ts",
  "stdlib-source-root-reference.ts",
  "types.ts",
  "uefi-tcb-golden-reference.ts",
] as const;

const KNOWN_REPORT_CHECKER_KEYS = [
  "aarch64-object-reference",
  "binary.metadata.fingerprint",
  "binary.pe.parse",
  "binary.structure.entry",
  "binary.structure.exception-directory",
  "binary.structure.headers",
  "binary.structure.relocations",
  "binary.structure.sections",
  "binary.structure.symbol-table",
  "binary.structure.trailing-bytes",
  "linked-layout-reference",
  "opt-ir-reference",
  "pe-coff-reference",
  "proof-fact-reference",
  "self-contained.entry",
  "self-contained.host-references",
  "self-contained.object-modules",
  "self-contained.runtime-helpers",
  "self-contained.section-ranges",
  "self-contained.unresolved-externals",
  "semantic-platform-reference",
  "source-authority.counts",
  "source-authority.stdlib-mode",
  "source-authority.trusted-roots",
  "stdlib-source-root-reference",
  "uefi-tcb-golden-reference",
] as const;

const ALLOWED_HOST_EDGE_FILES = new Set([
  "src/target/uefi-aarch64/qemu-smoke-host.ts",
  "scripts/smoke-uefi-aarch64.ts",
  "scripts/validate-full-image.ts",
]);

const TEST_SUPPORT_IMPORT_PATTERN =
  /(?:from\s+["'][^"']*(?:^|\/|\\.\\.)tests\/support\/|from\s+["'][^"']*\/tests\/support\/|import\s+["'][^"']*(?:^|\/|\\.\\.)tests\/support\/|import\s+["'][^"']*\/tests\/support\/)/;
const HOST_IMPORT_PATTERN =
  /from\s+["'](?:bun|node:fs|node:fs\/promises|node:path|node:os|node:process|node:child_process|fs|fs\/promises|path|os|process|child_process)["']/;
const DIRECT_HOST_ACCESS_PATTERN =
  /\b(?:Bun\.|process\.|Date\.now\s*\(|Math\.random\s*\(|crypto\.randomUUID\s*\(|randomUUID\s*\()/;
const FORBIDDEN_OPTIMIZED_FIXTURE_DEPENDENCY =
  "uefiAArch64PackagePipelineDependencies" + "ForOptimizedFixture";

describe("full-image validation audit", () => {
  test("production validation source does not import test support fixtures", () => {
    const violations = filesUnder(VALIDATION_SOURCE_ROOT)
      .map((filePath) => ({ filePath, source: readFileSync(filePath, "utf8") }))
      .filter(({ source }) => TEST_SUPPORT_IMPORT_PATTERN.test(source))
      .map(({ filePath }) => filePath);

    expect(violations).toEqual([]);
  });

  test("runner and CLI defaults keep QEMU optional", () => {
    const runnerSource = readFileSync(join(FULL_IMAGE_SOURCE_ROOT, "runner.ts"), "utf8");
    expect(runnerSource).toContain('qemuSmoke ?? { kind: "disabled" }');
    expect(runnerSource).toContain('smoke: { kind: "disabled" }');
    expect(runnerSource).not.toContain('qemuSmoke ?? { kind: "required" }');
    expect(runnerSource).not.toContain('smoke: { kind: "qemu" }');

    expect(existsSync("scripts/validate-full-image.ts")).toBe(true);
    if (existsSync("scripts/validate-full-image.ts")) {
      const cliSource = readFileSync("scripts/validate-full-image.ts", "utf8");
      expect(cliSource).toContain('kind: "disabled"');
      expect(cliSource).not.toMatch(/kind:\s*["']required["']/);
      expect(cliSource).not.toMatch(/kind:\s*["']qemu["']/);
    }

    const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as {
      readonly scripts?: Record<string, string>;
    };
    expect(packageJson.scripts?.["validate:full-image"]).toContain(
      "scripts/validate-full-image.ts",
    );
  });

  test("required full-image validation files and reference checkers are present and exported", async () => {
    for (const fileName of REQUIRED_FULL_IMAGE_FILES) {
      expect(existsSync(join(FULL_IMAGE_SOURCE_ROOT, fileName)), fileName).toBe(true);
    }
    for (const fileName of REQUIRED_REFERENCE_CHECKERS) {
      expect(existsSync(join(FULL_IMAGE_REFERENCE_CHECKER_ROOT, fileName)), fileName).toBe(true);
    }

    const validationIndex = readFileSync("src/validation/index.ts", "utf8");
    const fullImageIndex = readFileSync(join(FULL_IMAGE_SOURCE_ROOT, "index.ts"), "utf8");
    const checkerIndex = readFileSync(join(FULL_IMAGE_REFERENCE_CHECKER_ROOT, "index.ts"), "utf8");
    expect(validationIndex).toContain('export * from "./full-image"');
    expect(fullImageIndex).toContain('export * from "./matrix"');
    expect(fullImageIndex).toContain('export * from "./runner"');
    expect(fullImageIndex).toContain('export * from "./reference-checkers"');

    for (const checker of REQUIRED_REFERENCE_CHECKERS.filter(
      (fileName) => fileName !== "index.ts" && fileName !== "types.ts",
    )) {
      const exportPath = checker.replace(/\.ts$/, "");
      expect(checkerIndex).toContain(`from "./${exportPath}"`);
    }

    const fullImageValidation = await import("../../src/validation/full-image");
    expect(typeof fullImageValidation.runFullImageValidation).toBe("function");
    expect(typeof fullImageValidation.defaultFullImageReferenceCheckers).toBe("function");
    expect(typeof fullImageValidation.checkFullImageBinaryStructure).toBe("function");
    expect(typeof fullImageValidation.checkFullImageSelfContained).toBe("function");
  });

  test("required matrix and stage keys remain exact", async () => {
    const matrix = await import("../../src/validation/full-image/matrix");

    expect(matrix.FULL_IMAGE_VALIDATION_REQUIRED_STAGE_KEYS).toEqual(REQUIRED_STAGE_KEYS);
    expect(matrix.FULL_IMAGE_VALIDATION_ALLOWED_EXTRA_STAGE_KEYS).toEqual(ALLOWED_EXTRA_STAGE_KEYS);
    expect(matrix.FULL_IMAGE_VALIDATION_CASES).toEqual(REQUIRED_CASES);
    expect(matrix.fullImageValidationV1Cases().map(matrix.fullImageValidationCaseKey)).toEqual(
      REQUIRED_CASES.map(([scenario, stdlibMode]) => `${scenario}/${stdlibMode}`),
    );
  });

  test("default validation report uses only recognized checker and scenario keys", async () => {
    const validation = await import("../../src/validation/full-image");
    const fixtures = await import("../support/target/uefi-aarch64/uefi-aarch64-fixtures");
    const report = await validation.runFullImageValidation(
      { targetKey: "wrela-uefi-aarch64-rpi5-v1", qemuSmoke: { kind: "disabled" } },
      { filesystem: fixtures.nodeFixtureProjectFilesystem },
    );
    const knownScenarios = new Set(REQUIRED_CASES.map(([scenario]) => scenario));
    const knownCheckerKeys: ReadonlySet<string> = new Set(KNOWN_REPORT_CHECKER_KEYS);

    expect(report.status).toBe("passed");
    expect(
      [...new Set(report.cases.map((caseReport) => caseReport.scenario))].filter(
        (scenario) => !knownScenarios.has(scenario),
      ),
    ).toEqual([]);
    expect(
      [
        ...new Set(
          report.cases.flatMap((caseReport) =>
            [...caseReport.binaryChecks, ...caseReport.referenceChecks].map(
              (check) => check.checkerKey,
            ),
          ),
        ),
      ]
        .sort()
        .filter((checkerKey) => !knownCheckerKeys.has(checkerKey)),
    ).toEqual([]);
  });

  test("direct-platform full-image fixtures do not import stdlib modules", () => {
    const violations = filesUnder("tests/fixtures/full-image-validation", ".wr")
      .filter((filePath) => filePath.includes("/direct-platform/"))
      .map((filePath) => ({ filePath, source: readFileSync(filePath, "utf8") }))
      .filter(({ source }) => source.includes("wrela_std"))
      .map(({ filePath }) => filePath);

    expect(violations).toEqual([]);
  });

  test("production confidence tests do not use optimized OptIR fixture dependencies", () => {
    const validationTestFiles = [
      ...filesUnder("tests/audit"),
      ...filesUnder("tests/integration/validation/full-image"),
      ...filesUnder("tests/unit/validation/full-image"),
    ];
    const violations = validationTestFiles
      .map((filePath) => ({ filePath, source: readFileSync(filePath, "utf8") }))
      .filter(({ source }) => source.includes(FORBIDDEN_OPTIMIZED_FIXTURE_DEPENDENCY))
      .map(({ filePath }) => filePath);

    expect(violations).toEqual([]);
  });

  test("production validation source avoids nondeterminism and keeps filesystem access at host edges", () => {
    const violations = filesUnder("src")
      .filter((filePath) => validationConfidencePath(filePath))
      .filter((filePath) => !ALLOWED_HOST_EDGE_FILES.has(filePath))
      .map((filePath) => ({ filePath, source: readFileSync(filePath, "utf8") }))
      .filter(
        ({ source }) => HOST_IMPORT_PATTERN.test(source) || DIRECT_HOST_ACCESS_PATTERN.test(source),
      )
      .map(({ filePath }) => filePath);

    expect(violations).toEqual([]);
  });
});

function validationConfidencePath(filePath: string): boolean {
  return (
    filePath.startsWith("src/validation/") ||
    filePath === "src/target/uefi-aarch64/compile-uefi-aarch64-image.ts" ||
    filePath === "src/target/uefi-aarch64/package-input.ts" ||
    filePath === "src/target/uefi-aarch64/package-pipeline.ts" ||
    filePath === "src/target/uefi-aarch64/qemu-smoke.ts"
  );
}

function filesUnder(path: string, extension = ".ts"): readonly string[] {
  const files: string[] = [];
  for (const entry of readdirSync(path)) {
    const child = join(path, entry);
    if (statSync(child).isDirectory()) {
      files.push(...filesUnder(child, extension));
    } else if (entry.endsWith(extension)) {
      files.push(child);
    }
  }
  return Object.freeze(files.sort());
}
