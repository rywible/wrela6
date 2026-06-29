import type { OptIrBlock, OptIrEdge } from "../cfg";
import type { OptIrBlockId, OptIrOperationId, OptIrValueId } from "../ids";
import type { OptIrOperation } from "../operations";
import type { OptIrFunction } from "../program";
import type { OptIrTerminator } from "../terminators";

export interface OptIrLivenessInput {
  readonly func: OptIrFunction;
  readonly operationForId: (operationId: OptIrOperationId) => OptIrOperation | undefined;
}

export interface OptIrLivenessAnalysis {
  readonly liveIn: (blockId: OptIrBlockId) => readonly OptIrValueId[];
  readonly liveOut: (blockId: OptIrBlockId) => readonly OptIrValueId[];
  readonly blockUse: (blockId: OptIrBlockId) => readonly OptIrValueId[];
  readonly blockDef: (blockId: OptIrBlockId) => readonly OptIrValueId[];
  readonly edgeLiveOut: (edgeId: OptIrEdge["edgeId"]) => readonly OptIrValueId[];
}

export function computeOptIrLiveness(input: OptIrLivenessInput): OptIrLivenessAnalysis {
  const blocks = sortedBlocks(input.func.blocks);
  const blockById = new Map(blocks.map((block) => [block.blockId, block]));
  const blockFacts = new Map<OptIrBlockId, BlockUseDef>();
  for (const block of blocks) {
    blockFacts.set(block.blockId, computeBlockUseDef(block, input.operationForId));
  }

  const outgoingEdges = outgoingEdgesByBlock(input.func);
  const liveIn = new Map<OptIrBlockId, Set<OptIrValueId>>();
  const liveOut = new Map<OptIrBlockId, Set<OptIrValueId>>();
  const edgeLiveOut = new Map<OptIrEdge["edgeId"], Set<OptIrValueId>>();
  for (const block of blocks) {
    liveIn.set(block.blockId, new Set());
    liveOut.set(block.blockId, new Set());
  }

  let changed = true;
  while (changed) {
    changed = false;
    for (const block of [...blocks].reverse()) {
      const nextLiveOut = new Set<OptIrValueId>();
      for (const edge of outgoingEdges.get(block.blockId) ?? []) {
        const edgeLive = liveOutForEdge(edge, blockById, liveIn);
        edgeLiveOut.set(edge.edgeId, edgeLive);
        addAll(nextLiveOut, edgeLive);
      }

      const facts = blockFacts.get(block.blockId) ?? { use: new Set(), def: new Set() };
      const nextLiveIn = new Set(facts.use);
      for (const valueId of nextLiveOut) {
        if (!facts.def.has(valueId)) {
          nextLiveIn.add(valueId);
        }
      }

      if (!sameSet(liveOut.get(block.blockId) ?? new Set(), nextLiveOut)) {
        liveOut.set(block.blockId, nextLiveOut);
        changed = true;
      }
      if (!sameSet(liveIn.get(block.blockId) ?? new Set(), nextLiveIn)) {
        liveIn.set(block.blockId, nextLiveIn);
        changed = true;
      }
    }
  }

  for (const block of blocks) {
    for (const edge of outgoingEdges.get(block.blockId) ?? []) {
      edgeLiveOut.set(edge.edgeId, liveOutForEdge(edge, blockById, liveIn));
    }
  }

  return {
    liveIn(blockId) {
      return sortedValues(liveIn.get(blockId) ?? new Set());
    },
    liveOut(blockId) {
      return sortedValues(liveOut.get(blockId) ?? new Set());
    },
    blockUse(blockId) {
      return sortedValues(blockFacts.get(blockId)?.use ?? new Set());
    },
    blockDef(blockId) {
      return sortedValues(blockFacts.get(blockId)?.def ?? new Set());
    },
    edgeLiveOut(edgeId) {
      return sortedValues(edgeLiveOut.get(edgeId) ?? new Set());
    },
  };
}

interface BlockUseDef {
  readonly use: Set<OptIrValueId>;
  readonly def: Set<OptIrValueId>;
}

function computeBlockUseDef(
  block: OptIrBlock,
  operationForId: (operationId: OptIrOperationId) => OptIrOperation | undefined,
): BlockUseDef {
  const use = new Set<OptIrValueId>();
  const def = new Set<OptIrValueId>();

  for (const parameter of block.parameters) {
    def.add(parameter.valueId);
  }

  for (const operationId of block.operations) {
    const operation = operationForId(operationId);
    if (operation === undefined) {
      continue;
    }
    for (const operandId of operation.operandIds) {
      if (!def.has(operandId)) {
        use.add(operandId);
      }
    }
    for (const resultId of operation.resultIds) {
      def.add(resultId);
    }
  }

  if (block.terminator !== undefined) {
    for (const valueId of terminatorValues(block.terminator)) {
      if (!def.has(valueId)) {
        use.add(valueId);
      }
    }
  }

  return { use, def };
}

function terminatorValues(terminator: OptIrTerminator): readonly OptIrValueId[] {
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

function liveOutForEdge(
  edge: OptIrEdge,
  blockById: ReadonlyMap<OptIrBlockId, OptIrBlock>,
  liveIn: ReadonlyMap<OptIrBlockId, ReadonlySet<OptIrValueId>>,
): Set<OptIrValueId> {
  const result = new Set(edge.arguments);
  if (edge.toBlock === undefined) {
    return result;
  }
  const successor = blockById.get(edge.toBlock);
  const successorParameters = new Set(successor?.parameters.map((parameter) => parameter.valueId));
  for (const valueId of liveIn.get(edge.toBlock) ?? []) {
    if (!successorParameters.has(valueId)) {
      result.add(valueId);
    }
  }
  return result;
}

function outgoingEdgesByBlock(
  func: OptIrFunction,
): ReadonlyMap<OptIrBlockId, readonly OptIrEdge[]> {
  const outgoing = new Map<OptIrBlockId, OptIrEdge[]>();
  for (const block of func.blocks) {
    outgoing.set(block.blockId, []);
  }
  for (const edge of func.edges.entries()) {
    outgoing.get(edge.from)?.push(edge);
  }
  for (const [blockId, edges] of outgoing) {
    outgoing.set(
      blockId,
      edges.sort((left, right) => Number(left.edgeId) - Number(right.edgeId)),
    );
  }
  return outgoing;
}

function sortedBlocks(blocks: readonly OptIrBlock[]): readonly OptIrBlock[] {
  return [...blocks].sort((left, right) => Number(left.blockId) - Number(right.blockId));
}

function sortedValues(values: ReadonlySet<OptIrValueId>): readonly OptIrValueId[] {
  return [...values].sort((left, right) => Number(left) - Number(right));
}

function addAll<Value>(target: Set<Value>, source: Iterable<Value>): void {
  for (const value of source) {
    target.add(value);
  }
}

function sameSet<Value>(left: ReadonlySet<Value>, right: ReadonlySet<Value>): boolean {
  return left.size === right.size && [...left].every((value) => right.has(value));
}
