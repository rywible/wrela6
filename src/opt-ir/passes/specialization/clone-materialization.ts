import { monoInstanceId, type MonoInstanceId } from "../../../mono/ids";
import { optIrCfgEdgeTable } from "../../cfg";
import type { OptIrConstant } from "../../constants";
import type { OptIrBlockId, OptIrEdgeId, OptIrOperationId, OptIrValueId } from "../../ids";
import {
  optIrBlockId,
  optIrEdgeId,
  optIrFunctionId,
  optIrOperationId,
  optIrValueId,
} from "../../ids";
import { optIrConstantOperation, type OptIrOperation } from "../../operations";
import type { OptIrFunction, OptIrProgram } from "../../program";
import type { OptIrTerminator } from "../../terminators";
import type { OptIrCloneStaticOperand } from "./clone-signature";

export type OptIrSpecializationSourceCallOperation = OptIrOperation & {
  readonly kind: "sourceCall";
  readonly target: { readonly kind: "source"; readonly functionInstanceId: MonoInstanceId };
  readonly argumentIds: readonly OptIrValueId[];
};

export interface OptIrSpecializationCloneCandidate {
  readonly caller: OptIrFunction;
  readonly callee: OptIrFunction;
  readonly callOperation: OptIrSpecializationSourceCallOperation;
}

export interface OptIrMaterializedSpecializationClone {
  readonly function: OptIrFunction;
  readonly operations: readonly OptIrOperation[];
  readonly bakedParameterIndices: ReadonlySet<number>;
  readonly touchedEffectBoundary: boolean;
  readonly touchedCapabilityFacts: boolean;
  readonly touchedPrivateStateFacts: boolean;
}

export interface OptIrCloneMaterializationState {
  nextFunctionId: number;
  nextBlockId: number;
  nextEdgeId: number;
  nextOperationId: number;
  nextValueId: number;
  nextCloneOrdinal: number;
}

export function createSpecializationCloneMaterializationState(
  program: OptIrProgram,
  operations: readonly OptIrOperation[],
): OptIrCloneMaterializationState {
  const functionIds = program.functions.entries().map((func) => Number(func.functionId));
  const blockIds = program.functions
    .entries()
    .flatMap((func) => func.blocks.map((block) => Number(block.blockId)));
  const edgeIds = program.functions
    .entries()
    .flatMap((func) => func.edges.entries().map((edge) => Number(edge.edgeId)));
  const terminatorOperationIds = program.functions
    .entries()
    .flatMap((func) =>
      func.blocks.flatMap((block) =>
        block.terminator === undefined ? [] : [Number(block.terminator.operationId)],
      ),
    );
  const operationIds = [
    ...operations.map((operation) => Number(operation.operationId)),
    ...terminatorOperationIds,
  ];
  const valueIds = [
    ...operations.flatMap((operation) => [
      ...operation.operandIds.map(Number),
      ...operation.resultIds.map(Number),
    ]),
    ...program.functions
      .entries()
      .flatMap((func) =>
        func.blocks.flatMap((block) => [
          ...block.parameters.map((parameter) => Number(parameter.valueId)),
          ...terminatorValueIds(block.terminator).map(Number),
          ...func.edges
            .entries()
            .flatMap((edge) => [
              ...edge.arguments.map(Number),
              ...(edge.condition === undefined ? [] : [Number(edge.condition)]),
            ]),
        ]),
      ),
  ];

  return {
    nextFunctionId: nextId(functionIds),
    nextBlockId: nextId(blockIds),
    nextEdgeId: nextId(edgeIds),
    nextOperationId: nextId(operationIds),
    nextValueId: nextId(valueIds),
    nextCloneOrdinal: 0,
  };
}

