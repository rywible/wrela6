import { expect, test } from "bun:test";
import { SourceText } from "../../../../src/frontend";
import { coreTypeId, itemId, moduleId, typeId } from "../../../../src/semantic/ids";
import { ResolvedReferencesBuilder } from "../../../../src/semantic/names/resolution-result";
import {
  buildSurfaceReferenceLookup,
  syntaxReferenceKeyToString,
} from "../../../../src/semantic/surface/reference-lookup";

function typeReferenceFake(typeIdOrdinal: number) {
  return {
    kind: "type" as const,
    itemId: itemId(typeIdOrdinal),
    typeId: typeId(typeIdOrdinal),
  };
}

test("findOne locates a reference by module span and kind", () => {
  const source = SourceText.from("main.wr", "fn f(x: u32)\n");
  const span = source.span(8, 11);
  const key = { moduleId: moduleId(0), span, kind: "typeName", ordinal: 0 } as const;
  const builder = new ResolvedReferencesBuilder();
  builder.add(key, { kind: "builtinType", coreTypeId: coreTypeId("u32") });

  const lookup = buildSurfaceReferenceLookup(builder.build());
  const result = lookup.findOne({ moduleId: moduleId(0), span, kind: "typeName" });

  expect(result.kind).toBe("found");
  if (result.kind === "found") {
    expect(result.entry.key).toEqual(key);
  }
});

test("same module span and kind collision is ambiguous", () => {
  const source = SourceText.from("main.wr", "Recovered");
  const span = source.span(0, 9);
  const builder = new ResolvedReferencesBuilder();
  builder.add({ moduleId: moduleId(0), span, kind: "typeName", ordinal: 1 }, typeReferenceFake(1));
  builder.add({ moduleId: moduleId(0), span, kind: "typeName", ordinal: 0 }, typeReferenceFake(0));

  const lookup = buildSurfaceReferenceLookup(builder.build());
  const result = lookup.findOne({ moduleId: moduleId(0), span, kind: "typeName" });

  expect(result.kind).toBe("ambiguous");
  if (result.kind === "ambiguous") {
    expect(result.entries.map((entry) => entry.key.ordinal)).toEqual([0, 1]);
  }
});

test("syntax reference key string includes kind and ordinal", () => {
  const source = SourceText.from("main.wr", "u32");
  const key = {
    moduleId: moduleId(0),
    span: source.span(0, 3),
    kind: "typeName",
    ordinal: 2,
  } as const;

  expect(syntaxReferenceKeyToString(key)).toBe("0:0:3:typeName:2");
});

test("missing lookup returns missing", () => {
  const source = SourceText.from("main.wr", "abc");
  const span = source.span(0, 3);
  const builder = new ResolvedReferencesBuilder();
  const lookup = buildSurfaceReferenceLookup(builder.build());
  const result = lookup.findOne({ moduleId: moduleId(0), span, kind: "typeName" });
  expect(result.kind).toBe("missing");
});

test("different module IDs do not collide", () => {
  const source = SourceText.from("main.wr", "abc");
  const span = source.span(0, 3);
  const builder = new ResolvedReferencesBuilder();
  builder.add(
    { moduleId: moduleId(0), span, kind: "typeName", ordinal: 0 },
    { kind: "builtinType", coreTypeId: coreTypeId("u32") },
  );
  builder.add(
    { moduleId: moduleId(1), span, kind: "typeName", ordinal: 0 },
    { kind: "builtinType", coreTypeId: coreTypeId("bool") },
  );

  const lookup = buildSurfaceReferenceLookup(builder.build());
  const result0 = lookup.findOne({ moduleId: moduleId(0), span, kind: "typeName" });
  const result1 = lookup.findOne({ moduleId: moduleId(1), span, kind: "typeName" });

  expect(result0.kind).toBe("found");
  expect(result1.kind).toBe("found");
  if (result0.kind === "found" && result1.kind === "found") {
    expect(result0.entry.key.moduleId).toBe(moduleId(0));
    expect(result1.entry.key.moduleId).toBe(moduleId(1));
  }
});
