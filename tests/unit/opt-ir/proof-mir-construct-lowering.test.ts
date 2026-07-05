import { describe, expect, test } from "bun:test";
import { optIrConstantPool } from "../../../src/opt-ir/constants";
import { optIrOriginId } from "../../../src/opt-ir/ids";
import { optIrBlockArgumentBuilder } from "../../../src/opt-ir/lower/block-argument-builder";
import type { ProofMirLoweringContext } from "../../../src/opt-ir/lower/lower-checked-mir";
import { lowerProofMirConstructObjectStatement } from "../../../src/opt-ir/lower/proof-mir-construct-lowering";
import { proofMirScopedValueKey } from "../../../src/opt-ir/lower/proof-mir-lowering-support";
import { optIrUnsignedIntegerType } from "../../../src/opt-ir/types";
import {
  proofMirBlockId,
  proofMirOriginId,
  proofMirStatementId,
  proofMirValueId,
} from "../../../src/proof-mir/ids";
import type {
  ProofMirBlock,
  ProofMirFunction,
  ProofMirStatement,
  ProofMirValue,
} from "../../../src/proof-mir/model/graph";
import { coreTypeId, functionId, itemId, typeId } from "../../../src/semantic/ids";
import { coreCheckedType, sourceCheckedType } from "../../../src/semantic/surface/type-model";
import { SourceSpan } from "../../../src/shared/source-span";
import { monoInstanceId } from "../../../src/mono/ids";
import type { MonoCheckedType, MonoFunctionSignature } from "../../../src/mono/mono-hir";

describe("Proof MIR constructObject OptIR lowering", () => {
  test("lowers tag-only source constructs to typed integer constants", () => {
    const function_ = proofMirFunctionForConstructTest({
      values: [
        runtimeValue(proofMirValueId(1), coreCheckedType(coreTypeId("u32")) as MonoCheckedType),
        runtimeValue(
          proofMirValueId(2),
          sourceCheckedType({ itemId: itemId(10), typeId: typeId(20) }) as MonoCheckedType,
        ),
      ],
      statements: [
        {
          statementId: proofMirStatementId(1),
          origin: proofMirOriginId(1),
          kind: {
            kind: "literal",
            value: proofMirValueId(1),
            literal: { kind: "integer", text: "7", value: 7n },
          },
        },
      ],
    });
    const context = proofMirLoweringContextForConstructTest();

    const operations = lowerProofMirConstructObjectStatement({
      function_,
      construct: {
        kind: "constructObject",
        result: proofMirValueId(2),
        fields: [{ name: "__tag", value: proofMirValueId(1), origin: proofMirOriginId(1) }],
      },
      context,
      originId: optIrOriginId(1),
      valueTypeForLowering: () => optIrUnsignedIntegerType(64),
    });

    expect(operations).toHaveLength(1);
    expect(operations[0]).toMatchObject({
      kind: "constant",
      constant: { normalizedValue: 7n, type: optIrUnsignedIntegerType(64) },
    });
  });

  test("aliases source ABI field constructs without emitting aggregates", () => {
    const payloadType = sourceCheckedType({ itemId: itemId(11), typeId: typeId(21) });
    const resultType = sourceCheckedType({ itemId: itemId(12), typeId: typeId(22) });
    const function_ = proofMirFunctionForConstructTest({
      values: [
        runtimeValue(proofMirValueId(1), payloadType as MonoCheckedType),
        runtimeValue(proofMirValueId(2), resultType as MonoCheckedType),
      ],
      statements: [],
    });
    const context = proofMirLoweringContextForConstructTest({
      sourceTypeAbi: {
        lowerType: () => optIrUnsignedIntegerType(64),
        lowerConstruct: () => ({ kind: "fieldAlias", fieldName: "error" }),
      },
    });

    const operations = lowerProofMirConstructObjectStatement({
      function_,
      construct: {
        kind: "constructObject",
        result: proofMirValueId(2),
        fields: [{ name: "error", value: proofMirValueId(1), origin: proofMirOriginId(1) }],
      },
      context,
      originId: optIrOriginId(1),
      valueTypeForLowering: () => optIrUnsignedIntegerType(64),
    });

    const payloadValueId = context.values.valueIdFor(
      proofMirScopedValueKey(function_.functionInstanceId, proofMirValueId(1)),
    );
    const resultValueId = context.values.valueIdFor(
      proofMirScopedValueKey(function_.functionInstanceId, proofMirValueId(2)),
    );

    expect(operations).toEqual([]);
    expect(resultValueId).toBe(payloadValueId);
  });

  test("lowers payload enum constructs to explicit tag and payload stores", () => {
    const tagType = coreCheckedType(coreTypeId("u32")) as MonoCheckedType;
    const payloadType = sourceCheckedType({ itemId: itemId(11), typeId: typeId(21) });
    const resultType = sourceCheckedType({ itemId: itemId(12), typeId: typeId(22) });
    const function_ = proofMirFunctionForConstructTest({
      values: [
        runtimeValue(proofMirValueId(1), tagType),
        runtimeValue(proofMirValueId(2), payloadType as MonoCheckedType),
        runtimeValue(proofMirValueId(3), resultType as MonoCheckedType),
      ],
      statements: [
        {
          statementId: proofMirStatementId(1),
          origin: proofMirOriginId(1),
          kind: {
            kind: "literal",
            value: proofMirValueId(1),
            literal: { kind: "integer", text: "2", value: 2n },
          },
        },
      ],
    });
    const context = proofMirLoweringContextForConstructTest();

    const operations = lowerProofMirConstructObjectStatement({
      function_,
      construct: {
        kind: "constructObject",
        result: proofMirValueId(3),
        fields: [
          { name: "__tag", value: proofMirValueId(1), origin: proofMirOriginId(1) },
          { name: "value", value: proofMirValueId(2), origin: proofMirOriginId(1) },
        ],
      },
      context,
      originId: optIrOriginId(1),
      valueTypeForLowering: () => optIrUnsignedIntegerType(64),
    });

    const resultValueId = context.values.valueIdFor(
      proofMirScopedValueKey(function_.functionInstanceId, proofMirValueId(3)),
    );

    expect(operations.map((operation) => operation.kind)).toEqual([
      "enumTagStore",
      "enumPayloadStore",
    ]);
    expect(operations[0]).toMatchObject({
      kind: "enumTagStore",
      enumCase: { caseName: "case2", tagValue: "2" },
    });
    expect(operations[1]).toMatchObject({
      kind: "enumPayloadStore",
      enumCase: { payloadFieldName: "value", tagValue: "2" },
      resultIds: [resultValueId],
    });
  });

  test("does not invent case metadata for payload enum constructs with dynamic tags", () => {
    const tagType = coreCheckedType(coreTypeId("u32")) as MonoCheckedType;
    const payloadType = sourceCheckedType({ itemId: itemId(11), typeId: typeId(21) });
    const resultType = sourceCheckedType({ itemId: itemId(12), typeId: typeId(22) });
    const function_ = proofMirFunctionForConstructTest({
      values: [
        runtimeValue(proofMirValueId(1), tagType),
        runtimeValue(proofMirValueId(2), payloadType as MonoCheckedType),
        runtimeValue(proofMirValueId(3), resultType as MonoCheckedType),
      ],
      statements: [],
    });
    const context = proofMirLoweringContextForConstructTest();

    const operations = lowerProofMirConstructObjectStatement({
      function_,
      construct: {
        kind: "constructObject",
        result: proofMirValueId(3),
        fields: [
          { name: "__tag", value: proofMirValueId(1), origin: proofMirOriginId(1) },
          { name: "value", value: proofMirValueId(2), origin: proofMirOriginId(1) },
        ],
      },
      context,
      originId: optIrOriginId(1),
      valueTypeForLowering: () => optIrUnsignedIntegerType(64),
    });

    expect(operations.map((operation) => operation.kind)).toEqual(["aggregateConstruct"]);
  });
});

