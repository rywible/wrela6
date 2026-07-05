import { describe, expect, test } from "bun:test";

import { emptyOptIrFactSet } from "../../../../src/opt-ir/facts/fact-index";
import type { OptIrOperation } from "../../../../src/opt-ir/operations";
import {
  authenticateUefiAArch64TargetDriverSurface,
  compilerPackageInput,
  materializeUefiAArch64StaticChar16String,
  productionPackagePipelineDependencies,
  productionUefiAArch64OptIrTargetSurface,
  runUefiAArch64PackagePipelineToOptIr,
  uefiAArch64StaticChar16StringPointer,
  type PackageMonomorphizedImageAdapter,
  type PackageOptimizedOptIrAdapter,
  type PackageParsedModuleGraphAdapter,
  type PackageProofCheckAdapter,
  type PackageProofMirAdapter,
  type PackageRepresentationLayoutFactsAdapter,
  type PackageTypedHirAdapter,
  type UefiAArch64PackagePipelineDependencies,
  type UefiAArch64TargetDriverSurface,
} from "../../../../src/target/uefi-aarch64";
import { optimizedOptIrProgramWithEntryParameterForAArch64Test } from "../../../support/target/aarch64/selection/optimized-opt-ir-fixtures";
import {
  uefiCompilePackageInputFixture,
  uefiTargetSurfaceFixture,
} from "../../../support/target/uefi-aarch64/uefi-aarch64-fixtures";
import { unsafePackagePipelineAdapter } from "./package-pipeline-support";

