import { optIrCfgEdgeTable, type OptIrBlock, type OptIrEdge } from "../cfg";
import {
  optIrCallId,
  type OptIrBlockId,
  type OptIrEdgeId,
  type OptIrOperationId,
  type OptIrValueId,
} from "../ids";
import type { OptIrFreshIdAllocator } from "../id-allocation";
import type { OptIrOperation } from "../operations";
import type { OptIrFunction } from "../program";
import type { OptIrTerminator } from "../terminators";
import { rewriteOptIrOperationValues } from "./operation-value-rewrite";
import {
  buildOperandSubstitution,
  type SourceCallOperation,
  valueForSubstitution,
} from "./whole-program-inlining-bindings";

export interface InlineCallSite {
  readonly block: OptIrBlock;
  readonly operationIndex: number;
}

export function buildInlineSplice(input: {
  readonly caller: OptIrFunction;
  readonly callee: OptIrFunction;
  readonly entryBlock: OptIrBlock;
  readonly callSite: InlineCallSite;
  readonly callOperation: SourceCallOperation;
  readonly calleeOperations: readonly OptIrOperation[];
  readonly freshIds: OptIrFreshIdAllocator;
}):
  | {
      readonly functionOutput: OptIrFunction;
      readonly clonedOperations: readonly OptIrOperation[];
    }
  | undefined {
  const ids = input.freshIds;
  const mergeBlockId = ids.blockId();
  const callToEntryEdgeId = ids.edgeId();
  const blockSubstitution = new Map<OptIrBlockId, OptIrBlockId>(
    input.callee.blocks.map((block) => [block.blockId, ids.blockId()]),
  );
  const edgeSubstitution = new Map<OptIrEdgeId, OptIrEdgeId>(
    input.callee.edges.entries().map((edge) => [edge.edgeId, ids.edgeId()]),
  );
  const operationSubstitution = new Map<OptIrOperationId, OptIrOperationId>(
    input.calleeOperations.map((operation) => [operation.operationId, ids.operationId()]),
  );
  const returnEdgeByBlock = new Map<OptIrBlockId, OptIrEdgeId>();
  for (const block of input.callee.blocks) {
    if (block.terminator?.kind === "return") {
      returnEdgeByBlock.set(block.blockId, ids.edgeId());
    }
  }
  const valueSubstitution = new Map(
    buildOperandSubstitution(input.callOperation, input.entryBlock),
  );
  for (const block of input.callee.blocks) {
    if (block.blockId === input.entryBlock.blockId) {
      continue;
    }
    for (const parameter of block.parameters) {
      valueSubstitution.set(parameter.valueId, ids.valueId());
    }
  }
  for (const operation of input.calleeOperations) {
    for (const resultId of operation.resultIds) {
      valueSubstitution.set(resultId, ids.valueId());
    }
  }

  const clonedOperations = input.calleeOperations.map((operation) =>
    rewriteOperationId(
      rewriteOptIrOperationValues(operation, {
        valueFor: (valueId) => valueForSubstitution(valueSubstitution, valueId),
      }),
      requireMappedId(operationSubstitution, operation.operationId, "operation"),
    ),
  );
  const clonedBlocks = input.callee.blocks.map((block) =>
    cloneInlineBlock({
      block,
      entryBlockId: input.entryBlock.blockId,
      mergeBlockId,
      blockSubstitution,
      edgeSubstitution,
      returnEdgeByBlock,
      operationSubstitution,
      valueSubstitution,
      ids,
    }),
  );
  const clonedEdges = input.callee.edges
    .entries()
    .map((edge) =>
      cloneInlineEdge({ edge, blockSubstitution, edgeSubstitution, valueSubstitution }),
    );
  if (clonedEdges.some((edge) => edgeFeedsDestinationParameterWithItself(edge, clonedBlocks))) {
    return undefined;
  }
  const returnEdges: OptIrEdge[] = [];
  for (const block of input.callee.blocks) {
    if (block.terminator?.kind !== "return") {
      continue;
    }
    const edgeId = returnEdgeByBlock.get(block.blockId);
    const from = blockSubstitution.get(block.blockId);
    if (edgeId === undefined || from === undefined) {
      return undefined;
    }
    const edgeArguments = block.terminator.values.map((valueId) =>
      valueForSubstitution(valueSubstitution, valueId),
    );
    if (
      edgeArguments.some((argumentId, index) => argumentId === input.callOperation.resultIds[index])
    ) {
      return undefined;
    }
    returnEdges.push(
      Object.freeze({
        edgeId,
        from,
        toBlock: mergeBlockId,
        ordinal: 0,
        kind: "normal" as const,
        arguments: Object.freeze(edgeArguments),
        originId: block.terminator.originId,
      }),
    );
  }
  if (returnEdges.length !== returnEdgeByBlock.size) {
    return undefined;
  }

  const callBlock = input.callSite.block;
  const beforeCall = callBlock.operations.slice(0, input.callSite.operationIndex);
  const afterCall = callBlock.operations.slice(input.callSite.operationIndex + 1);
  const mergeBlock = Object.freeze({
    blockId: mergeBlockId,
    parameters: Object.freeze(
      input.callOperation.resultIds.map((valueId, index) =>
        Object.freeze({
          kind: "blockParameter" as const,
          valueId,
          type: input.callOperation.resultTypes[index]!,
          incomingRole: "phi" as const,
          originId: input.callOperation.originId,
        }),
      ),
    ),
    operations: Object.freeze(afterCall),
    ...(callBlock.terminator === undefined ? {} : { terminator: callBlock.terminator }),
    originId: callBlock.originId,
  });
  if (mergeBlock.parameters.length !== input.callOperation.resultTypes.length) {
    return undefined;
  }
  const preCallBlock = Object.freeze({
    ...callBlock,
    operations: Object.freeze(beforeCall),
    terminator: Object.freeze({
      kind: "jump" as const,
      operationId: ids.operationId(),
      edge: callToEntryEdgeId,
      originId: input.callOperation.originId,
    }),
  });
  const callToEntryEdge = Object.freeze({
    edgeId: callToEntryEdgeId,
    from: callBlock.blockId,
    toBlock: requireMappedId(blockSubstitution, input.entryBlock.blockId, "block"),
    ordinal: 0,
    kind: "normal" as const,
    arguments: Object.freeze([]),
    originId: input.callOperation.originId,
  });
  const originalCallerEdges = input.caller.edges
    .entries()
    .map((edge) =>
      edge.from === callBlock.blockId ? Object.freeze({ ...edge, from: mergeBlockId }) : edge,
    );
  const blocks = input.caller.blocks.flatMap((block) =>
    block.blockId === callBlock.blockId ? [preCallBlock, ...clonedBlocks, mergeBlock] : [block],
  );

  return {
    functionOutput: Object.freeze({
      ...input.caller,
      blocks: Object.freeze(blocks),
      edges: optIrCfgEdgeTable([
        ...originalCallerEdges,
        callToEntryEdge,
        ...clonedEdges,
        ...returnEdges,
      ]),
    }),
    clonedOperations: Object.freeze(clonedOperations),
  };
}

