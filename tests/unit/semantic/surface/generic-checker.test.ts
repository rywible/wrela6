import { expect, test } from "bun:test";
import { parseAndResolveSurfaceFixture } from "../../../support/semantic/semantic-surface-fakes";
import { checkGenericSignature } from "../../../../src/semantic/surface/generic-checker";

test("duplicate generic parameter names are diagnosed", () => {
  const fixture = parseAndResolveSurfaceFixture([["main.wr", "class Box[T, T]:\n"]]);
  const item = fixture.index.items()[0]!;
  const result = checkGenericSignature({
    owner: { kind: "item", itemId: item.id },
    index: fixture.index,
    referenceLookup: fixture.referenceLookup,
    coreTypes: fixture.coreTypes,
  });

  expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
    "SURFACE_DUPLICATE_GENERIC_PARAMETER",
  );
});

test("single generic parameter produces no diagnostics", () => {
  const fixture = parseAndResolveSurfaceFixture([["main.wr", "class Box[T]:\n"]]);
  const item = fixture.index.items()[0]!;
  const result = checkGenericSignature({
    owner: { kind: "item", itemId: item.id },
    index: fixture.index,
    referenceLookup: fixture.referenceLookup,
    coreTypes: fixture.coreTypes,
  });

  expect(result.diagnostics).toEqual([]);
  expect(result.signature.parameters).toHaveLength(1);
  expect(result.signature.parameters[0]!.name).toBe("T");
});

test("generic bound checks through type references", () => {
  const fixture = parseAndResolveSurfaceFixture([
    ["main.wr", "interface Reader:\n    fn read()\nclass Box[T: Reader]\n"],
  ]);
  const item = fixture.index.items().find((record) => record.name === "Box")!;
  const result = checkGenericSignature({
    owner: { kind: "item", itemId: item.id },
    index: fixture.index,
    referenceLookup: fixture.referenceLookup,
    coreTypes: fixture.coreTypes,
  });

  expect(result.signature.parameters[0]!.bounds).toHaveLength(1);
  expect(result.diagnostics).toEqual([]);
});

test("function generic parameters are checked", () => {
  const fixture = parseAndResolveSurfaceFixture([["main.wr", "fn f[T](x: T)\n"]]);
  const func = fixture.index.functions()[0]!;
  const result = checkGenericSignature({
    owner: { kind: "function", itemId: func.itemId, functionId: func.id },
    index: fixture.index,
    referenceLookup: fixture.referenceLookup,
    coreTypes: fixture.coreTypes,
  });

  expect(result.signature.parameters).toHaveLength(1);
  expect(result.diagnostics).toEqual([]);
});