describe("UEFI package pipeline OptIR static CHAR16 artifacts", () => {
  test("production OptIR adapter calls real OptIR and preserves certified static CHAR16 metadata", () => {
    const packageInputResult = directPlatformUtf16PackageInputForTest();
    expect(packageInputResult.kind).toBe("ok");
    if (packageInputResult.kind !== "ok") return;
    const target = targetSurfaceWithUefiImageProfileForTest();
    const optIrTarget = productionUefiAArch64OptIrTargetSurface(target);
    let optIr: PackageOptimizedOptIrAdapter | undefined;
    let proofCheck: PackageProofCheckAdapter | undefined;

    const productionDependencies = productionPackagePipelineDependencies();
    const result = runUefiAArch64PackagePipelineToOptIr(
      {
        packageInput: packageInputResult.value,
        target,
      },
      {
        ...productionDependencies,
        checkProofAndResources(input) {
          const checked = productionDependencies.checkProofAndResources(input);
          if (checked.kind === "ok") proofCheck = checked.value;
          return checked;
        },
        buildOptimizedOptIr(input) {
          const built = productionDependencies.buildOptimizedOptIr(input);
          if (built.kind === "ok") optIr = built.value;
          return built;
        },
      },
    );

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.value.stages.map((stage) => stage.stageKey)).toEqual([
      "frontend",
      "semantic",
      "monomorphization",
      "layout-facts",
      "proof-mir",
      "proof-check",
      "opt-ir",
    ]);
    expect(result.verification.runs).toEqual([
      {
        verifierKey: "uefi-aarch64-package-pipeline",
        runKey: "to-opt-ir",
        status: "passed",
      },
    ]);
    expect(result.value.stages.at(-1)).toEqual({
      stageKey: "opt-ir",
      status: "passed",
    });
    expect(result.diagnostics).toEqual([]);
    expect(optIr).toBeDefined();
    if (optIr === undefined) return;
    expect(optIr.buildOptimizedOptIrInput).toBeDefined();
    const buildOptimizedOptIrResult = optIr.buildOptimizedOptIrResult;
    expect(buildOptimizedOptIrResult?.kind).toBe("ok");
    if (buildOptimizedOptIrResult === undefined) return;
    expect(result.value.optIr.program.functions.entries().length).toBeGreaterThan(0);
    expect(buildOptimizedOptIrResult.operations.some(isUtf16StaticIntrinsicOperation)).toBe(false);
    expect(result.value.optIr.operations.some((operation) => operation.kind === "constAddr")).toBe(
      true,
    );
    expect(result.value.optIr.operations.some(isUtf16StaticIntrinsicOperation)).toBe(false);
    expect(
      result.value.optIr.program.constants.entries().filter((constant) => constant.kind === "data"),
    ).toHaveLength(1);
    expect(result.value.optIr.staticChar16Strings).toHaveLength(1);
    expect(result.value.optIr.staticChar16Pointers).toHaveLength(1);
    expect("staticChar16Metadata" in (proofCheck ?? {})).toBe(false);
    expect(result.value.optIr.staticChar16Strings[0]?.codeUnits).toEqual([
      87, 82, 69, 76, 65, 95, 85, 69, 70, 73, 95, 83, 77, 79, 75, 69, 95, 79, 75, 13, 10, 0,
    ]);
    expect(result.value.optIr.staticChar16Pointers[0]?.valueKey).toStartWith("optir.value:");
    expect(result.value.optIr.staticChar16Pointers[0]?.pointer.stableKey).toBe(
      result.value.optIr.staticChar16Strings[0]?.stableKey,
    );
    expect(optIrTarget.platformEffects.resolve("uefi.console.outputString")).toMatchObject({
      effectKey: "uefi.console.outputString",
      ordering: "ordered",
    });
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

    const dependencies = packagePipelineDependenciesWithOptIr(
      unsafePackagePipelineAdapter<PackageOptimizedOptIrAdapter>({
        program: optIrFixture.program,
        operations: Object.freeze([...optIrFixture.operations]),
        optimizationRegions: Object.freeze([...optIrFixture.optimizationRegions]),
        unoptimizedOperations: Object.freeze([...optIrFixture.operations]),
        facts: emptyOptIrFactSet(),
        staticChar16Strings: Object.freeze([]),
        staticChar16Pointers: Object.freeze([
          Object.freeze({
            valueKey: "optir.value:1",
            pointer: uefiAArch64StaticChar16StringPointer(staticString),
          }),
        ]),
      }),
    );

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
});

function directPlatformUtf16PackageInputForTest() {
  return compilerPackageInput({
    packageKey: "smoke-utf16-static-opt-ir",
    entryModuleName: "image",
    enabledTargetFeatures: ["full-image-validation"],
    sourceRoots: [
      { kind: "project", rootKey: "project", rootPath: "src", trustedForAuthority: false },
    ],
    sourceFiles: [
      {
        sourceKey: "src/image.wr",
        moduleName: "image",
        text: [
          "use UefiStatus from wrela_std.target.uefi.status",
          "platform fn output_string(message: Utf16Static) -> UefiStatus",
          "uefi image SmokeUtf16StaticOptIr:",
          "    fn boot() -> UefiStatus:",
          '        output_string(utf16_static("WRELA_UEFI_SMOKE_OK\\r\\n"))',
          "",
        ].join("\n"),
      },
      {
        sourceKey: "src/wrela_std/target/uefi/status.wr",
        moduleName: "wrela_std.target.uefi.status",
        text: canonicalUefiStatusSourceForTest("enum"),
      },
    ],
  });
}

function targetSurfaceWithUefiImageProfileForTest(): UefiAArch64TargetDriverSurface {
  const targetResult = authenticateUefiAArch64TargetDriverSurface(uefiTargetSurfaceFixture());
  expect(targetResult.kind).toBe("ok");
  if (targetResult.kind !== "ok") throw new Error("expected authenticated UEFI target");
  return targetResult.value;
}

function canonicalUefiStatusSourceForTest(enumHeader: "enum"): string {
  return [
    `${enumHeader} UefiStatus:`,
    "    success",
    "    load_error",
    "    invalid_parameter",
    "    unsupported",
    "    bad_buffer_size",
    "    buffer_too_small",
    "    device_error",
    "    not_found",
    "    aborted",
    "    security_violation",
  ].join("\n");
}

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
      value: unsafePackagePipelineAdapter<PackageParsedModuleGraphAdapter>({
        kind: "parsed-graph",
      }),
      diagnostics: [],
    }),
    lowerTypedHir: () => ({
      kind: "ok" as const,
      value: unsafePackagePipelineAdapter<PackageTypedHirAdapter>({ kind: "typed-hir" }),
      diagnostics: [],
    }),
    monomorphizeWholeImage: () => ({
      kind: "ok" as const,
      value: unsafePackagePipelineAdapter<PackageMonomorphizedImageAdapter>({
        kind: "mono-image",
        reachablePlatformPrimitiveIds: Object.freeze([]),
      }),
      diagnostics: [],
    }),
    computeRepresentationLayoutFacts: () => ({
      kind: "ok" as const,
      value: unsafePackagePipelineAdapter<PackageRepresentationLayoutFactsAdapter>({
        kind: "layout-facts",
      }),
      diagnostics: [],
    }),
    buildProofMir: () => ({
      kind: "ok" as const,
      value: unsafePackagePipelineAdapter<PackageProofMirAdapter>({ kind: "proof-mir" }),
      diagnostics: [],
    }),
    checkProofAndResources: () => ({
      kind: "ok" as const,
      value: unsafePackagePipelineAdapter<PackageProofCheckAdapter>({ kind: "proof-check" }),
      diagnostics: [],
    }),
    buildOptimizedOptIr: () => ({ kind: "ok" as const, value: optIr, diagnostics: [] }),
  });
}

function isUtf16StaticIntrinsicOperation(operation: OptIrOperation): boolean {
  return (
    operation.kind === "intrinsicCall" &&
    operation.target.kind === "intrinsic" &&
    operation.target.intrinsicKey === "uefi.utf16_static"
  );
}
