import { computeOptIrLoopTree } from "../analyses/loop-tree";
import { deriveCertifiedLoopTripCount } from "../analyses/loop-trip-count";
import { optIrBoundsAuthorityIsProven } from "../facts/bounds-facts";
import type { OptIrFactSet } from "../facts/fact-index";
import { createOptIrFreshIdAllocator } from "../id-allocation";
import { optIrBlockId, optIrOriginId } from "../ids";
import type { OptIrOperationKind } from "../operation-kinds";
import { hasMemoryAccess, type OptIrMemoryAccessOperation } from "../operation-access";
import type { OptIrMemoryAccessDescriptor, OptIrOperation } from "../operations";
import type { OptIrProgram } from "../program";
import type { OptIrTargetSurface } from "../target-surface";
import type { OptIrScalarType } from "../types";
import { operationMap } from "./pipeline-state";
import {
  classifyLoopVectorizationShape,
  type OptIrLoopBlockedEffect,
  type OptIrLoopEffectSafety,
  type OptIrLoopLoadMemoryAccess,
  type OptIrLoopLoadPackCandidate,
  type OptIrLoopTripCount,
  type OptIrLoopVectorTailPlan,
} from "./loop-vectorization/loop-shape";
import type { OptIrSlpCandidate, OptIrSlpIdiom } from "./slp-vectorization";

export interface DiscoverSlpCandidatesInput {
  readonly program: OptIrProgram;
  readonly operations: readonly OptIrOperation[];
  readonly facts: OptIrFactSet;
}

export function discoverSlpCandidates(
  input: DiscoverSlpCandidatesInput,
): readonly OptIrSlpCandidate[] {
  const candidates: OptIrSlpCandidate[] = [
    ...discoverAdjacentLoadCandidates(input.program, input.operations, input.facts),
    ...discoverEndianDecodeCandidates(input.program, input.operations),
  ];
  return Object.freeze(candidates);
}

export interface DiscoverLoopVectorizationCandidatesInput {
  readonly program: OptIrProgram;
  readonly operations: readonly OptIrOperation[];
  readonly facts: OptIrFactSet;
  readonly target: OptIrTargetSurface;
}

export function discoverLoopVectorizationCandidates(
  input: DiscoverLoopVectorizationCandidatesInput,
): readonly OptIrLoopLoadPackCandidate[] {
  const laneType = input.target.vector.legalLaneTypes[0];
  const lanes = input.target.vector.legalLaneCounts[0];
  if (laneType === undefined || lanes === undefined) {
    return [];
  }
  const operationById = operationMap(input.operations);
  const freshIds = createOptIrFreshIdAllocator({
    program: input.program,
    operations: input.operations,
  });
  const candidates: OptIrLoopLoadPackCandidate[] = [];

  for (const function_ of input.program.functions.entries()) {
    const loopTree = computeOptIrLoopTree(function_);
    for (const loop of loopTree.loops()) {
      const bodyBlocks = function_.blocks.filter((block) => loop.blocks.includes(block.blockId));
      const bodyOperations = bodyBlocks.flatMap((block) =>
        block.operations
          .map((operationId) => operationById.get(operationId))
          .filter((operation): operation is OptIrOperation => operation !== undefined),
      );
      const memoryOperations = bodyOperations.filter(hasMemoryAccess);
      const loadOperations = memoryOperations.filter(
        (
          operation,
        ): operation is Extract<OptIrMemoryAccessOperation, { readonly kind: "memoryLoad" }> =>
          operation.kind === "memoryLoad" && operation.memoryAccess.volatility === "nonVolatile",
      );
      if (memoryOperations.length !== loadOperations.length) {
        continue;
      }
      const loadMemoryAccesses = loadOperations.map((operation) =>
        loopLoadMemoryAccessFromOperation(operation, lanes),
      );
      if (loadMemoryAccesses.length === 0) {
        continue;
      }
      const vectorIds = reserveLoopVectorIds(freshIds, loadMemoryAccesses.length);
      const scalarOperationIds = loadMemoryAccesses.map((access) => access.operationId);
      const tripCount = deriveCertifiedLoopTripCount({
        function: function_,
        loop,
        bodyOperations,
        operations: operationById,
        facts: input.facts,
      });
      const tailPlan = tailPlanForTripCount(tripCount, lanes);
      candidates.push({
        loopId: `loop:${Number(loop.header)}`,
        headerBlockId: loop.header,
        latchBlockIds: Object.freeze([...loop.latches]),
        bodyBlockIds: Object.freeze([...loop.blocks]),
        scalarOperationIds: Object.freeze(scalarOperationIds),
        nextOperationId: vectorIds.nextOperationId,
        nextValueId: vectorIds.nextValueId,
        originId: bodyBlocks[0]?.originId ?? optIrOriginId(0),
        laneType,
        lanes,
        tripCount,
        tailPlan,
        laneBounds: Object.freeze(
          loadMemoryAccesses.map((access) => ({
            operationId: access.operationId,
            proven: boundsProvenForAccess(access, input.facts),
          })),
        ),
        memoryAccesses: Object.freeze(loadMemoryAccesses),
        memoryIndependenceProven: memoryIndependenceProven(loadMemoryAccesses),
        effectSafety: loopEffectSafety(bodyOperations),
        targetOperationKinds: Object.freeze(
          loadMemoryAccesses.map(() => targetVectorLoadOperationKind(tailPlan)),
        ),
        estimatedLiveVectorRegisters: Math.max(1, loadMemoryAccesses.length),
      });
    }
  }

  return Object.freeze(
    candidates.filter((candidate) => {
      const shape = classifyLoopVectorizationShape(candidate);
      return shape.kind === "vectorizable";
    }),
  );
}

