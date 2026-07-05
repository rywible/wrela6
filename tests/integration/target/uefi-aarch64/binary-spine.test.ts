import { describe, expect, test } from "bun:test";

import type { OptIrConstant } from "../../../../src/opt-ir/constants";
import { emptyOptIrFactSet } from "../../../../src/opt-ir/facts/fact-index";
import {
  optIrDataConstantFingerprint,
  optIrIntegerConstant,
} from "../../../../src/opt-ir/constants";
import {
  optIrConstantId,
  optIrCallId,
  optIrOperationId,
  optIrOriginId,
  optIrValueId,
} from "../../../../src/opt-ir/ids";
import {
  optIrConstantOperation,
  optIrConstAddrOperation,
  optIrPlatformCallOperation,
} from "../../../../src/opt-ir/operations";
import { optIrAddressType, optIrUnsignedIntegerType } from "../../../../src/opt-ir/types";
import {
  PE_MACHINE_ARM64,
  PE_SUBSYSTEM_EFI_APPLICATION,
  parsePeCoffImage,
} from "../../../../src/pe-coff";
import {
  authenticateUefiAArch64TargetDriverSurface,
  materializeUefiAArch64StaticChar16String,
  runUefiAArch64BinarySpine,
  uefiAArch64StaticChar16StringPointer,
  type UefiAArch64PackageOptIrPipelineOutput,
} from "../../../../src/target/uefi-aarch64";
import {
  optimizedOptIrProgramWithEntryParameterForAArch64Test,
  optimizedOptIrProgramWithUnitSuccessImageEntryForAArch64Test,
} from "../../../support/target/aarch64/selection/optimized-opt-ir-fixtures";
import {
  optIrBlockForTest,
  optIrFunctionForTest,
  optIrProgramForTest,
} from "../../../support/opt-ir/cfg-fakes";
import {
  optIrConstantTable,
  optIrFunctionTable,
  optIrRegionTable,
} from "../../../../src/opt-ir/program";
import { uefiTargetSurfaceFixture } from "../../../support/target/uefi-aarch64/uefi-aarch64-fixtures";

