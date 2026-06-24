import { expect, test } from "bun:test";
import { parseAndResolveSurfaceFixture } from "../../../support/semantic/semantic-surface-fakes";
import {
  checkFunctionSignature,
  checkAllFunctionSignatures,
  checkedFunctionSignatureFingerprint,
  targetSignatureExactlyMatches,
} from "../../../../src/semantic/surface/signature-checker";
import { coreCheckedType } from "../../../../src/semantic/surface/type-model";
import { concreteKind } from "../../../../src/semantic/surface/resource-kind";
import type { TargetFunctionSignature } from "../../../../src/semantic/surface/platform-surface";

test("consumed parameter becomes consume mode", () => {
  const fixture = parseAndResolveSurfaceFixture([
    ["main.wr", "fn foo(consume packet: u32) -> u32\n"],
  ]);
  const func = fixture.index.functions()[0]!;
  const result = checkFunctionSignature({
    functionRecord: func,
    index: fixture.index,
    referenceLookup: fixture.referenceLookup,
    coreTypes: fixture.coreTypes,
    kindContext: fixture.kindContext,
  });

  expect(result.signature.parameters[0]!.mode).toBe("consume");
  expect(result.diagnostics).toEqual([]);
});

test("observe parameter mode for non-consumed parameters", () => {
  const fixture = parseAndResolveSurfaceFixture([["main.wr", "fn bar(x: u32) -> u32\n"]]);
  const func = fixture.index.functions()[0]!;
  const result = checkFunctionSignature({
    functionRecord: func,
    index: fixture.index,
    referenceLookup: fixture.referenceLookup,
    coreTypes: fixture.coreTypes,
    kindContext: fixture.kindContext,
  });

  expect(result.signature.parameters[0]!.mode).toBe("observe");
});

test("terminal predicate combination is rejected", () => {
  const fixture = parseAndResolveSurfaceFixture([
    ["main.wr", "terminal predicate fn bad() -> bool\n"],
  ]);
  const func = fixture.index.functions()[0]!;
  const result = checkFunctionSignature({
    functionRecord: func,
    index: fixture.index,
    referenceLookup: fixture.referenceLookup,
    coreTypes: fixture.coreTypes,
    kindContext: fixture.kindContext,
  });

  expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
    "SURFACE_ILLEGAL_FUNCTION_MODIFIERS",
  );
});

test("basic function signature returns correct structure", () => {
  const fixture = parseAndResolveSurfaceFixture([["main.wr", "fn hello(x: u32) -> u32\n"]]);
  const func = fixture.index.functions()[0]!;
  const result = checkFunctionSignature({
    functionRecord: func,
    index: fixture.index,
    referenceLookup: fixture.referenceLookup,
    coreTypes: fixture.coreTypes,
    kindContext: fixture.kindContext,
  });

  expect(result.signature.functionId).toBe(func.id);
  expect(result.signature.itemId).toBe(func.itemId);
  expect(result.signature.parameters).toHaveLength(1);
  expect(result.signature.modifiers.isPlatform).toBe(false);
  expect(result.signature.modifiers.isTerminal).toBe(false);
  expect(result.signature.modifiers.isPredicate).toBe(false);
  expect(result.signature.modifiers.isConstructor).toBe(false);
  expect(result.signature.modifiers.isPrivate).toBe(false);
});

test("platform and constructor are rejected together", () => {
  const fixture = parseAndResolveSurfaceFixture([["main.wr", "platform constructor fn bad()\n"]]);
  const func = fixture.index.functions()[0]!;
  const result = checkFunctionSignature({
    functionRecord: func,
    index: fixture.index,
    referenceLookup: fixture.referenceLookup,
    coreTypes: fixture.coreTypes,
    kindContext: fixture.kindContext,
  });

  expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
    "SURFACE_ILLEGAL_FUNCTION_MODIFIERS",
  );
});

test("checkAllFunctionSignatures returns all signatures", () => {
  const fixture = parseAndResolveSurfaceFixture([["main.wr", "fn a()\nfn b()\n"]]);
  const result = checkAllFunctionSignatures({
    index: fixture.index,
    referenceLookup: fixture.referenceLookup,
    coreTypes: fixture.coreTypes,
    kindContext: fixture.kindContext,
  });

  expect(result.signatures.entries()).toHaveLength(2);
});

test("checkedFunctionSignatureFingerprint is deterministic", () => {
  const fixture = parseAndResolveSurfaceFixture([["main.wr", "fn f(x: u32) -> bool\n"]]);
  const func = fixture.index.functions()[0]!;
  const result = checkFunctionSignature({
    functionRecord: func,
    index: fixture.index,
    referenceLookup: fixture.referenceLookup,
    coreTypes: fixture.coreTypes,
    kindContext: fixture.kindContext,
  });

  const fp1 = checkedFunctionSignatureFingerprint(result.signature);
  const fp2 = checkedFunctionSignatureFingerprint(result.signature);
  expect(fp1).toBe(fp2);
  expect(typeof fp1).toBe("string");
  expect(fp1).toContain("params:1");
  expect(fp1).toContain("mode:observe");
});

