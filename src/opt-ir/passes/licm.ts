import { computeOptIrDominance } from "../analyses/dominance";
import { computeOptIrLoopTree, type OptIrLoopRecord } from "../analyses/loop-tree";
import { optIrCfgEdgeTable, type OptIrBlock, type OptIrEdge } from "../cfg";
import { type OptIrBlockId, type OptIrOperationId, type OptIrValueId } from "../ids";
import { createOptIrFreshIdAllocator, type OptIrFreshIdAllocator } from "../fresh-ids";
import type { OptIrOperation } from "../operations";
import { optIrFunctionTable, type OptIrFunction, type OptIrProgram } from "../program";
import { operationCanMoveToPreheader } from "./licm-speculation";
import type { OptIrMemoryRewriteRecord } from "./memory-optimization";

export interface OptIrLicmInput {
  readonly program: OptIrProgram;
  readonly operations: readonly OptIrOperation[];
  readonly loopOperationIds: readonly OptIrOperationId[];
  readonly effectBoundaryOperationIds: readonly OptIrOperationId[];
  readonly regionSafeOperationIds?: readonly OptIrOperationId[];
}

export interface OptIrLicmResult {
  readonly program: OptIrProgram;
  readonly movedOperationIds: readonly OptIrOperationId[];
  readonly blockedOperationIds: readonly OptIrOperationId[];
  readonly rewriteRecords: readonly OptIrMemoryRewriteRecord[];
}

export function runLicmForTest(input: OptIrLicmInput): OptIrLicmResult {
  return runLicm(input);
}

export function runLicm(input: OptIrLicmInput): OptIrLicmResult {
  const operations = new Map(
    input.operations.map((operation) => [operation.operationId, operation]),
  );
  const boundaries = new Set(input.effectBoundaryOperationIds);
  const regionSafe = new Set(input.regionSafeOperationIds ?? []);
  const hoisted = hoistOperationsInProgram({
    program: input.program,
    operations,
    loopOperationIds: input.loopOperationIds,
    effectBoundaryOperationIds: boundaries,
    regionSafeOperationIds: regionSafe,
  });
  const movedOperationIds = [...hoisted.movedOperationIds].sort(compareOperationIds);
  const rewriteRecords = movedOperationIds.map(
    (operationId): OptIrMemoryRewriteRecord => ({
      subject: { kind: "operation", operationId },
      invariant: { kind: "effectBoundaryEquivalence" },
    }),
  );

  return {
    program: movedOperationIds.length === 0 ? input.program : hoisted.program,
    movedOperationIds,
    blockedOperationIds: [...hoisted.blockedOperationIds].sort(compareOperationIds),
    rewriteRecords,
  };
}

function resultProducerByValue(
  loopOperationIds: readonly OptIrOperationId[],
  operations: ReadonlyMap<OptIrOperationId, OptIrOperation>,
): ReadonlyMap<number, OptIrOperationId> {
  const producerByValue = new Map<number, OptIrOperationId>();
  for (const operationId of loopOperationIds) {
    const operation = operations.get(operationId);
    if (operation === undefined) {
      continue;
    }
    for (const resultId of operation.resultIds) {
      producerByValue.set(Number(resultId), operationId);
    }
  }
  return producerByValue;
}

function hoistOperationsInProgram(input: {
  readonly program: OptIrProgram;
  readonly operations: ReadonlyMap<OptIrOperationId, OptIrOperation>;
  readonly loopOperationIds: readonly OptIrOperationId[];
  readonly effectBoundaryOperationIds: ReadonlySet<OptIrOperationId>;
  readonly regionSafeOperationIds: ReadonlySet<OptIrOperationId>;
}): {
  readonly program: OptIrProgram;
  readonly movedOperationIds: ReadonlySet<OptIrOperationId>;
  readonly blockedOperationIds: ReadonlySet<OptIrOperationId>;
} {
  const movedOperationIds = new Set<OptIrOperationId>();
  const blockedOperationIds = new Set<OptIrOperationId>();
  const requestedLoopOperationIds = new Set(input.loopOperationIds);
  const freshIds = createOptIrFreshIdAllocator({
    program: input.program,
    operations: [...input.operations.values()],
  });
  const functions = input.program.functions.entries().map((function_) => {
    const result = hoistOperationsInFunction({
      function_,
      operations: input.operations,
      freshIds,
      requestedLoopOperationIds,
      effectBoundaryOperationIds: input.effectBoundaryOperationIds,
      regionSafeOperationIds: input.regionSafeOperationIds,
    });
    for (const operationId of result.movedOperationIds) movedOperationIds.add(operationId);
    for (const operationId of result.blockedOperationIds) blockedOperationIds.add(operationId);
    return result.function_;
  });
  return {
    program: { ...input.program, functions: optIrFunctionTable(functions) },
    movedOperationIds,
    blockedOperationIds,
  };
}