function reserveLoopVectorIds(
  freshIds: ReturnType<typeof createOptIrFreshIdAllocator>,
  operationCount: number,
): { readonly nextOperationId: number; readonly nextValueId: number } {
  const operationIds = Array.from({ length: operationCount }, () => Number(freshIds.operationId()));
  const valueIds = Array.from({ length: operationCount }, () => Number(freshIds.valueId()));
  return {
    nextOperationId: operationIds[0] ?? Number(freshIds.operationId()),
    nextValueId: valueIds[0] ?? Number(freshIds.valueId()),
  };
}

function targetVectorLoadOperationKind(tailPlan: OptIrLoopVectorTailPlan): OptIrOperationKind {
  return tailPlan.kind === "maskedTail" ? "vectorMaskedLoad" : "vectorLoad";
}

function discoverAdjacentLoadCandidates(
  program: OptIrProgram,
  operations: readonly OptIrOperation[],
  facts: OptIrFactSet,
): OptIrSlpCandidate[] {
  const operationById = operationMap(operations);
  const candidates: OptIrSlpCandidate[] = [];

  for (const function_ of program.functions.entries()) {
    for (const block of function_.blocks) {
      const blockOperations = block.operations
        .map((operationId) => operationById.get(operationId))
        .filter((operation): operation is OptIrOperation => operation !== undefined);
      for (let index = 0; index < blockOperations.length; ) {
        const chain = contiguousLoadChain(blockOperations, index);
        if (chain.length < 2) {
          index += 1;
          continue;
        }
        const packSize = chain.length >= 4 ? 4 : 2;
        const packed = chain.slice(0, packSize);
        candidates.push(
          slpCandidateFromAdjacentLoads({
            idiom: "adjacentPacketFieldRead",
            blockId: block.blockId,
            loads: packed,
            facts,
          }),
        );
        index += packSize;
      }
    }
  }
  return candidates;
}

function contiguousLoadChain(
  operations: readonly OptIrOperation[],
  startIndex: number,
): readonly Extract<OptIrOperation, { readonly kind: "memoryLoad" }>[] {
  const chain: Extract<OptIrOperation, { readonly kind: "memoryLoad" }>[] = [];
  for (let index = startIndex; index < operations.length; index += 1) {
    const current = operations[index];
    if (current?.kind !== "memoryLoad") {
      break;
    }
    if (chain.length === 0) {
      chain.push(current);
      continue;
    }
    const previous = chain[chain.length - 1]!;
    if (!adjacentScalarLoads(previous, current)) {
      break;
    }
    chain.push(current);
  }
  return chain;
}

