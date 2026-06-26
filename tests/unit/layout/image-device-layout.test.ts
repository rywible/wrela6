import { describe, expect, test } from "bun:test";
import { computeImageDeviceFacts } from "../../../src/layout/image-device-layout";
import { layoutDiagnosticCode } from "../../../src/layout/diagnostics";
import { layoutImageDeviceKeyString } from "../../../src/layout/type-key";
import { monoInstanceId } from "../../../src/mono/ids";
import { deviceSurfaceId, fieldId, targetTypeId } from "../../../src/semantic/ids";
import {
  imageDeviceLayoutFixture,
  normalizeTargetFactsForTest,
} from "../../support/layout/layout-fixtures";
import {
  layoutDeviceSurfaceCatalogFake,
  layoutTargetSurfaceFake,
} from "../../support/layout/layout-fakes";
import { buildLayoutTypeResolver } from "../../../src/layout/layout-type-resolver";
import { seedPrimitiveTypeFacts } from "../../../src/layout/primitive-layout";

describe("computeImageDeviceFacts", () => {
  test("image device fact records zero-sized capability representation", () => {
    const fixture = imageDeviceLayoutFixture({
      representation: { kind: "zeroSizedCapability" },
    });
    const result = computeImageDeviceFacts(fixture);

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.value.devices.entries()[0]?.representation).toEqual({
      kind: "zeroSizedCapability",
    });
    expect(result.value.devices.entries()[0]?.brandIds).toEqual(
      fixture.program.image.devices[0]?.brandIds,
    );
  });

  test("image device facts preserve proof brand ids for zero-sized capabilities", () => {
    const fixture = imageDeviceLayoutFixture({
      representation: { kind: "zeroSizedCapability" },
    });
    const result = computeImageDeviceFacts(fixture);

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.value.devices.entries()[0]?.brandIds.length).toBeGreaterThan(0);
  });

  test("missing target device surface emits deterministic diagnostic", () => {
    const fixture = imageDeviceLayoutFixture();
    const device = fixture.program.image.devices[0]!;

    const result = computeImageDeviceFacts({
      program: fixture.program,
      target: layoutTargetSurfaceFake({
        deviceSurfaces: layoutDeviceSurfaceCatalogFake([]),
      }),
    });

    expect(result.kind).toBe("error");
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      layoutDiagnosticCode("LAYOUT_MISSING_DEVICE_SURFACE"),
    );
    expect(result.diagnostics[0]?.ownerKey).toBe(
      `image-device:${String(fixture.program.image.instanceId)}:${String(device.fieldId)}`,
    );
    expect(result.diagnostics[0]?.rootCauseKey).toBe(
      `device-surface:${String(device.deviceSurfaceId)}`,
    );
    expect(result.diagnostics[0]?.stableDetail).toBe(
      `${String(fixture.target.targetId)}:${String(device.deviceSurfaceId)}`,
    );
  });

  test("target-handle device capability references target primitive layout", () => {
    const fixture = imageDeviceLayoutFixture({
      representation: { kind: "targetHandle", targetTypeId: targetTypeId("Ptr") },
    });
    const result = computeImageDeviceFacts(fixture);

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    const fact = result.value.devices.entries()[0];
    expect(fact?.representation).toEqual({
      kind: "targetHandle",
      type: { kind: "target", targetTypeId: targetTypeId("Ptr") },
      layout: expect.objectContaining({
        key: { kind: "target", targetTypeId: targetTypeId("Ptr") },
        sizeBytes: 8n,
        alignmentBytes: 8n,
      }),
    });
  });

  test("image device facts sort by image instance id and field id", () => {
    const fixture = imageDeviceLayoutFixture({
      representation: { kind: "zeroSizedCapability" },
    });
    const result = computeImageDeviceFacts(fixture);

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    const keys = result.value.devices.entries().map((entry) => entry.key);
    const sortedKeys = [...keys].sort((left, right) =>
      layoutImageDeviceKeyString(left).localeCompare(layoutImageDeviceKeyString(right)),
    );
    expect(keys).toEqual(sortedKeys);
    expect(keys[0]?.imageInstanceId).toEqual(fixture.program.image.instanceId);
    expect(keys[0]?.fieldId).toEqual(fieldId(0));
  });

  test("every mono image device receives a layout image device fact", () => {
    const fixture = imageDeviceLayoutFixture({
      representation: { kind: "zeroSizedCapability" },
    });
    const result = computeImageDeviceFacts(fixture);

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.value.devices.entries()).toHaveLength(fixture.program.image.devices.length);
    for (const device of fixture.program.image.devices) {
      expect(
        result.value.devices.get({
          imageInstanceId: fixture.program.image.instanceId,
          fieldId: device.fieldId,
        }),
      ).toBeDefined();
    }
  });

  test("image device fact records resolved source device type", () => {
    const fixture = imageDeviceLayoutFixture({
      representation: { kind: "zeroSizedCapability" },
    });
    const result = computeImageDeviceFacts(fixture);

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.value.devices.entries()[0]?.deviceType).toEqual({
      kind: "source",
      instanceId: monoInstanceId("type:0|args:<>"),
    });
  });

  test("image device facts can use an injected layout type resolver", () => {
    const fixture = imageDeviceLayoutFixture({
      representation: { kind: "zeroSizedCapability" },
    });
    const targetFacts = normalizeTargetFactsForTest(fixture.target);
    const primitiveFacts = seedPrimitiveTypeFacts(fixture.target);
    expect(primitiveFacts.kind).toBe("ok");
    if (primitiveFacts.kind !== "ok") return;

    const resolverResult = buildLayoutTypeResolver({
      program: fixture.program,
      targetFacts,
      primitiveTypes: primitiveFacts.value.types,
    });
    expect(resolverResult.kind).toBe("ok");
    if (resolverResult.kind !== "ok") return;

    const result = computeImageDeviceFacts({
      ...fixture,
      types: primitiveFacts.value.types,
      resolver: resolverResult.value.resolver,
    });

    expect(result.kind).toBe("ok");
  });

  test("configured device surface uses explicit device surface catalog entry", () => {
    const fixture = imageDeviceLayoutFixture();
    const device = fixture.program.image.devices[0]!;
    const result = computeImageDeviceFacts({
      program: fixture.program,
      target: layoutTargetSurfaceFake({
        deviceSurfaces: layoutDeviceSurfaceCatalogFake([
          {
            deviceSurfaceId: device.deviceSurfaceId,
            representation: { kind: "zeroSizedCapability" },
          },
        ]),
      }),
    });

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.value.devices.entries()[0]?.deviceSurfaceId).toBe(deviceSurfaceId("serial"));
  });
});