function hoistOperationsInFunction(input: {
  readonly function_: OptIrFunction;
  readonly operations: ReadonlyMap<OptIrOperationId, OptIrOperation>;
  readonly freshIds: OptIrFreshIdAllocator;
  readonly requestedLoopOperationIds: ReadonlySet<OptIrOperationId>;
  readonly effectBoundaryOperationIds: ReadonlySet<OptIrOperationId>;
  readonly regionSafeOperationIds: ReadonlySet<OptIrOperationId>;
}): {
  readonly function_: OptIrFunction;
  readonly movedOperationIds: ReadonlySet<OptIrOperationId>;
  readonly blockedOperationIds: ReadonlySet<OptIrOperationId>;
} {
  let currentFunction = input.function_;
  const movedOperationIds = new Set<OptIrOperationId>();
  const blockedOperationIds = new Set<OptIrOperationId>();
  const loops = [...computeOptIrLoopTree(input.function_).loops()].sort(
    (left, right) =>
      left.blocks.length - right.blocks.length || Number(left.header) - Number(right.header),
  );

  for (const loop of loops) {
    const prepared = ensureLoopPreheader(currentFunction, loop, input.freshIds);
    if (prepared === undefined) {
      for (const operationId of loopOperationIdsInProgramOrder(
        currentFunction,
        loop,
        input.requestedLoopOperationIds,
      )) {
        blockedOperationIds.add(operationId);
      }
      continue;
    }
    currentFunction = prepared.function_;
    const selected = selectLoopInvariantOperations({
      function_: currentFunction,
      operations: input.operations,
      loop,
      preheaderBlockId: prepared.preheaderBlockId,
      requestedLoopOperationIds: input.requestedLoopOperationIds,
      effectBoundaryOperationIds: input.effectBoundaryOperationIds,
      regionSafeOperationIds: input.regionSafeOperationIds,
    });
    for (const operationId of selected.blockedOperationIds) {
      blockedOperationIds.add(operationId);
    }
    if (selected.hoistableOperationIds.length === 0) {
      continue;
    }
    const moved = moveOperationsToPreheader({
      function_: currentFunction,
      loop,
      preheaderBlockId: prepared.preheaderBlockId,
      operationIds: selected.hoistableOperationIds,
    });
    if (moved.movedOperationIds.size === 0) {
      continue;
    }
    currentFunction = moved.function_;
    for (const operationId of moved.movedOperationIds) {
      movedOperationIds.add(operationId);
      blockedOperationIds.delete(operationId);
    }
  }

  return {
    function_: currentFunction,
    movedOperationIds,
    blockedOperationIds,
  };
}

function ensureLoopPreheader(
  function_: OptIrFunction,
  loop: OptIrLoopRecord,
  freshIds: OptIrFreshIdAllocator,
): { readonly function_: OptIrFunction; readonly preheaderBlockId: OptIrBlockId } | undefined {
  const loopBlocks = new Set(loop.blocks);
  const header = function_.blocks.find((block) => block.blockId === loop.header);
  if (header === undefined) {
    return undefined;
  }
  const outsideEdges = function_.edges
    .entries()
    .filter((edge) => edge.toBlock === loop.header && !loopBlocks.has(edge.from));
  if (outsideEdges.length === 0) {
    return undefined;
  }
  if (outsideEdges.length === 1) {
    const edge = outsideEdges[0];
    const predecessor = edge === undefined ? undefined : blockById(function_).get(edge.from);
    if (
      edge !== undefined &&
      predecessor?.terminator?.kind === "jump" &&
      predecessor.terminator.edge === edge.edgeId
    ) {
      return { function_, preheaderBlockId: predecessor.blockId };
    }
  }
  return insertLoopPreheader({ function_, freshIds, loop, header, outsideEdges });
}

