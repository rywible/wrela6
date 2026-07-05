import type { OptIrEdge } from "./cfg";
import {
  optIrBlockId,
  optIrEdgeId,
  optIrOperationId,
  optIrValueId,
  type OptIrBlockId,
  type OptIrEdgeId,
  type OptIrOperationId,
  type OptIrValueId,
} from "./ids";
import type { OptIrOperation } from "./operations";
import type { OptIrProgram } from "./program";
import type { OptIrTerminator } from "./terminators";

export interface OptIrFreshIdAllocator {
  readonly blockId: () => OptIrBlockId;
  readonly edgeId: () => OptIrEdgeId;
  readonly operationId: () => OptIrOperationId;
  readonly valueId: () => OptIrValueId;
}

export function createOptIrFreshIdAllocator(input: {
  readonly program: OptIrProgram;
  readonly operations: readonly OptIrOperation[];
}): OptIrFreshIdAllocator {
  let nextBlockId =
    Math.max(
      0,
      ...input.program.functions
        .entries()
        .flatMap((function_) => function_.blocks.map((block) => Number(block.blockId))),
    ) + 1;
  let nextEdgeId =
    Math.max(
      0,
      ...input.program.functions
        .entries()
        .flatMap((function_) => function_.edges.entries().map((edge) => Number(edge.edgeId))),
    ) + 1;
  let nextOperationId =
    Math.max(
      0,
      ...input.operations.map((operation) => Number(operation.operationId)),
      ...input.program.functions
        .entries()
        .flatMap((function_) =>
          function_.blocks.flatMap((block) =>
            block.terminator === undefined ? [] : [Number(block.terminator.operationId)],
          ),
        ),
    ) + 1;
  let nextValueId =
    Math.max(
      0,
      ...input.operations.flatMap((operation) => [
        ...operation.operandIds.map(Number),
        ...operation.resultIds.map(Number),
      ]),
      ...input.program.functions
        .entries()
        .flatMap((function_) =>
          function_.blocks.flatMap((block) => [
            ...block.parameters.map((parameter) => Number(parameter.valueId)),
            ...terminatorValueUses(block.terminator).map(Number),
          ]),
        ),
      ...input.program.functions
        .entries()
        .flatMap((function_) => function_.edges.entries().flatMap(edgeValueUses)),
    ) + 1;

  return {
    blockId() {
      return optIrBlockId(nextBlockId++);
    },
    edgeId() {
      return optIrEdgeId(nextEdgeId++);
    },
    operationId() {
      return optIrOperationId(nextOperationId++);
    },
    valueId() {
      return optIrValueId(nextValueId++);
    },
  };
}

function edgeValueUses(edge: OptIrEdge): readonly number[] {
  return [
    ...edge.arguments.map(Number),
    ...(edge.condition === undefined ? [] : [Number(edge.condition)]),
  ];
}

function terminatorValueUses(terminator: OptIrTerminator | undefined): readonly OptIrValueId[] {
  if (terminator === undefined) {
    return [];
  }
  switch (terminator.kind) {
    case "branch":
      return [terminator.condition];
    case "switch":
      return [terminator.scrutinee];
    case "return":
      return terminator.values;
    case "jump":
    case "unreachable":
      return [];
  }
}
