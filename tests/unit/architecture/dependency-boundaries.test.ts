import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const root = process.cwd();

function sourceFilesUnder(directory: string): string[] {
  const absoluteDirectory = join(root, directory);
  const result: string[] = [];
  const stack = [absoluteDirectory];

  while (stack.length > 0) {
    const current = stack.pop()!;
    for (const entry of readdirSync(current)) {
      const absolutePath = join(current, entry);
      const stat = statSync(absolutePath);
      if (stat.isDirectory()) {
        stack.push(absolutePath);
      } else if (absolutePath.endsWith(".ts")) {
        result.push(relative(root, absolutePath));
      }
    }
  }

  return result.sort();
}

function importsIn(file: string): string[] {
  const text = sourceText(file);
  return [
    ...text.matchAll(/\bimport(?:\s+type)?[\s\S]*?\sfrom\s+["']([^"']+)["']/g),
    ...text.matchAll(/\bexport(?:\s+type)?[\s\S]*?\sfrom\s+["']([^"']+)["']/g),
  ].map((match) => match[1]!);
}

function sourceText(file: string): string {
  return readFileSync(join(root, file), "utf8");
}

function filesContaining(directory: string, needle: string): readonly string[] {
  return sourceFilesUnder(directory).filter((file) => sourceText(file).includes(needle));
}

function lineCount(file: string): number {
  return sourceText(file).split("\n").length;
}

function assertNoImports(files: readonly string[], forbidden: RegExp, message: string): void {
  const violations = files.flatMap((file) =>
    importsIn(file)
      .filter((specifier) => forbidden.test(specifier))
      .map((specifier) => `${file} -> ${specifier}`),
  );

  expect(violations, message).toEqual([]);
}

