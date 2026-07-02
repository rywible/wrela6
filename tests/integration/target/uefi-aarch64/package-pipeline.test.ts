import { describe, expect, test } from "bun:test";
import { emptyOptIrFactSet } from "../../../../src/opt-ir/facts/fact-index";
import {
  authenticateUefiAArch64TargetDriverSurface,
  materializeUefiAArch64StaticChar16String,
  runUefiAArch64PackagePipelineToOptIr,
  uefiAArch64StaticChar16StringPointer,
  type PackageOptimizedOptIrAdapter,
  type UefiAArch64PackagePipelineDependencies,
} from "../../../../src/target/uefi-aarch64";
import { optimizedOptIrProgramWithEntryParameterForAArch64Test } from "../../../support/target/aarch64/selection/optimized-opt-ir-fixtures";
import {
  uefiCompilePackageInputFixture,
  uefiTargetSurfaceFixture,
} from "../../../support/target/uefi-aarch64/uefi-aarch64-fixtures";

describe("UEFI package pipeline through OptIR", () => {
  test("runs explicit source stages for a smoke package", () => {
    const packageInputResult = uefiCompilePackageInputFixture("success");
    expect(packageInputResult.kind).toBe("ok");
    if (packageInputResult.kind !== "ok") return;

    const targetResult = authenticateUefiAArch64TargetDriverSurface(uefiTargetSurfaceFixture());
    expect(targetResult.kind).toBe("ok");
    if (targetResult.kind !== "ok") return;

    const parsedGraph = Object.freeze({ kind: "parsed-graph" });
    const typedHir = Object.freeze({ kind: "typed-hir" });
    const monoImage = Object.freeze({
      kind: "mono-image",
      reachablePlatformPrimitiveIds: targetResult.value.platformLowerings.map(
        (lowering) => lowering.primitiveId,
      ),
    });
    const layoutFacts = Object.freeze({ kind: "layout-facts" });
    const proofMir = Object.freeze({ kind: "proof-mir" });
    const proofCheck = Object.freeze({ kind: "proof-check" });
    const optIrFixture = optimizedOptIrProgramWithEntryParameterForAArch64Test();
    const staticString = staticChar16StringForTest();
    const staticPointer = uefiAArch64StaticChar16StringPointer(staticString);
    const optIr = Object.freeze({
      program: optIrFixture.program,
      operations: Object.freeze([...optIrFixture.operations]),
      facts: emptyOptIrFactSet(),
      staticChar16Strings: Object.freeze([staticString]),
      staticChar16Pointers: Object.freeze([
        Object.freeze({ valueKey: "optir.value:1", pointer: staticPointer }),
      ]),
    });

    const dependencies: UefiAArch64PackagePipelineDependencies = {
      parseModuleGraph(input) {
        expect(input.packageInput).toBe(packageInputResult.value);
        return { kind: "ok", value: parsedGraph, diagnostics: [] };
      },
      lowerTypedHir(input) {
        expect(input.parsedGraph).toBe(parsedGraph);
        expect(input.target).toBe(targetResult.value);
        return { kind: "ok", value: typedHir, diagnostics: [] };
      },
      monomorphizeWholeImage(input) {
        expect(input.typedHir).toBe(typedHir);
        return { kind: "ok", value: monoImage, diagnostics: [] };
      },
      computeRepresentationLayoutFacts(input) {
        expect(input.monomorphizedImage).toBe(monoImage);
        return { kind: "ok", value: layoutFacts, diagnostics: [] };
      },
      buildProofMir(input) {
        expect(input.layoutFacts).toBe(layoutFacts);
        expect(input.monomorphizedImage).toBe(monoImage);
        return { kind: "ok", value: proofMir, diagnostics: [] };
      },
      checkProofAndResources(input) {
        expect(input.proofMir).toBe(proofMir);
        return { kind: "ok", value: proofCheck, diagnostics: [] };
      },
      buildOptimizedOptIr(input) {
        expect(input.proofCheck).toBe(proofCheck);
        expect(input.proofMir).toBe(proofMir);
        return { kind: "ok", value: optIr, diagnostics: [] };
      },
    };

    const result = runUefiAArch64PackagePipelineToOptIr(
      {
        packageInput: packageInputResult.value,
        target: targetResult.value,
      },
      dependencies,
    );

    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.value.stages.map((stage) => stage.stageKey)).toEqual([
        "frontend",
        "semantic",
        "monomorphization",
        "layout-facts",
        "proof-mir",
        "proof-check",
        "opt-ir",
      ]);
      expect(result.value.semanticPlatformCatalogFingerprint).toBe(
        result.value.target.semanticPlatformCatalogFingerprint,
      );
      expect(result.value.proofMirRuntimeCatalogFingerprint).toBe(
        result.value.target.proofMirRuntimeCatalogFingerprint,
      );
      expect(result.value.runtimeCatalogFingerprint).toBe(
        result.value.target.proofMirRuntimeCatalogFingerprint,
      );
      expect(result.value.reachablePlatformPrimitiveIds).toEqual(
        targetResult.value.platformLowerings.map((lowering) => lowering.primitiveId),
      );
      expect(result.value.optIr).toEqual(optIr);
      expect(result.value.optIr.staticChar16Pointers[0]?.pointer.symbolName).toBe(
        staticPointer.symbolName,
      );
    }
  });

  test("rejects optimized OptIR static CHAR16 pointers without matching string data", () => {
    const packageInputResult = uefiCompilePackageInputFixture("success");
    expect(packageInputResult.kind).toBe("ok");
    if (packageInputResult.kind !== "ok") return;

    const targetResult = authenticateUefiAArch64TargetDriverSurface(uefiTargetSurfaceFixture());
    expect(targetResult.kind).toBe("ok");
    if (targetResult.kind !== "ok") return;
    const optIrFixture = optimizedOptIrProgramWithEntryParameterForAArch64Test();
    const staticString = staticChar16StringForTest();

    const dependencies = packagePipelineDependenciesWithOptIr({
      program: optIrFixture.program,
      operations: Object.freeze([...optIrFixture.operations]),
      facts: emptyOptIrFactSet(),
      staticChar16Strings: Object.freeze([]),
      staticChar16Pointers: Object.freeze([
        Object.freeze({
          valueKey: "optir.value:1",
          pointer: uefiAArch64StaticChar16StringPointer(staticString),
        }),
      ]),
    });

    const result = runUefiAArch64PackagePipelineToOptIr(
      {
        packageInput: packageInputResult.value,
        target: targetResult.value,
      },
      dependencies,
    );

    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toContain(
      "opt-ir-artifact:malformed-static-char16-pointer:optir.value:1",
    );
  });

  test("rejects malformed optimized OptIR artifacts from injected dependencies", () => {
    const packageInputResult = uefiCompilePackageInputFixture("success");
    expect(packageInputResult.kind).toBe("ok");
    if (packageInputResult.kind !== "ok") return;

    const targetResult = authenticateUefiAArch64TargetDriverSurface(uefiTargetSurfaceFixture());
    expect(targetResult.kind).toBe("ok");
    if (targetResult.kind !== "ok") return;
    const optIrFixture = optimizedOptIrProgramWithEntryParameterForAArch64Test();

    const dependencies: UefiAArch64PackagePipelineDependencies = {
      parseModuleGraph: () => ({
        kind: "ok",
        value: Object.freeze({ kind: "parsed-graph" }),
        diagnostics: [],
      }),
      lowerTypedHir: () => ({
        kind: "ok",
        value: Object.freeze({ kind: "typed-hir" }),
        diagnostics: [],
      }),
      monomorphizeWholeImage: () => ({
        kind: "ok",
        value: Object.freeze({ kind: "mono-image" }),
        diagnostics: [],
      }),
      computeRepresentationLayoutFacts: () => ({
        kind: "ok",
        value: Object.freeze({ kind: "layout-facts" }),
        diagnostics: [],
      }),
      buildProofMir: () => ({
        kind: "ok",
        value: Object.freeze({ kind: "proof-mir" }),
        diagnostics: [],
      }),
      checkProofAndResources: () => ({
        kind: "ok",
        value: Object.freeze({ kind: "proof-check" }),
        diagnostics: [],
      }),
      buildOptimizedOptIr: () => ({
        kind: "ok",
        value: Object.freeze({
          program: optIrFixture.program,
          operations: Object.freeze({}) as PackageOptimizedOptIrAdapter["operations"],
          facts: emptyOptIrFactSet(),
        }),
        diagnostics: [],
      }),
    };

    const result = runUefiAArch64PackagePipelineToOptIr(
      {
        packageInput: packageInputResult.value,
        target: targetResult.value,
      },
      dependencies,
    );

    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toEqual([
      "opt-ir-artifact:malformed",
    ]);
    expect(result.verification.runs).toEqual([
      { verifierKey: "uefi-aarch64-package-pipeline", runKey: "frontend", status: "passed" },
      { verifierKey: "uefi-aarch64-package-pipeline", runKey: "semantic", status: "passed" },
      {
        verifierKey: "uefi-aarch64-package-pipeline",
        runKey: "monomorphization",
        status: "passed",
      },
      { verifierKey: "uefi-aarch64-package-pipeline", runKey: "layout-facts", status: "passed" },
      { verifierKey: "uefi-aarch64-package-pipeline", runKey: "proof-mir", status: "passed" },
      { verifierKey: "uefi-aarch64-package-pipeline", runKey: "proof-check", status: "passed" },
      { verifierKey: "uefi-aarch64-package-pipeline", runKey: "opt-ir", status: "failed" },
    ]);
  });
});