export function materializeSpecializationClone(
  candidate: OptIrSpecializationCloneCandidate,
  staticOperands: readonly OptIrCloneStaticOperand[],
  staticValues: ReadonlyMap<OptIrValueId, OptIrConstant>,
  operationById: ReadonlyMap<OptIrOperationId, OptIrOperation>,
  state: OptIrCloneMaterializationState,
): OptIrMaterializedSpecializationClone {
  const bakedParameterIndices = new Set(
    staticOperands
      .filter((operand) => operand.binding.kind === "constant")
      .map((operand) => operand.parameterIndex),
  );
  const bakedConstants = new Map(
    staticOperands.flatMap((operand) => {
      if (operand.binding.kind !== "constant") {
        return [];
      }
      const constant = staticValues.get(operand.valueId);
      return constant === undefined ? [] : [[operand.parameterIndex, constant] as const];
    }),
  );
  const blockIdMap = new Map<OptIrBlockId, OptIrBlockId>();
  const edgeIdMap = new Map<OptIrEdgeId, OptIrEdgeId>();
  const operationIdMap = new Map<OptIrOperationId, OptIrOperationId>();
  const valueIdMap = new Map<OptIrValueId, OptIrValueId>();
  const clonedOperations: OptIrOperation[] = [];

  for (const block of candidate.callee.blocks) {
    blockIdMap.set(block.blockId, optIrBlockId(state.nextBlockId));
    state.nextBlockId += 1;
  }
  for (const edge of candidate.callee.edges.entries()) {
    edgeIdMap.set(edge.edgeId, optIrEdgeId(state.nextEdgeId));
    state.nextEdgeId += 1;
  }
  for (const operationId of candidate.callee.blocks.flatMap((block) => block.operations)) {
    operationIdMap.set(operationId, optIrOperationId(state.nextOperationId));
    state.nextOperationId += 1;
  }
  for (const block of candidate.callee.blocks) {
    if (block.terminator !== undefined) {
      operationIdMap.set(block.terminator.operationId, optIrOperationId(state.nextOperationId));
      state.nextOperationId += 1;
    }
  }
  for (const block of candidate.callee.blocks) {
    for (const parameter of block.parameters) {
      valueIdMap.set(parameter.valueId, optIrValueId(state.nextValueId));
      state.nextValueId += 1;
    }
  }
  for (const operation of candidate.callee.blocks.flatMap((block) =>
    block.operations.flatMap((operationId) => operationById.get(operationId) ?? []),
  )) {
    for (const resultId of operation.resultIds) {
      valueIdMap.set(resultId, optIrValueId(state.nextValueId));
      state.nextValueId += 1;
    }
  }

  const entryBlockId = candidate.callee.entryBlock;
  const clonedBlocks = candidate.callee.blocks.map((block) => {
    const isEntry = block.blockId === entryBlockId;
    const constantOperations: OptIrOperation[] = [];
    const parameters = block.parameters.flatMap((parameter, parameterIndex) => {
      const mappedValueId = requireMappedValue(valueIdMap, parameter.valueId);
      if (isEntry && bakedParameterIndices.has(parameterIndex)) {
        const constant = bakedConstants.get(parameterIndex);
        if (constant !== undefined) {
          const constantResultId = optIrValueId(state.nextValueId);
          state.nextValueId += 1;
          valueIdMap.set(parameter.valueId, constantResultId);
          constantOperations.push(
            optIrConstantOperation({
              operationId: optIrOperationId(state.nextOperationId),
              resultId: constantResultId,
              constant,
              originId: parameter.originId,
              displayName: `specialized.param.${parameterIndex}`,
            }),
          );
          state.nextOperationId += 1;
        }
        return [];
      }
      return [
        Object.freeze({
          ...parameter,
          valueId: mappedValueId,
        }),
      ];
    });
    const clonedBlockOperations = [
      ...constantOperations,
      ...block.operations.flatMap((operationId) => {
        const operation = operationById.get(operationId);
        if (operation === undefined) {
          return [];
        }
        return [rewriteClonedOperation(operation, operationIdMap, valueIdMap)];
      }),
    ];
    clonedOperations.push(...clonedBlockOperations);

    return Object.freeze({
      ...block,
      blockId: requireMappedBlock(blockIdMap, block.blockId),
      parameters: Object.freeze(parameters),
      operations: Object.freeze(clonedBlockOperations.map((operation) => operation.operationId)),
      terminator: remapTerminator(block.terminator, operationIdMap, valueIdMap, edgeIdMap),
    });
  });

  const clonedEdges = candidate.callee.edges.entries().map((edge) =>
    Object.freeze({
      ...edge,
      edgeId: requireMappedEdge(edgeIdMap, edge.edgeId),
      from: requireMappedBlock(blockIdMap, edge.from),
      ...(edge.toBlock === undefined
        ? {}
        : { toBlock: requireMappedBlock(blockIdMap, edge.toBlock) }),
      arguments: Object.freeze(
        edge.arguments.map((valueId) => substituteValue(valueIdMap, valueId)),
      ),
      ...(edge.condition === undefined
        ? {}
        : { condition: substituteValue(valueIdMap, edge.condition) }),
    }),
  );
  const cloneOrdinal = state.nextCloneOrdinal;
  state.nextCloneOrdinal += 1;
  const { externalRoot: _externalRoot, ...cloneBase } = candidate.callee;
  void _externalRoot;
  const functionOutput = Object.freeze({
    ...cloneBase,
    functionId: optIrFunctionId(state.nextFunctionId),
    monoInstanceId: monoInstanceId(
      `${candidate.callee.monoInstanceId}.specialized.${cloneOrdinal}`,
    ),
    signature: Object.freeze({
      ...candidate.callee.signature,
      parameters: Object.freeze(
        candidate.callee.signature.parameters.filter(
          (_parameter, index) => !bakedParameterIndices.has(index),
        ),
      ),
    }),
    blocks: Object.freeze(clonedBlocks),
    edges: optIrCfgEdgeTable(clonedEdges),
    entryBlock: requireMappedBlock(blockIdMap, candidate.callee.entryBlock),
    originId: candidate.callOperation.originId,
  });
  state.nextFunctionId += 1;

  return Object.freeze({
    function: functionOutput,
    operations: Object.freeze(clonedOperations.sort(compareOperations)),
    bakedParameterIndices,
    touchedEffectBoundary: clonedOperations.some((operation) => !operation.effects.isRuntimePure),
    touchedCapabilityFacts: staticOperands.some(
      (operand) =>
        operand.binding.kind === "factKey" && operand.binding.factKey.startsWith("capabilityFact:"),
    ),
    touchedPrivateStateFacts: staticOperands.some(
      (operand) =>
        operand.binding.kind === "factKey" &&
        operand.binding.factKey.startsWith("privateStateFact:"),
    ),
  });
}

