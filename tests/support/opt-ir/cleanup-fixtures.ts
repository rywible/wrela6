import { optIrCfgEdgeTable, type OptIrBlock, type OptIrEdge } from "../../../src/opt-ir/cfg";
import { monoInstanceId } from "../../../src/mono/ids";
import type { MonoCheckedType, MonoFunctionSignature } from "../../../src/mono/mono-hir";
import {
  optIrBlockId,
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
  optIrMemoryLoadOperation,
  type OptIrOperation,
} from "../../../src/opt-ir/operations";
import type { OptIrFunction } from "../../../src/opt-ir/program";
import { optIrSignedIntegerType } from "../../../src/opt-ir/types";
import { coreTypeId, functionId, itemId } from "../../../src/semantic/ids";
import { coreCheckedType } from "../../../src/semantic/surface/type-model";
import { SourceSpan } from "../../../src/shared/source-span";
import { optIrIntegerConstant } from "../../../src/opt-ir/constants";

export const integer32 = optIrSignedIntegerType(32);

export function addOperation(
  operationId: number,
  resultId: number,
  left: number,
  right: number,
): OptIrOperation {
  return optIrIntegerBinaryOperation({
    operationId: optIrOperationId(operationId),
    resultId: optIrValueId(resultId),
    left: optIrValueId(left),
    right: optIrValueId(right),
    operator: "add",
    resultType: integer32,
    originId: optIrOriginId(1),
  });
}

export function loadOperation(input: {
  readonly operationId: number;
  readonly resultId: number;
  readonly volatility: "nonVolatile" | "volatile";
}): OptIrOperation {
  const result = optIrMemoryLoadOperation({
    operationId: optIrOperationId(input.operationId),
    resultId: optIrValueId(input.resultId),
    region: optIrRegionId(1),
    byteOffset: 0n,
    byteWidth: 4,
    alignment: 4,
    valueType: integer32,
    endian: "little",
    volatility: input.volatility,
    boundsAuthority: { kind: "targetContract", authorityKey: "test-region" },
    originId: optIrOriginId(1),
  });
  if (result.kind !== "ok") {
    throw new Error("Expected load fixture to construct.");
  }
  return result.operation;
}

export function booleanConstantOperation(
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

export function functionWithOperations(
  operationIds: readonly OptIrOperationId[],
  edges: readonly OptIrEdge[] = [],
): OptIrFunction {
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
    edges: optIrCfgEdgeTable(edges),
    entryBlock: block.blockId,
    originId: optIrOriginId(1),
  };
}

export function functionWithBlocks(input: {
  readonly blocks: readonly OptIrBlock[];
  readonly edges?: readonly OptIrEdge[];
}): OptIrFunction {
  return {
    functionId: optIrFunctionId(1),
    monoInstanceId: monoInstanceId("test.instance"),
    signature: signatureForTest(),
    blocks: input.blocks,
    edges: optIrCfgEdgeTable(input.edges ?? []),
    entryBlock: input.blocks[0]?.blockId ?? optIrBlockId(1),
    originId: optIrOriginId(1),
  };
}

export function edgeToBlockArgument(argumentId: ReturnType<typeof optIrValueId>): OptIrEdge {
  return {
    edgeId: optIrEdgeId(1),
    from: optIrBlockId(1),
    toBlock: optIrBlockId(2),
    ordinal: 0,
    kind: "normal",
    arguments: [argumentId],
    originId: optIrOriginId(1),
  };
}

export function edgeIntoBlock(
  edgeId: ReturnType<typeof optIrEdgeId>,
  toBlock: ReturnType<typeof optIrBlockId>,
  argumentIds: readonly ReturnType<typeof optIrValueId>[],
): OptIrEdge {
  return {
    edgeId,
    from: optIrBlockId(1),
    toBlock,
    ordinal: Number(edgeId),
    kind: "normal",
    arguments: argumentIds,
    originId: optIrOriginId(1),
  };
}

export function edgeBetween(
  edgeId: ReturnType<typeof optIrEdgeId>,
  from: ReturnType<typeof optIrBlockId>,
  toBlock: ReturnType<typeof optIrBlockId>,
  argumentIds: readonly ReturnType<typeof optIrValueId>[],
): OptIrEdge {
  return {
    edgeId,
    from,
    toBlock,
    ordinal: Number(edgeId),
    kind: "normal",
    arguments: argumentIds,
    originId: optIrOriginId(1),
  };
}

export function blockWithReturn(
  blockId: ReturnType<typeof optIrBlockId>,
  operationIds: readonly OptIrOperationId[],
): OptIrBlock {
  return {
    blockId,
    parameters: [],
    operations: operationIds,
    terminator: {
      kind: "return",
      operationId: optIrOperationId(Number(blockId) + 100),
      values: [],
      originId: optIrOriginId(1),
    },
    originId: optIrOriginId(1),
  };
}

export function operationTable(
  operations: readonly OptIrOperation[],
): ReadonlyMap<OptIrOperationId, OptIrOperation> {
  return new Map(operations.map((operation) => [operation.operationId, operation]));
}

export function requireOperation(
  operations: readonly OptIrOperation[],
  operationId: OptIrOperationId,
): OptIrOperation {
  const operation = operations.find((candidate) => candidate.operationId === operationId);
  if (operation === undefined) {
    throw new Error(`Expected operation ${operationId}.`);
  }
  return operation;
}

export function blockOperations(functionOutput: OptIrFunction): readonly OptIrOperationId[] {
  return functionOutput.blocks.flatMap((block) => block.operations);
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
