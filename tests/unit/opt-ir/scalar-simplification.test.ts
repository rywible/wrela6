import { describe, expect, test } from "bun:test";

import { monoInstanceId } from "../../../src/mono/ids";
import { optIrCfgEdgeTable, type OptIrBlock, type OptIrEdge } from "../../../src/opt-ir/cfg";
import { optIrIntegerConstant } from "../../../src/opt-ir/constants";
import {
  optIrBlockId,
  optIrCallId,
  optIrConstantId,
  optIrEdgeId,
  optIrFunctionId,
  optIrOperationId,
  optIrOriginId,
  optIrRegionId,
  optIrValueId,
  type OptIrOperationId,
} from "../../../src/opt-ir/ids";
import {
  optIrConstantOperation,
  optIrIntegerBinaryOperation,
  optIrIntegerCompareOperation,
  optIrMemoryLoadOperation,
  optIrRuntimeCallOperation,
  type OptIrBoundsAuthority,
  type OptIrOperation,
} from "../../../src/opt-ir/operations";
import { runScalarSimplification } from "../../../src/opt-ir/passes/scalar-simplification";
import type { OptIrFunction } from "../../../src/opt-ir/program";
import { optIrBooleanType, optIrSignedIntegerType } from "../../../src/opt-ir/types";
import { coreTypeId, functionId, itemId } from "../../../src/semantic/ids";
import { coreCheckedType } from "../../../src/semantic/surface/type-model";
import { SourceSpan } from "../../../src/shared/source-span";
import type { MonoCheckedType, MonoFunctionSignature } from "../../../src/mono/mono-hir";

const integer32 = optIrSignedIntegerType(32);
const booleanType = optIrBooleanType();

