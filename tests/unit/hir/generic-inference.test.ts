import { expect, test } from "bun:test";
import { SourceSpan } from "../../../src/shared/source-span";
import { inferCallTypeArguments } from "../../../src/hir/generic-inference";
import { substituteCheckedSignature } from "../../../src/hir/generic-substitution";
import { checkedFunctionSignatureFake } from "../../support/hir/typed-hir-fakes";
import { concreteKind } from "../../../src/semantic/surface/resource-kind";
import { coreTypeId, functionId } from "../../../src/semantic/ids";
import {
  appliedType,
  checkedTypeFingerprint,
  coreCheckedType,
  genericParameterCheckedType,
} from "../../../src/semantic/surface/type-model";
import type { CheckedFunctionSignature } from "../../../src/semantic/surface/checked-program";

function genericSignature(): CheckedFunctionSignature {
  const genericKey = {
    owner: { kind: "function" as const, itemId: 0 as any, functionId: functionId(1) },
    index: 0,
  };
  const genericType = genericParameterCheckedType(genericKey);
  return {
    ...checkedFunctionSignatureFake({ functionId: functionId(1), returnType: genericType }),
    genericSignature: {
      owner: { kind: "function", itemId: 0 as any, functionId: functionId(1) },
      parameters: [
        {
          key: genericKey,
          name: "T",
          bounds: [],
          span: SourceSpan.from(0, 1),
        },
      ],
    },
    parameters: [
      {
        parameterId: 0 as any,
        name: "value",
        type: genericType,
        mode: "observe",
        resourceKind: concreteKind("Copy"),
        sourceSpan: SourceSpan.from(0, 1),
      },
    ],
  };
}

test("generic inference uses explicit type arguments", () => {
  const result = inferCallTypeArguments({
    signature: genericSignature(),
    explicitTypeArguments: [coreCheckedType(coreTypeId("u32"))],
    arguments: [],
    sourceSpan: SourceSpan.from(0, 1),
  });

  expect(result.typeArguments.map(checkedTypeFingerprint)).toEqual(["core:u32"]);
  expect(result.diagnostics).toEqual([]);
});

test("explicit type arguments on non-generic calls report wrong arity", () => {
  const result = inferCallTypeArguments({
    signature: checkedFunctionSignatureFake({ functionId: functionId(1) }),
    explicitTypeArguments: [coreCheckedType(coreTypeId("u32"))],
    arguments: [],
    sourceSpan: SourceSpan.from(0, 1),
  });

  expect(result.diagnostics.map((diagnostic) => String(diagnostic.code))).toContain(
    "HIR_WRONG_GENERIC_ARGUMENT_COUNT",
  );
});

test("substitution returns the original signature when no generic arguments are needed", () => {
  const signature = checkedFunctionSignatureFake();
  expect(substituteCheckedSignature({ signature, typeArguments: [] }).returnType).toEqual(
    signature.returnType,
  );
});

test("generic inference recurses into nested parameter types", () => {
  const signature = genericSignature();
  const nestedFormal = appliedType({
    constructor: { kind: "core", coreTypeId: coreTypeId("Box") },
    arguments: [signature.parameters[0]!.type],
    resourceKind: concreteKind("Copy"),
  });
  const nestedActual = appliedType({
    constructor: { kind: "core", coreTypeId: coreTypeId("Box") },
    arguments: [coreCheckedType(coreTypeId("u32"))],
    resourceKind: concreteKind("Copy"),
  });

  const result = inferCallTypeArguments({
    signature: { ...signature, parameters: [{ ...signature.parameters[0]!, type: nestedFormal }] },
    arguments: [{ type: nestedActual }],
    sourceSpan: SourceSpan.from(0, 1),
  });

  expect(result.typeArguments.map(checkedTypeFingerprint)).toEqual(["core:u32"]);
  expect(result.diagnostics).toEqual([]);
});

test("generic inference uses expected return type constraints", () => {
  const result = inferCallTypeArguments({
    signature: genericSignature(),
    arguments: [],
    expectedReturnType: coreCheckedType(coreTypeId("bool")),
    sourceSpan: SourceSpan.from(0, 1),
  });

  expect(result.typeArguments.map(checkedTypeFingerprint)).toEqual(["core:bool"]);
  expect(result.diagnostics).toEqual([]);
});

test("generic inference reports unsatisfied checked bounds", () => {
  const signature = genericSignature();
  const result = inferCallTypeArguments({
    signature: {
      ...signature,
      genericSignature: {
        ...signature.genericSignature!,
        parameters: [
          {
            ...signature.genericSignature!.parameters[0]!,
            bounds: [
              { interfaceType: coreCheckedType(coreTypeId("bool")), span: SourceSpan.from(0, 1) },
            ],
          },
        ],
      },
    },
    arguments: [{ type: coreCheckedType(coreTypeId("u32")) }],
    sourceSpan: SourceSpan.from(0, 1),
  });

  expect(result.diagnostics.map((diagnostic) => String(diagnostic.code))).toContain(
    "HIR_GENERIC_BOUND_NOT_SATISFIED",
  );
});
