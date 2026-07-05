import { describe, expect, test } from "bun:test";

import {
  authenticateUefiAArch64TargetDriverSurface,
  runUefiAArch64PackagePipelineToProofCheck,
  type PackageMonomorphizedImageAdapter,
  type PackageParsedModuleGraphAdapter,
  type PackageProofCheckAdapter,
  type PackageProofMirAdapter,
  type PackageRepresentationLayoutFactsAdapter,
  type PackageTypedHirAdapter,
  type UefiAArch64PackagePipelineDependencies,
} from "../../../../src/target/uefi-aarch64";
import {
  uefiCompilePackageInputFixture,
  uefiTargetSurfaceFixture,
} from "../../../support/target/uefi-aarch64/uefi-aarch64-fixtures";

describe("UEFI package pipeline proof-check boundary", () => {
  test("proof-check pipeline boundary does not build OptIR", () => {
    const packageInputResult = uefiCompilePackageInputFixture("success");
    expect(packageInputResult.kind).toBe("ok");
    if (packageInputResult.kind !== "ok") return;

    const targetResult = authenticateUefiAArch64TargetDriverSurface(uefiTargetSurfaceFixture());
    expect(targetResult.kind).toBe("ok");
    if (targetResult.kind !== "ok") return;

    const parsedGraph = unsafePackagePipelineAdapter<PackageParsedModuleGraphAdapter>({
      kind: "parsed-graph",
    });
    const typedHir = unsafePackagePipelineAdapter<PackageTypedHirAdapter>({ kind: "typed-hir" });
    const monoImage = unsafePackagePipelineAdapter<PackageMonomorphizedImageAdapter>({
      kind: "mono-image",
      reachablePlatformPrimitiveIds: targetResult.value.platformLowerings.map(
        (lowering) => lowering.primitiveId,
      ),
    });
    const layoutFacts = unsafePackagePipelineAdapter<PackageRepresentationLayoutFactsAdapter>({
      kind: "layout-facts",
    });
    const proofMir = unsafePackagePipelineAdapter<PackageProofMirAdapter>({
      kind: "proof-mir",
    });
    const proofCheck = unsafePackagePipelineAdapter<PackageProofCheckAdapter>({
      kind: "proof-check",
    });
    let optimizedOptIrCalls = 0;

    const dependencies: UefiAArch64PackagePipelineDependencies = {
      parseModuleGraph: () => ({ kind: "ok", value: parsedGraph, diagnostics: [] }),
      lowerTypedHir: () => ({ kind: "ok", value: typedHir, diagnostics: [] }),
      monomorphizeWholeImage: () => ({ kind: "ok", value: monoImage, diagnostics: [] }),
      computeRepresentationLayoutFacts: () => ({
        kind: "ok",
        value: layoutFacts,
        diagnostics: [],
      }),
      buildProofMir: () => ({ kind: "ok", value: proofMir, diagnostics: [] }),
      checkProofAndResources: () => ({ kind: "ok", value: proofCheck, diagnostics: [] }),
      buildOptimizedOptIr: () => {
        optimizedOptIrCalls += 1;
        throw new Error("proof-check pipeline must not build OptIR");
      },
    };

    const result = runUefiAArch64PackagePipelineToProofCheck(
      {
        packageInput: packageInputResult.value,
        target: targetResult.value,
      },
      dependencies,
    );

    expect(result.kind).toBe("ok");
    expect(optimizedOptIrCalls).toBe(0);
    if (result.kind !== "ok") return;
    expect(result.verification.runs.map((run) => run.runKey)).toEqual(["to-proof-check"]);
    expect(result.value.stages.map((stage) => stage.stageKey)).toEqual([
      "frontend",
      "semantic",
      "monomorphization",
      "layout-facts",
      "proof-mir",
      "proof-check",
    ]);
    expect("optimizedOptIr" in result.value).toBe(false);
    expect("optIr" in result.value).toBe(false);
  });
});

function unsafePackagePipelineAdapter<Adapter>(value: unknown): Adapter {
  return Object.freeze(value as object) as Adapter;
}
