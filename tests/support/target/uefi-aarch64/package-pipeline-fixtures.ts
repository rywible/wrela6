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
  const parsedGraph = unsafePackagePipelineAdapter<PackageParsedModuleGraphAdapter>({
    kind: "parsed-graph",
  });
  const typedHir = unsafePackagePipelineAdapter<PackageTypedHirAdapter>({ kind: "typed-hir" });
  const monomorphizedImage = unsafePackagePipelineAdapter<PackageMonomorphizedImageAdapter>({
    kind: "mono-image",
    reachablePlatformPrimitiveIds: Object.freeze([]),
  });
  const layoutFacts = unsafePackagePipelineAdapter<PackageRepresentationLayoutFactsAdapter>({
    kind: "layout-facts",
  });
  const proofMir = unsafePackagePipelineAdapter<PackageProofMirAdapter>({ kind: "proof-mir" });
  const proofCheck = unsafePackagePipelineAdapter<PackageProofCheckAdapter>({
    kind: "proof-check",
  });

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
      const optIr = unsafePackagePipelineAdapter<PackageOptimizedOptIrAdapter>({
        program: fixture.program,
        operations: Object.freeze([...fixture.operations]),
        optimizationRegions: Object.freeze([...fixture.optimizationRegions]),
        unoptimizedOperations: Object.freeze([...fixture.operations]),
        facts: emptyOptIrFactSet(),
        staticChar16Strings: Object.freeze([]),
        staticChar16Pointers: Object.freeze([]),
      });
      return { kind: "ok" as const, value: optIr, diagnostics: [] };
    },
  });
}

function unsafePackagePipelineAdapter<Adapter>(value: unknown): Adapter {
  return Object.freeze(value as object) as Adapter;
}
