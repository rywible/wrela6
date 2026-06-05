import { expect, test } from "bun:test";
import { checkImageDevices } from "../../../../src/semantic/surface/image-device-checker";
import {
  parseAndResolveSurfaceFixture,
  semanticTargetSurfaceFake,
  deviceSurfaceFake,
} from "../../../support/semantic/semantic-surface-fakes";
import { selectImageRoot } from "../../../../src/semantic/surface/image-root-selection";
import { uniqueEdgeRootKey } from "../../../../src/semantic/ids";

function selectedBootImage(fixture: ReturnType<typeof parseAndResolveSurfaceFixture>) {
  const result = selectImageRoot({
    index: fixture.index,
    targetSurface: fixture.targetSurface,
    imageRoot: undefined,
  });
  return result.selection!;
}

test("image device fields are checked via type references", () => {
  const fixture = parseAndResolveSurfaceFixture([
    ["main.wr", "class NetDevice:\nuefi image Boot:\n    devices:\n        net0: NetDevice\n"],
  ]);

  const selection = selectedBootImage(fixture);
  const result = checkImageDevices({
    selection,
    index: fixture.index,
    referenceLookup: fixture.referenceLookup,
    coreTypes: fixture.coreTypes,
    targetSurface: semanticTargetSurfaceFake({
      devices: [deviceSurfaceFake({ name: "NetDevice", uniqueEdgeRoots: ["net-root"] })],
    }),
    kindContext: fixture.kindContext,
  });

  expect(Array.isArray(result.devices)).toBe(true);
  expect(result.devices.length).toBe(1);
  expect(result.devices[0]!.fieldId).toBe(
    fixture.index.fieldsForItem(fixture.index.images()[0]!.itemId)[0]!.id,
  );
  expect(result.devices[0]!.uniqueEdgeRoots).toEqual([uniqueEdgeRootKey("net-root")]);
  expect(Array.isArray(result.diagnostics)).toBe(true);
});

test("duplicate unique edge root keys are rejected", () => {
  const fixture = parseAndResolveSurfaceFixture([
    [
      "main.wr",
      "class NetDevice:\nuefi image Boot:\n    devices:\n        net0: NetDevice\n        net1: NetDevice\n",
    ],
  ]);

  const selection = selectedBootImage(fixture);
  const result = checkImageDevices({
    selection,
    index: fixture.index,
    referenceLookup: fixture.referenceLookup,
    coreTypes: fixture.coreTypes,
    targetSurface: semanticTargetSurfaceFake({
      devices: [deviceSurfaceFake({ name: "NetDevice", uniqueEdgeRoots: ["net-root"] })],
    }),
    kindContext: fixture.kindContext,
  });

  const hasDuplicateRootDiagnostic = result.diagnostics.some(
    (diagnostic) => diagnostic.code === "SURFACE_DUPLICATE_UNIQUE_EDGE_ROOT",
  );
  expect(hasDuplicateRootDiagnostic).toBe(true);
  expect(result.diagnostics.length).toBeGreaterThanOrEqual(1);
});

test("target unavailable device surface produces diagnostic", () => {
  const fixture = parseAndResolveSurfaceFixture([
    ["main.wr", "uefi image Boot:\n    devices:\n        net0: MissingDevice\n"],
  ]);

  const selection = selectedBootImage(fixture);
  const result = checkImageDevices({
    selection,
    index: fixture.index,
    referenceLookup: fixture.referenceLookup,
    coreTypes: fixture.coreTypes,
    targetSurface: semanticTargetSurfaceFake({
      devices: [deviceSurfaceFake({ name: "NetDevice", uniqueEdgeRoots: [] })],
    }),
    kindContext: fixture.kindContext,
  });

  expect(result.devices.length).toBe(0);
  const hasUnavailableDiagnostic = result.diagnostics.some(
    (diagnostic) => diagnostic.code === "SURFACE_TARGET_UNAVAILABLE_IMAGE_DEVICE",
  );
  expect(hasUnavailableDiagnostic).toBe(true);
});

test("different device surface ids can conflict on same root key", () => {
  const fixture = parseAndResolveSurfaceFixture([
    [
      "main.wr",
      "class NetDeviceA:\nclass NetDeviceB:\nuefi image Boot:\n    devices:\n        net0: NetDeviceA\n        net1: NetDeviceB\n",
    ],
  ]);

  const selection = selectedBootImage(fixture);
  const result = checkImageDevices({
    selection,
    index: fixture.index,
    referenceLookup: fixture.referenceLookup,
    coreTypes: fixture.coreTypes,
    targetSurface: semanticTargetSurfaceFake({
      devices: [
        deviceSurfaceFake({ name: "NetDeviceA", uniqueEdgeRoots: ["shared-root"] }),
        deviceSurfaceFake({ name: "NetDeviceB", uniqueEdgeRoots: ["shared-root"] }),
      ],
    }),
    kindContext: fixture.kindContext,
  });

  const hasDuplicateRootDiagnostic = result.diagnostics.some(
    (diagnostic) => diagnostic.code === "SURFACE_DUPLICATE_UNIQUE_EDGE_ROOT",
  );
  expect(hasDuplicateRootDiagnostic).toBe(true);
});

test("ordinary image fields are not treated as device root bindings", () => {
  const fixture = parseAndResolveSurfaceFixture([
    ["main.wr", "uefi image Boot:\n    flag: u32\n    devices:\n        net0: u32\n"],
  ]);

  const selection = selectedBootImage(fixture);
  const result = checkImageDevices({
    selection,
    index: fixture.index,
    referenceLookup: fixture.referenceLookup,
    coreTypes: fixture.coreTypes,
    targetSurface: semanticTargetSurfaceFake({
      devices: [],
    }),
    kindContext: fixture.kindContext,
  });

  // The ordinary `flag` field is not in deviceFieldIds so it won't be checked
  // Only `net0` appears, and its type `u32` won't match any device surface
  expect(result.devices.length).toBe(0);
  expect(result.diagnostics.length).toBeGreaterThanOrEqual(1);
  expect(
    result.diagnostics.some(
      (diagnostic) => diagnostic.code === "SURFACE_TARGET_UNAVAILABLE_IMAGE_DEVICE",
    ),
  ).toBe(true);
});

test("check type reference uses SurfaceReferenceLookup not string lookup", () => {
  const fixture = parseAndResolveSurfaceFixture([
    ["main.wr", "class NetDevice:\nuefi image Boot:\n    devices:\n        net0: NetDevice\n"],
  ]);

  const selection = selectedBootImage(fixture);
  const result = checkImageDevices({
    selection,
    index: fixture.index,
    referenceLookup: fixture.referenceLookup,
    coreTypes: fixture.coreTypes,
    targetSurface: semanticTargetSurfaceFake({
      devices: [deviceSurfaceFake({ name: "NetDevice", uniqueEdgeRoots: ["net-root"] })],
    }),
    kindContext: fixture.kindContext,
  });

  expect(result.devices.length).toBe(1);
  // The type was resolved via SurfaceReferenceLookup through checkTypeReference
  expect(result.devices[0]!.type.kind).toBe("source");
  expect(result.devices[0]!.type).toHaveProperty("itemId");
  expect(result.devices[0]!.type).toHaveProperty("typeId");
});
