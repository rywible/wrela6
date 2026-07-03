import { describe, expect, test } from "bun:test";
import { emptyOptIrFactSet } from "../../../../src/opt-ir/facts/fact-index";
import {
  authenticateUefiAArch64TargetDriverSurface,
  compilerPackageInput,
  extractUefiAArch64StaticChar16MetadataFromCompilerIntrinsics,
  materializeUefiAArch64StaticChar16String,
  productionPackagePipelineDependencies,
  productionUefiAArch64OptIrTargetSurface,
  productionUefiAArch64ProofCheckInputAuthority,
  productionUefiAArch64LayoutTargetSurface,
  productionUefiAArch64ProofMirBuildTargetContext,
  runUefiAArch64PackagePipelineToOptIr,
  uefiAArch64TargetDiagnostic,
  uefiAArch64StaticChar16StringPointer,
  type PackageMonomorphizedImageAdapter,
  type PackageOptimizedOptIrAdapter,
  type PackageParsedModuleGraphAdapter,
  type PackageProofCheckAdapter,
  type PackageProofMirAdapter,
  type PackageRepresentationLayoutFactsAdapter,
  type PackageTypedHirAdapter,
  type UefiAArch64TargetDriverSurface,
  type UefiAArch64PackagePipelineDependencies,
} from "../../../../src/target/uefi-aarch64";
import { optimizedOptIrProgramWithEntryParameterForAArch64Test } from "../../../support/target/aarch64/selection/optimized-opt-ir-fixtures";
import {
  uefiCompilePackageInputFixture,
  uefiTargetSurfaceFixture,
} from "../../../support/target/uefi-aarch64/uefi-aarch64-fixtures";

