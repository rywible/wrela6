import { describe, expect, test } from "bun:test";
import { SourceSpan } from "../../../src/shared/source-span";
import { HirLocalScope } from "../../../src/hir/local-scope";
import { hirLocalId, hirOriginId, ownedId } from "../../../src/hir/ids";
import { coreTypeId, functionId, itemId, parameterId } from "../../../src/semantic/ids";
import type { CheckedFunctionSignature } from "../../../src/semantic/surface/checked-program";
import { concreteKind } from "../../../src/semantic/surface/resource-kind";
import { coreCheckedType } from "../../../src/semantic/surface/type-model";

const type = coreCheckedType(coreTypeId("u32"));
const resourceKind = concreteKind("Copy");
const owner = { kind: "function" as const, functionId: functionId(1) };

function signature(): CheckedFunctionSignature {
  return {
    functionId: functionId(1),
    itemId: itemId(1),
    receiver: {
      parameterId: parameterId(0),
      ownerItemId: itemId(7),
      type,
      resourceKind,
      mode: "consume",
    },
    parameters: [
      {
        parameterId: parameterId(1),
        name: "value",
        type,
        mode: "observe",
        resourceKind,
        sourceSpan: SourceSpan.from(10, 15),
      },
      {
        parameterId: parameterId(2),
        name: "other",
        type,
        mode: "consume",
        resourceKind,
        sourceSpan: SourceSpan.from(16, 21),
      },
    ],
    returnType: type,
    returnKind: resourceKind,
    modifiers: {
      isPlatform: false,
      isTerminal: false,
      isPredicate: false,
      isConstructor: false,
      isPrivate: false,
    },
    sourceSpan: SourceSpan.from(0, 30),
  };
}

describe("HirLocalScope", () => {
  test("seeds receiver and parameters in checked signature order", () => {
    const scope = HirLocalScope.fromSignature({
      owner,
      signature: signature(),
      originForParameter: (parameter) => hirOriginId((parameter.parameterId as number) + 1),
    });

    expect(scope.locals().map((local) => [local.name, local.parameterId])).toEqual([
      ["self", parameterId(0)],
      ["value", parameterId(1)],
      ["other", parameterId(2)],
    ]);
    expect(scope.lookup("value")?.parameterId).toBe(parameterId(1));
  });

  test("duplicate source locals create an error local without shadowing the original", () => {
    const scope = HirLocalScope.empty(owner);
    const first = scope.addSourceLocal({
      name: "value",
      type,
      resourceKind,
      sourceOrigin: hirOriginId(1),
      introducedBy: "sourceLet",
    });
    const second = scope.addSourceLocal({
      name: "value",
      type,
      resourceKind,
      sourceOrigin: hirOriginId(2),
      introducedBy: "takeAlias",
    });

    expect(first.diagnostics).toEqual([]);
    expect(second.local.mode).toBe("error");
    expect(second.local.introducedBy).toBe("recovery");
    expect(second.diagnostics.map((diagnostic) => String(diagnostic.code))).toEqual([
      "HIR_LOCAL_NAME_SHADOWS",
    ]);
    expect(scope.lookup("value")).toBe(first.local);
    expect(scope.lookupBinding(hirOriginId(2))).toBe(second.local);
  });

  test("duplicate signature parameters record HIR_LOCAL_NAME_SHADOWS", () => {
    const duplicateSignature = signature();
    const scope = HirLocalScope.fromSignature({
      owner,
      signature: {
        ...duplicateSignature,
        parameters: [
          duplicateSignature.parameters[0]!,
          { ...duplicateSignature.parameters[1]!, name: "value" },
        ],
      },
      originForParameter: (parameter) => hirOriginId((parameter.parameterId as number) + 1),
    });

    expect(scope.locals().map((local) => [local.name, local.mode])).toEqual([
      ["self", "receiver"],
      ["value", "parameter"],
      ["value", "error"],
    ]);
    expect(scope.diagnostics().map((diagnostic) => String(diagnostic.code))).toEqual([
      "HIR_LOCAL_NAME_SHADOWS",
    ]);
  });

  test("compiler temporaries use unique local ids and do not bind source names", () => {
    const scope = HirLocalScope.empty(owner);
    const first = scope.addTemporary({
      name: "tmp",
      type,
      resourceKind,
      sourceOrigin: hirOriginId(1),
    });
    const second = scope.addTemporary({
      name: "tmp",
      type,
      resourceKind,
      sourceOrigin: hirOriginId(2),
    });

    expect(first.local.localId).not.toBe(second.local.localId);
    expect(first.diagnostics).toEqual([]);
    expect(second.diagnostics).toEqual([]);
    expect(scope.lookup("tmp")).toBeUndefined();
  });

  test("owner-scoped helper accepts generic owned ids without using object identity", () => {
    const scope = HirLocalScope.empty(owner);
    const local = scope.addSourceLocal({
      name: "value",
      type,
      resourceKind,
      sourceOrigin: hirOriginId(1),
      introducedBy: "sourceLet",
    }).local;

    expect(local.localId).toBe(hirLocalId(0));
    expect(
      ownedId({ kind: "function", functionId: functionId(1) }, local.localId, "local").id,
    ).toBe(local.localId);
  });
});