function discoverEndianDecodeCandidates(
  program: OptIrProgram,
  operations: readonly OptIrOperation[],
): OptIrSlpCandidate[] {
  const placement = operationPlacementById(program);
  return operations
    .filter((operation) => operation.kind === "layoutEndianDecode")
    .flatMap((operation): readonly OptIrSlpCandidate[] => {
      const bytes = operation.operandIds[0];
      const operationPlacement = placement.get(operation.operationId);
      if (operationPlacement === undefined) {
        return [];
      }
      return [
        {
          idiom: "endianDecode" as const,
          blockId: operationPlacement.blockId,
          anchorOperationId: operation.operationId,
          scalarOperationIds: Object.freeze([operation.operationId]),
          originId: operation.originId,
          laneType: operation.resultTypes[0] as OptIrScalarType,
          lanes: 1,
          byteOffset: 0n,
          byteWidth: integerByteWidth(operation.resultTypes[0] as OptIrScalarType),
          alignment: 1,
          laneBoundsProven: true,
          aliasSafe: true,
          effectSafe: true,
          endianLegal: operation.endian !== "native",
          targetFeatureLegal: true,
          unalignedAccess: false,
          estimatedLiveVectorRegisters: 1,
          sourceValueIds: bytes === undefined ? [] : Object.freeze([bytes]),
          endian: operation.endian,
        },
      ];
    });
}

function adjacentScalarLoads(
  first: Extract<OptIrOperation, { readonly kind: "memoryLoad" }>,
  second: Extract<OptIrOperation, { readonly kind: "memoryLoad" }>,
): boolean {
  if (
    first.memoryAccess.region !== second.memoryAccess.region ||
    isVectorTypedAccess(first.memoryAccess) ||
    isVectorTypedAccess(second.memoryAccess)
  ) {
    return false;
  }
  return (
    first.memoryAccess.byteOffset + BigInt(first.memoryAccess.byteWidth) ===
    second.memoryAccess.byteOffset
  );
}

function slpCandidateFromAdjacentLoads(input: {
  readonly idiom: Extract<OptIrSlpIdiom, "adjacentPacketFieldRead" | "adjacentSourceFieldRead">;
  readonly blockId: ReturnType<typeof optIrBlockId>;
  readonly loads: readonly Extract<OptIrOperation, { readonly kind: "memoryLoad" }>[];
  readonly facts: OptIrFactSet;
}): OptIrSlpCandidate {
  const first = input.loads[0]!;
  const laneBoundsProven = input.loads.every((load) =>
    boundsProvenForAccess(loopLoadMemoryAccessFromOperation(load), input.facts),
  );
  const totalByteWidth = input.loads.reduce((sum, load) => sum + load.memoryAccess.byteWidth, 0);
  return {
    idiom: input.idiom,
    blockId: input.blockId,
    anchorOperationId: first.operationId,
    scalarOperationIds: Object.freeze(input.loads.map((load) => load.operationId)),
    originId: first.originId,
    memoryAccess: Object.freeze({
      ...first.memoryAccess,
      byteWidth: totalByteWidth,
      alignment: Math.min(...input.loads.map((load) => load.memoryAccess.alignment)),
    }),
    laneType: scalarMemoryValueType(first.memoryAccess.valueType),
    lanes: input.loads.length,
    byteOffset: first.memoryAccess.byteOffset,
    byteWidth: totalByteWidth,
    alignment: Math.min(...input.loads.map((load) => load.memoryAccess.alignment)),
    laneBoundsProven,
    aliasSafe: loadsAreAliasSafe(input.loads),
    effectSafe: input.loads.every((load) => load.memoryAccess.volatility === "nonVolatile"),
    endianLegal: input.loads.every(
      (load) => load.memoryAccess.endian === first.memoryAccess.endian,
    ),
    targetFeatureLegal: true,
    unalignedAccess: input.loads.some(
      (load) => load.memoryAccess.alignment < load.memoryAccess.byteWidth,
    ),
    estimatedLiveVectorRegisters: 1,
    sourceValueIds: [],
    endian: first.memoryAccess.endian,
  };
}

function loadsAreAliasSafe(
  loads: readonly Extract<OptIrOperation, { readonly kind: "memoryLoad" }>[],
): boolean {
  if (loads.length <= 1) {
    return true;
  }
  const region = loads[0]?.memoryAccess.region;
  return loads.every((load) => load.memoryAccess.region === region);
}

function tailPlanForTripCount(
  tripCount: OptIrLoopTripCount,
  lanes: number,
): OptIrLoopVectorTailPlan {
  if (tripCount.kind === "unknown") {
    return { kind: "scalarEpilogue", epilogueBlockId: optIrBlockId(0) };
  }
  if (tripCount.iterations % lanes === 0) {
    return { kind: "certifiedMultiple" };
  }
  return { kind: "scalarEpilogue", epilogueBlockId: optIrBlockId(0) };
}

