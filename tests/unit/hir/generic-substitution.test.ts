import { expect, test } from "bun:test";
import { SourceSpan } from "../../../src/shared/source-span";
import { substituteCheckedSignature } from "../../../src/hir/generic-substitution";
import { checkedFunctionSignatureFake } from "../../support/hir/typed-hir-fakes";
import { coreTypeId, functionId } from "../../../src/semantic/ids";
import { concreteKind, parametricKind } from "../../../src/semantic/surface/resource-kind";
import {
  appliedType,
  coreCheckedType,
  genericParameterCheckedType,
} from "../../../src/semantic/surface/type-model";

test("substituteCheckedSignature preserves the signature object when no field changes", () => {
  const signature = checkedFunctionSignatureFake();

  expect(substituteCheckedSignature({ signature, typeArguments: [] })).toBe(signature);
});

test("substituteCheckedSignature substitutes checked types and resource kinds through HIR transform", () => {
  const parameter = {
    owner: { kind: "function" as const, itemId: 0 as any, functionId: functionId(7) },
    index: 0,
  };
  const genericType = genericParameterCheckedType(parameter);
  const boxedGeneric = appliedType({
    constructor: { kind: "core", coreTypeId: coreTypeId("Box") },
    arguments: [genericType],
    resourceKind: parametricKind(parameter),
  });
  const signature = {
    ...checkedFunctionSignatureFake({ functionId: functionId(7), returnType: boxedGeneric }),
    genericSignature: {
      owner: { kind: "function" as const, itemId: 0 as any, functionId: functionId(7) },
      parameters: [{ key: parameter, name: "T", bounds: [], span: SourceSpan.from(0, 1) }],
    },
    parameters: [
      {
        parameterId: 0 as any,
        name: "value",
        type: genericType,
        mode: "observe" as const,
        resourceKind: parametricKind(parameter),
        sourceSpan: SourceSpan.from(0, 1),
      },
    ],
  };

  const concreteTypeArgument = appliedType({
    constructor: { kind: "core", coreTypeId: coreTypeId("BoxedU32") },
    arguments: [coreCheckedType(coreTypeId("u32"))],
    resourceKind: concreteKind("Copy"),
  });
  const substituted = substituteCheckedSignature({
    signature,
    typeArguments: [concreteTypeArgument],
  });

  expect(substituted).not.toBe(signature);
  expect(substituted.parameters[0]?.type).toEqual(concreteTypeArgument);
  expect(substituted.parameters[0]?.resourceKind).toEqual(concreteKind("Copy"));
  expect(substituted.returnType).toEqual(
    appliedType({
      constructor: { kind: "core", coreTypeId: coreTypeId("Box") },
      arguments: [concreteTypeArgument],
      resourceKind: concreteKind("Copy"),
    }),
  );
});