export function findCallSite(
  caller: OptIrFunction,
  callOperationId: OptIrOperationId,
): InlineCallSite | undefined {
  for (const block of caller.blocks) {
    const operationIndex = block.operations.indexOf(callOperationId);
    if (operationIndex >= 0) {
      return { block, operationIndex };
    }
  }
  return undefined;
}

function cloneInlineBlock(input: {
  readonly block: OptIrBlock;
  readonly entryBlockId: OptIrBlockId;
  readonly mergeBlockId: OptIrBlockId;
  readonly blockSubstitution: ReadonlyMap<OptIrBlockId, OptIrBlockId>;
  readonly edgeSubstitution: ReadonlyMap<OptIrEdgeId, OptIrEdgeId>;
  readonly returnEdgeByBlock: ReadonlyMap<OptIrBlockId, OptIrEdgeId>;
  readonly operationSubstitution: ReadonlyMap<OptIrOperationId, OptIrOperationId>;
  readonly valueSubstitution: ReadonlyMap<OptIrValueId, OptIrValueId>;
  readonly ids: OptIrFreshIdAllocator;
}): OptIrBlock {
  return Object.freeze({
    ...input.block,
    blockId: requireMappedId(input.blockSubstitution, input.block.blockId, "block"),
    parameters:
      input.block.blockId === input.entryBlockId
        ? Object.freeze([])
        : Object.freeze(
            input.block.parameters.map((parameter) =>
              Object.freeze({
                ...parameter,
                valueId: valueForSubstitution(input.valueSubstitution, parameter.valueId),
              }),
            ),
          ),
    operations: Object.freeze(
      input.block.operations.map((operationId) =>
        requireMappedId(input.operationSubstitution, operationId, "operation"),
      ),
    ),
    ...(input.block.terminator === undefined
      ? {}
      : {
          terminator: rewriteInlineTerminator({
            terminator: input.block.terminator,
            blockId: input.block.blockId,
            mergeBlockId: input.mergeBlockId,
            edgeSubstitution: input.edgeSubstitution,
            returnEdgeByBlock: input.returnEdgeByBlock,
            valueSubstitution: input.valueSubstitution,
            ids: input.ids,
          }),
        }),
  });
}

