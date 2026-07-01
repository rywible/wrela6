import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const BACKEND_SOURCE_ROOT = "src/target/aarch64/backend";

describe("AArch64 backend code-quality guardrails", () => {
  test("production backend sources do not expose test-stage override machinery", () => {
    const offender = backendSourceFiles().find((file) => {
      const source = readFileSync(file, "utf8");
      return (
        source.includes("testStageOverrides") ||
        source.includes("AArch64BackendStageOverride") ||
        source.includes("forcedAArch64BackendStageOverride") ||
        source.includes("verifyAArch64BackendStageOverrides")
      );
    });

    expect(offender).toBeUndefined();
  });

  test("unused generic compiler fact extension registry is not shipped", () => {
    const offender = sourceFiles("src/shared/facts").find((file) => {
      const source = readFileSync(file, "utf8");
      return source.includes("CompilerFactExtension") || source.includes("compilerFactExtension");
    });

    expect(offender).toBeUndefined();
  });

  test("backend source files and large end-to-end tests stay below the 1k-line boundary", () => {
    const files = [
      ...backendSourceFiles(),
      "tests/unit/target/aarch64/backend/backend-end-to-end.test.ts",
    ];
    const oversized = files
      .map((file) => ({ file, lines: lineCount(file) }))
      .filter((entry) => entry.lines >= 1000);

    expect(oversized).toEqual([]);
  });

  test("backend code reuses canonical stable hash and little-endian word helpers", () => {
    const duplicateHelper = [
      ...backendSourceFiles(),
      ...sourceFiles("src/target/aarch64/target-surface"),
    ].find((file) => {
      const source = readFileSync(file, "utf8");
      return (
        source.includes("function stableHash(") ||
        (source.includes("function wordToU32Le(") && !file.endsWith("encoding-core.ts")) ||
        source.includes("function writeU32LeWord(")
      );
    });

    expect(duplicateHelper).toBeUndefined();
  });

  test("backend register alias logic has a single canonical implementation", () => {
    const duplicateRegisterHelper = backendSourceFiles().find((file) => {
      const source = readFileSync(file, "utf8");
      return (
        source.includes("function registerStorageKey(") ||
        source.includes("function physicalRegisterStorageKey(")
      );
    });

    expect(duplicateRegisterHelper).toBeUndefined();
  });

  test("reviewed low-priority shortcuts stay out of the backend path", () => {
    const factSetSource = readFileSync("src/target/aarch64/machine-ir/fact-set.ts", "utf8");
    const pipelineSource = readFileSync(
      "src/target/aarch64/backend/api/function-pipeline.ts",
      "utf8",
    );
    const layoutSource = readFileSync(
      "src/target/aarch64/backend/object/layout-encode-fixed-point.ts",
      "utf8",
    );

    expect(factSetSource).not.toContain("payload?.family");
    expect(pipelineSource).not.toContain("expandAArch64BackendPseudos({ pseudos: [] })");
    expect(layoutSource).not.toContain("stableDetail.startsWith");
    expect(layoutSource).not.toContain("stableDetail.slice");
  });

  test("target-surface normalization does not ship empty behavior fallbacks", () => {
    const targetSurfaceSource = readFileSync(
      "src/target/aarch64/backend/api/backend-target-surface.ts",
      "utf8",
    );

    expect(targetSurfaceSource).not.toContain("createEmpty");
    expect(targetSurfaceSource).not.toContain(":empty");
  });
});

function backendSourceFiles(): readonly string[] {
  return sourceFiles(BACKEND_SOURCE_ROOT);
}

function sourceFiles(root: string): readonly string[] {
  return readdirSync(root).flatMap((entry) => {
    const path = join(root, entry);
    if (statSync(path).isDirectory()) return [...sourceFiles(path)];
    return path.endsWith(".ts") ? [path] : [];
  });
}

function lineCount(file: string): number {
  return readFileSync(file, "utf8").split("\n").length;
}