describe("UEFI AArch64 binary spine", () => {
  test("links entry thunk and helper objects before writing PE", () => {
    const target = authenticateUefiAArch64TargetDriverSurface(uefiTargetSurfaceFixture());
    expect(target.kind).toBe("ok");
    if (target.kind !== "ok") throw new Error("expected authenticated UEFI target");

    const result = runUefiAArch64BinarySpine({
      target: target.value,
      optIr: packageOptIrFixture(target.value),
      artifactName: "smoke.efi",
    });

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") throw new Error("expected binary spine output");
    expect(result.value.stages.map((stage) => stage.stageKey)).toEqual([
      "aarch64-lowering",
      "aarch64-backend",
      "static-char16-objects",
      "validation-fixture-objects",
      "runtime-helper-objects",
      "synthetic-entry-object",
      "linker",
      "pe-coff-writer",
    ]);
    expect(result.value.linkedLayout.entry.loaderEntryLinkageName).toBe("__wrela_uefi_entry");
    expect(result.value.linkedLayout.unwindRecords).toContainEqual(
      expect.objectContaining({
        functionStartRva: result.value.linkedLayout.entry.loaderEntryRva,
        unwindInfoSectionKey: ".xdata",
      }),
    );
    const unwindSections = result.value.linkedLayout.sections.filter((section) =>
      [".pdata", ".xdata"].includes(section.stableKey),
    );
    expect(unwindSections.map((section) => section.stableKey).sort()).toEqual([".pdata", ".xdata"]);
    for (const section of unwindSections) {
      expect(section.bytes.length).toBeGreaterThan(0);
      expect(section.bytes.some((byte) => byte !== 0)).toBe(true);
    }
    expect(result.value.peCoffArtifact.artifactName).toBe("smoke.efi");
    expect(result.value.helperObjects.map((module) => module.moduleKey)).toEqual(
      expect.arrayContaining([
        "uefi-runtime-helper:entry-initialize-context",
        "uefi-runtime-helper:status-from-boot-result",
      ]),
    );

    const parsed = parsePeCoffImage(result.value.peCoffArtifact.bytes);
    expect(parsed.kind).toBe("ok");
    if (parsed.kind !== "ok") throw new Error("expected parseable PE image");
    expect(parsed.value.coffHeader.machine).toBe(PE_MACHINE_ARM64);
    expect(parsed.value.optionalHeader.subsystem).toBe(PE_SUBSYSTEM_EFI_APPLICATION);
  });

  test("rejects source-visible image entry parameters before lowering", () => {
    const target = authenticateUefiAArch64TargetDriverSurface(uefiTargetSurfaceFixture());
    expect(target.kind).toBe("ok");
    if (target.kind !== "ok") throw new Error("expected authenticated UEFI target");

    const result = runUefiAArch64BinarySpine({
      target: target.value,
      optIr: packageOptIrFixture(
        target.value,
        optimizedOptIrProgramWithEntryParameterForAArch64Test(),
      ),
      artifactName: "smoke.efi",
    });

    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(
      result.diagnostics.some((diagnostic) =>
        diagnostic.stableDetail.endsWith("entry-contract:unsupported-source-visible-parameters"),
      ),
    ).toBe(true);
    expect(result.verification.runs).toEqual([
      {
        verifierKey: "uefi-aarch64-binary-spine",
        runKey: "aarch64-lowering",
        status: "failed",
      },
    ]);
  });

  test("links static CHAR16 data used by console output firmware calls", () => {
    const target = authenticateUefiAArch64TargetDriverSurface(uefiTargetSurfaceFixture());
    expect(target.kind).toBe("ok");
    if (target.kind !== "ok") throw new Error("expected authenticated UEFI target");
    const staticString = staticChar16StringForTest();
    const pointer = uefiAArch64StaticChar16StringPointer(staticString);

    const result = runUefiAArch64BinarySpine({
      target: target.value,
      optIr: packageOptIrFixture(target.value, consoleOutputConstAddrOptIrFixture(staticString)),
      artifactName: "console.efi",
    });

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") throw new Error("expected binary spine output");
    expect(result.value.stages.map((stage) => stage.stageKey)).toContain("static-char16-objects");
    expect(result.value.staticChar16Objects).toHaveLength(1);
    expect(result.value.linkedLayout.symbols.map((symbol) => symbol.linkageName)).toContain(
      pointer.symbolName,
    );
  });

  test("links validation fixture packet source as compiler-owned read-only bytes", () => {
    const target = authenticateUefiAArch64TargetDriverSurface(uefiTargetSurfaceFixture());
    expect(target.kind).toBe("ok");
    if (target.kind !== "ok") throw new Error("expected authenticated UEFI target");

    const result = runUefiAArch64BinarySpine({
      target: target.value,
      optIr: packageOptIrFixture(target.value, validationFixturePacketSourceOptIrFixture(), {
        staticChar16Strings: Object.freeze([]),
        staticChar16Pointers: Object.freeze([]),
        validationFixturePacketSources: Object.freeze([
          Object.freeze({
            primitiveId: "uefi.validation.fixturePacketSource",
            feature: "full-image-validation-fixture",
            stableKey: "binary-spine-packet-counter:fixture-packet-source",
            bytes: Object.freeze([0x01, 0x02, 0x41, 0x42]),
          }),
        ]),
      }),
      artifactName: "packet-counter.efi",
    });

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") throw new Error("expected binary spine output");
    expect(result.value.validationFixtureObjects).toHaveLength(1);

    const linkedSymbols = result.value.linkedLayout.symbols.map((symbol) => symbol.linkageName);
    expect(linkedSymbols).toContain("__wrela_uefi_validation_fixture_packet_bytes");
    expect(linkedSymbols).not.toContain("validation_fixture_packet_source");
    expect(linkedSymbols).not.toContain("platform.uefi.validation.fixturePacketSource");

    const section = result.value.linkedLayout.sections.find(
      (candidate) => candidate.stableKey === ".rdata",
    );
    expect(Array.from(section?.bytes ?? [])).toEqual(
      expect.arrayContaining([0x01, 0x02, 0x41, 0x42]),
    );
  });

  test("rejects console output firmware calls without static CHAR16 metadata", () => {
    const target = authenticateUefiAArch64TargetDriverSurface(uefiTargetSurfaceFixture());
    expect(target.kind).toBe("ok");
    if (target.kind !== "ok") throw new Error("expected authenticated UEFI target");

    const result = runUefiAArch64BinarySpine({
      target: target.value,
      optIr: packageOptIrFixture(target.value, consoleOutputOptIrFixture()),
      artifactName: "console.efi",
    });

    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(
      result.diagnostics.some((diagnostic) =>
        diagnostic.stableDetail.endsWith(
          "firmware-platform-call:missing-static-char16-pointer:2:optir.value:1",
        ),
      ),
    ).toBe(true);
    expect(result.verification.runs).toEqual([
      {
        verifierKey: "uefi-aarch64-binary-spine",
        runKey: "aarch64-lowering",
        status: "failed",
      },
    ]);
  });
});

