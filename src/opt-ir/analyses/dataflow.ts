import type { OptIrBlock } from "../cfg";
import { optIrDiagnosticCode, optIrDiagnosticOrderKey, type OptIrDiagnostic } from "../diagnostics";
import type { OptIrBlockId } from "../ids";
import type { OptIrFunction } from "../program";
import type { OptIrDataflowLattice } from "./dataflow-lattice";

export type OptIrDataflowDirection = "forward" | "backward";

export type OptIrDataflowResult<State> =
  | {
      readonly kind: "ok";
      readonly inputStates: ReadonlyMap<OptIrBlockId, State>;
      readonly outputStates: ReadonlyMap<OptIrBlockId, State>;
    }
  | { readonly kind: "error"; readonly diagnostic: OptIrDiagnostic };

export function solveOptIrDataflow<State>(input: {
  readonly direction: OptIrDataflowDirection;
  readonly function: OptIrFunction;
  readonly lattice: OptIrDataflowLattice<State>;
  readonly boundary: State;
  readonly transfer: (block: OptIrBlock, state: State) => State;
  readonly maxIterations: number;
}): OptIrDataflowResult<State> {
  const blocks = optIrReachableBlocksInCfgOrder(input.function);
  const byBlock = new Map(blocks.map((block) => [block.blockId, block]));
  const incoming = optIrIncomingBlockIds(input.function);
  const outgoing = optIrOutgoingBlockIds(input.function);
  const inStates = new Map<OptIrBlockId, State>();
  const outStates = new Map<OptIrBlockId, State>();
  for (const block of blocks) {
    inStates.set(block.blockId, input.lattice.bottom());
    outStates.set(block.blockId, input.lattice.bottom());
  }
  if (input.direction === "forward") {
    inStates.set(input.function.entryBlock, input.boundary);
  }

  const worklist = blocks.map((block) => block.blockId);
  const queued = new Set(worklist);
  let iterations = 0;
  while (worklist.length > 0) {
    if (iterations >= input.maxIterations) {
      return {
        kind: "error",
        diagnostic: fuelDiagnostic(input.direction, input.maxIterations, input.function),
      };
    }
    iterations += 1;
    const blockId = worklist.shift()!;
    queued.delete(blockId);
    const block = byBlock.get(blockId)!;
    if (input.direction === "forward") {
      const merged =
        blockId === input.function.entryBlock
          ? input.boundary
          : mergePredecessors(incoming.get(blockId) ?? [], outStates, input.lattice);
      inStates.set(blockId, merged);
      const nextOut = input.transfer(block, merged);
      if (!input.lattice.equals(outStates.get(blockId)!, nextOut)) {
        outStates.set(blockId, nextOut);
        enqueue(worklist, queued, outgoing.get(blockId) ?? []);
      }
    } else {
      const merged = mergePredecessors(outgoing.get(blockId) ?? [], inStates, input.lattice);
      outStates.set(blockId, merged);
      const nextIn = input.transfer(block, merged);
      if (!input.lattice.equals(inStates.get(blockId)!, nextIn)) {
        inStates.set(blockId, nextIn);
        enqueue(worklist, queued, incoming.get(blockId) ?? []);
      }
    }
  }

  return { kind: "ok", inputStates: inStates, outputStates: outStates };
}

function mergePredecessors<State>(
  blockIds: readonly OptIrBlockId[],
  states: ReadonlyMap<OptIrBlockId, State>,
  lattice: OptIrDataflowLattice<State>,
): State {
  return blockIds.reduce(
    (result, blockId) => lattice.meet(result, states.get(blockId) ?? lattice.bottom()),
    lattice.bottom(),
  );
}

function enqueue(
  worklist: OptIrBlockId[],
  queued: Set<OptIrBlockId>,
  blockIds: readonly OptIrBlockId[],
): void {
  for (const blockId of [...blockIds].sort((left, right) => Number(left) - Number(right))) {
    if (!queued.has(blockId)) {
      worklist.push(blockId);
      queued.add(blockId);
    }
  }
}

export function optIrReachableBlocksInCfgOrder(function_: OptIrFunction): readonly OptIrBlock[] {
  const byId = new Map(function_.blocks.map((block) => [block.blockId, block]));
  const outgoing = optIrOutgoingBlockIds(function_);
  const visited = new Set<OptIrBlockId>();
  const ordered: OptIrBlock[] = [];
  const worklist = [function_.entryBlock];
  while (worklist.length > 0) {
    const blockId = worklist.shift();
    if (blockId === undefined || visited.has(blockId)) {
      continue;
    }
    visited.add(blockId);
    const block = byId.get(blockId);
    if (block !== undefined) {
      ordered.push(block);
    }
    worklist.push(...(outgoing.get(blockId) ?? []));
  }
  return ordered;
}

export function optIrOutgoingBlockIds(
  function_: OptIrFunction,
): ReadonlyMap<OptIrBlockId, readonly OptIrBlockId[]> {
  const result = new Map<OptIrBlockId, OptIrBlockId[]>();
  for (const edge of function_.edges.entries()) {
    if (edge.toBlock !== undefined) {
      result.set(edge.from, [...(result.get(edge.from) ?? []), edge.toBlock]);
    }
  }
  sortBlockIdLists(result);
  return result;
}

export function optIrIncomingBlockIds(
  function_: OptIrFunction,
): ReadonlyMap<OptIrBlockId, readonly OptIrBlockId[]> {
  const result = new Map<OptIrBlockId, OptIrBlockId[]>();
  for (const edge of function_.edges.entries()) {
    if (edge.toBlock !== undefined) {
      result.set(edge.toBlock, [...(result.get(edge.toBlock) ?? []), edge.from]);
    }
  }
  sortBlockIdLists(result);
  return result;
}

function sortBlockIdLists(map: Map<OptIrBlockId, OptIrBlockId[]>): void {
  for (const [blockId, blockIds] of map) {
    map.set(blockId, [...new Set(blockIds)].sort(compareIds));
  }
}

function compareIds(left: number, right: number): number {
  return Number(left) - Number(right);
}

function fuelDiagnostic(
  direction: OptIrDataflowDirection,
  fuel: number,
  function_: OptIrFunction,
): OptIrDiagnostic {
  const code = optIrDiagnosticCode("OPT_IR_INPUT_CONTRACT_INVALID");
  const stableDetail = `dataflow-fuel-exhausted:${direction}:${fuel}`;
  return {
    severity: "error",
    code,
    messageTemplate: "OptIR dataflow solver exhausted its deterministic worklist fuel.",
    arguments: { direction, fuel },
    ownerKey: `function:${function_.functionId}`,
    rootCauseKey: "dataflow:fuel",
    stableDetail,
    originId: function_.originId,
    functionId: function_.functionId,
    orderKey: optIrDiagnosticOrderKey({
      originKey: String(function_.originId),
      functionKey: String(function_.functionId),
      code,
      ownerKey: `function:${function_.functionId}`,
      rootCauseKey: "dataflow:fuel",
      stableDetail,
    }),
  };
}