function boundsProvenForAccess(access: OptIrLoopLoadMemoryAccess, facts: OptIrFactSet): boolean {
  return optIrBoundsAuthorityIsProven(access.boundsAuthority, facts);
}

function memoryIndependenceProven(accesses: readonly OptIrLoopLoadMemoryAccess[]): boolean {
  if (accesses.length <= 1) {
    return true;
  }
  const regions = new Set(accesses.map((access) => access.region));
  if (regions.size !== 1) {
    return false;
  }
  for (let leftIndex = 0; leftIndex < accesses.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < accesses.length; rightIndex += 1) {
      if (memoryAccessRangesOverlap(accesses[leftIndex]!, accesses[rightIndex]!)) {
        return false;
      }
    }
  }
  return true;
}

function memoryAccessRangesOverlap(
  left: OptIrLoopLoadMemoryAccess,
  right: OptIrLoopLoadMemoryAccess,
): boolean {
  const leftEnd = left.byteOffset + BigInt(left.byteWidth);
  const rightEnd = right.byteOffset + BigInt(right.byteWidth);
  return left.byteOffset < rightEnd && right.byteOffset < leftEnd;
}

function loopEffectSafety(bodyOperations: readonly OptIrOperation[]): OptIrLoopEffectSafety {
  const blockedEffects: OptIrLoopBlockedEffect[] = [];
  for (const operation of bodyOperations) {
    if (hasMemoryAccess(operation) && operation.memoryAccess.volatility === "volatile") {
      blockedEffects.push("volatile");
    }
    if (operation.effects.hasTerminalEffects) {
      blockedEffects.push("terminal");
    }
    if (
      (operation.kind === "sourceCall" ||
        operation.kind === "runtimeCall" ||
        operation.kind === "platformCall") &&
      operation.target.kind === "externalUnknown"
    ) {
      blockedEffects.push("runtime");
    }
  }
  const uniqueBlocked = [...new Set(blockedEffects)];
  const safe =
    uniqueBlocked.length === 0 &&
    bodyOperations.every(
      (operation) => operation.effects.isRuntimePure || hasMemoryAccess(operation),
    );
  return {
    safe,
    carriedValues: [],
    blockedEffects: uniqueBlocked,
    vectorPermittedEffects: [],
  };
}

function loopLoadMemoryAccessFromOperation(
  operation: Extract<OptIrMemoryAccessOperation, { readonly kind: "memoryLoad" }>,
  lanes = 1,
): OptIrLoopLoadMemoryAccess {
  return {
    operationId: operation.operationId,
    kind: "load",
    region: operation.memoryAccess.region,
    byteOffset: operation.memoryAccess.byteOffset,
    byteWidth: operation.memoryAccess.byteWidth,
    vectorByteWidth: operation.memoryAccess.byteWidth * lanes,
    alignment: operation.memoryAccess.alignment,
    sourceValueIds: Object.freeze([]),
    boundsAuthority: operation.memoryAccess.boundsAuthority,
    memoryVersionBefore: 0,
    memoryVersionAfter: 0,
  };
}

function operationPlacementById(
  program: OptIrProgram,
): ReadonlyMap<
  OptIrOperation["operationId"],
  { readonly blockId: ReturnType<typeof optIrBlockId> }
> {
  const placement = new Map<
    OptIrOperation["operationId"],
    { readonly blockId: ReturnType<typeof optIrBlockId> }
  >();
  for (const function_ of program.functions.entries()) {
    for (const block of function_.blocks) {
      for (const operationId of block.operations) {
        placement.set(operationId, { blockId: block.blockId });
      }
    }
  }
  return placement;
}

function isVectorTypedAccess(access: OptIrMemoryAccessDescriptor): boolean {
  return access.valueType.kind === "vector" || access.valueType.kind === "vectorMask";
}

function integerByteWidth(type: OptIrScalarType): number {
  if (type.kind !== "integer") {
    return 1;
  }
  return Math.max(1, type.width / 8);
}

function scalarMemoryValueType(type: OptIrMemoryAccessDescriptor["valueType"]): OptIrScalarType {
  if (type.kind === "vector") {
    return type.laneType;
  }
  if (type.kind === "vectorMask") {
    return { kind: "boolean" };
  }
  return type;
}
