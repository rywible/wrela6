import type { OptIrBlock } from "../cfg";
import type { OptIrBlockId } from "../ids";
import type { OptIrFunction } from "../program";

export interface OptIrDominanceAnalysis {
  readonly entryBlock: OptIrBlockId;
  readonly blocks: () => readonly OptIrBlockId[];
  readonly reachableBlocks: () => readonly OptIrBlockId[];
  readonly isReachable: (blockId: OptIrBlockId) => boolean;
  readonly dominators: (blockId: OptIrBlockId) => readonly OptIrBlockId[];
  readonly dominates: (dominator: OptIrBlockId, dominated: OptIrBlockId) => boolean;
  readonly strictlyDominates: (dominator: OptIrBlockId, dominated: OptIrBlockId) => boolean;
  readonly immediateDominator: (blockId: OptIrBlockId) => OptIrBlockId | undefined;
  readonly blockDominatesUse: (definitionBlock: OptIrBlockId, useBlock: OptIrBlockId) => boolean;
}

export function computeOptIrDominance(func: OptIrFunction): OptIrDominanceAnalysis {
  const blocks = sortedBlockIds(func.blocks);
  const blockSet = new Set(blocks);
  const successors = successorsByBlock(func);
  const predecessors = predecessorsByBlock(blocks, successors);
  const reachable = reachableBlocks(func.entryBlock, successors);
  const reachableList = blocks.filter((blockId) => reachable.has(blockId));
  const allReachable = new Set(reachableList);
  const dominators = new Map<OptIrBlockId, Set<OptIrBlockId>>();

  for (const blockId of blocks) {
    if (!reachable.has(blockId)) {
      dominators.set(blockId, new Set([blockId]));
    } else if (blockId === func.entryBlock) {
      dominators.set(blockId, new Set([blockId]));
    } else {
      dominators.set(blockId, new Set(allReachable));
    }
  }

  let changed = true;
  while (changed) {
    changed = false;
    for (const blockId of reachableList) {
      if (blockId === func.entryBlock) {
        continue;
      }
      const predecessorIds = (predecessors.get(blockId) ?? []).filter((predecessor) =>
        reachable.has(predecessor),
      );
      const next = intersectDominators(predecessorIds, dominators);
      next.add(blockId);
      if (!sameSet(dominators.get(blockId) ?? new Set(), next)) {
        dominators.set(blockId, next);
        changed = true;
      }
    }
  }

  return {
    entryBlock: func.entryBlock,
    blocks() {
      return blocks.slice();
    },
    reachableBlocks() {
      return reachableList.slice();
    },
    isReachable(blockId) {
      return reachable.has(blockId);
    },
    dominators(blockId) {
      return sortedIds(dominators.get(blockId) ?? new Set());
    },
    dominates(dominator, dominated) {
      return blockSet.has(dominator) && (dominators.get(dominated)?.has(dominator) ?? false);
    },
    strictlyDominates(dominator, dominated) {
      return dominator !== dominated && (dominators.get(dominated)?.has(dominator) ?? false);
    },
    immediateDominator(blockId) {
      if (blockId === func.entryBlock || !reachable.has(blockId)) {
        return undefined;
      }
      const strictDominators = sortedIds(dominators.get(blockId) ?? new Set()).filter(
        (dominator) => dominator !== blockId,
      );
      return strictDominators.find((candidate) =>
        strictDominators.every(
          (other) => other === candidate || (dominators.get(candidate)?.has(other) ?? false),
        ),
      );
    },
    blockDominatesUse(definitionBlock, useBlock) {
      return (
        blockSet.has(definitionBlock) && (dominators.get(useBlock)?.has(definitionBlock) ?? false)
      );
    },
  };
}

function sortedBlockIds(blocks: readonly OptIrBlock[]): readonly OptIrBlockId[] {
  return [...blocks].map((block) => block.blockId).sort(compareIds);
}

function successorsByBlock(
  func: OptIrFunction,
): ReadonlyMap<OptIrBlockId, readonly OptIrBlockId[]> {
  const successors = new Map<OptIrBlockId, OptIrBlockId[]>();
  for (const block of func.blocks) {
    successors.set(block.blockId, []);
  }
  for (const edge of func.edges.entries()) {
    if (edge.toBlock !== undefined) {
      successors.get(edge.from)?.push(edge.toBlock);
    }
  }
  for (const [blockId, blockSuccessors] of successors) {
    successors.set(blockId, [...new Set(blockSuccessors)].sort(compareIds));
  }
  return successors;
}

function predecessorsByBlock(
  blocks: readonly OptIrBlockId[],
  successors: ReadonlyMap<OptIrBlockId, readonly OptIrBlockId[]>,
): ReadonlyMap<OptIrBlockId, readonly OptIrBlockId[]> {
  const predecessors = new Map<OptIrBlockId, OptIrBlockId[]>(
    blocks.map((blockId) => [blockId, []]),
  );
  for (const [from, successorIds] of successors) {
    for (const toBlock of successorIds) {
      predecessors.get(toBlock)?.push(from);
    }
  }
  for (const [blockId, predecessorIds] of predecessors) {
    predecessors.set(blockId, [...new Set(predecessorIds)].sort(compareIds));
  }
  return predecessors;
}

function reachableBlocks(
  entryBlock: OptIrBlockId,
  successors: ReadonlyMap<OptIrBlockId, readonly OptIrBlockId[]>,
): ReadonlySet<OptIrBlockId> {
  const reachable = new Set<OptIrBlockId>();
  const worklist = [entryBlock];
  while (worklist.length > 0) {
    const blockId = worklist.shift();
    if (blockId === undefined || reachable.has(blockId)) {
      continue;
    }
    reachable.add(blockId);
    worklist.push(...(successors.get(blockId) ?? []));
  }
  return reachable;
}

function intersectDominators(
  blockIds: readonly OptIrBlockId[],
  dominators: ReadonlyMap<OptIrBlockId, ReadonlySet<OptIrBlockId>>,
): Set<OptIrBlockId> {
  if (blockIds.length === 0) {
    return new Set();
  }
  const first = blockIds[0];
  if (first === undefined) {
    return new Set();
  }
  const rest = blockIds.slice(1);
  const intersection = new Set(dominators.get(first) ?? []);
  for (const blockId of rest) {
    const next = dominators.get(blockId) ?? new Set();
    for (const dominator of intersection) {
      if (!next.has(dominator)) {
        intersection.delete(dominator);
      }
    }
  }
  return intersection;
}

function sortedIds(ids: ReadonlySet<OptIrBlockId>): readonly OptIrBlockId[] {
  return [...ids].sort(compareIds);
}

function sameSet(left: ReadonlySet<OptIrBlockId>, right: ReadonlySet<OptIrBlockId>): boolean {
  return left.size === right.size && [...left].every((value) => right.has(value));
}

function compareIds(left: OptIrBlockId, right: OptIrBlockId): number {
  return Number(left) - Number(right);
}
