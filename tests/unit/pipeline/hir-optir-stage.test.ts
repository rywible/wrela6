import { describe, expect, test } from "bun:test";

import {
  compilerMetadataValue,
  createCompilerStageMetadata,
  optIrPassesMetadata,
  runHirStage,
  runOptIrConstructionStage,
  runOptIrOptimizationStage,
} from "../../../src/pipeline";

describe("HIR and OptIR pipeline stages", () => {
  test("HIR errors stop OptIR construction", () => {
    let constructionRuns = 0;
    const hir = runHirStage({
      input: {} as never,
      lowerHir: () => ({
        program: { kind: "hir-program" } as never,
        diagnostics: [diagnostic("HIR_BAD") as never],
      }),
    });

    const optIr = runOptIrConstructionStage({
      hir,
      input: {} as never,
      construct: () => {
        constructionRuns += 1;
        return { kind: "ok", diagnostics: [], program: {}, facts: {} } as never;
      },
    });

    expect(hir.kind).toBe("error");
    expect(optIr.kind).toBe("error");
    expect(constructionRuns).toBe(0);
    expect(optIr.diagnostics.map((item) => String(item.code))).toEqual(["HIR_BAD"]);
  });

  test("OptIR construction and optimization return stage results", () => {
    const hir = runHirStage({
      input: {} as never,
      lowerHir: () => ({ program: { kind: "hir-program" } as never, diagnostics: [] }),
    });
    const constructed = runOptIrConstructionStage({
      hir,
      input: {} as never,
      construct: () =>
        ({
          kind: "ok",
          program: { kind: "opt-ir" },
          operations: [],
          optimizationRegions: [],
          facts: {},
          provenance: {},
          proofErasureProvenance: {},
          diagnostics: [],
        }) as never,
    });

    const optimized = runOptIrOptimizationStage({
      construction: constructed as never,
      input: {} as never,
      optimize: () =>
        ({
          kind: "ok",
          program: { kind: "optimized-opt-ir" },
          operations: [],
          optimizationRegions: [],
          facts: {},
          provenance: {},
          decisionLog: {},
          diagnostics: [diagnostic("OPT_INFO")],
          verificationCheckpoints: [],
          metadata: createCompilerStageMetadata([
            optIrPassesMetadata({ passIds: ["scalar-replacement", "dce"] }),
          ]),
        }) as never,
    });

    expect(constructed.kind).toBe("ok");
    expect(optimized.kind).toBe("ok");
    expect(compilerMetadataValue(optimized.metadata, "optIrPasses")).toEqual({
      passIds: ["scalar-replacement", "dce"],
    });
    if (optimized.kind !== "ok") throw new Error("expected optimization to succeed");
    expect("metadata" in optimized.value.program).toBe(false);
  });
});

function diagnostic(code: string) {
  return { code, severity: "error", message: code };
}