describe("OptIR scalar simplification", () => {
  test("folds integer arithmetic and records deterministic value remaps", () => {
    const left = integerConstantOperation(1, 10, 7n);
    const right = integerConstantOperation(2, 11, 5n);
    const sum = optIrIntegerBinaryOperation({
      operationId: optIrOperationId(3),
      resultId: optIrValueId(12),
      left: left.resultIds[0] ?? optIrValueId(0),
      right: right.resultIds[0] ?? optIrValueId(0),
      operator: "add",
      resultType: integer32,
      originId: optIrOriginId(1),
    });
    const functionInput = functionWithOperations([
      left.operationId,
      right.operationId,
      sum.operationId,
    ]);

    const result = runScalarSimplification({
      function: functionInput,
      operations: operationTable([left, right, sum]),
      fuel: 4,
    });

    const folded = requireOperation(result.operations, sum.operationId);
    expect(folded.kind).toBe("constant");
    if (folded.kind !== "constant") {
      throw new Error("Expected folded constant.");
    }
    expect(folded.constant.normalizedValue).toBe(12n);
    expect(result.rewriteRecords).toEqual([
      {
        operationId: sum.operationId,
        resultId: optIrValueId(12),
        replacement: { kind: "constant", normalizedValue: 12n },
        invariant: { kind: "pureAlgebraicEquivalence" },
      },
    ]);
    expect(result.subjectRemap.entries).toEqual([]);

    const idempotent = runScalarSimplification({
      function: result.function,
      operations: operationTable(result.operations),
      fuel: 4,
    });
    expect(idempotent.operations).toEqual(result.operations);
    expect(idempotent.rewriteRecords).toEqual([]);
    expect(idempotent.rejectedBoundsChecks).toEqual([]);
  });

  test("uses fuel to fold constants exposed by earlier scalar rewrites", () => {
    const left = integerConstantOperation(1, 10, 7n);
    const right = integerConstantOperation(2, 11, 5n);
    const sum = optIrIntegerBinaryOperation({
      operationId: optIrOperationId(3),
      resultId: optIrValueId(12),
      left: left.resultIds[0] ?? optIrValueId(0),
      right: right.resultIds[0] ?? optIrValueId(0),
      operator: "add",
      resultType: integer32,
      originId: optIrOriginId(1),
    });
    const doubled = optIrIntegerBinaryOperation({
      operationId: optIrOperationId(4),
      resultId: optIrValueId(13),
      left: sum.resultIds[0] ?? optIrValueId(0),
      right: sum.resultIds[0] ?? optIrValueId(0),
      operator: "add",
      resultType: integer32,
      originId: optIrOriginId(1),
    });
    const functionInput = functionWithOperations([
      left.operationId,
      right.operationId,
      sum.operationId,
      doubled.operationId,
    ]);

    const singleRound = runScalarSimplification({
      function: functionInput,
      operations: operationTable([left, right, sum, doubled]),
      fuel: 1,
    });
    expect(requireOperation(singleRound.operations, doubled.operationId)).toEqual(doubled);

    const fixedPoint = runScalarSimplification({
      function: functionInput,
      operations: operationTable([left, right, sum, doubled]),
      fuel: 4,
    });

    const folded = requireOperation(fixedPoint.operations, doubled.operationId);
    expect(folded.kind).toBe("constant");
    if (folded.kind !== "constant") {
      throw new Error("Expected chained folded constant.");
    }
    expect(folded.constant.normalizedValue).toBe(24n);
    expect(fixedPoint.rewriteRecords.map((record) => record.operationId)).toEqual([
      sum.operationId,
      doubled.operationId,
    ]);
  });

  test("folds compares to constants and uses them to simplify branches", () => {
    const left = integerConstantOperation(1, 10, 7n);
    const right = integerConstantOperation(2, 11, 5n);
    const compare = optIrIntegerCompareOperation({
      operationId: optIrOperationId(3),
      resultId: optIrValueId(12),
      left: left.resultIds[0] ?? optIrValueId(0),
      right: right.resultIds[0] ?? optIrValueId(0),
      operator: "signedLessThan",
      originId: optIrOriginId(1),
    });
    const functionInput = functionWithBranch(
      [left.operationId, right.operationId, compare.operationId],
      compare.resultIds[0] ?? optIrValueId(0),
    );

    const result = runScalarSimplification({
      function: functionInput,
      operations: operationTable([left, right, compare]),
      fuel: 4,
    });

    const folded = requireOperation(result.operations, compare.operationId);
    expect(folded.kind).toBe("constant");
    if (folded.kind !== "constant") {
      throw new Error("Expected compare constant.");
    }
    expect(folded.constant.type).toEqual(booleanType);
    expect(folded.constant.normalizedValue).toBe(0n);
    expect(result.function.blocks.map((block) => block.blockId)).toEqual([
      optIrBlockId(1),
      optIrBlockId(3),
    ]);
    expect(result.function.blocks[0]?.terminator).toEqual({
      kind: "jump",
      operationId: optIrOperationId(50),
      edge: optIrEdgeId(2),
      originId: optIrOriginId(1),
    });
    expect(result.removedEdgeIds).toEqual([optIrEdgeId(1)]);
  });

  test("simplifies compares from scoped facts without inventing facts for unrelated values", () => {
    const compare = optIrIntegerCompareOperation({
      operationId: optIrOperationId(3),
      resultId: optIrValueId(12),
      left: optIrValueId(10),
      right: optIrValueId(11),
      operator: "equal",
      originId: optIrOriginId(1),
    });
    const unknownCompare = optIrIntegerCompareOperation({
      operationId: optIrOperationId(4),
      resultId: optIrValueId(13),
      left: optIrValueId(20),
      right: optIrValueId(21),
      operator: "equal",
      originId: optIrOriginId(1),
    });

    const result = runScalarSimplification({
      function: functionWithOperations([compare.operationId, unknownCompare.operationId]),
      operations: operationTable([compare, unknownCompare]),
      compareFacts: [
        { left: optIrValueId(10), operator: "equal", right: optIrValueId(11), result: true },
      ],
      fuel: 4,
    });

    expect(requireOperation(result.operations, compare.operationId).kind).toBe("constant");
    expect(requireOperation(result.operations, unknownCompare.operationId)).toEqual(unknownCompare);
  });

  test("removes runtime bounds checks only when affected accesses receive replacement authority", () => {
    const check = boundsCheckOperation(1);
    const load = loadOperation(2, { kind: "targetContract", authorityKey: "precheck" });
    const authority: OptIrBoundsAuthority = {
      kind: "validatedBuffer",
      authorityKey: "packet.bounds",
    };

    const result = runScalarSimplification({
      function: functionWithOperations([check.operationId, load.operationId]),
      operations: operationTable([check, load]),
      removableBoundsChecks: [
        {
          checkOperationId: check.operationId,
          affectedAccessOperationIds: [load.operationId],
          replacementAuthority: authority,
        },
      ],
      fuel: 4,
    });

    expect(result.function.blocks[0]?.operations).toEqual([load.operationId]);
    expect(result.removedOperationIds).toEqual([check.operationId]);
    const rewrittenLoad = requireOperation(result.operations, load.operationId);
    expect(rewrittenLoad.kind).toBe("memoryLoad");
    if (rewrittenLoad.kind !== "memoryLoad") {
      throw new Error("Expected load.");
    }
    expect(rewrittenLoad.memoryAccess.boundsAuthority).toEqual(authority);
    expect(result.rejectedBoundsChecks).toEqual([]);
  });

  test("keeps runtime bounds checks when replacement authority is not provable", () => {
    const check = boundsCheckOperation(1);
    const load = loadOperation(2, { kind: "targetContract", authorityKey: "precheck" });

    const result = runScalarSimplification({
      function: functionWithOperations([check.operationId, load.operationId]),
      operations: operationTable([check, load]),
      removableBoundsChecks: [
        {
          checkOperationId: check.operationId,
          affectedAccessOperationIds: [load.operationId],
        },
      ],
      fuel: 4,
    });

    expect(result.function.blocks[0]?.operations).toEqual([check.operationId, load.operationId]);
    expect(result.removedOperationIds).toEqual([]);
    expect(result.rejectedBoundsChecks).toEqual([
      {
        checkOperationId: check.operationId,
        reason: "missingReplacementAuthority",
      },
    ]);
  });
});