export function retargetSpecializedCallOperation(
  operations: readonly OptIrOperation[],
  callOperationId: OptIrOperationId,
  cloneInstanceId: MonoInstanceId,
  bakedParameterIndices: ReadonlySet<number>,
): readonly OptIrOperation[] {
  return Object.freeze(
    operations.map((operation) => {
      if (operation.operationId !== callOperationId || operation.kind !== "sourceCall") {
        return operation;
      }
      const argumentIds = operation.argumentIds.filter(
        (_valueId, index) => !bakedParameterIndices.has(index),
      );
      return Object.freeze({
        ...operation,
        target: Object.freeze({
          kind: "source" as const,
          functionInstanceId: cloneInstanceId,
        }),
        argumentIds: Object.freeze(argumentIds),
        operandIds: Object.freeze(argumentIds),
      });
    }),
  );
}

function rewriteClonedOperation(
  operation: OptIrOperation,
  operationIdMap: ReadonlyMap<OptIrOperationId, OptIrOperationId>,
  valueIdMap: ReadonlyMap<OptIrValueId, OptIrValueId>,
): OptIrOperation {
  const base = {
    ...operation,
    operationId: requireMappedOperation(operationIdMap, operation.operationId),
    operandIds: Object.freeze(
      operation.operandIds.map((valueId) => substituteValue(valueIdMap, valueId)),
    ),
    resultIds: Object.freeze(
      operation.resultIds.map((valueId) => substituteValue(valueIdMap, valueId)),
    ),
  };
  switch (operation.kind) {
    case "constant":
    case "memoryLoad":
    case "proofErasedMarker":
      return Object.freeze(base);
    case "integerBinary":
    case "integerCompare":
    case "booleanBinary":
      return Object.freeze({
        ...base,
        left: substituteValue(valueIdMap, operation.left),
        right: substituteValue(valueIdMap, operation.right),
      });
    case "integerUnary":
    case "booleanNot":
      return Object.freeze({
        ...base,
        operand: substituteValue(valueIdMap, operation.operand),
      });
    case "aggregateConstruct":
      return Object.freeze({
        ...base,
        fieldIds: Object.freeze(
          operation.fieldIds.map((valueId) => substituteValue(valueIdMap, valueId)),
        ),
      });
    case "aggregateExtract":
      return Object.freeze({
        ...base,
        aggregate: substituteValue(valueIdMap, operation.aggregate),
      });
    case "aggregateInsert":
      return Object.freeze({
        ...base,
        aggregate: substituteValue(valueIdMap, operation.aggregate),
        field: substituteValue(valueIdMap, operation.field),
      });
    case "layoutOffset":
    case "layoutByteRange":
      return Object.freeze({
        ...base,
        base: substituteValue(valueIdMap, operation.base),
      });
    case "layoutEndianDecode":
      return Object.freeze({
        ...base,
        bytes: substituteValue(valueIdMap, operation.bytes),
      });
    case "memoryStore":
      return Object.freeze({
        ...base,
        storeValue: substituteValue(valueIdMap, operation.storeValue),
      });
    case "sourceCall":
    case "runtimeCall":
    case "platformCall":
    case "intrinsicCall":
      return Object.freeze({
        ...base,
        argumentIds: Object.freeze(
          operation.argumentIds.map((valueId) => substituteValue(valueIdMap, valueId)),
        ),
      });
    case "vectorLoad":
    case "vectorMaskedLoad":
      return Object.freeze({
        ...base,
        ...(operation.mask === undefined
          ? {}
          : { mask: substituteValue(valueIdMap, operation.mask) }),
      });
    case "vectorStore":
    case "vectorMaskedStore":
      return Object.freeze({
        ...base,
        vector: substituteValue(valueIdMap, operation.vector),
        storeValue: substituteValue(valueIdMap, operation.storeValue),
        ...(operation.mask === undefined
          ? {}
          : { mask: substituteValue(valueIdMap, operation.mask) }),
      });
    case "vectorShuffle":
    case "vectorCompare":
      return Object.freeze({
        ...base,
        sourceValueIds: Object.freeze(
          operation.sourceValueIds.map((valueId) => substituteValue(valueIdMap, valueId)),
        ),
      });
    case "vectorSelect":
      return Object.freeze({
        ...base,
        mask: substituteValue(valueIdMap, operation.mask),
        sourceValueIds: Object.freeze(
          operation.sourceValueIds.map((valueId) => substituteValue(valueIdMap, valueId)),
        ),
      });
    case "vectorByteSwap":
      return Object.freeze({
        ...base,
        vector: substituteValue(valueIdMap, operation.vector),
      });
  }
}

