import { describe, expect, test } from "bun:test";

import {
  authenticateUefiAArch64TargetDriverSurface,
  fingerprintUefiAArch64FirmwareAbi,
  fingerprintUefiAArch64FirmwareTables,
  canonicalUefiAArch64TargetDriverSurfaceInput,
  fingerprintTargetDriverSurface,
  type UefiAArch64PlatformPrimitiveLowering,
} from "../../../../src/target/uefi-aarch64";
import { proofMirRuntimeOperationId } from "../../../../src/runtime/runtime-catalog";
import { uefiTargetSurfaceFixture } from "../../../support/target/uefi-aarch64/uefi-aarch64-fixtures";

describe("UEFI AArch64 target-driver surface", () => {
  test("authenticates the canonical production surface", () => {
    const result = authenticateUefiAArch64TargetDriverSurface(uefiTargetSurfaceFixture());

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.value.targetKey).toBe("wrela-uefi-aarch64-rpi5-v1");
    expect(result.value.targetDriverFingerprint).toStartWith("uefi-aarch64-target-driver:");
  });

  test("accepts only the v1 RPi5 target key", () => {
    const input = uefiTargetSurfaceFixture({ targetKey: "other-target" as never });
    const result = authenticateUefiAArch64TargetDriverSurface(input);

    expect(result.kind).toBe("error");
    expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toContain(
      "target-driver-surface:unsupported-target-key:other-target",
    );
  });

  test("rejects duplicate entry symbols", () => {
    const fixture = uefiTargetSurfaceFixture();
    const input = canonicalUefiAArch64TargetDriverSurfaceInput({
      ...fixture,
      entryProfile: {
        ...fixture.entryProfile,
        imageEntryShimSymbol: "wrela.image.boot" as never,
      },
    });

    const result = authenticateUefiAArch64TargetDriverSurface(input);
    expect(result.kind).toBe("error");
    expect(
      result.diagnostics.some((diagnostic) =>
        diagnostic.stableDetail.includes("entry-contract:duplicate-symbol"),
      ),
    ).toBe(true);
  });

  test("rejects a firmware lowering that points at an absent table path", () => {
    const fixture = uefiTargetSurfaceFixture();
    const [first, ...rest] = fixture.platformLowerings;
    if (first === undefined) throw new Error("expected platform lowering");
    const input = uefiTargetSurfaceFixture({
      platformLowerings: [
        {
          ...first,
          lowering: {
            kind: "firmware-call",
            tablePath: { kind: "boot-services", field: "missing-service" as never },
            arguments: [],
            result: { kind: "efi-status" },
          },
        },
        ...rest,
      ],
    });

    const result = authenticateUefiAArch64TargetDriverSurface(input);
    expect(result.kind).toBe("error");
    expect(
      result.diagnostics.some((diagnostic) =>
        diagnostic.stableDetail.includes("platform-lowering:unknown-table-path"),
      ),
    ).toBe(true);
  });

  test("shuffled platform lowerings and runtime materializations keep the same fingerprint", () => {
    const fixture = uefiTargetSurfaceFixture();
    const shuffled = uefiTargetSurfaceFixture({
      platformLowerings: [...fixture.platformLowerings].reverse(),
      runtimeMaterializations: [...fixture.runtimeMaterializations].reverse(),
    });

    const first = authenticateUefiAArch64TargetDriverSurface(fixture);
    const second = authenticateUefiAArch64TargetDriverSurface(shuffled);

    expect(first.kind).toBe("ok");
    expect(second.kind).toBe("ok");
    if (first.kind !== "ok" || second.kind !== "ok") return;
    expect(second.value.platformLowerings.map((lowering) => String(lowering.primitiveId))).toEqual(
      first.value.platformLowerings.map((lowering) => String(lowering.primitiveId)),
    );
    expect(
      second.value.runtimeMaterializations.map((materialization) =>
        String(materialization.runtimeId),
      ),
    ).toEqual(
      first.value.runtimeMaterializations.map((materialization) =>
        String(materialization.runtimeId),
      ),
    );
    expect(second.value.targetDriverFingerprint).toBe(first.value.targetDriverFingerprint);
  });

  test("changing a component fingerprint changes the target-driver fingerprint", () => {
    const fixture = uefiTargetSurfaceFixture();
    const changed = uefiTargetSurfaceFixture({
      componentFingerprints: {
        ...fixture.componentFingerprints,
        semanticPrimitives: [
          {
            ...fixture.componentFingerprints.semanticPrimitives[0]!,
            fingerprint: "semantic-primitive:changed",
          },
          ...fixture.componentFingerprints.semanticPrimitives.slice(1),
        ],
      },
    });

    expect(fingerprintTargetDriverSurface(changed)).not.toBe(
      fingerprintTargetDriverSurface(fixture),
    );
  });

  test("rejects stale component target-surface fingerprints during target-driver authentication", () => {
    const result = authenticateUefiAArch64TargetDriverSurface(
      uefiTargetSurfaceFixture({
        aarch64TargetFingerprint: "aarch64-target:stale",
        backendTargetFingerprint: "aarch64-backend:stale",
        linkerTargetFingerprint: "aarch64-linker:stale",
        peCoffWriterTargetFingerprint: "pe-coff:stale",
      }),
    );

    expect(result.kind).toBe("error");
    expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toEqual(
      expect.arrayContaining([
        "target-driver-surface:stale-aarch64-target-fingerprint",
        "target-driver-surface:stale-backend-target-fingerprint",
        "target-driver-surface:stale-linker-target-fingerprint",
        "target-driver-surface:stale-pe-coff-writer-target-fingerprint",
      ]),
    );
  });

  test("rejects duplicate primitive IDs and duplicate runtime IDs", () => {
    const fixture = uefiTargetSurfaceFixture();
    const result = authenticateUefiAArch64TargetDriverSurface(
      uefiTargetSurfaceFixture({
        platformLowerings: [fixture.platformLowerings[0]!, ...fixture.platformLowerings],
        runtimeMaterializations: [
          fixture.runtimeMaterializations[0]!,
          ...fixture.runtimeMaterializations,
        ],
      }),
    );

    expect(result.kind).toBe("error");
    expect(
      result.diagnostics.some((diagnostic) =>
        diagnostic.stableDetail.startsWith("platform-lowering:duplicate-primitive:"),
      ),
    ).toBe(true);
    expect(
      result.diagnostics.some((diagnostic) =>
        diagnostic.stableDetail.startsWith("runtime-materialization:duplicate-runtime-id:"),
      ),
    ).toBe(true);
  });

  test("rejects compiler-runtime platform lowerings without matching runtime materializations", () => {
    const fixture = uefiTargetSurfaceFixture();
    const result = authenticateUefiAArch64TargetDriverSurface(
      uefiTargetSurfaceFixture({
        platformLowerings: platformLoweringsWithExitBootServicesHelper(fixture.platformLowerings, {
          runtimeId: proofMirRuntimeOperationId(999999),
          helperLinkageName: "__wrela_missing_helper",
        }),
      }),
    );

    expect(result.kind).toBe("error");
    expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toContain(
      "target-driver-surface:missing-runtime-helper-materialization:uefi.boot.exitBootServices:999999",
    );
  });

  test("rejects compiler-runtime platform lowerings with mismatched helper linkage", () => {
    const fixture = uefiTargetSurfaceFixture();
    const result = authenticateUefiAArch64TargetDriverSurface(
      uefiTargetSurfaceFixture({
        platformLowerings: platformLoweringsWithExitBootServicesHelper(fixture.platformLowerings, {
          runtimeId: proofMirRuntimeOperationId(1006),
          helperLinkageName: "__wrela_wrong_helper",
        }),
      }),
    );

    expect(result.kind).toBe("error");
    expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toContain(
      "target-driver-surface:runtime-helper-linkage-mismatch:uefi.boot.exitBootServices:1006:expected:__wrela_uefi_exit_boot_services_with_fresh_map:actual:__wrela_wrong_helper",
    );
  });

  test("rejects surfaces missing runtime materializations for emitted helper objects", () => {
    const fixture = uefiTargetSurfaceFixture();
    const result = authenticateUefiAArch64TargetDriverSurface(
      uefiTargetSurfaceFixture({
        runtimeMaterializations: fixture.runtimeMaterializations.filter(
          (materialization) =>
            String(materialization.runtimeId) !== "1000" &&
            String(materialization.runtimeId) !== "1002",
        ),
      }),
    );

    expect(result.kind).toBe("error");
    expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toEqual(
      expect.arrayContaining([
        "runtime-materialization:missing-required-runtime-id:1000",
        "runtime-materialization:missing-required-runtime-id:1002",
      ]),
    );
  });

  test("rejects a missing component fingerprint", () => {
    const fixture = uefiTargetSurfaceFixture();
    const result = authenticateUefiAArch64TargetDriverSurface(
      uefiTargetSurfaceFixture({
        componentFingerprints: {
          ...fixture.componentFingerprints,
          runtimeOperations: fixture.componentFingerprints.runtimeOperations.slice(1),
        },
      }),
    );

    expect(result.kind).toBe("error");
    expect(
      result.diagnostics.some((diagnostic) =>
        diagnostic.stableDetail.startsWith("target-driver-surface:missing-component-fingerprint:"),
      ),
    ).toBe(true);
  });

  test("rejects a missing firmware-call component fingerprint", () => {
    const fixture = uefiTargetSurfaceFixture();
    const result = authenticateUefiAArch64TargetDriverSurface(
      uefiTargetSurfaceFixture({
        componentFingerprints: {
          ...fixture.componentFingerprints,
          firmwareCalls: [],
        },
      }),
    );

    expect(result.kind).toBe("error");
    expect(
      result.diagnostics.some((diagnostic) =>
        diagnostic.stableDetail.startsWith(
          "target-driver-surface:missing-component-fingerprint:firmware-call:",
        ),
      ),
    ).toBe(true);
  });

  test("rejects firmware tables whose TCB offsets changed even with recomputed fingerprint", () => {
    const fixture = uefiTargetSurfaceFixture();
    const firmwareTables = {
      records: fixture.firmwareTables.records.map((record) =>
        record.tableKey === "boot-services" && record.fieldKey === "set-watchdog-timer"
          ? { ...record, offsetBytes: 0 }
          : record,
      ),
    };
    const result = authenticateUefiAArch64TargetDriverSurface(
      uefiTargetSurfaceFixture({
        firmwareTables,
        firmwareTablesFingerprint: fingerprintUefiAArch64FirmwareTables(firmwareTables),
      }),
    );

    expect(result.kind).toBe("error");
    expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toContain(
      "firmware-tables:canonical-mismatch:boot-services:set-watchdog-timer",
    );
  });

  test("rejects firmware ABI fingerprints that are not bound to authenticated target surfaces", () => {
    const fixture = uefiTargetSurfaceFixture();
    const changedBackendAbi = {
      ...fixture.firmwareAbi,
      backendAbiSurfaceFingerprint: "backend-abi:bogus",
    };
    const changedRegistersAbi = {
      ...fixture.firmwareAbi,
      physicalRegisterModelFingerprint: "physical-registers:bogus",
    };
    const changedBackendResult = authenticateUefiAArch64TargetDriverSurface(
      uefiTargetSurfaceFixture({
        firmwareAbi: changedBackendAbi,
        firmwareAbiFingerprint: fingerprintUefiAArch64FirmwareAbi(changedBackendAbi),
      }),
    );
    const changedRegistersResult = authenticateUefiAArch64TargetDriverSurface(
      uefiTargetSurfaceFixture({
        firmwareAbi: changedRegistersAbi,
        firmwareAbiFingerprint: fingerprintUefiAArch64FirmwareAbi(changedRegistersAbi),
      }),
    );

    expect(changedBackendResult.kind).toBe("error");
    expect(changedRegistersResult.kind).toBe("error");
    expect(changedBackendResult.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toContain(
      "firmware-abi:backend-abi-fingerprint",
    );
    expect(
      changedRegistersResult.diagnostics.map((diagnostic) => diagnostic.stableDetail),
    ).toContain("firmware-abi:physical-register-model-fingerprint");
  });

  test("rejects platform lowerings without the semantic target catalog", () => {
    const { semanticTarget: _semanticTarget, ...input } = uefiTargetSurfaceFixture();
    const result = authenticateUefiAArch64TargetDriverSurface(input);

    expect(result.kind).toBe("error");
    expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toContain(
      "target-driver-surface:missing-semantic-target",
    );
  });

  test("rejects runtime materializations without the Proof MIR runtime catalog", () => {
    const { proofMirRuntimeCatalog: _runtimeCatalog, ...input } = uefiTargetSurfaceFixture();
    const result = authenticateUefiAArch64TargetDriverSurface(input);

    expect(result.kind).toBe("error");
    expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toContain(
      "target-driver-surface:missing-runtime-catalog",
    );
  });

  test("uses the canonical Task 9 watchdog policy vocabulary", () => {
    const result = authenticateUefiAArch64TargetDriverSurface(
      uefiTargetSurfaceFixture({
        watchdogPolicy: { kind: "leave-firmware-default" as never },
      }),
    );

    expect(result.kind).toBe("error");
    expect(result.kind === "error" ? result.diagnostics[0]?.stableDetail : undefined).toBe(
      "target-driver-surface:unsupported-watchdog-policy:leave-firmware-default",
    );
  });
});

function platformLoweringsWithExitBootServicesHelper(
  lowerings: readonly UefiAArch64PlatformPrimitiveLowering[],
  helper: {
    readonly runtimeId: ReturnType<typeof proofMirRuntimeOperationId>;
    readonly helperLinkageName: string;
  },
): readonly UefiAArch64PlatformPrimitiveLowering[] {
  return lowerings.map((lowering) =>
    String(lowering.primitiveId) === "uefi.boot.exitBootServices"
      ? {
          ...lowering,
          lowering: {
            kind: "compiler-runtime-helper" as const,
            runtimeId: helper.runtimeId,
            helperLinkageName: helper.helperLinkageName,
            arguments: Object.freeze([
              { kind: "image-handle" as const },
              { kind: "system-table" as const },
            ]),
            result: Object.freeze({ kind: "efi-status" as const }),
          },
        }
      : lowering,
  );
}
