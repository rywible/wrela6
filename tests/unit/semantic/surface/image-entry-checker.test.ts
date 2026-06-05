import { expect, test } from "bun:test";
import { checkImageEntry } from "../../../../src/semantic/surface/image-entry-checker";
import {
  parseAndResolveSurfaceFixture,
  semanticTargetSurfaceFake,
  uefiImageProfileFake,
} from "../../../support/semantic/semantic-surface-fakes";
import { selectImageRoot } from "../../../../src/semantic/surface/image-root-selection";
import { SourceSpan } from "../../../../src/frontend";
import { coreTypeId } from "../../../../src/semantic/ids";

test("entry function is discovered by profile entry function name", () => {
  const fixture = parseAndResolveSurfaceFixture([
    ["main.wr", "uefi image Boot:\n    fn entry() -> Never\n"],
  ]);

  const targetSurface = semanticTargetSurfaceFake({
    profiles: [uefiImageProfileFake({ entryFunctionName: "entry" })],
  });

  const rootResult = selectImageRoot({
    index: fixture.index,
    targetSurface,
    imageRoot: undefined,
  });
  const selection = rootResult.selection!;

  const result = checkImageEntry({
    selection,
    index: fixture.index,
    signatures: {
      get: () => ({
        functionId: 0 as any,
        itemId: 0 as any,
        parameters: [],
        returnType: { kind: "core", coreTypeId: coreTypeId("Never") },
        returnKind: { kind: "concrete", value: "Never" },
        modifiers: {
          isPlatform: false,
          isTerminal: false,
          isPredicate: false,
          isConstructor: false,
          isPrivate: false,
        },
        sourceSpan: SourceSpan.from(0, 0),
      }),
      entries: () => [],
    },
  });

  expect(result.entryFunctionId).toBe(fixture.index.functions()[0]!.id);
  expect(result.diagnostics).toEqual([]);
});

test("missing entry function produces SURFACE_INVALID_IMAGE_ENTRY_SHAPE", () => {
  const fixture = parseAndResolveSurfaceFixture([["main.wr", "uefi image Boot:\n"]]);

  const rootResult = selectImageRoot({
    index: fixture.index,
    targetSurface: fixture.targetSurface,
    imageRoot: undefined,
  });
  const selection = rootResult.selection!;

  const result = checkImageEntry({
    selection,
    index: fixture.index,
    signatures: {
      get: () => undefined,
      entries: () => [],
    },
  });

  expect(result.entryFunctionId).toBeUndefined();
  expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
    "SURFACE_INVALID_IMAGE_ENTRY_SHAPE",
  );
});

test("entry function with no checked signature produces SURFACE_INVALID_IMAGE_ENTRY_SIGNATURE", () => {
  const fixture = parseAndResolveSurfaceFixture([
    ["main.wr", "uefi image Boot:\n    fn entry() -> Never\n"],
  ]);

  const targetSurface = semanticTargetSurfaceFake({
    profiles: [uefiImageProfileFake({ entryFunctionName: "entry" })],
  });

  const rootResult = selectImageRoot({
    index: fixture.index,
    targetSurface,
    imageRoot: undefined,
  });
  const selection = rootResult.selection!;

  const result = checkImageEntry({
    selection,
    index: fixture.index,
    signatures: {
      get: () => undefined,
      entries: () => [],
    },
  });

  expect(result.entryFunctionId).toBe(fixture.index.functions()[0]!.id);
  expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
    "SURFACE_INVALID_IMAGE_ENTRY_SIGNATURE",
  );
});

test("entry function with mismatched signature produces SURFACE_INVALID_IMAGE_ENTRY_SIGNATURE", () => {
  const fixture = parseAndResolveSurfaceFixture([
    ["main.wr", "uefi image Boot:\n    fn entry() -> Never\n"],
  ]);

  const targetSurface = semanticTargetSurfaceFake({
    profiles: [uefiImageProfileFake({ entryFunctionName: "entry" })],
  });

  const rootResult = selectImageRoot({
    index: fixture.index,
    targetSurface,
    imageRoot: undefined,
  });
  const selection = rootResult.selection!;

  const result = checkImageEntry({
    selection,
    index: fixture.index,
    signatures: {
      get: () => ({
        functionId: 0 as any,
        itemId: 0 as any,
        parameters: [
          {
            parameterId: 0 as any,
            name: "x",
            type: { kind: "core", coreTypeId: coreTypeId("u32") },
            mode: "observe" as const,
            resourceKind: { kind: "concrete", value: "Copy" },
            sourceSpan: SourceSpan.from(0, 0),
          },
        ],
        returnType: { kind: "core", coreTypeId: coreTypeId("u32") },
        returnKind: { kind: "concrete", value: "Copy" },
        modifiers: {
          isPlatform: false,
          isTerminal: false,
          isPredicate: false,
          isConstructor: false,
          isPrivate: false,
        },
        sourceSpan: SourceSpan.from(0, 0),
      }),
      entries: () => [],
    },
  });

  expect(result.entryFunctionId).toBe(fixture.index.functions()[0]!.id);
  expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
    "SURFACE_INVALID_IMAGE_ENTRY_SIGNATURE",
  );
});

test("success when entry function matches default main entry name", () => {
  const fixture = parseAndResolveSurfaceFixture([
    ["main.wr", "uefi image Boot:\n    fn main() -> Never\n"],
  ]);

  const rootResult = selectImageRoot({
    index: fixture.index,
    targetSurface: fixture.targetSurface,
    imageRoot: undefined,
  });
  const selection = rootResult.selection!;

  const result = checkImageEntry({
    selection,
    index: fixture.index,
    signatures: {
      get: () => ({
        functionId: 0 as any,
        itemId: 0 as any,
        parameters: [],
        returnType: { kind: "core", coreTypeId: coreTypeId("Never") },
        returnKind: { kind: "concrete", value: "Never" },
        modifiers: {
          isPlatform: false,
          isTerminal: false,
          isPredicate: false,
          isConstructor: false,
          isPrivate: false,
        },
        sourceSpan: SourceSpan.from(0, 0),
      }),
      entries: () => [],
    },
  });

  expect(result.entryFunctionId).toBe(fixture.index.functions()[0]!.id);
  expect(result.diagnostics).toEqual([]);
});
