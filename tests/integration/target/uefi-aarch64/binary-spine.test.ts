import { describe, expect, test } from "bun:test";

import { emptyOptIrFactSet } from "../../../../src/opt-ir/facts/fact-index";
import { optIrIntegerConstant } from "../../../../src/opt-ir/constants";
import {
  optIrConstantId,
  optIrCallId,
  optIrOperationId,
  optIrOriginId,
  optIrValueId,
} from "../../../../src/opt-ir/ids";
import {
  optIrConstantOperation,
  optIrPlatformCallOperation,
} from "../../../../src/opt-ir/operations";
import { optIrUnsignedIntegerType } from "../../../../src/opt-ir/types";
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
import { optIrFunctionTable, optIrRegionTable } from "../../../../src/opt-ir/program";
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
        diagnostic.stableDetail.endsWith("entry-contract:source-visible-parameters-must-be-empty"),
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
      optIr: packageOptIrFixture(target.value, consoleOutputOptIrFixture(), {
        staticChar16Strings: Object.freeze([staticString]),
        staticChar16Pointers: Object.freeze([
          Object.freeze({ valueKey: "optir.value:1", pointer }),
        ]),
      }),
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
  > = {
    staticChar16Strings: Object.freeze([]),
    staticChar16Pointers: Object.freeze([]),
  },
): UefiAArch64PackageOptIrPipelineOutput {
  return Object.freeze({
    target,
    optIr: Object.freeze({
      program: fixture.program,
      operations: Object.freeze([...fixture.operations]),
      facts: emptyOptIrFactSet(),
      staticChar16Strings: staticMetadata.staticChar16Strings,
      staticChar16Pointers: staticMetadata.staticChar16Pointers,
    }),
    semanticPlatformCatalogFingerprint: target.semanticPlatformCatalogFingerprint,
    proofMirRuntimeCatalogFingerprint: target.proofMirRuntimeCatalogFingerprint,
    reachablePlatformPrimitiveIds: Object.freeze([]),
    runtimeCatalogFingerprint: target.proofMirRuntimeCatalogFingerprint,
    stages: Object.freeze([]),
  });
}

function staticChar16StringForTest() {
  const result = materializeUefiAArch64StaticChar16String({
    stableKey: "binary-spine-console-marker",
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
  return { program, operations: [pointer, call] };
}