function packageOptIrFixture(
  target: UefiAArch64PackageOptIrPipelineOutput["target"],
  fixture: ReturnType<
    typeof optimizedOptIrProgramWithUnitSuccessImageEntryForAArch64Test
  > = optimizedOptIrProgramWithUnitSuccessImageEntryForAArch64Test(),
  staticMetadata: Pick<
    UefiAArch64PackageOptIrPipelineOutput["optIr"],
    "staticChar16Strings" | "staticChar16Pointers"
  > &
    Partial<
      Pick<UefiAArch64PackageOptIrPipelineOutput["optIr"], "validationFixturePacketSources">
    > = {
    staticChar16Strings: Object.freeze([]),
    staticChar16Pointers: Object.freeze([]),
  },
): UefiAArch64PackageOptIrPipelineOutput {
  return Object.freeze({
    target,
    parsedGraph: Object.freeze({}) as UefiAArch64PackageOptIrPipelineOutput["parsedGraph"],
    typedHir: Object.freeze({}) as UefiAArch64PackageOptIrPipelineOutput["typedHir"],
    monomorphizedImage: Object.freeze(
      {},
    ) as UefiAArch64PackageOptIrPipelineOutput["monomorphizedImage"],
    layoutFacts: Object.freeze({}) as UefiAArch64PackageOptIrPipelineOutput["layoutFacts"],
    proofMir: Object.freeze({}) as UefiAArch64PackageOptIrPipelineOutput["proofMir"],
    proofCheck: Object.freeze({}) as UefiAArch64PackageOptIrPipelineOutput["proofCheck"],
    optimizedOptIr: Object.freeze({}) as UefiAArch64PackageOptIrPipelineOutput["optimizedOptIr"],
    optIr: Object.freeze({
      program: fixture.program,
      operations: Object.freeze([...fixture.operations]),
      optimizationRegions: Object.freeze([...fixture.optimizationRegions]),
      unoptimizedOperations: Object.freeze([...fixture.operations]),
      facts: emptyOptIrFactSet(),
      staticChar16Strings: staticMetadata.staticChar16Strings,
      staticChar16Pointers: staticMetadata.staticChar16Pointers,
      validationFixturePacketSources: staticMetadata.validationFixturePacketSources ?? [],
    }),
    semanticPlatformCatalogFingerprint: target.semanticPlatformCatalogFingerprint,
    proofMirRuntimeCatalogFingerprint: target.proofMirRuntimeCatalogFingerprint,
    reachablePlatformPrimitiveIds: Object.freeze([]),
    runtimeCatalogFingerprint: target.proofMirRuntimeCatalogFingerprint,
    stages: Object.freeze([]),
  });
}

function validationFixturePacketSourceOptIrFixture() {
  const originId = optIrOriginId(300);
  const call = optIrPlatformCallOperation({
    operationId: optIrOperationId(1),
    callId: optIrCallId(1),
    target: { kind: "platform", platformKey: "uefi.validation.fixturePacketSource" },
    argumentIds: [],
    resultIds: [optIrValueId(1)],
    resultTypes: [optIrUnsignedIntegerType(64)],
    originId,
  });
  const block = optIrBlockForTest({
    parameters: [],
    operations: [call.operationId],
    terminator: {
      kind: "return",
      operationId: optIrOperationId(99),
      values: [optIrValueId(1)],
      originId,
    },
    originId,
  });
  const sourceFunction = optIrFunctionForTest({
    blocks: [block],
    entryBlock: block.blockId,
    externalRoot: { reason: "imageEntry", originId },
    originId,
  });
  const program = optIrProgramForTest({
    functions: optIrFunctionTable([sourceFunction]),
    regions: optIrRegionTable([]),
  });
  return { program, operations: [call], optimizationRegions: Object.freeze([]) };
}