describe("UEFI package pipeline through OptIR", () => {
  test("extracts accepted utf16_static intrinsic metadata into static CHAR16 records", () => {
    const result = extractUefiAArch64StaticChar16MetadataFromCompilerIntrinsics([
      {
        intrinsicKey: "uefi.utf16_static",
        literalValue: "OK\r\n",
        returnTypeKey: "uefi.Utf16Static",
        sourceValueKey: "hir.expression:42",
        hirExpressionId: 42 as never,
        semanticReferenceKey: "0:0:12:functionName:0",
      },
    ]);

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.value.staticChar16Strings).toHaveLength(1);
    expect(result.value.staticChar16Pointers).toHaveLength(1);
    expect(result.value.staticChar16Strings[0]?.codeUnits).toEqual([79, 75, 13, 10, 0]);
    expect(result.value.staticChar16Pointers[0]?.valueKey).toBe("hir.expression:42");
    expect(result.value.staticChar16Pointers[0]?.pointer.stableKey).toBe(
      result.value.staticChar16Strings[0]?.stableKey,
    );
  });

  test("runs explicit source stages for a smoke package", () => {
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
    const optIrFixture = optimizedOptIrProgramWithEntryParameterForAArch64Test();
    const staticString = staticChar16StringForTest();
    const staticPointer = uefiAArch64StaticChar16StringPointer(staticString);
    const optIr = unsafePackagePipelineAdapter<PackageOptimizedOptIrAdapter>({
      program: optIrFixture.program,
      operations: Object.freeze([...optIrFixture.operations]),
      unoptimizedOperations: Object.freeze([...optIrFixture.operations]),
      facts: emptyOptIrFactSet(),
      staticChar16Strings: Object.freeze([staticString]),
      staticChar16Pointers: Object.freeze([
        Object.freeze({ valueKey: "optir.value:1", pointer: staticPointer }),
      ]),
      validationFixturePacketSources: Object.freeze([]),
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

  test("carries validation fixture packet bytes into the OptIR pipeline artifact", () => {
    const packageInputResult = compilerPackageInput({
      packageKey: "packet-counter-test",
      sourceRoots: [],
      sourceFiles: [],
      enabledTargetFeatures: ["full-image-validation-fixture"],
      validationFixturePacketSource: {
        primitiveId: "uefi.validation.fixturePacketSource",
        feature: "full-image-validation-fixture",
        stableKey: "packet-counter-test:fixture-packet-source",
        bytes: [0x01, 0x02, 0x41, 0x42],
      },
    });
    expect(packageInputResult.kind).toBe("ok");
    if (packageInputResult.kind !== "ok") return;

    const targetResult = authenticateUefiAArch64TargetDriverSurface(uefiTargetSurfaceFixture());
    expect(targetResult.kind).toBe("ok");
    if (targetResult.kind !== "ok") return;

    const optIrFixture = optimizedOptIrProgramWithEntryParameterForAArch64Test();
    const dependencies: UefiAArch64PackagePipelineDependencies = {
      parseModuleGraph: () => ({
        kind: "ok",
        value: unsafePackagePipelineAdapter<PackageParsedModuleGraphAdapter>({
          kind: "parsed-graph",
        }),
        diagnostics: [],
      }),
      lowerTypedHir: () => ({
        kind: "ok",
        value: unsafePackagePipelineAdapter<PackageTypedHirAdapter>({ kind: "typed-hir" }),
        diagnostics: [],
      }),
      monomorphizeWholeImage: () => ({
        kind: "ok",
        value: unsafePackagePipelineAdapter<PackageMonomorphizedImageAdapter>({
          kind: "mono-image",
          reachablePlatformPrimitiveIds: [],
        }),
        diagnostics: [],
      }),
      computeRepresentationLayoutFacts: () => ({
        kind: "ok",
        value: unsafePackagePipelineAdapter<PackageRepresentationLayoutFactsAdapter>({
          kind: "layout-facts",
        }),
        diagnostics: [],
      }),
      buildProofMir: () => ({
        kind: "ok",
        value: unsafePackagePipelineAdapter<PackageProofMirAdapter>({ kind: "proof-mir" }),
        diagnostics: [],
      }),
      checkProofAndResources: () => ({
        kind: "ok",
        value: unsafePackagePipelineAdapter<PackageProofCheckAdapter>({ kind: "proof-check" }),
        diagnostics: [],
      }),
      buildOptimizedOptIr: () => ({
        kind: "ok",
        value: unsafePackagePipelineAdapter<PackageOptimizedOptIrAdapter>({
          program: optIrFixture.program,
          operations: Object.freeze([...optIrFixture.operations]),
          unoptimizedOperations: Object.freeze([...optIrFixture.operations]),
          facts: emptyOptIrFactSet(),
          staticChar16Strings: Object.freeze([]),
          staticChar16Pointers: Object.freeze([]),
        }),
        diagnostics: [],
      }),
    };

    const result = runUefiAArch64PackagePipelineToOptIr(
      { packageInput: packageInputResult.value, target: targetResult.value },
      dependencies,
    );

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.value.optIr.validationFixturePacketSources).toEqual([
      {
        primitiveId: "uefi.validation.fixturePacketSource",
        feature: "full-image-validation-fixture",
        stableKey: "packet-counter-test:fixture-packet-source",
        bytes: [0x01, 0x02, 0x41, 0x42],
      },
    ]);
  });

  test("production semantic adapter lowers direct target-typed source and advances to monomorphization", () => {
    const packageInputResult = directTargetTypedPackageInputForTest();
    expect(packageInputResult.kind).toBe("ok");
    if (packageInputResult.kind !== "ok") return;
    const target = targetSurfaceWithUefiImageProfileForTest();

    const result = runUefiAArch64PackagePipelineToOptIr(
      {
        packageInput: packageInputResult.value,
        target,
      },
      {
        ...productionPackagePipelineDependencies(),
        monomorphizeWholeImage: () => ({
          kind: "error" as const,
          diagnostics: [
            uefiAArch64TargetDiagnostic({
              code: "UEFI_AARCH64_PIPELINE_FAILED",
              ownerKey: "test-stop",
              stableDetail: "stop-after-semantic",
            }),
          ],
        }),
      },
    );

    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.verification.runs.map((run) => run.runKey)).toEqual([
      "frontend",
      "semantic",
      "monomorphization",
    ]);
    expect(result.verification.runs[1]?.status).toBe("passed");
    expect(result.diagnostics[0]?.ownerKey).toBe("test-stop");
  });

  test("production semantic adapter does not treat any enum named UefiStatus as target status ABI", () => {
    const packageInputResult = compilerPackageInput({
      packageKey: "bogus-source-status",
      entryModuleName: "image",
      sourceRoots: [
        { kind: "project", rootKey: "project", rootPath: "src", trustedForAuthority: false },
      ],
      sourceFiles: [
        {
          sourceKey: "src/image.wr",
          moduleName: "image",
          text: [
            "enum UefiStatus:",
            "    bogus",
            "platform fn output_string(message: Utf16Static) -> UefiStatus",
            "uefi image BogusSourceStatus:",
            "    fn boot() -> UefiStatus:",
            "        return UefiStatus.bogus",
            "",
          ].join("\n"),
        },
      ],
    });
    expect(packageInputResult.kind).toBe("ok");
    if (packageInputResult.kind !== "ok") return;

    const result = runUefiAArch64PackagePipelineToOptIr(
      {
        packageInput: packageInputResult.value,
        target: targetSurfaceWithUefiImageProfileForTest(),
      },
      {
        ...productionPackagePipelineDependencies(),
        monomorphizeWholeImage: () => ({
          kind: "error" as const,
          diagnostics: [
            uefiAArch64TargetDiagnostic({
              code: "UEFI_AARCH64_PIPELINE_FAILED",
              ownerKey: "test-stop",
              stableDetail: "semantic-should-not-pass",
            }),
          ],
        }),
      },
    );

    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.verification.runs.map((run) => run.runKey)).toEqual(["frontend", "semantic"]);
    expect(result.verification.runs.at(-1)?.status).toBe("failed");
    expect(result.diagnostics.map((diagnostic) => diagnostic.ownerKey)).not.toContain("test-stop");
  });

  test("production monomorphization adapter lowers direct target-typed source and advances to layout facts", () => {
    const packageInputResult = directTargetTypedPackageInputForTest();
    expect(packageInputResult.kind).toBe("ok");
    if (packageInputResult.kind !== "ok") return;
    const target = targetSurfaceWithUefiImageProfileForTest();

    const result = runUefiAArch64PackagePipelineToOptIr(
      {
        packageInput: packageInputResult.value,
        target,
      },
      {
        ...productionPackagePipelineDependencies(),
        computeRepresentationLayoutFacts: () => ({
          kind: "error" as const,
          diagnostics: [
            uefiAArch64TargetDiagnostic({
              code: "UEFI_AARCH64_PIPELINE_FAILED",
              ownerKey: "test-stop",
              stableDetail: "stop-after-monomorphization",
            }),
          ],
        }),
      },
    );

    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.verification.runs.map((run) => run.runKey)).toEqual([
      "frontend",
      "semantic",
      "monomorphization",
      "layout-facts",
    ]);
    expect(result.verification.runs[2]?.status).toBe("passed");
    expect(result.diagnostics[0]?.ownerKey).toBe("test-stop");
  });

  test("production layout-facts adapter computes UEFI AArch64 layout and advances to proof MIR", () => {
    const packageInputResult = directTargetTypedPackageInputForTest();
    expect(packageInputResult.kind).toBe("ok");
    if (packageInputResult.kind !== "ok") return;
    const target = targetSurfaceWithUefiImageProfileForTest();
    const layoutTarget = productionUefiAArch64LayoutTargetSurface(target);
    let layoutFacts: PackageRepresentationLayoutFactsAdapter | undefined;

    const productionDependencies = productionPackagePipelineDependencies();
    const result = runUefiAArch64PackagePipelineToOptIr(
      {
        packageInput: packageInputResult.value,
        target,
      },
      {
        ...productionDependencies,
        computeRepresentationLayoutFacts(input) {
          const computed = productionDependencies.computeRepresentationLayoutFacts(input);
          if (computed.kind === "ok") layoutFacts = computed.value;
          return computed;
        },
        buildProofMir: () => ({
          kind: "error" as const,
          diagnostics: [
            uefiAArch64TargetDiagnostic({
              code: "UEFI_AARCH64_PIPELINE_FAILED",
              ownerKey: "test-stop",
              stableDetail: "stop-after-layout-facts",
            }),
          ],
        }),
      },
    );

    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.verification.runs.map((run) => run.runKey)).toEqual([
      "frontend",
      "semantic",
      "monomorphization",
      "layout-facts",
      "proof-mir",
    ]);
    expect(result.verification.runs[3]?.status).toBe("passed");
    expect(result.diagnostics[0]?.ownerKey).toBe("test-stop");
    expect(
      layoutFacts?.computeRepresentationLayoutFactsInput?.target.dataModel.pointerWidthBits,
    ).toBe(64);
    expect(layoutFacts?.computeRepresentationLayoutFactsResult?.facts.target.pointerWidthBits).toBe(
      layoutTarget.dataModel.pointerWidthBits,
    );
    expect(layoutFacts?.computeRepresentationLayoutFactsResult?.facts.imageEntry).toBeDefined();
  });

  test("production proof-MIR adapter builds source image entry MIR and advances to proof check", () => {
    const packageInputResult = directTargetTypedPackageInputForTest();
    expect(packageInputResult.kind).toBe("ok");
    if (packageInputResult.kind !== "ok") return;
    const target = targetSurfaceWithUefiImageProfileForTest();
    const proofMirTarget = productionUefiAArch64ProofMirBuildTargetContext(target);
    let proofMir: PackageProofMirAdapter | undefined;

    const productionDependencies = productionPackagePipelineDependencies();
    const result = runUefiAArch64PackagePipelineToOptIr(
      {
        packageInput: packageInputResult.value,
        target,
      },
      {
        ...productionDependencies,
        buildProofMir(input) {
          const built = productionDependencies.buildProofMir(input);
          if (built.kind === "ok") proofMir = built.value;
          return built;
        },
        checkProofAndResources: () => ({
          kind: "error" as const,
          diagnostics: [
            uefiAArch64TargetDiagnostic({
              code: "UEFI_AARCH64_PIPELINE_FAILED",
              ownerKey: "test-stop",
              stableDetail: "stop-after-proof-mir",
            }),
          ],
        }),
      },
    );

    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.verification.runs.map((run) => run.runKey)).toEqual([
      "frontend",
      "semantic",
      "monomorphization",
      "layout-facts",
      "proof-mir",
      "proof-check",
    ]);
    expect(result.verification.runs[4]?.status).toBe("passed");
    expect(result.diagnostics[0]?.ownerKey).toBe("test-stop");
    expect(proofMir?.buildProofMirInput?.target.targetId).toBe(proofMirTarget.targetId);
    expect(proofMir?.buildProofMirInput?.target.runtimeCatalog.targetId).toBe(
      proofMirTarget.runtimeCatalog.targetId,
    );
    expect(proofMir?.buildProofMirInput?.target.runtimeCatalog.entries().length).toBe(
      proofMirTarget.runtimeCatalog.entries().length,
    );
    expect(
      proofMir?.buildProofMirResult?.mir.image.externalRoots.map((root) => root.reason),
    ).toContain("imageEntry");
    expect(proofMir?.buildProofMirResult?.mir.image.entryFunctionInstanceId).toBe(
      proofMir?.buildProofMirResult?.mir.image.externalRoots.find(
        (root) => root.reason === "imageEntry",
      )?.functionInstanceId,
    );
    expect(proofMir?.buildProofMirResult?.mir.functions.entries().length).toBeGreaterThan(0);
    const entryFunctionInstanceId =
      proofMir?.buildProofMirResult?.mir.image.entryFunctionInstanceId;
    expect(entryFunctionInstanceId).toBeDefined();
    if (entryFunctionInstanceId === undefined) return;
    expect(proofMir?.buildProofMirResult?.mir.functions.get(entryFunctionInstanceId)).toBeDefined();
    expect(proofMir?.buildProofMirResult?.mir.callGraph.entries()).toBeDefined();
  });

  test("production proof-check adapter checks source image MIR and advances to OptIR", () => {
    const packageInputResult = directTargetTypedPackageInputForTest();
    expect(packageInputResult.kind).toBe("ok");
    if (packageInputResult.kind !== "ok") return;
    const target = targetSurfaceWithUefiImageProfileForTest();
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
        buildOptimizedOptIr: () => ({
          kind: "error" as const,
          diagnostics: [
            uefiAArch64TargetDiagnostic({
              code: "UEFI_AARCH64_PIPELINE_FAILED",
              ownerKey: "test-stop",
              stableDetail: "stop-after-proof-check",
            }),
          ],
        }),
      },
    );

    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.verification.runs.map((run) => run.runKey)).toEqual([
      "frontend",
      "semantic",
      "monomorphization",
      "layout-facts",
      "proof-mir",
      "proof-check",
      "opt-ir",
    ]);
    expect(result.verification.runs[5]?.status).toBe("passed");
    expect(result.diagnostics[0]?.ownerKey).toBe("test-stop");
    expect(proofCheck?.checkProofAndResourcesInput).toBeDefined();
    expect(proofCheck?.checkProofAndResourcesInput?.runtimeCatalog.fingerprint).toEqual(
      proofCheck?.checkProofAndResourcesInput?.mir.runtimeCatalog.fingerprint,
    );
    expect(proofCheck?.checkProofAndResourcesResult?.checked.facts.origins.length).toBeGreaterThan(
      0,
    );
    expect(proofCheck?.checkProofAndResourcesResult?.checked.terminalGraph).toBeDefined();

    const authority = productionUefiAArch64ProofCheckInputAuthority({
      target,
      layout: proofCheck?.checkProofAndResourcesInput?.layout,
      proofMir: proofCheck?.checkProofAndResourcesInput?.mir,
    });
    expect(authority.kind).toBe("ok");
  });

  test("production proof-check authority preserves platform contract catalog diagnostics", () => {
    const packageInputResult = directTargetTypedPackageInputForTest();
    expect(packageInputResult.kind).toBe("ok");
    if (packageInputResult.kind !== "ok") return;
    const target = targetSurfaceWithUefiImageProfileForTest();
    let proofCheck: PackageProofCheckAdapter | undefined;

    const productionDependencies = productionPackagePipelineDependencies();
    const pipelineResult = runUefiAArch64PackagePipelineToOptIr(
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
        buildOptimizedOptIr: () => ({
          kind: "error" as const,
          diagnostics: [
            uefiAArch64TargetDiagnostic({
              code: "UEFI_AARCH64_PIPELINE_FAILED",
              ownerKey: "test-stop",
              stableDetail: "stop-after-proof-check",
            }),
          ],
        }),
      },
    );
    expect(pipelineResult.kind).toBe("error");
    expect(proofCheck?.checkProofAndResourcesInput).toBeDefined();
    if (proofCheck?.checkProofAndResourcesInput === undefined) return;

    const firstLowering = target.platformLowerings[0];
    expect(firstLowering).toBeDefined();
    if (firstLowering === undefined) return;

    const duplicateContractTarget = Object.freeze({
      ...target,
      platformLowerings: Object.freeze([firstLowering, firstLowering, ...target.platformLowerings]),
    });
    const authority = productionUefiAArch64ProofCheckInputAuthority({
      target: duplicateContractTarget,
      layout: proofCheck.checkProofAndResourcesInput.layout,
      proofMir: proofCheck.checkProofAndResourcesInput.mir,
    });

    expect(authority.kind).toBe("error");
    if (authority.kind !== "error") return;
    expect(authority.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toContainEqual(
      expect.stringContaining("PROOF_CHECK_DUPLICATE_AUTHORITY_ENTRY:duplicate:"),
    );
  });

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
    expect(result.value.optIr.operations).toEqual(buildOptimizedOptIrResult.operations);
    expect(result.value.optIr.staticChar16Strings).toHaveLength(1);
    expect(result.value.optIr.staticChar16Pointers).toHaveLength(1);
    expect(proofCheck?.staticChar16Metadata?.staticChar16Strings).toHaveLength(1);
    expect(proofCheck?.staticChar16Metadata?.staticChar16Strings[0]?.codeUnits).toEqual([
      87, 82, 69, 76, 65, 95, 85, 69, 70, 73, 95, 83, 77, 79, 75, 69, 95, 79, 75, 13, 10, 0,
    ]);
    expect(proofCheck?.staticChar16Metadata?.staticChar16Pointers).toHaveLength(1);
    expect(proofCheck?.staticChar16Metadata?.staticChar16Pointers[0]?.valueKey).toStartWith(
      "hir.expression:",
    );
    expect(proofCheck?.staticChar16Metadata?.staticChar16Pointers[0]?.pointer.stableKey).toBe(
      proofCheck?.staticChar16Metadata?.staticChar16Strings[0]?.stableKey,
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
        value: unsafePackagePipelineAdapter<PackageParsedModuleGraphAdapter>({
          kind: "parsed-graph",
        }),
        diagnostics: [],
      }),
      lowerTypedHir: () => ({
        kind: "ok",
        value: unsafePackagePipelineAdapter<PackageTypedHirAdapter>({ kind: "typed-hir" }),
        diagnostics: [],
      }),
      monomorphizeWholeImage: () => ({
        kind: "ok",
        value: unsafePackagePipelineAdapter<PackageMonomorphizedImageAdapter>({
          kind: "mono-image",
        }),
        diagnostics: [],
      }),
      computeRepresentationLayoutFacts: () => ({
        kind: "ok",
        value: unsafePackagePipelineAdapter<PackageRepresentationLayoutFactsAdapter>({
          kind: "layout-facts",
        }),
        diagnostics: [],
      }),
      buildProofMir: () => ({
        kind: "ok",
        value: unsafePackagePipelineAdapter<PackageProofMirAdapter>({ kind: "proof-mir" }),
        diagnostics: [],
      }),
      checkProofAndResources: () => ({
        kind: "ok",
        value: unsafePackagePipelineAdapter<PackageProofCheckAdapter>({ kind: "proof-check" }),
        diagnostics: [],
      }),
      buildOptimizedOptIr: () => ({
        kind: "ok",
        value: unsafePackagePipelineAdapter<PackageOptimizedOptIrAdapter>({
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

function directTargetTypedPackageInputForTest() {
  return compilerPackageInput({
    packageKey: "smoke-direct-target-typed",
    entryModuleName: "image",
    sourceRoots: [
      { kind: "project", rootKey: "project", rootPath: "src", trustedForAuthority: false },
    ],
    sourceFiles: [
      {
        sourceKey: "src/image.wr",
        moduleName: "image",
        text: [
          "uefi image SmokeDirectTargetTyped:",
          "    fn boot() -> Never:",
          "        return",
          "",
        ].join("\n"),
      },
    ],
  });
}

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
          "enum UefiStatus:",
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
          "platform fn output_string(message: Utf16Static) -> UefiStatus",
          "uefi image SmokeUtf16StaticOptIr:",
          "    fn boot() -> UefiStatus:",
          '        output_string(utf16_static("WRELA_UEFI_SMOKE_OK\\r\\n"))',
          "",
        ].join("\n"),
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
      value: unsafePackagePipelineAdapter<PackageMonomorphizedImageAdapter>({ kind: "mono-image" }),
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

function unsafePackagePipelineAdapter<Adapter>(value: unknown): Adapter {
  return Object.freeze(value as object) as Adapter;
}