describe("architecture dependency boundaries", () => {
  test("lexer stays below parser, AST, semantic, and backend layers", () => {
    assertNoImports(
      sourceFilesUnder("src/frontend/lexer"),
      /(?:^|\/)(parser|ast|semantic|hir|opt-ir|target|linker|cli)(?:\/|$)/,
      "lexer imports later layers",
    );
  });

  test("parser stays below later compiler layers", () => {
    assertNoImports(
      sourceFilesUnder("src/frontend/parser"),
      /(?:^|\/)(ast|semantic|hir|opt-ir|target|linker|cli)(?:\/|$)/,
      "parser imports later layers",
    );
  });

  test("frontend does not grow a second syntax arena", () => {
    const forbiddenPath = /(?:^|\/)(syntax-arena|syntax-node|flat-syntax[^/]*)\.ts$/;
    const violations = sourceFilesUnder("src/frontend").filter((file) => forbiddenPath.test(file));

    expect(violations).toEqual([]);
    expect(forbiddenPath.test("src/frontend/parser/flat-syntax-arena.ts")).toBe(true);
  });

  test("AST syntax views use the canonical syntax index import", () => {
    const syntaxQueryImports = importsIn("src/frontend/ast/syntax-query.ts");

    expect(syntaxQueryImports).toContain("../syntax");
    expect(syntaxQueryImports).not.toContain("../syntax/syntax-index");
  });

  test("module import discovery does not use the lexer import scanner as canonical path", () => {
    const imports = importsIn("src/frontend/module-import-discovery.ts");
    const legacyScannerPath = ["./lexer", ["import", "discovery"].join("-")].join("/");
    const legacyGraphPath = ["./lexer", ["module", "graph", "lexer"].join("-")].join("/");

    expect(imports).not.toContain(legacyScannerPath);
    expect(imports).not.toContain(legacyGraphPath);
  });

  test("OptIR does not import target code", () => {
    assertNoImports(
      sourceFilesUnder("src/opt-ir"),
      /(?:^|\/)target(?:\/|$)/,
      "OptIR imports target",
    );
  });

  test("runtime source does not import fast-check", () => {
    assertNoImports(sourceFilesUnder("src"), /^fast-check$/, "runtime imports fast-check");
  });

  test("OptIR production scheduling flows through the pass manager", () => {
    expect(filesContaining("src/opt-ir/passes", "const context: OptIrPassContext =")).toEqual([
      "src/opt-ir/passes/pass-manager.ts",
    ]);
    expect(filesContaining("src/opt-ir/passes", "runOptIrPassPipeline(")).toEqual([
      "src/opt-ir/passes/pass-manager.ts",
      "src/opt-ir/passes/pipeline.ts",
    ]);

    const pipelineSource = sourceText("src/opt-ir/passes/pipeline.ts");
    expect(pipelineSource).toContain("runOptIrPassPipeline({");
    expect(pipelineSource).not.toContain("runPipelineStepToFixpoint(");
  });

  test("OptIR legacy fixpoint helper is limited to internal egraph convergence", () => {
    expect(filesContaining("src/opt-ir/passes", "runPipelineStepToFixpoint(")).toEqual([
      "src/opt-ir/passes/pipeline-state.ts",
      "src/opt-ir/passes/pipeline-steps.ts",
    ]);

    const pipelineStepsSource = sourceText("src/opt-ir/passes/pipeline-steps.ts");
    expect(pipelineStepsSource).toContain("runFactGatedEGraphStep");
    expect(pipelineStepsSource).toContain("runOptIrFactGatedEGraphMaterialization");
  });

  test("OptIR memory passes have honest boundaries and share canonical dataflow", () => {
    const dispatchSource = sourceText("src/opt-ir/passes/pipeline-dispatch.ts");
    const stepsSource = sourceText("src/opt-ir/passes/pipeline-steps.ts");
    const memoryStepsSource = sourceText("src/opt-ir/passes/pipeline-memory-steps.ts");
    const memorySsaSource = sourceText("src/opt-ir/analyses/memory-ssa.ts");
    const memoryOptimizationSource = sourceText("src/opt-ir/passes/memory-optimization.ts");

    expect(dispatchSource).toContain("runLoadStoreForwardingStep");
    expect(dispatchSource).toContain("runDeadStoreEliminationStep");
    expect(dispatchSource).not.toContain("runMemoryOptimizationStep(next");
    expect(stepsSource).not.toContain("runMemoryOptimizationStep");
    expect(memoryStepsSource).not.toContain("runMemoryOptimizationStep");
    expect(memorySsaSource).toContain("solveOptIrDataflow({");
    expect(memoryOptimizationSource).toContain("solveOptIrDataflow({");
    expect(memorySsaSource).not.toContain("while (changed && remainingIterations");
    expect(memoryOptimizationSource).not.toContain("while (changed && remainingIterations");
  });

  test("frontend module loading has one graph traversal implementation", () => {
    const source = sourceText("src/frontend/module-loader.ts");

    expect(source.match(/while \(stack\.length > 0\)/g)).toHaveLength(1);
    expect(source).not.toContain("function loadFrontendModuleGraphSyncWithReader");
  });

  test("temporary HIR traversal framework is not shipped without runtime consumers", () => {
    expect(existsSync(join(root, "src/hir/traversal.ts"))).toBe(false);
    expect(existsSync(join(root, "src/hir/transform-context.ts"))).toBe(false);
    expect(existsSync(join(root, "src/hir/transform.ts"))).toBe(false);
    expect(sourceText("src/hir/checked-type-transform.ts")).toContain("transformCheckedType");
    expect(sourceText("src/mono/mono-transform-context.ts")).not.toContain("readonly hir");
    expect(sourceText("tests/audit/mono-maintainability-audit.test.ts")).not.toContain(
      "transformHirExpression",
    );
  });

  test("OptIR id allocation has one canonical module name", () => {
    expect(existsSync(join(root, "src/opt-ir/fresh-ids.ts"))).toBe(false);
    expect(sourceText("src/opt-ir/id-allocation.ts")).not.toContain('from "./fresh-ids"');
  });

  test("large OptIR cluster tests stay below the thermo-nuclear line threshold", () => {
    expect(lineCount("tests/unit/opt-ir/memory-optimization.test.ts")).toBeLessThanOrEqual(1_000);
    expect(lineCount("tests/unit/opt-ir/cleanup.test.ts")).toBeLessThanOrEqual(1_000);
  });

  test("UEFI entry thunk keeps planning, encoding, and unwind metadata split", () => {
    expect(lineCount("src/target/uefi-aarch64/entry-thunk.ts")).toBeLessThan(650);
    expect(existsSync(join(root, "src/target/uefi-aarch64/entry-thunk-instructions.ts"))).toBe(
      true,
    );
    expect(existsSync(join(root, "src/target/uefi-aarch64/entry-thunk-unwind.ts"))).toBe(true);
  });
});
