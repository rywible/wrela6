import { describe, expect, test } from "bun:test";

import {
  authenticateUefiAArch64TargetDriverSurface,
  authenticateUefiAArch64PlatformLowerings,
  canonicalUefiAArch64FirmwareTableSurface,
  canonicalUefiAArch64PlatformLowerings,
  canonicalUefiAArch64SemanticTargetSurface,
  fingerprintUefiPlatformPrimitiveSpec,
  fingerprintUefiSemanticPlatformCatalog,
  FULL_IMAGE_VALIDATION_FEATURE,
  productionUefiAArch64LayoutTargetSurface,
  UEFI_AARCH64_UTF16_STATIC_INTRINSIC,
  uefiAArch64PlatformPrimitiveNameCatalog,
} from "../../../../src/target/uefi-aarch64";
import { deviceSurfaceId, targetTypeId } from "../../../../src/semantic/ids";
import { semanticTargetSurface } from "../../../../src/semantic/surface/platform-surface";
import { semanticTargetSurfaceWithUefiPrimitives } from "../../../support/semantic/semantic-surface-fakes";
import { uefiTargetSurfaceFixture } from "../../../support/target/uefi-aarch64/uefi-aarch64-fixtures";

describe("UEFI platform primitive lowering payloads", () => {
  test("exports the UEFI primitive source-name catalog", () => {
    const catalog = uefiAArch64PlatformPrimitiveNameCatalog();

    expect(FULL_IMAGE_VALIDATION_FEATURE).toBe("full-image-validation-fixture");
    expect(
      catalog.primitives.map((primitive) => [primitive.name, String(primitive.primitiveId)]),
    ).toEqual([
      ["exit_boot_services_with_fresh_map", "uefi.boot.exitBootServices"],
      ["output_string", "uefi.console.outputString"],
      ["set_watchdog_timer", "uefi.boot.setWatchdogTimer"],
      ["uefi_bind_virtio_net", "uefi.source.bindVirtioNet"],
      ["uefi_discover_virtio", "uefi.source.discoverVirtio"],
      ["uefi_exit_boot_services", "uefi.source.exitBootServices"],
      ["uefi_plan_machine", "uefi.source.planMachine"],
      ["uefi_reserve_restricted_memory", "uefi.source.reserveRestrictedMemory"],
      ["uefi_split_network_device", "uefi.source.splitNetworkDevice"],
      ["validation_fixture_packet_source", "uefi.validation.fixturePacketSource"],
      ["validation_fixture_packet_stream", "uefi.validation.fixturePacketStream"],
    ]);
    expect(String(catalog.byName("output_string")?.primitiveId)).toBe("uefi.console.outputString");
  });

  test("exports the UEFI utf16_static compiler intrinsic catalog entry", () => {
    expect(UEFI_AARCH64_UTF16_STATIC_INTRINSIC).toEqual({
      sourceName: "utf16_static",
      intrinsicKey: "uefi.utf16_static",
      parameterShape: ["string-literal"],
      returnTargetType: "uefi.Utf16Static",
    });
    expect(Object.isFrozen(UEFI_AARCH64_UTF16_STATIC_INTRINSIC)).toBe(true);
    expect(Object.isFrozen(UEFI_AARCH64_UTF16_STATIC_INTRINSIC.parameterShape)).toBe(true);
  });

  test("authenticates v1 lowerings against canonical semantic primitives", () => {
    const semanticTarget = canonicalUefiAArch64SemanticTargetSurface();
    const result = authenticateUefiAArch64PlatformLowerings({
      semanticTarget,
      semanticPlatformCatalogFingerprint: fingerprintUefiSemanticPlatformCatalog(semanticTarget),
      firmwareTables: canonicalUefiAArch64FirmwareTableSurface(),
      lowerings: canonicalUefiAArch64PlatformLowerings(),
    });

    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.value.map((lowering) => String(lowering.primitiveId))).toEqual([
        "uefi.boot.allocatePool",
        "uefi.boot.exit",
        "uefi.boot.exitBootServices",
        "uefi.boot.freePool",
        "uefi.boot.getMemoryMap",
        "uefi.boot.setWatchdogTimer",
        "uefi.boot.stall",
        "uefi.console.outputString",
        "uefi.protocol.locate",
        "uefi.source.bindVirtioNet",
        "uefi.source.discoverVirtio",
        "uefi.source.exitBootServices",
        "uefi.source.planMachine",
        "uefi.source.reserveRestrictedMemory",
        "uefi.source.splitNetworkDevice",
        "uefi.validation.fixturePacketSource",
        "uefi.validation.fixturePacketStream",
      ]);
    }
  });

  test("canonical semantic target gates the validation fixture primitives behind their feature", () => {
    const semanticTarget = canonicalUefiAArch64SemanticTargetSurface();
    const sourcePrimitive = semanticTarget.platformPrimitives.get(
      "uefi.validation.fixturePacketSource" as never,
    );
    const streamPrimitive = semanticTarget.platformPrimitives.get(
      "uefi.validation.fixturePacketStream" as never,
    );

    expect(sourcePrimitive).toBeDefined();
    expect(sourcePrimitive?.availability.features).toEqual([FULL_IMAGE_VALIDATION_FEATURE]);
    expect(streamPrimitive).toBeDefined();
    expect(streamPrimitive?.availability.features).toEqual([FULL_IMAGE_VALIDATION_FEATURE]);
  });

  test("catalogs validation fixture packet sources as compiler-owned inline primitives", () => {
    for (const primitiveId of [
      "uefi.validation.fixturePacketSource",
      "uefi.validation.fixturePacketStream",
    ]) {
      const lowering = canonicalUefiAArch64PlatformLowerings().find(
        (candidate) => String(candidate.primitiveId) === primitiveId,
      );

      expect(lowering?.lowering).toEqual({
        kind: "inline",
        operationKey: "validation-fixture-packet-source",
      });
    }
  });

  test("catalogs source-level UEFI bringup primitives as private target status edges", () => {
    const semanticTarget = canonicalUefiAArch64SemanticTargetSurface();
    const primitive = semanticTarget.platformPrimitives.get(
      "uefi.source.reserveRestrictedMemory" as never,
    );
    const lowering = canonicalUefiAArch64PlatformLowerings().find(
      (candidate) => String(candidate.primitiveId) === "uefi.source.reserveRestrictedMemory",
    );
    const exitLowering = canonicalUefiAArch64PlatformLowerings().find(
      (candidate) => String(candidate.primitiveId) === "uefi.source.exitBootServices",
    );

    expect(primitive?.signature.requiredModifiers).toEqual(["private", "platform"]);
    expect(lowering?.lowering).toEqual({
      kind: "constant-status",
      operationKey: "uefi-source-reserve-restricted-memory",
      value: 0n,
    });
    expect(exitLowering?.lowering).toMatchObject({
      kind: "compiler-runtime-helper",
      helperLinkageName: "__wrela_uefi_exit_boot_services_with_fresh_map",
      result: { kind: "efi-status" },
    });
  });

  test("layout target exposes source-visible network device as a zero-sized capability", () => {
    const target = authenticateUefiAArch64TargetDriverSurface(uefiTargetSurfaceFixture());
    expect(target.kind).toBe("ok");
    if (target.kind !== "ok") return;
    const layoutTarget = productionUefiAArch64LayoutTargetSurface(target.value);

    expect(layoutTarget.deviceSurfaces.get(deviceSurfaceId("uefi.net0"))).toEqual({
      deviceSurfaceId: deviceSurfaceId("uefi.net0"),
      representation: { kind: "zeroSizedCapability" },
      sourceOrigin: "uefi-aarch64:source-api:NetworkDevice",
    });
  });

  test("canonical console primitive carries the stdlib wrapper signature shape", () => {
    const semanticTarget = canonicalUefiAArch64SemanticTargetSurface();
    const primitive = semanticTarget.platformPrimitives.get("uefi.console.outputString" as never);

    expect(primitive?.signature.parameters).toHaveLength(1);
    expect(primitive?.signature.parameters[0]?.type).toEqual({
      kind: "target",
      targetTypeId: targetTypeId("uefi.Utf16Static"),
    });
    expect(primitive?.signature.returnType).toEqual({
      kind: "target",
      targetTypeId: targetTypeId("uefi.Status"),
    });
    expect(primitive?.signature.requiredModifiers).toEqual(["platform"]);
  });

  test("catalogs exitBootServices as the fresh-map compiler-runtime helper", () => {
    const lowering = canonicalUefiAArch64PlatformLowerings().find(
      (candidate) => String(candidate.primitiveId) === "uefi.boot.exitBootServices",
    );

    expect(lowering?.lowering.kind).toBe("compiler-runtime-helper");
  });

  test("canonical console lowering requires a materialized static CHAR16 pointer", () => {
    const lowering = canonicalUefiAArch64PlatformLowerings().find(
      (candidate) => String(candidate.primitiveId) === "uefi.console.outputString",
    );
    const firstArgument =
      lowering?.lowering.kind === "firmware-call"
        ? (lowering.lowering.arguments[0] as unknown)
        : undefined;

    expect(firstArgument).toEqual({
      kind: "source-argument",
      index: 0,
      pointerRequirement: {
        kind: "static-char16-pointer",
        lifetime: "image-readonly",
        nulTerminated: true,
      },
    });
  });

  test("rejects lowerings without a semantic primitive source record", () => {
    const semanticTarget = semanticTargetSurfaceWithUefiPrimitives({ primitives: [] });
    const result = authenticateUefiAArch64PlatformLowerings({
      semanticTarget,
      semanticPlatformCatalogFingerprint: fingerprintUefiSemanticPlatformCatalog(semanticTarget),
      firmwareTables: canonicalUefiAArch64FirmwareTableSurface(),
      lowerings: canonicalUefiAArch64PlatformLowerings(),
    });

    expect(result.kind).toBe("error");
    expect(
      result.diagnostics.some((diagnostic) =>
        diagnostic.stableDetail.startsWith("platform-lowering:missing-semantic-primitive:"),
      ),
    ).toBe(true);
  });

  test("rejects stale primitive fingerprints", () => {
    const semanticTarget = canonicalUefiAArch64SemanticTargetSurface();
    const lowerings = canonicalUefiAArch64PlatformLowerings();
    const first = lowerings[0]!;
    const rest = lowerings.slice(1);
    const result = authenticateUefiAArch64PlatformLowerings({
      semanticTarget,
      semanticPlatformCatalogFingerprint: fingerprintUefiSemanticPlatformCatalog(semanticTarget),
      firmwareTables: canonicalUefiAArch64FirmwareTableSurface(),
      lowerings: [{ ...first, semanticPrimitiveFingerprint: "stale" }, ...rest],
    });

    expect(result.kind).toBe("error");
    expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toContain(
      `platform-lowering:stale-semantic-fingerprint:${String(first.primitiveId)}`,
    );
  });

  test("rejects duplicate primitive IDs", () => {
    const semanticTarget = canonicalUefiAArch64SemanticTargetSurface();
    const lowerings = canonicalUefiAArch64PlatformLowerings();
    const first = lowerings[0]!;
    const rest = lowerings.slice(1);
    const result = authenticateUefiAArch64PlatformLowerings({
      semanticTarget,
      semanticPlatformCatalogFingerprint: fingerprintUefiSemanticPlatformCatalog(semanticTarget),
      firmwareTables: canonicalUefiAArch64FirmwareTableSurface(),
      lowerings: [first, first, ...rest],
    });

    expect(result.kind).toBe("error");
    expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toContain(
      `platform-lowering:duplicate-primitive:${String(first.primitiveId)}`,
    );
  });

  test("rejects firmware-call lowerings whose table path is absent", () => {
    const semanticTarget = canonicalUefiAArch64SemanticTargetSurface();
    const lowerings = canonicalUefiAArch64PlatformLowerings();
    const first = lowerings[0]!;
    const rest = lowerings.slice(1);
    const result = authenticateUefiAArch64PlatformLowerings({
      semanticTarget,
      semanticPlatformCatalogFingerprint: fingerprintUefiSemanticPlatformCatalog(semanticTarget),
      firmwareTables: canonicalUefiAArch64FirmwareTableSurface(),
      lowerings: [
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

    expect(result.kind).toBe("error");
    expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toContain(
      `platform-lowering:unknown-table-path:${String(first.primitiveId)}`,
    );
  });

  test("derives fingerprints from semantic records and catalog contents", () => {
    const semanticTarget = canonicalUefiAArch64SemanticTargetSurface();
    const primitive = semanticTarget.platformPrimitives.get("uefi.console.outputString" as never);
    expect(primitive).toBeDefined();
    if (primitive === undefined) return;

    const primitiveFingerprint = fingerprintUefiPlatformPrimitiveSpec(primitive);
    expect(primitiveFingerprint).toStartWith("uefi-platform-primitive:");
    expect(
      canonicalUefiAArch64PlatformLowerings().find(
        (lowering) => String(lowering.primitiveId) === "uefi.console.outputString",
      )?.semanticPrimitiveFingerprint,
    ).toBe(primitiveFingerprint);
    expect(fingerprintUefiSemanticPlatformCatalog(semanticTarget)).toStartWith(
      "uefi-semantic-platform-catalog:",
    );
  });

  test("semantic platform catalog fingerprints do not depend on primitive entry order", () => {
    const semanticTarget = canonicalUefiAArch64SemanticTargetSurface();
    const reversedSurface = semanticTargetSurface({
      targetId: semanticTarget.targetId,
      platformPrimitives: {
        get: (primitiveId) => semanticTarget.platformPrimitives.get(primitiveId),
        entries: () => [...semanticTarget.platformPrimitives.entries()].reverse(),
      },
      imageProfiles: semanticTarget.imageProfiles,
      deviceSurfaces: semanticTarget.deviceSurfaces,
      targetTypeKinds: semanticTarget.targetTypeKinds,
    });

    expect(fingerprintUefiSemanticPlatformCatalog(reversedSurface)).toBe(
      fingerprintUefiSemanticPlatformCatalog(semanticTarget),
    );
  });

  test("rejects stale semantic platform catalog fingerprints", () => {
    const semanticTarget = canonicalUefiAArch64SemanticTargetSurface();
    const result = authenticateUefiAArch64PlatformLowerings({
      semanticTarget,
      semanticPlatformCatalogFingerprint: "stale",
      firmwareTables: canonicalUefiAArch64FirmwareTableSurface(),
      lowerings: canonicalUefiAArch64PlatformLowerings(),
    });

    expect(result.kind).toBe("error");
    expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toContain(
      "platform-catalog:stale-semantic-platform-fingerprint",
    );
  });
});