function insertLoopPreheader(input: {
  readonly function_: OptIrFunction;
  readonly freshIds: OptIrFreshIdAllocator;
  readonly loop: OptIrLoopRecord;
  readonly header: OptIrBlock;
  readonly outsideEdges: readonly OptIrEdge[];
}): { readonly function_: OptIrFunction; readonly preheaderBlockId: OptIrBlockId } | undefined {
  const headerEdgeParameters = edgeSuppliedParameters(input.header);
  if (input.outsideEdges.some((edge) => edge.arguments.length !== headerEdgeParameters.length)) {
    return undefined;
  }
  const preheaderBlockId = input.freshIds.blockId();
  const preheaderParameters = headerEdgeParameters.map((parameter) => ({
    ...parameter,
    valueId: input.freshIds.valueId(),
    incomingRole: parameter.incomingRole === "entry" ? ("phi" as const) : parameter.incomingRole,
  }));
  const preheaderEdge = Object.freeze({
    edgeId: input.freshIds.edgeId(),
    from: preheaderBlockId,
    toBlock: input.loop.header,
    ordinal: 0,
    kind: "normal" as const,
    arguments: Object.freeze(preheaderParameters.map((parameter) => parameter.valueId)),
    originId: input.header.originId,
  });
  const preheaderBlock = Object.freeze({
    blockId: preheaderBlockId,
    parameters: Object.freeze(preheaderParameters),
    operations: Object.freeze([]),
    terminator: Object.freeze({
      kind: "jump" as const,
      operationId: input.freshIds.operationId(),
      edge: preheaderEdge.edgeId,
      originId: input.header.originId,
    }),
    originId: input.header.originId,
  });
  const outsideEdgeIds = new Set(input.outsideEdges.map((edge) => edge.edgeId));
  const edges = input.function_.edges
    .entries()
    .map((edge) =>
      outsideEdgeIds.has(edge.edgeId)
        ? Object.freeze({ ...edge, toBlock: preheaderBlockId })
        : edge,
    );

  return {
    preheaderBlockId,
    function_: Object.freeze({
      ...input.function_,
      blocks: Object.freeze(
        insertBlockBefore(input.function_.blocks, input.header.blockId, preheaderBlock),
      ),
      edges: optIrCfgEdgeTable([...edges, preheaderEdge]),
    }),
  };
}

function selectLoopInvariantOperations(input: {
  readonly function_: OptIrFunction;
  readonly operations: ReadonlyMap<OptIrOperationId, OptIrOperation>;
  readonly loop: OptIrLoopRecord;
  readonly preheaderBlockId: OptIrBlockId;
  readonly requestedLoopOperationIds: ReadonlySet<OptIrOperationId>;
  readonly effectBoundaryOperationIds: ReadonlySet<OptIrOperationId>;
  readonly regionSafeOperationIds: ReadonlySet<OptIrOperationId>;
}): {
  readonly hoistableOperationIds: readonly OptIrOperationId[];
  readonly blockedOperationIds: readonly OptIrOperationId[];
} {
  const loopBlockIds = new Set(input.loop.blocks);
  const loopOperationIds = loopOperationIdsInProgramOrder(
    input.function_,
    input.loop,
    input.requestedLoopOperationIds,
  );
  const loopResultProducers = resultProducerByValue(loopOperationIds, input.operations);
  const definitionBlockByValue = valueDefinitionBlocks(input.function_, input.operations);
  const dominance = computeOptIrDominance(input.function_);
  const hoistable = new Set<OptIrOperationId>();
  const blocked = new Set<OptIrOperationId>();

  let changed = true;
  while (changed) {
    changed = false;
    for (const operationId of loopOperationIds) {
      if (hoistable.has(operationId) || blocked.has(operationId)) {
        continue;
      }
      const operation = input.operations.get(operationId);
      if (operation === undefined || input.effectBoundaryOperationIds.has(operationId)) {
        blocked.add(operationId);
        continue;
      }
      if (
        operationCanMoveToPreheader(operation, operationId, input.regionSafeOperationIds) &&
        operandsAreAvailableInPreheader({
          operation,
          loopBlockIds,
          loopResultProducers,
          hoistableOperationIds: hoistable,
          definitionBlockByValue,
          preheaderBlockId: input.preheaderBlockId,
          blockDominatesUse: dominance.blockDominatesUse,
        })
      ) {
        hoistable.add(operationId);
        changed = true;
      }
    }
  }

  for (const operationId of loopOperationIds) {
    if (!hoistable.has(operationId)) {
      blocked.add(operationId);
    }
  }

  return {
    hoistableOperationIds: Object.freeze(
      loopOperationIds.filter((operationId) => hoistable.has(operationId)),
    ),
    blockedOperationIds: Object.freeze([...blocked].sort(compareOperationIds)),
  };
}