function integerConstantOperation(
  operationId: number,
  resultId: number,
  normalizedValue: bigint,
): OptIrOperation {
  return optIrConstantOperation({
    operationId: optIrOperationId(operationId),
    resultId: optIrValueId(resultId),
    constant: optIrIntegerConstant({
      constantId: optIrConstantId(operationId),
      type: integer32,
      normalizedValue,
      dataModel: { pointerWidth: 64, endian: "little" },
    }),
    originId: optIrOriginId(1),
  });
}

function boundsCheckOperation(operationId: number): OptIrOperation {
  return optIrRuntimeCallOperation({
    operationId: optIrOperationId(operationId),
    callId: optIrCallId(operationId),
    target: { kind: "runtime", runtimeKey: "runtime.bounds_check" },
    argumentIds: [],
    resultIds: [],
    resultTypes: [],
    originId: optIrOriginId(1),
  });
}

function loadOperation(operationId: number, authority: OptIrBoundsAuthority): OptIrOperation {
  const result = optIrMemoryLoadOperation({
    operationId: optIrOperationId(operationId),
    resultId: optIrValueId(operationId + 20),
    region: optIrRegionId(1),
    byteOffset: 0n,
    byteWidth: 4,
    alignment: 4,
    valueType: integer32,
    endian: "little",
    volatility: "nonVolatile",
    boundsAuthority: authority,
    originId: optIrOriginId(1),
  });
  if (result.kind !== "ok") {
    throw new Error("Expected load fixture to construct.");
  }
  return result.operation;
}

function functionWithOperations(operationIds: readonly OptIrOperationId[]): OptIrFunction {
  const block: OptIrBlock = {
    blockId: optIrBlockId(1),
    parameters: [],
    operations: operationIds,
    originId: optIrOriginId(1),
  };
  return {
    functionId: optIrFunctionId(1),
    monoInstanceId: monoInstanceId("test.instance"),
    signature: signatureForTest(),
    blocks: [block],
    edges: optIrCfgEdgeTable([]),
    entryBlock: block.blockId,
    originId: optIrOriginId(1),
  };
}

function functionWithBranch(
  operationIds: readonly OptIrOperationId[],
  condition: ReturnType<typeof optIrValueId>,
): OptIrFunction {
  return {
    ...functionWithOperations([]),
    blocks: [
      {
        blockId: optIrBlockId(1),
        parameters: [],
        operations: operationIds,
        terminator: {
          kind: "branch",
          operationId: optIrOperationId(50),
          condition,
          trueEdge: optIrEdgeId(1),
          falseEdge: optIrEdgeId(2),
          originId: optIrOriginId(1),
        },
        originId: optIrOriginId(1),
      },
      blockWithReturn(optIrBlockId(2)),
      blockWithReturn(optIrBlockId(3)),
    ],
    edges: optIrCfgEdgeTable([
      edgeBetween(optIrEdgeId(1), optIrBlockId(1), optIrBlockId(2)),
      edgeBetween(optIrEdgeId(2), optIrBlockId(1), optIrBlockId(3)),
    ]),
    entryBlock: optIrBlockId(1),
  };
}

function edgeBetween(
  edgeId: ReturnType<typeof optIrEdgeId>,
  from: ReturnType<typeof optIrBlockId>,
  toBlock: ReturnType<typeof optIrBlockId>,
): OptIrEdge {
  return {
    edgeId,
    from,
    toBlock,
    ordinal: Number(edgeId),
    kind: "normal",
    arguments: [],
    originId: optIrOriginId(1),
  };
}

function blockWithReturn(blockId: ReturnType<typeof optIrBlockId>): OptIrBlock {
  return {
    blockId,
    parameters: [],
    operations: [],
    terminator: {
      kind: "return",
      operationId: optIrOperationId(Number(blockId) + 100),
      values: [],
      originId: optIrOriginId(1),
    },
    originId: optIrOriginId(1),
  };
}

function signatureForTest(): MonoFunctionSignature {
  return {
    functionId: functionId(1),
    itemId: itemId(1),
    parameters: [],
    returnType: monoCheckedTypeForTest("Never"),
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

function monoCheckedTypeForTest(name: string): MonoCheckedType {
  return coreCheckedType(coreTypeId(name)) as MonoCheckedType;
}

function operationTable(
  operations: readonly OptIrOperation[],
): ReadonlyMap<OptIrOperationId, OptIrOperation> {
  return new Map(operations.map((operation) => [operation.operationId, operation]));
}

function requireOperation(
  operations: readonly OptIrOperation[],
  operationId: OptIrOperationId,
): OptIrOperation {
  const operation = operations.find((candidate) => candidate.operationId === operationId);
  if (operation === undefined) {
    throw new Error(`Expected operation ${operationId}.`);
  }
  return operation;
}
