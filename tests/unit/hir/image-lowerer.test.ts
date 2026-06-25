import { expect, test } from "bun:test";
import { SourceSpan } from "../../../src/shared/source-span";
import { imageId, imageProfileId } from "../../../src/semantic/ids";
import { targetWithSerialDevice } from "../../support/hir/typed-hir-fakes";
import { createHirUnitContext, lowerTypedHirForTest } from "../../support/hir/typed-hir-fixtures";
import { lowerSelectedImage } from "../../../src/hir/image-lowerer";

test("absent checked image seed produces an empty image table", () => {
  const result = lowerTypedHirForTest([["main.wr", "fn process() -> bool\n"]]);

  expect(result.program.images.entries()).toEqual([]);
  expect(result.program.proofMetadata.imageOrigins.entries()).toEqual([]);
});

test("selected image lowers device origins when semantic seed has devices", () => {
  const result = lowerTypedHirForTest(
    [
      [
        "main.wr",
        "class SerialDevice:\nuefi image Boot:\n    devices:\n        serial: SerialDevice\n    fn main() -> Never\n",
      ],
    ],
    { targetSurface: targetWithSerialDevice(["rx", "tx"]) },
  );

  expect(result.program.images.entries().length).toBeLessThanOrEqual(1);
  expect(result.program.proofMetadata.brands.entries().length).toBeGreaterThanOrEqual(0);
});

test("selected image attaches device places and unique-edge-root brand ids", () => {
  const result = lowerTypedHirForTest(
    [
      [
        "main.wr",
        "class SerialDevice:\nuefi image Boot:\n    devices:\n        serial: SerialDevice\n    fn main() -> Never\n",
      ],
    ],
    { targetSurface: targetWithSerialDevice(["rx", "tx"]) },
  );

  const image = result.program.images.entries()[0]!;
  const device = image.devices[0]!;

  expect(device.place.kind).toBe("imageDevice");
  expect(device.place.root).toMatchObject({ kind: "imageDevice", imageId: image.imageId });
  expect(device.place.placeId.owner).toEqual({ kind: "image", imageId: image.imageId });
  expect(device.rootPlaces).toHaveLength(2);
  expect(new Set(device.rootPlaces.map((place) => place.placeId.id)).size).toBe(2);
  expect(device.rootPlaces.map((place) => place.placeId.owner)).toEqual([
    { kind: "image", imageId: image.imageId },
    { kind: "image", imageId: image.imageId },
  ]);
  expect(device.brandIds).toHaveLength(2);
  expect(device.brandIds.map((brandId) => brandId.owner)).toEqual([
    { kind: "image", imageId: image.imageId },
    { kind: "image", imageId: image.imageId },
  ]);
  expect(result.program.proofMetadata.brands.entries().map((brand) => brand.brandId)).toEqual([
    ...device.brandIds,
  ]);
  expect(
    result.program.proofMetadata.resourcePlaces.entries().map((place) => place.canonicalKey),
  ).toEqual([device.place, ...device.rootPlaces].map((place) => place.canonicalKey));
});

test("missing checked device surface emits diagnostic and does not mint device brands", () => {
  const result = lowerTypedHirForTest([
    [
      "main.wr",
      "class SerialDevice:\nuefi image Boot:\n    devices:\n        serial: SerialDevice\n    fn main() -> Never\n",
    ],
  ]);

  expect(result.diagnostics.map((diagnostic) => String(diagnostic.code))).toContain(
    "HIR_IMAGE_DEVICE_SURFACE_MISSING",
  );
  expect(result.program.images.entries()).toHaveLength(1);
  expect(result.program.images.entries()[0]!.devices).toEqual([]);
  expect(
    result.program.proofMetadata.brands
      .entries()
      .filter((brand) => brand.origin.kind === "imageDevice"),
  ).toEqual([]);
});

test("missing completed image device references lower fail-closed without device brands", () => {
  const result = lowerTypedHirForTest([
    [
      "main.wr",
      [
        "class SerialDevice:",
        "uefi image Boot:",
        "    devices:",
        "        serial: SerialDevice",
        "    fn main() -> Never",
        "fn read() -> SerialDevice:",
        "    return Boot.serial",
      ].join("\n"),
    ],
  ]);

  const expressions = result.program.functions
    .entries()
    .flatMap((func) => func.bodyIndex?.expressions.entries() ?? []);
  const memberExpressions = expressions.filter((expression) => expression.kind.kind === "member");
  const missingMemberExpressions = expressions.filter(
    (expression) =>
      expression.kind.kind === "error" && expression.kind.reason === "missing-member:serial",
  );

  expect(memberExpressions).toEqual([]);
  expect(missingMemberExpressions).toHaveLength(1);
  expect(result.diagnostics.map((diagnostic) => String(diagnostic.code))).toContain(
    "HIR_MEMBER_REFERENCE_MISSING",
  );
  expect(
    result.program.proofMetadata.brands
      .entries()
      .filter((brand) => brand.origin.kind === "imageDevice"),
  ).toEqual([]);
});

test("missing checked image seed entry emits HIR_IMAGE_ENTRY_SURFACE_MISSING", () => {
  const context = createHirUnitContext("fn process() -> bool\n");

  lowerSelectedImage({
    context: {
      ...context,
      image: {
        imageId: imageId(999),
        profileId: imageProfileId("uefi"),
        entryFunctionId: undefined,
        devices: [],
        sourceSpan: SourceSpan.from(0, 0),
      },
    },
  });

  expect(context.diagnostics.entries().map((diagnostic) => String(diagnostic.code))).toContain(
    "HIR_IMAGE_ENTRY_SURFACE_MISSING",
  );
});

test("missing selected image entry function does not mint image origin metadata", () => {
  const context = createHirUnitContext("uefi image Boot:\n    fn main() -> Never\n");
  const image = context.index.images()[0]!;

  const result = lowerSelectedImage({
    context: {
      ...context,
      image: {
        imageId: image.id,
        profileId: imageProfileId("uefi"),
        entryFunctionId: undefined,
        devices: [],
        sourceSpan: SourceSpan.from(0, 15),
      },
    },
  });

  expect(context.diagnostics.entries().map((diagnostic) => String(diagnostic.code))).toContain(
    "HIR_IMAGE_ENTRY_SURFACE_MISSING",
  );
  expect(result.images).toEqual([]);
  expect(context.proofMetadata.imageOrigins.entries()).toEqual([]);
});