function remapTerminator(
  terminator: OptIrTerminator | undefined,
  operationIdMap: ReadonlyMap<OptIrOperationId, OptIrOperationId>,
  valueIdMap: ReadonlyMap<OptIrValueId, OptIrValueId>,
  edgeIdMap: ReadonlyMap<OptIrEdgeId, OptIrEdgeId>,
): OptIrTerminator | undefined {
  if (terminator === undefined) {
    return undefined;
  }
  const operationId = requireMappedOperation(operationIdMap, terminator.operationId);
  switch (terminator.kind) {
    case "jump":
      return Object.freeze({
        ...terminator,
        operationId,
        edge: requireMappedEdge(edgeIdMap, terminator.edge),
      });
    case "branch":
      return Object.freeze({
        ...terminator,
        operationId,
        condition: substituteValue(valueIdMap, terminator.condition),
        trueEdge: requireMappedEdge(edgeIdMap, terminator.trueEdge),
        falseEdge: requireMappedEdge(edgeIdMap, terminator.falseEdge),
      });
    case "switch":
      return Object.freeze({
        ...terminator,
        operationId,
        scrutinee: substituteValue(valueIdMap, terminator.scrutinee),
        cases: Object.freeze(
          terminator.cases.map((switchCase) =>
            Object.freeze({
              ...switchCase,
              edge: requireMappedEdge(edgeIdMap, switchCase.edge),
            }),
          ),
        ),
        defaultEdge: requireMappedEdge(edgeIdMap, terminator.defaultEdge),
      });
    case "return":
      return Object.freeze({
        ...terminator,
        operationId,
        values: Object.freeze(
          terminator.values.map((valueId) => substituteValue(valueIdMap, valueId)),
        ),
      });
    case "unreachable":
      return Object.freeze({ ...terminator, operationId });
  }
}

