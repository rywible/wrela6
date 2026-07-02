import { describe, expect, test } from "bun:test";

import {
  authenticateUefiAArch64PlatformLowerings,
  canonicalUefiAArch64FirmwareTableSurface,
  canonicalUefiAArch64PlatformLowerings,
  canonicalUefiAArch64SemanticTargetSurface,
  fingerprintUefiPlatformPrimitiveSpec,
  fingerprintUefiSemanticPlatformCatalog,
} from "../../../../src/target/uefi-aarch64";
import { targetTypeId } from "../../../../src/semantic/ids";
import { semanticTargetSurface } from "../../../../src/semantic/surface/platform-surface";
import { semanticTargetSurfaceWithUefiPrimitives } from "../../../support/semantic/semantic-surface-fakes";

describe("UEFI platform primitive lowering payloads", () => {
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
      ]);
    }
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
