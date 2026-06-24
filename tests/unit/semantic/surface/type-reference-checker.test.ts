import { expect, test } from "bun:test";
import { parseAndResolveSurfaceFixture } from "../../../support/semantic/semantic-surface-fakes";
import { checkTypeReference } from "../../../../src/semantic/surface/type-reference-checker";

test("builtin type reference checks to core checked type", () => {
  const fixture = parseAndResolveSurfaceFixture([["main.wr", "fn f(x: u32)\n"]]);
  const paramRecord = fixture.index.parameters()[0]!;
  const result = checkTypeReference({
    moduleId: fixture.index.function(paramRecord.functionId)!.moduleId,
    view: paramRecord.type,
    index: fixture.index,
    referenceLookup: fixture.referenceLookup,
    coreTypes: fixture.coreTypes,
  });

  expect(result.type.kind).toBe("core");
  expect(result.diagnostics).toEqual([]);
});

test("function reference in type position follows resolved references", () => {
  const fixture = parseAndResolveSurfaceFixture([["main.wr", "fn Other()\nfn f(x: Other)\n"]]);
  const functions = fixture.index.functions();
  const fFunction = functions.find((func) => func.name === "f")!;
  const funcParams = fixture.index.parametersForFunction(fFunction.id);
  const funcParam = funcParams[0]!;

  const result = checkTypeReference({
    moduleId: fFunction.moduleId,
    view: funcParam.type,
    index: fixture.index,
    referenceLookup: fixture.referenceLookup,
    coreTypes: fixture.coreTypes,
  });

  expect(result.type.kind).toBe("error");
  const codes = result.diagnostics.map((diagnostic) => diagnostic.code);
  expect(codes).toContain("SURFACE_INVALID_TYPE_REFERENCE");
  expect(codes).not.toContain("SURFACE_NON_TYPE_REFERENCE");
});

test("missing type reference produces invalid type reference diagnostic", () => {
  const fixture = parseAndResolveSurfaceFixture([["main.wr", "fn f(x: MissingType)\n"]]);
  const paramRecord = fixture.index.parameters()[0]!;
  const result = checkTypeReference({
    moduleId: fixture.index.function(paramRecord.functionId)!.moduleId,
    view: paramRecord.type,
    index: fixture.index,
    referenceLookup: fixture.referenceLookup,
    coreTypes: fixture.coreTypes,
  });

  expect(result.type.kind).toBe("error");
  const codes = result.diagnostics.map((diagnostic) => diagnostic.code);
  expect(codes).toContain("SURFACE_INVALID_TYPE_REFERENCE");
});

test("undefined view returns error type without diagnostics", () => {
  const fixture = parseAndResolveSurfaceFixture([["main.wr", "fn f(x: u32)\n"]]);
  const result = checkTypeReference({
    moduleId: fixture.index.functions()[0]!.moduleId,
    view: undefined,
    index: fixture.index,
    referenceLookup: fixture.referenceLookup,
    coreTypes: fixture.coreTypes,
  });

  expect(result.type.kind).toBe("error");
  expect(result.diagnostics).toEqual([]);
});

test("type argument count on a generic parameter is validated", () => {
  const fixture = parseAndResolveSurfaceFixture([
    ["main.wr", "dataclass Box[T]:\n    value: T[u32]\n"],
  ]);
  const field = fixture.index.fields()[0]!;
  const item = fixture.index.item(field.ownerItemId)!;
  const result = checkTypeReference({
    moduleId: item.moduleId,
    view: field.type,
    index: fixture.index,
    referenceLookup: fixture.referenceLookup,
    coreTypes: fixture.coreTypes,
  });

  expect(result.type.kind).toBe("error");
  const codes = result.diagnostics.map((diagnostic) => diagnostic.code);
  expect(codes).toContain("SURFACE_WRONG_GENERIC_ARGUMENT_COUNT");
});

test("generic type arguments must satisfy constructor bounds", () => {
  const fixture = parseAndResolveSurfaceFixture([
    [
      "main.wr",
      "interface Reader:\n    fn read()\nclass NotReader:\nclass Box[T: Reader]:\n    value: T\nfn f(x: Box[NotReader])\n",
    ],
  ]);
  const func = fixture.index.functions().find((record) => record.name === "f")!;
  const param = fixture.index.parametersForFunction(func.id)[0]!;

  const result = checkTypeReference({
    moduleId: func.moduleId,
    view: param.type,
    index: fixture.index,
    referenceLookup: fixture.referenceLookup,
    coreTypes: fixture.coreTypes,
  });

  expect(result.type.kind).toBe("applied");
  expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
    "SURFACE_INVALID_INTERFACE_CONSTRAINT",
  );
});

test("generic type argument bound checking does not recurse through cyclic function bounds", () => {
  const fixture = parseAndResolveSurfaceFixture([
    [
      "main.wr",
      "interface Reader:\n    fn read()\nclass Box[T: Reader]:\n    value: T\nfn f[U: U](x: Box[U])\n",
    ],
  ]);
  const func = fixture.index.functions().find((record) => record.name === "f")!;
  const param = fixture.index.parametersForFunction(func.id)[0]!;

  const result = checkTypeReference({
    moduleId: func.moduleId,
    view: param.type,
    index: fixture.index,
    referenceLookup: fixture.referenceLookup,
    coreTypes: fixture.coreTypes,
  });

  expect(result.type.kind).toBe("applied");
  expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
    "SURFACE_INVALID_INTERFACE_CONSTRAINT",
  );
});