function requireMappedOperation(
  operationIdMap: ReadonlyMap<OptIrOperationId, OptIrOperationId>,
  operationId: OptIrOperationId,
): OptIrOperationId {
  const mapped = operationIdMap.get(operationId);
  if (mapped === undefined) {
    throw new Error(`Missing cloned operation id for ${Number(operationId)}.`);
  }
  return mapped;
}

function requireMappedBlock(
  blockIdMap: ReadonlyMap<OptIrBlockId, OptIrBlockId>,
  blockId: OptIrBlockId,
): OptIrBlockId {
  const mapped = blockIdMap.get(blockId);
  if (mapped === undefined) {
    throw new Error(`Missing cloned block id for ${Number(blockId)}.`);
  }
  return mapped;
}

function requireMappedEdge(
  edgeIdMap: ReadonlyMap<OptIrEdgeId, OptIrEdgeId>,
  edgeId: OptIrEdgeId,
): OptIrEdgeId {
  const mapped = edgeIdMap.get(edgeId);
  if (mapped === undefined) {
    throw new Error(`Missing cloned edge id for ${Number(edgeId)}.`);
  }
  return mapped;
}

function requireMappedValue(
  valueIdMap: ReadonlyMap<OptIrValueId, OptIrValueId>,
  valueId: OptIrValueId,
): OptIrValueId {
  const mapped = valueIdMap.get(valueId);
  if (mapped === undefined) {
    throw new Error(`Missing cloned value id for ${Number(valueId)}.`);
  }
  return mapped;
}

function substituteValue(
  valueIdMap: ReadonlyMap<OptIrValueId, OptIrValueId>,
  valueId: OptIrValueId,
): OptIrValueId {
  return valueIdMap.get(valueId) ?? valueId;
}

function nextId(ids: readonly number[]): number {
  return ids.length === 0 ? 1 : Math.max(...ids) + 1;
}

function terminatorValueIds(terminator: OptIrTerminator | undefined): readonly OptIrValueId[] {
  switch (terminator?.kind) {
    case undefined:
    case "jump":
    case "unreachable":
      return [];
    case "branch":
      return [terminator.condition];
    case "switch":
      return [terminator.scrutinee];
    case "return":
      return terminator.values;
  }
}

function compareOperations(left: OptIrOperation, right: OptIrOperation): number {
  return Number(left.operationId) - Number(right.operationId);
}