function rewriteInlineTerminator(input: {
  readonly terminator: OptIrTerminator;
  readonly blockId: OptIrBlockId;
  readonly mergeBlockId: OptIrBlockId;
  readonly edgeSubstitution: ReadonlyMap<OptIrEdgeId, OptIrEdgeId>;
  readonly returnEdgeByBlock: ReadonlyMap<OptIrBlockId, OptIrEdgeId>;
  readonly valueSubstitution: ReadonlyMap<OptIrValueId, OptIrValueId>;
  readonly ids: OptIrFreshIdAllocator;
}): OptIrTerminator {
  switch (input.terminator.kind) {
    case "jump":
      return Object.freeze({
        ...input.terminator,
        operationId: input.ids.operationId(),
        edge: requireMappedId(input.edgeSubstitution, input.terminator.edge, "edge"),
      });
    case "branch":
      return Object.freeze({
        ...input.terminator,
        operationId: input.ids.operationId(),
        condition: valueForSubstitution(input.valueSubstitution, input.terminator.condition),
        trueEdge: requireMappedId(input.edgeSubstitution, input.terminator.trueEdge, "edge"),
        falseEdge: requireMappedId(input.edgeSubstitution, input.terminator.falseEdge, "edge"),
      });
    case "switch":
      return Object.freeze({
        ...input.terminator,
        operationId: input.ids.operationId(),
        scrutinee: valueForSubstitution(input.valueSubstitution, input.terminator.scrutinee),
        cases: Object.freeze(
          input.terminator.cases.map((switchCase) =>
            Object.freeze({
              ...switchCase,
              edge: requireMappedId(input.edgeSubstitution, switchCase.edge, "edge"),
            }),
          ),
        ),
        defaultEdge: requireMappedId(input.edgeSubstitution, input.terminator.defaultEdge, "edge"),
      });
    case "return":
      return Object.freeze({
        kind: "jump" as const,
        operationId: input.ids.operationId(),
        edge: requireMappedId(input.returnEdgeByBlock, input.blockId, "return-edge"),
        originId: input.terminator.originId,
      });
    case "unreachable":
      return Object.freeze({
        ...input.terminator,
        operationId: input.ids.operationId(),
      });
  }
}

function cloneInlineEdge(input: {
  readonly edge: OptIrEdge;
  readonly blockSubstitution: ReadonlyMap<OptIrBlockId, OptIrBlockId>;
  readonly edgeSubstitution: ReadonlyMap<OptIrEdgeId, OptIrEdgeId>;
  readonly valueSubstitution: ReadonlyMap<OptIrValueId, OptIrValueId>;
}): OptIrEdge {
  return Object.freeze({
    ...input.edge,
    edgeId: requireMappedId(input.edgeSubstitution, input.edge.edgeId, "edge"),
    from: requireMappedId(input.blockSubstitution, input.edge.from, "block"),
    ...(input.edge.toBlock === undefined
      ? {}
      : { toBlock: requireMappedId(input.blockSubstitution, input.edge.toBlock, "block") }),
    arguments: Object.freeze(
      input.edge.arguments.map((valueId) => valueForSubstitution(input.valueSubstitution, valueId)),
    ),
    ...(input.edge.condition === undefined
      ? {}
      : { condition: valueForSubstitution(input.valueSubstitution, input.edge.condition) }),
  });
}

function edgeFeedsDestinationParameterWithItself(
  edge: OptIrEdge,
  blocks: readonly OptIrBlock[],
): boolean {
  if (edge.toBlock === undefined) {
    return false;
  }
  const destination = blocks.find((block) => block.blockId === edge.toBlock);
  if (destination === undefined) {
    return false;
  }
  const parameters = destination.parameters.filter(
    (parameter) => parameter.incomingRole !== "entry",
  );
  return parameters.some((parameter, index) => edge.arguments[index] === parameter.valueId);
}

function requireMappedId<SourceId, TargetId>(
  substitution: ReadonlyMap<SourceId, TargetId>,
  sourceId: SourceId,
  label: string,
): TargetId {
  const targetId = substitution.get(sourceId);
  if (targetId === undefined) {
    throw new RangeError(`Missing whole-program inline ${label} clone for ${String(sourceId)}.`);
  }
  return targetId;
}

function rewriteOperationId(
  operation: OptIrOperation,
  operationId: OptIrOperationId,
): OptIrOperation {
  return Object.freeze({
    ...operation,
    operationId,
    ...("callId" in operation ? { callId: optIrCallId(Number(operationId)) } : {}),
  });
}
