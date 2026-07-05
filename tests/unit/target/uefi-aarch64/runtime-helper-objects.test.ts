import { describe, expect, test } from "bun:test";

import type { AArch64ObjectModule } from "../../../../src/target/aarch64/backend/object/object-module";
import { verifyAArch64ObjectModule } from "../../../../src/target/aarch64/backend/verify/encoding-object-verifier";
import { RPI5_BACKEND_CATALOGS } from "../../../../src/target/aarch64/backend/catalogs/rpi5-backend-catalog-data";
import type { AArch64BackendTargetSurface } from "../../../../src/target/aarch64/backend/api/backend-target-surface";
import {
  canonicalUefiAArch64ExitBootServicesPolicy,
  canonicalUefiAArch64FirmwareTableSurface,
  canonicalUefiAArch64StatusPolicy,
  materializeUefiAArch64EntryInitializeContextHelper,
  materializeUefiAArch64ExitBootServicesWithFreshMapHelper,
  materializeUefiAArch64RuntimeHelperObjects,
  materializeUefiAArch64StatusFromBootResultHelper,
} from "../../../../src/target/uefi-aarch64";
import { authenticatedBackendTargetSurfaceForTest } from "../../../support/target/aarch64/backend/backend-target-surface-fakes";

describe("UEFI AArch64 runtime helper objects", () => {
  test("entry initialize context helper emits branches and firmware call", () => {
    const result = materializeUefiAArch64EntryInitializeContextHelper({
      backendTarget: backendTargetForRuntimeHelperObjectsTest(),
      firmwareTables: canonicalUefiAArch64FirmwareTableSurface(),
      statusPolicy: canonicalUefiAArch64StatusPolicy(),
      watchdogPolicy: { kind: "disable-before-source" },
    });

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") throw new Error("expected helper object");
    expect(objectDefinesLinkageName(result.value, "__wrela_uefi_entry_initialize_context")).toBe(
      true,
    );
    expect(verifyAArch64ObjectModule({ objectModule: result.value }).kind).toBe("ok");
    expect(result.value.sections.flatMap((section) => section.bytes)).not.toHaveLength(0);
    expect(objectInstructionOpcodes(result.value)).toEqual(
      expect.arrayContaining(["cbz", "ldr-unsigned-immediate", "blr", "cmp", "b-cond", "ret"]),
    );
  });

  test("entry initialize context helper preserves the caller link register across firmware calls", () => {
    const result = materializeUefiAArch64EntryInitializeContextHelper({
      backendTarget: backendTargetForRuntimeHelperObjectsTest(),
      firmwareTables: canonicalUefiAArch64FirmwareTableSurface(),
      statusPolicy: canonicalUefiAArch64StatusPolicy(),
      watchdogPolicy: { kind: "disable-before-source" },
    });

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") throw new Error("expected helper object");
    const sources = objectInstructionSources(result.value, "uefi.entry.initialize-context");
    const firmwareCallIndex = sources.findIndex((source) => source.endsWith(":blr"));
    const saveLinkRegisterIndex = sources.findIndex((source) =>
      source.includes("save-link-register:str-unsigned-immediate"),
    );
    const returnIndices = sources
      .map((source, index) => ({ source, index }))
      .filter((entry) => entry.source.endsWith(":ret"))
      .map((entry) => entry.index);

    expect(firmwareCallIndex).toBeGreaterThanOrEqual(0);
    expect(saveLinkRegisterIndex).toBeGreaterThanOrEqual(0);
    expect(saveLinkRegisterIndex).toBeLessThan(firmwareCallIndex);
    expect(returnIndices).not.toHaveLength(0);
    for (const returnIndex of returnIndices) {
      expect(sources[returnIndex - 2]).toContain("restore-link-register:ldr-unsigned-immediate");
      expect(sources[returnIndex - 1]).toContain("free-helper-frame:add-immediate");
    }
  });

  test("entry initialize context treats unsupported watchdog disable as success status", () => {
    const result = materializeUefiAArch64EntryInitializeContextHelper({
      backendTarget: backendTargetForRuntimeHelperObjectsTest(),
      firmwareTables: canonicalUefiAArch64FirmwareTableSurface(),
      statusPolicy: canonicalUefiAArch64StatusPolicy(),
      watchdogPolicy: { kind: "disable-before-source" },
    });

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") throw new Error("expected helper object");
    const successStatusWrite = result.value.byteProvenance.find((record) =>
      record.source.includes("return-success:movz"),
    );
    expect(successStatusWrite).toBeDefined();
    if (successStatusWrite === undefined) throw new Error("expected return-success write");
    const textBytes = result.value.sections.find((section) => section.stableKey === ".text")?.bytes;
    expect(textBytes).toBeDefined();
    if (textBytes === undefined) throw new Error("expected text section");
    expect(
      textBytes.slice(
        successStatusWrite.startOffsetBytes,
        successStatusWrite.startOffsetBytes + successStatusWrite.byteLength,
      ),
    ).toEqual(Uint8Array.of(0x00, 0x00, 0x80, 0xd2));
  });

  test("exit boot services helper emits bounded fresh-map retry loop", () => {
    const result = materializeUefiAArch64ExitBootServicesWithFreshMapHelper({
      backendTarget: backendTargetForRuntimeHelperObjectsTest(),
      firmwareTables: canonicalUefiAArch64FirmwareTableSurface(),
      statusPolicy: canonicalUefiAArch64StatusPolicy(),
      exitBootServicesPolicy: canonicalUefiAArch64ExitBootServicesPolicy({
        maxInvalidParameterRetries: 1,
      }),
    });

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") throw new Error("expected helper object");
    expect(
      objectDefinesLinkageName(result.value, "__wrela_uefi_exit_boot_services_with_fresh_map"),
    ).toBe(true);
    expect(verifyAArch64ObjectModule({ objectModule: result.value }).kind).toBe("ok");
    expect(result.value.sections.flatMap((section) => section.bytes)).not.toHaveLength(0);
    expect(objectInstructionOpcodes(result.value, "uefi.exit-boot-services")).toEqual(
      expect.arrayContaining([
        "ldr-unsigned-immediate",
        "str-unsigned-immediate",
        "blr",
        "cmp",
        "b-cond",
        "ret",
      ]),
    );
    const provenanceSources = result.value.byteProvenance.map((record) => record.source);
    const allocatePoolCall = provenanceSources.findIndex((source) =>
      source.includes("call-allocate-pool"),
    );
    const firstExitBootServices = provenanceSources.findIndex((source) =>
      source.includes("call-exit-boot-services"),
    );

    expect(allocatePoolCall).toBeGreaterThanOrEqual(0);
    expect(firstExitBootServices).toBeGreaterThan(allocatePoolCall);
    expect(
      provenanceSources
        .slice(firstExitBootServices + 1)
        .some((source) => source.includes("call-allocate-pool")),
    ).toBe(false);
  });

  test("exit boot services helper branches stale-key retry back to fresh map", () => {
    const result = materializeUefiAArch64ExitBootServicesWithFreshMapHelper({
      backendTarget: backendTargetForRuntimeHelperObjectsTest(),
      firmwareTables: canonicalUefiAArch64FirmwareTableSurface(),
      statusPolicy: canonicalUefiAArch64StatusPolicy(),
      exitBootServicesPolicy: canonicalUefiAArch64ExitBootServicesPolicy({
        maxInvalidParameterRetries: 1,
      }),
    });

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") throw new Error("expected helper object");
    const provenanceSources = result.value.byteProvenance.map((record) => record.source);
    const firstGetMemoryMap = provenanceSources.findIndex((source) =>
      source.includes("call-get-memory-map"),
    );
    const firstExitBootServices = provenanceSources.findIndex((source) =>
      source.includes("call-exit-boot-services"),
    );
    const retryBranch = provenanceSources.findIndex(
      (source, index) =>
        index > firstExitBootServices && source.includes("branch-retry-with-fresh-map"),
    );

    expect(firstGetMemoryMap).toBeGreaterThanOrEqual(0);
    expect(firstExitBootServices).toBeGreaterThan(firstGetMemoryMap);
    expect(retryBranch).toBeGreaterThan(firstExitBootServices);
  });

  test("status conversion helper maps source boot result codes through the closed status table", () => {
    const result = materializeUefiAArch64StatusFromBootResultHelper({
      backendTarget: backendTargetForRuntimeHelperObjectsTest(),
      statusPolicy: canonicalUefiAArch64StatusPolicy(),
    });

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") throw new Error("expected helper object");
    expect(objectDefinesLinkageName(result.value, "__wrela_uefi_status_from_boot_result")).toBe(
      true,
    );
    expect(verifyAArch64ObjectModule({ objectModule: result.value }).kind).toBe("ok");
    expect(objectInstructionOpcodes(result.value, "uefi.status.from-boot-result")).toEqual(
      expect.arrayContaining(["cmp", "b-cond", "movz", "movk", "ret"]),
    );
    expect(result.value.byteProvenance.map((record) => record.source)).toEqual(
      expect.arrayContaining([
        expect.stringContaining("return-success"),
        expect.stringContaining("return-securityViolation"),
        expect.stringContaining("return-aborted"),
      ]),
    );
  });

  test("materializes all runtime helper link modules required by entry thunk", () => {
    const result = materializeUefiAArch64RuntimeHelperObjects({
      backendTarget: backendTargetForRuntimeHelperObjectsTest(),
      firmwareTables: canonicalUefiAArch64FirmwareTableSurface(),
      statusPolicy: canonicalUefiAArch64StatusPolicy(),
      watchdogPolicy: { kind: "disable-before-source" },
      exitBootServicesPolicy: canonicalUefiAArch64ExitBootServicesPolicy(),
    });

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") throw new Error("expected helper modules");
    expect(result.value.modules.map((module) => module.moduleKey)).toEqual([
      "uefi-runtime-helper:entry-initialize-context",
      "uefi-runtime-helper:exit-boot-services-with-fresh-map",
      "uefi-runtime-helper:status-from-boot-result",
    ]);
  });

  test("reports deterministic primitive coverage for every emitted helper object", () => {
    const result = materializeUefiAArch64RuntimeHelperObjects({
      backendTarget: backendTargetForRuntimeHelperObjectsTest(),
      firmwareTables: canonicalUefiAArch64FirmwareTableSurface(),
      statusPolicy: canonicalUefiAArch64StatusPolicy(),
      watchdogPolicy: { kind: "disable-before-source" },
      exitBootServicesPolicy: canonicalUefiAArch64ExitBootServicesPolicy(),
    });

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") throw new Error("expected helper modules");
    expect(result.value.coverage.map((record) => record.moduleKey)).toEqual(
      result.value.modules.map((module) => module.moduleKey),
    );
    expect(result.value.coveredPrimitiveIds.map(String)).toEqual([
      "uefi.boot.exitBootServices",
      "uefi.boot.setWatchdogTimer",
      "uefi.source.exitBootServices",
    ]);
  });
});

function backendTargetForRuntimeHelperObjectsTest(): AArch64BackendTargetSurface {
  return authenticatedBackendTargetSurfaceForTest({
    registerModel: RPI5_BACKEND_CATALOGS.registerModel,
  });
}

function objectDefinesLinkageName(objectModule: AArch64ObjectModule, linkageName: string): boolean {
  return objectModule.symbols.some(
    (symbol) => symbol.kind === "global-definition" && symbol.linkageName === linkageName,
  );
}

function objectInstructionOpcodes(
  objectModule: AArch64ObjectModule,
  helperKey = "uefi.entry.initialize-context",
): readonly string[] {
  return objectInstructionSources(objectModule, helperKey).map(
    (source) => source.split(":").at(-1) ?? "",
  );
}

function objectInstructionSources(
  objectModule: AArch64ObjectModule,
  helperKey = "uefi.entry.initialize-context",
): readonly string[] {
  return objectModule.byteProvenance
    .filter((record) => record.source.startsWith(`${helperKey}:instruction:`))
    .map((record) => record.source);
}
