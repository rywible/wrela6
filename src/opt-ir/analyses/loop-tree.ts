import type { OptIrBlockId } from "../ids";
import type { OptIrFunction } from "../program";
import { computeOptIrDominance } from "./dominance";

export interface OptIrLoopRecord {
  readonly header: OptIrBlockId;
  readonly latches: readonly OptIrBlockId[];
  readonly blocks: readonly OptIrBlockId[];
}

export interface OptIrLoopTree {
  readonly loops: () => readonly OptIrLoopRecord[];
  readonly loopDepth: (blockId: OptIrBlockId) => number;
  readonly latchesForHeader: (header: OptIrBlockId) => readonly OptIrBlockId[];
  readonly isColdPath: (blockId: OptIrBlockId) => boolean;
  readonly isTerminalPath: (blockId: OptIrBlockId) => boolean;
}

export function computeOptIrLoopTree(func: OptIrFunction): OptIrLoopTree {
  const dominance = computeOptIrDominance(func);
  const predecessors = predecessorsByBlock(func);
  const loopsByHeader = new Map<
    OptIrBlockId,
    { latches: Set<OptIrBlockId>; blocks: Set<OptIrBlockId> }
  >();

  for (const cfgEdge of func.edges.entries()) {
    if (cfgEdge.toBlock === undefined) {
      continue;
    }
    if (!dominance.dominates(cfgEdge.toBlock, cfgEdge.from)) {
      continue;
    }
    const loop = loopsByHeader.get(cfgEdge.toBlock) ?? {
      latches: new Set<OptIrBlockId>(),
      blocks: new Set<OptIrBlockId>([cfgEdge.toBlock]),
    };
    loop.latches.add(cfgEdge.from);
    collectNaturalLoopBlocks({
      header: cfgEdge.toBlock,
      latch: cfgEdge.from,
      predecessors,
      blocks: loop.blocks,
    });
    loopsByHeader.set(cfgEdge.toBlock, loop);
  }

  const loopRecords = [...loopsByHeader.entries()]
    .map(([header, loop]) =>
      Object.freeze({
        header,
        latches: Object.freeze([...sortedBlockIds(loop.latches)]),
        blocks: Object.freeze([...sortedBlockIds(loop.blocks)]),
      }),
    )
    .sort((left, right) => Number(left.header) - Number(right.header));
  const depthByBlock = new Map<OptIrBlockId, number>();
  for (const loop of loopRecords) {
    for (const blockId of loop.blocks) {
      depthByBlock.set(blockId, (depthByBlock.get(blockId) ?? 0) + 1);
    }
  }
  const coldBlocks = coldPathBlocks(func);
  const terminalBlocks = terminalPathBlocks(func);

  return Object.freeze({
    loops() {
      return loopRecords.slice();
    },
    loopDepth(blockId: OptIrBlockId) {
      return depthByBlock.get(blockId) ?? 0;
    },
    latchesForHeader(header: OptIrBlockId) {
      return loopRecords.find((loop) => loop.header === header)?.latches.slice() ?? [];
    },
    isColdPath(blockId: OptIrBlockId) {
      return coldBlocks.has(blockId);
    },
    isTerminalPath(blockId: OptIrBlockId) {
      return terminalBlocks.has(blockId);
    },
  });
}

function collectNaturalLoopBlocks(input: {
  readonly header: OptIrBlockId;
  readonly latch: OptIrBlockId;
  readonly predecessors: ReadonlyMap<OptIrBlockId, readonly OptIrBlockId[]>;
  readonly blocks: Set<OptIrBlockId>;
}): void {
  const worklist = [input.latch];
  input.blocks.add(input.latch);
  while (worklist.length > 0) {
    const blockId = worklist.pop();
    if (blockId === undefined || blockId === input.header) {
      continue;
    }
    for (const predecessor of input.predecessors.get(blockId) ?? []) {
      if (!input.blocks.has(predecessor)) {
        input.blocks.add(predecessor);
        worklist.push(predecessor);
      }
    }
  }
}

function predecessorsByBlock(
  func: OptIrFunction,
): ReadonlyMap<OptIrBlockId, readonly OptIrBlockId[]> {
  const predecessors = new Map<OptIrBlockId, OptIrBlockId[]>();
  for (const block of func.blocks) {
    predecessors.set(block.blockId, []);
  }
  for (const cfgEdge of func.edges.entries()) {
    if (cfgEdge.toBlock !== undefined) {
      predecessors.get(cfgEdge.toBlock)?.push(cfgEdge.from);
    }
  }
  for (const values of predecessors.values()) {
    values.sort((left, right) => Number(left) - Number(right));
  }
  return predecessors;
}

function coldPathBlocks(func: OptIrFunction): ReadonlySet<OptIrBlockId> {
  const cold = new Set<OptIrBlockId>();
  for (const cfgEdge of func.edges.entries()) {
    if (
      (cfgEdge.kind === "panicExit" || cfgEdge.kind === "validationErr") &&
      cfgEdge.toBlock !== undefined
    ) {
      cold.add(cfgEdge.toBlock);
    }
  }
  return cold;
}

function terminalPathBlocks(func: OptIrFunction): ReadonlySet<OptIrBlockId> {
  const terminal = new Set<OptIrBlockId>();
  for (const block of func.blocks) {
    if (block.terminator?.kind === "return" || block.terminator?.kind === "unreachable") {
      terminal.add(block.blockId);
    }
  }
  return terminal;
}

function sortedBlockIds(blocks: Iterable<OptIrBlockId>): readonly OptIrBlockId[] {
  return [...blocks].sort((left, right) => Number(left) - Number(right));
}