function staticChar16StringForTest() {
  const result = materializeUefiAArch64StaticChar16String({
    stableKey: "package-pipeline-console-marker",
    value: "OK\r\n",
  });
  expect(result.kind).toBe("ok");
  if (result.kind !== "ok") throw new Error("expected static firmware string");
  return result.value;
}

function packagePipelineDependenciesWithOptIr(
  optIr: PackageOptimizedOptIrAdapter,
): UefiAArch64PackagePipelineDependencies {
  return Object.freeze({
    parseModuleGraph: () => ({
      kind: "ok" as const,
      value: Object.freeze({ kind: "parsed-graph" }),
      diagnostics: [],
    }),
    lowerTypedHir: () => ({
      kind: "ok" as const,
      value: Object.freeze({ kind: "typed-hir" }),
      diagnostics: [],
    }),
    monomorphizeWholeImage: () => ({
      kind: "ok" as const,
      value: Object.freeze({ kind: "mono-image" }),
      diagnostics: [],
    }),
    computeRepresentationLayoutFacts: () => ({
      kind: "ok" as const,
      value: Object.freeze({ kind: "layout-facts" }),
      diagnostics: [],
    }),
    buildProofMir: () => ({
      kind: "ok" as const,
      value: Object.freeze({ kind: "proof-mir" }),
      diagnostics: [],
    }),
    checkProofAndResources: () => ({
      kind: "ok" as const,
      value: Object.freeze({ kind: "proof-check" }),
      diagnostics: [],
    }),
    buildOptimizedOptIr: () => ({ kind: "ok" as const, value: optIr, diagnostics: [] }),
  });
}