function operandsAreAvailableInPreheader(input: {
  readonly operation: OptIrOperation;
  readonly loopBlockIds: ReadonlySet<OptIrBlockId>;
  readonly loopResultProducers: ReadonlyMap<number, OptIrOperationId>;
  readonly hoistableOperationIds: ReadonlySet<OptIrOperationId>;
  readonly definitionBlockByValue: ReadonlyMap<OptIrValueId, OptIrBlockId>;
  readonly preheaderBlockId: OptIrBlockId;
  readonly blockDominatesUse: (definitionBlock: OptIrBlockId, useBlock: OptIrBlockId) => boolean;
}): boolean {
  return input.operation.operandIds.every((operandId) => {
    const producer = input.loopResultProducers.get(Number(operandId));
    if (producer !== undefined) {
      return input.hoistableOperationIds.has(producer);
    }
    const definitionBlock = input.definitionBlockByValue.get(operandId);
    return (
      definitionBlock === undefined ||
      (!input.loopBlockIds.has(definitionBlock) &&
        (definitionBlock === input.preheaderBlockId ||
          input.blockDominatesUse(definitionBlock, input.preheaderBlockId)))
    );
  });
}

function moveOperationsToPreheader(input: {
  readonly function_: OptIrFunction;
  readonly loop: OptIrLoopRecord;
  readonly preheaderBlockId: OptIrBlockId;
  readonly operationIds: readonly OptIrOperationId[];
}): {
  readonly function_: OptIrFunction;
  readonly movedOperationIds: ReadonlySet<OptIrOperationId>;
} {
  const loopBlockIds = new Set(input.loop.blocks);
  const operationIds = new Set(input.operationIds);
  const movedOperationIds = new Set<OptIrOperationId>();
  const hoisted = input.operationIds.filter((operationId) => {
    const block = input.function_.blocks.find((candidate) =>
      candidate.operations.includes(operationId),
    );
    return (
      block !== undefined &&
      block.blockId !== input.preheaderBlockId &&
      loopBlockIds.has(block.blockId)
    );
  });
  if (hoisted.length === 0) {
    return { function_: input.function_, movedOperationIds };
  }
  for (const operationId of hoisted) {
    movedOperationIds.add(operationId);
  }
  return {
    function_: Object.freeze({
      ...input.function_,
      blocks: Object.freeze(
        input.function_.blocks.map((block) => {
          if (block.blockId === input.preheaderBlockId) {
            return Object.freeze({
              ...block,
              operations: Object.freeze([...block.operations, ...hoisted]),
            });
          }
          if (!loopBlockIds.has(block.blockId)) {
            return block;
          }
          return Object.freeze({
            ...block,
            operations: Object.freeze(
              block.operations.filter((operationId) => !operationIds.has(operationId)),
            ),
          });
        }),
      ),
    }),
    movedOperationIds,
  };
}

function loopOperationIdsInProgramOrder(
  function_: OptIrFunction,
  loop: OptIrLoopRecord,
  requestedLoopOperationIds: ReadonlySet<OptIrOperationId>,
): readonly OptIrOperationId[] {
  const loopBlockIds = new Set(loop.blocks);
  return function_.blocks
    .filter((block) => loopBlockIds.has(block.blockId))
    .flatMap((block) => block.operations)
    .filter(
      (operationId) =>
        requestedLoopOperationIds.size === 0 || requestedLoopOperationIds.has(operationId),
    );
}

function valueDefinitionBlocks(
  function_: OptIrFunction,
  operations: ReadonlyMap<OptIrOperationId, OptIrOperation>,
): ReadonlyMap<OptIrValueId, OptIrBlockId> {
  const definitions = new Map<OptIrValueId, OptIrBlockId>();
  for (const block of function_.blocks) {
    for (const parameter of block.parameters) {
      definitions.set(parameter.valueId, block.blockId);
    }
    for (const operationId of block.operations) {
      const operation = operations.get(operationId);
      if (operation === undefined) continue;
      for (const resultId of operation.resultIds) {
        definitions.set(resultId, block.blockId);
      }
    }
  }
  return definitions;
}

function blockById(function_: OptIrFunction): ReadonlyMap<OptIrBlockId, OptIrBlock> {
  return new Map(function_.blocks.map((block) => [block.blockId, block]));
}

function edgeSuppliedParameters(block: OptIrBlock) {
  return block.parameters.filter((parameter) => parameter.incomingRole !== "entry");
}

function insertBlockBefore(
  blocks: readonly OptIrBlock[],
  beforeBlockId: OptIrBlockId,
  blockToInsert: OptIrBlock,
): readonly OptIrBlock[] {
  const output: OptIrBlock[] = [];
  let inserted = false;
  for (const block of blocks) {
    if (!inserted && block.blockId === beforeBlockId) {
      output.push(blockToInsert);
      inserted = true;
    }
    output.push(block);
  }
  if (!inserted) {
    output.push(blockToInsert);
  }
  return output;
}

function compareOperationIds(left: OptIrOperationId, right: OptIrOperationId): number {
  return Number(left) - Number(right);
}