function staticChar16StringForTest() {
  const result = materializeUefiAArch64StaticChar16String({
    stableKey: "utf16-static-binary-spine-console-marker",
    value: "OK\r\n",
  });
  expect(result.kind).toBe("ok");
  if (result.kind !== "ok") throw new Error("expected static firmware string");
  return result.value;
}

function consoleOutputOptIrFixture() {
  const originId = optIrOriginId(200);
  const pointer = optIrConstantOperation({
    operationId: optIrOperationId(1),
    resultId: optIrValueId(1),
    constant: optIrIntegerConstant({
      constantId: optIrConstantId(1),
      type: optIrUnsignedIntegerType(64),
      normalizedValue: 0n,
    }),
    originId,
  });
  const call = optIrPlatformCallOperation({
    operationId: optIrOperationId(2),
    callId: optIrCallId(2),
    target: { kind: "platform", platformKey: "uefi.console.outputString" },
    argumentIds: [optIrValueId(1)],
    resultIds: [optIrValueId(100)],
    resultTypes: [optIrUnsignedIntegerType(64)],
    originId,
  });
  const block = optIrBlockForTest({
    parameters: [],
    operations: [pointer.operationId, call.operationId],
    terminator: {
      kind: "return",
      operationId: optIrOperationId(99),
      values: [optIrValueId(100)],
      originId,
    },
    originId,
  });
  const sourceFunction = optIrFunctionForTest({
    blocks: [block],
    entryBlock: block.blockId,
    externalRoot: { reason: "imageEntry", originId },
    originId,
  });
  const program = optIrProgramForTest({
    functions: optIrFunctionTable([sourceFunction]),
    regions: optIrRegionTable([]),
  });
  return { program, operations: [pointer, call], optimizationRegions: Object.freeze([]) };
}

function consoleOutputConstAddrOptIrFixture(
  staticString: ReturnType<typeof staticChar16StringForTest>,
) {
  const originId = optIrOriginId(200);
  const bytes = Object.freeze([...staticString.bytes]);
  const alignment = 2;
  const section = ".rodata";
  const dataConstant: OptIrConstant = Object.freeze({
    kind: "data" as const,
    constantId: optIrConstantId(1),
    type: optIrAddressType(),
    normalizedValue: 0n,
    bytes,
    alignment,
    section,
    stableKey: staticString.stableKey,
    fingerprint: optIrDataConstantFingerprint({
      bytes,
      alignment,
      section,
      stableKey: staticString.stableKey,
    }),
  });
  const pointer = optIrConstAddrOperation({
    operationId: optIrOperationId(1),
    resultId: optIrValueId(1),
    resultType: optIrAddressType(),
    constantId: dataConstant.constantId,
    originId,
  });
  const call = optIrPlatformCallOperation({
    operationId: optIrOperationId(2),
    callId: optIrCallId(2),
    target: { kind: "platform", platformKey: "uefi.console.outputString" },
    argumentIds: [optIrValueId(1)],
    resultIds: [optIrValueId(100)],
    resultTypes: [optIrUnsignedIntegerType(64)],
    originId,
  });
  const block = optIrBlockForTest({
    parameters: [],
    operations: [pointer.operationId, call.operationId],
    terminator: {
      kind: "return",
      operationId: optIrOperationId(99),
      values: [optIrValueId(100)],
      originId,
    },
    originId,
  });
  const sourceFunction = optIrFunctionForTest({
    blocks: [block],
    entryBlock: block.blockId,
    externalRoot: { reason: "imageEntry", originId },
    originId,
  });
  const program = optIrProgramForTest({
    functions: optIrFunctionTable([sourceFunction]),
    regions: optIrRegionTable([]),
    constants: optIrConstantTable([dataConstant]),
  });
  return { program, operations: [pointer, call], optimizationRegions: Object.freeze([]) };
}
