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

test("function reference in type position is unresolved and produces invalid type reference", () => {
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
