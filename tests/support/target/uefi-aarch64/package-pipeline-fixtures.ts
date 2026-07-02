import { emptyOptIrFactSet } from "../../../../src/opt-ir/facts/fact-index";
import {
  type PackageMonomorphizedImageAdapter,
  type PackageOptimizedOptIrAdapter,
  type PackageParsedModuleGraphAdapter,
  type PackageProofCheckAdapter,
  type PackageProofMirAdapter,
  type PackageRepresentationLayoutFactsAdapter,
  type PackageTypedHirAdapter,
  type UefiAArch64PackagePipelineDependencies,
} from "../../../../src/target/uefi-aarch64";
import { optimizedOptIrProgramWithUnitSuccessImageEntryForAArch64Test } from "../aarch64/selection/optimized-opt-ir-fixtures";

export function uefiAArch64PackagePipelineDependenciesForOptimizedFixture(): UefiAArch64PackagePipelineDependencies {
  const parsedGraph: PackageParsedModuleGraphAdapter = Object.freeze({ kind: "parsed-graph" });
  const typedHir: PackageTypedHirAdapter = Object.freeze({ kind: "typed-hir" });
  const monomorphizedImage: PackageMonomorphizedImageAdapter = Object.freeze({
    kind: "mono-image",
    reachablePlatformPrimitiveIds: Object.freeze([]),
  });
  const layoutFacts: PackageRepresentationLayoutFactsAdapter = Object.freeze({
    kind: "layout-facts",
  });
  const proofMir: PackageProofMirAdapter = Object.freeze({ kind: "proof-mir" });
  const proofCheck: PackageProofCheckAdapter = Object.freeze({ kind: "proof-check" });

  return Object.freeze({
    parseModuleGraph: () => ({ kind: "ok" as const, value: parsedGraph, diagnostics: [] }),
    lowerTypedHir: () => ({ kind: "ok" as const, value: typedHir, diagnostics: [] }),
    monomorphizeWholeImage: () => ({
      kind: "ok" as const,
      value: monomorphizedImage,
      diagnostics: [],
    }),
    computeRepresentationLayoutFacts: () => ({
      kind: "ok" as const,
      value: layoutFacts,
      diagnostics: [],
    }),
    buildProofMir: () => ({ kind: "ok" as const, value: proofMir, diagnostics: [] }),
    checkProofAndResources: () => ({
      kind: "ok" as const,
      value: proofCheck,
      diagnostics: [],
    }),
    buildOptimizedOptIr: () => {
      const fixture = optimizedOptIrProgramWithUnitSuccessImageEntryForAArch64Test();
      const optIr: PackageOptimizedOptIrAdapter = Object.freeze({
        program: fixture.program,
        operations: Object.freeze([...fixture.operations]),
        facts: emptyOptIrFactSet(),
      });
      return { kind: "ok" as const, value: optIr, diagnostics: [] };
    },
  });
}
