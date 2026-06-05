import { expect, test } from "bun:test";
import { imageId } from "../../../../src/semantic/ids";
import { selectImageRoot } from "../../../../src/semantic/surface/image-root-selection";
import {
  parseAndResolveSurfaceFixture,
  semanticTargetSurfaceFake,
} from "../../../support/semantic/semantic-surface-fakes";

test("single image is selected when no explicit root is provided", () => {
  const fixture = parseAndResolveSurfaceFixture([["main.wr", "uefi image Boot:\n"]]);
  const result = selectImageRoot({
    index: fixture.index,
    targetSurface: fixture.targetSurface,
    imageRoot: undefined,
  });

  expect(result.selection?.imageId).toBe(fixture.index.images()[0]!.id);
  expect(result.diagnostics).toEqual([]);
});

test("multiple images require explicit selection", () => {
  const fixture = parseAndResolveSurfaceFixture([["main.wr", "uefi image A:\nuefi image B:\n"]]);
  const result = selectImageRoot({
    index: fixture.index,
    targetSurface: fixture.targetSurface,
    imageRoot: undefined,
  });

  expect(result.selection).toBeUndefined();
  expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
    "SURFACE_AMBIGUOUS_IMAGE_ROOT",
  );
});

test("no images produces missing image root", () => {
  const fixture = parseAndResolveSurfaceFixture([["main.wr", "fn main()\n"]]);
  const result = selectImageRoot({
    index: fixture.index,
    targetSurface: fixture.targetSurface,
    imageRoot: undefined,
  });

  expect(result.selection).toBeUndefined();
  expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
    "SURFACE_MISSING_IMAGE_ROOT",
  );
});

test("byImageId selection resolves correctly", () => {
  const fixture = parseAndResolveSurfaceFixture([["main.wr", "uefi image Boot:\n"]]);
  const imgId = fixture.index.images()[0]!.id;

  const result = selectImageRoot({
    index: fixture.index,
    targetSurface: fixture.targetSurface,
    imageRoot: { kind: "byImageId", imageId: imgId },
  });

  expect(result.selection?.imageId).toBe(imgId);
  expect(result.diagnostics).toEqual([]);
});

test("byQualifiedName selection resolves correctly", () => {
  const fixture = parseAndResolveSurfaceFixture([["main.wr", "uefi image Boot:\n"]]);
  const imgId = fixture.index.images()[0]!.id;

  const result = selectImageRoot({
    index: fixture.index,
    targetSurface: fixture.targetSurface,
    imageRoot: { kind: "byQualifiedName", modulePath: "main.wr", imageName: "Boot" },
  });

  expect(result.selection?.imageId).toBe(imgId);
  expect(result.diagnostics).toEqual([]);
});

test("explicit selection of non-existent image produces diagnostic", () => {
  const fixture = parseAndResolveSurfaceFixture([["main.wr", "uefi image Boot:\n"]]);

  const result = selectImageRoot({
    index: fixture.index,
    targetSurface: fixture.targetSurface,
    imageRoot: { kind: "byImageId", imageId: imageId(999) },
  });

  expect(result.selection).toBeUndefined();
  expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
    "SURFACE_INVALID_IMAGE_ROOT_SELECTION",
  );
});

test("byQualifiedName with wrong module path fails", () => {
  const fixture = parseAndResolveSurfaceFixture([["main.wr", "uefi image Boot:\n"]]);

  const result = selectImageRoot({
    index: fixture.index,
    targetSurface: fixture.targetSurface,
    imageRoot: { kind: "byQualifiedName", modulePath: "wrong.wr", imageName: "Boot" },
  });

  expect(result.selection).toBeUndefined();
  expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
    "SURFACE_INVALID_IMAGE_ROOT_SELECTION",
  );
});

test("byQualifiedName with wrong image name fails", () => {
  const fixture = parseAndResolveSurfaceFixture([["main.wr", "uefi image Boot:\n"]]);

  const result = selectImageRoot({
    index: fixture.index,
    targetSurface: fixture.targetSurface,
    imageRoot: { kind: "byQualifiedName", modulePath: "main.wr", imageName: "WrongName" },
  });

  expect(result.selection).toBeUndefined();
  expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
    "SURFACE_INVALID_IMAGE_ROOT_SELECTION",
  );
});

test("selection maps to uefi profile", () => {
  const fixture = parseAndResolveSurfaceFixture([["main.wr", "uefi image Boot:\n"]]);

  const result = selectImageRoot({
    index: fixture.index,
    targetSurface: semanticTargetSurfaceFake(),
    imageRoot: undefined,
  });

  expect(result.selection?.profile.declarationKind).toBe("uefi");
  expect(result.selection?.profileId).toBe(result.selection!.profile.profileId);
});

test("CheckedImageRootSelection includes availability context", () => {
  const fixture = parseAndResolveSurfaceFixture([["main.wr", "uefi image Boot:\n"]]);

  const result = selectImageRoot({
    index: fixture.index,
    targetSurface: fixture.targetSurface,
    imageRoot: undefined,
  });

  expect(result.selection?.availability.targetId).toBe(fixture.targetSurface.targetId);
  expect(result.selection?.availability.profileId).toBe(result.selection!.profileId);
  expect(result.selection?.availability.features).toEqual([]);
  expect(result.selection?.image).toBe(fixture.index.images()[0]);
  expect(result.selection?.profile).toBe(fixture.targetSurface.imageProfiles[0]);
});