function proofMirLoweringContextForConstructTest(
  input: Partial<Pick<ProofMirLoweringContext["target"], "sourceTypeAbi">> = {},
): ProofMirLoweringContext {
  return {
    values: optIrBlockArgumentBuilder(),
    constantPool: optIrConstantPool(),
    target: {
      targetId: "construct-test" as never,
      ...(input.sourceTypeAbi === undefined ? {} : { sourceTypeAbi: input.sourceTypeAbi }),
    },
    nextOperationId: 1,
    nextConstantId: 1,
  } as unknown as ProofMirLoweringContext;
}

function proofMirFunctionForConstructTest(input: {
  readonly values: readonly ProofMirValue[];
  readonly statements: readonly ProofMirStatement[];
}): ProofMirFunction {
  const functionInstanceId = monoInstanceId("fn:construct-test");
  const valuesById = new Map(input.values.map((value) => [String(value.valueId), value]));
  const block = {
    blockId: proofMirBlockId(0),
    statements: input.statements,
  } as ProofMirBlock;
  return {
    functionInstanceId,
    sourceFunctionId: functionId(0),
    signature: signatureForConstructTest(),
    entryBlockId: block.blockId,
    blocks: {
      get: (blockId: ReturnType<typeof proofMirBlockId>) =>
        blockId === block.blockId ? block : undefined,
      entries: () => [block],
    },
    values: {
      get: (valueId: ReturnType<typeof proofMirValueId>) => valuesById.get(String(valueId)),
      entries: () => input.values,
    },
  } as unknown as ProofMirFunction;
}

function runtimeValue(
  valueId: ReturnType<typeof proofMirValueId>,
  type: MonoCheckedType,
): ProofMirValue {
  return {
    valueId,
    type,
    resourceKind: "Copy",
    representation: { kind: "runtime" },
    origin: proofMirOriginId(Number(valueId)),
  };
}

function signatureForConstructTest(): MonoFunctionSignature {
  return {
    functionId: functionId(0),
    itemId: itemId(0),
    parameters: [],
    returnType: coreCheckedType(coreTypeId("Never")) as MonoCheckedType,
    returnKind: "Never",
    modifiers: {
      isPlatform: false,
      isTerminal: false,
      isPredicate: false,
      isConstructor: false,
      isPrivate: false,
    },
    sourceSpan: SourceSpan.from(0, 0),
  };
}