test("targetSignatureExactlyMatches returns false for undefined source", () => {
  const target: TargetFunctionSignature = {
    genericArity: 0,
    receiver: undefined,
    parameters: [],
    returnType: coreCheckedType("Never" as any),
    returnKind: concreteKind("Never"),
    requiredModifiers: [],
    forbiddenModifiers: [],
  };

  expect(targetSignatureExactlyMatches(undefined, target)).toBe(false);
});

test("targetSignatureExactlyMatches matches identical signatures", () => {
  const fixture = parseAndResolveSurfaceFixture([["main.wr", "fn f(x: u32) -> bool\n"]]);
  const func = fixture.index.functions()[0]!;
  const result = checkFunctionSignature({
    functionRecord: func,
    index: fixture.index,
    referenceLookup: fixture.referenceLookup,
    coreTypes: fixture.coreTypes,
    kindContext: fixture.kindContext,
  });

  const target: TargetFunctionSignature = {
    genericArity: 0,
    receiver: undefined,
    parameters: [
      {
        type: result.signature.parameters[0]!.type,
        mode: "observe",
        resourceKind: result.signature.parameters[0]!.resourceKind,
      },
    ],
    returnType: result.signature.returnType,
    returnKind: result.signature.returnKind,
    requiredModifiers: [],
    forbiddenModifiers: [],
  };

  expect(targetSignatureExactlyMatches(result.signature, target)).toBe(true);
});

test("targetSignatureExactlyMatches honors forbidden modifiers", () => {
  const fixture = parseAndResolveSurfaceFixture([["main.wr", "fn f() -> Never\n"]]);
  const func = fixture.index.functions()[0]!;
  const result = checkFunctionSignature({
    functionRecord: func,
    index: fixture.index,
    referenceLookup: fixture.referenceLookup,
    coreTypes: fixture.coreTypes,
    kindContext: fixture.kindContext,
  });

  const target: TargetFunctionSignature = {
    genericArity: 0,
    receiver: undefined,
    parameters: [],
    returnType: result.signature.returnType,
    returnKind: result.signature.returnKind,
    requiredModifiers: [],
    forbiddenModifiers: ["private"],
  };

  expect(targetSignatureExactlyMatches(result.signature, target)).toBe(true);
});

test("ordinary function with no return type reports invalid return type", () => {
  const fixture = parseAndResolveSurfaceFixture([["main.wr", "fn nothing()\n"]]);
  const func = fixture.index.functions()[0]!;
  const result = checkFunctionSignature({
    functionRecord: func,
    index: fixture.index,
    referenceLookup: fixture.referenceLookup,
    coreTypes: fixture.coreTypes,
    kindContext: fixture.kindContext,
  });

  expect(result.signature.returnType.kind).toBe("core");
  expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
    "SURFACE_INVALID_RETURN_TYPE",
  );
});

test("terminal function with no return type defaults to core Never", () => {
  const fixture = parseAndResolveSurfaceFixture([["main.wr", "terminal fn nothing()\n"]]);
  const func = fixture.index.functions()[0]!;
  const result = checkFunctionSignature({
    functionRecord: func,
    index: fixture.index,
    referenceLookup: fixture.referenceLookup,
    coreTypes: fixture.coreTypes,
    kindContext: fixture.kindContext,
  });

  expect(result.signature.returnType.kind).toBe("core");
  expect(result.diagnostics.map((diagnostic) => diagnostic.code)).not.toContain(
    "SURFACE_INVALID_RETURN_TYPE",
  );
});

test("ownerItemId is set when function has parentItemId", () => {
  const fixture = parseAndResolveSurfaceFixture([["main.wr", "class Foo:\n  fn method(s)\n"]]);
  const methods = fixture.index.functions().filter((func) => func.parentItemId !== undefined);
  if (methods.length > 0) {
    const method = methods[0]!;
    expect(method.parentItemId).toBeDefined();
    const result = checkFunctionSignature({
      functionRecord: method,
      index: fixture.index,
      referenceLookup: fixture.referenceLookup,
      coreTypes: fixture.coreTypes,
      kindContext: fixture.kindContext,
    });
    expect(result.signature.ownerItemId).toBe(method.parentItemId);
  }
});

test("unannotated method self receives the owner source type", () => {
  const fixture = parseAndResolveSurfaceFixture([["main.wr", "class Foo:\n    fn method(self)\n"]]);
  const method = fixture.index.functions().find((func) => func.parentItemId !== undefined)!;
  const owner = fixture.index.item(method.parentItemId!)!;
  if (owner.typeId === undefined) throw new Error("expected method owner to have a type id");
  const result = checkFunctionSignature({
    functionRecord: method,
    index: fixture.index,
    referenceLookup: fixture.referenceLookup,
    coreTypes: fixture.coreTypes,
    kindContext: fixture.kindContext,
  });

  expect(result.signature.receiver?.type).toEqual({
    kind: "source",
    itemId: owner.id,
    typeId: owner.typeId,
  });
});

test("function without parameters has empty parameters list", () => {
  const fixture = parseAndResolveSurfaceFixture([["main.wr", "fn empty()\n"]]);
  const func = fixture.index.functions()[0]!;
  const result = checkFunctionSignature({
    functionRecord: func,
    index: fixture.index,
    referenceLookup: fixture.referenceLookup,
    coreTypes: fixture.coreTypes,
    kindContext: fixture.kindContext,
  });

  expect(result.signature.parameters).toHaveLength(0);
});
