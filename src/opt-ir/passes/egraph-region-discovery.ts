import { buildOptIrEffectTokenIndex, type OptIrEffectTokenIndex } from "../analyses/effect-tokens";
import { computeOptIrLoopTree } from "../analyses/loop-tree";
import type { OptIrFactSet } from "../facts/fact-index";
import { optIrRegionId, optIrRewriteRegionId, type OptIrOperationId } from "../ids";
import { hasMemoryAccess } from "../operation-access";
import type { OptIrOperation } from "../operations";
import type { OptIrFunction, OptIrProgram } from "../program";
import type { OptIrRegion } from "../regions";
import {
  selectEGraphRegions,
  type OptIrEGraphBoundaryKind,
  type OptIrEGraphRegionCandidate,
  type OptIrEGraphTokenWindow,
} from "../egraph/region-selection";
import {
  isExternalRootRuntimeOperation,
  operationMatchesPacketParserRuntimeKey,
} from "../rewrites/wrela-operation-patterns";
import { operationMap, operationsInProgramOrder } from "./pipeline-state";

type OptIrDiscoveredLoop = ReturnType<ReturnType<typeof computeOptIrLoopTree>["loops"]>[number];

export interface OptIrEGraphRegionDiscoveryInput {
  readonly program: OptIrProgram;
  readonly operations: readonly OptIrOperation[];
  readonly optimizationRegions: readonly OptIrRegion[];
  readonly facts: OptIrFactSet;
}

export function discoverOptIrEGraphRegionCandidates(
  input: OptIrEGraphRegionDiscoveryInput,
): readonly OptIrEGraphRegionCandidate[] {
  return selectEGraphRegions({
    candidates: discoverOptIrEGraphRegionCandidatePool(input),
  });
}

export function discoverOptIrEGraphRegionCandidatePool(
  input: OptIrEGraphRegionDiscoveryInput,
): readonly OptIrEGraphRegionCandidate[] {
  const byId = operationMap(input.operations);
  const regions = input.optimizationRegions;
  const tokenIndexResult = buildOptIrEffectTokenIndex({
    program: input.program,
    regions,
    operationForId: (operationId) => byId.get(operationId),
  });
  const tokenIndex = tokenIndexResult.kind === "ok" ? tokenIndexResult.index : undefined;

  const candidates: OptIrEGraphRegionCandidate[] = [];
  let nextRegionId = 0;

  for (const function_ of input.program.functions.entries()) {
    const loopTree = computeOptIrLoopTree(function_);
    for (const loop of loopTree.loops()) {
      const vectorLoop = discoverVectorizableLoopRegion(function_, loop, byId, nextRegionId);
      if (vectorLoop !== undefined) {
        candidates.push(vectorLoop);
        nextRegionId += 1;
      }
    }

    for (const block of function_.blocks) {
      const blockOperations = block.operations
        .map((operationId) => byId.get(operationId))
        .filter((operation): operation is OptIrOperation => operation !== undefined);

      const parserSlice = discoverParserValidationReadDispatchSlice(
        blockOperations,
        nextRegionId,
        tokenIndex,
      );
      if (parserSlice !== undefined) {
        candidates.push(parserSlice);
        nextRegionId += 1;
      }

      for (const memorySlice of discoverSingleEntrySingleExitMemorySlices(
        blockOperations,
        nextRegionId,
        tokenIndex,
      )) {
        candidates.push(memorySlice);
        nextRegionId += 1;
      }

      for (const scalarDag of discoverPureScalarDagRegions(
        blockOperations,
        nextRegionId,
        tokenIndex,
      )) {
        candidates.push(scalarDag);
        nextRegionId += 1;
      }
    }
  }

  return Object.freeze(candidates);
}

function discoverParserValidationReadDispatchSlice(
  blockOperations: readonly OptIrOperation[],
  regionId: number,
  tokenIndex: OptIrEffectTokenIndex | undefined,
): OptIrEGraphRegionCandidate | undefined {
  const parserStateIds = blockOperations
    .filter((operation) => operationMatchesPacketParserRuntimeKey(operation, "related"))
    .map((operation) => operation.operationId);
  const aggregateIds = blockOperations
    .filter(
      (operation) =>
        operation.kind === "aggregateConstruct" || operation.kind === "aggregateExtract",
    )
    .map((operation) => operation.operationId);
  const loadIds = blockOperations
    .filter((operation) => operation.kind === "memoryLoad")
    .map((operation) => operation.operationId);

  if (parserStateIds.length === 0 || loadIds.length === 0) {
    return undefined;
  }

  const operationIds = uniqueOperationIdsInOrder([...parserStateIds, ...aggregateIds, ...loadIds]);
  const sliceOperations = blockOperations.filter((operation) =>
    operationIds.includes(operation.operationId),
  );
  const tokenWindow = tokenWindowForOperations(sliceOperations, tokenIndex);

  return freezeCandidate({
    regionId: optIrRewriteRegionId(regionId),
    containingRegionId: containingRegionForOperations(sliceOperations),
    kind: "parserValidationReadDispatchSlice",
    operationIds,
    rootOperationId: operationIds[operationIds.length - 1]!,
    ...(tokenWindow === undefined ? {} : { tokenWindow }),
  });
}

function discoverVectorizableLoopRegion(
  function_: OptIrFunction,
  loop: OptIrDiscoveredLoop,
  byId: ReadonlyMap<OptIrOperationId, OptIrOperation>,
  regionId: number,
): OptIrEGraphRegionCandidate | undefined {
  const bodyOperations = loop.blocks.flatMap((loopBlockId) => {
    const block = function_.blocks.find((entry) => entry.blockId === loopBlockId);
    if (block === undefined) {
      return [];
    }
    return block.operations
      .map((operationId) => byId.get(operationId))
      .filter((operation): operation is OptIrOperation => operation !== undefined);
  });
  const memoryBody = bodyOperations.filter(
    (operation) =>
      (operation.kind === "memoryLoad" || operation.kind === "memoryStore") &&
      operation.memoryAccess.volatility === "nonVolatile",
  );
  if (memoryBody.length === 0) {
    return undefined;
  }

  const operationIds = uniqueOperationIdsInOrder(
    memoryBody.map((operation) => operation.operationId),
  );
  const boundary = firstBoundary(bodyOperations);
  const firstMemoryOperation = memoryBody.find(hasMemoryAccess);
  if (firstMemoryOperation === undefined) {
    return undefined;
  }
  return freezeCandidate({
    regionId: optIrRewriteRegionId(regionId),
    containingRegionId: firstMemoryOperation.memoryAccess.region,
    kind: "vectorizableLoop",
    operationIds,
    containingOperationIds: uniqueOperationIdsInOrder(
      bodyOperations.map((operation) => operation.operationId),
    ),
    rootOperationId: operationIds[0]!,
    ...(boundary === undefined ? {} : { boundary }),
  });
}

function discoverSingleEntrySingleExitMemorySlices(
  blockOperations: readonly OptIrOperation[],
  startRegionId: number,
  tokenIndex: OptIrEffectTokenIndex | undefined,
): readonly OptIrEGraphRegionCandidate[] {
  return discoverContiguousOperationSlices({
    blockOperations,
    startRegionId,
    shouldInclude: hasMemoryAccess,
    shouldSplit: (previous, current) =>
      hasMemoryAccess(previous) &&
      hasMemoryAccess(current) &&
      previous.memoryAccess.region !== current.memoryAccess.region,
    buildCandidate: (current, regionId) => {
      const operationIds = uniqueOperationIdsInOrder(
        current.map((operation) => operation.operationId),
      );
      const boundary = firstBoundary(current);
      const tokenWindow = tokenWindowForOperations(current, tokenIndex);
      const firstMemoryOperation = current.find(hasMemoryAccess);
      if (firstMemoryOperation === undefined) {
        return undefined;
      }
      return freezeCandidate({
        regionId: optIrRewriteRegionId(regionId),
        containingRegionId: firstMemoryOperation.memoryAccess.region,
        kind: "singleEntrySingleExitMemorySlice",
        operationIds,
        rootOperationId: operationIds[operationIds.length - 1]!,
        ...(boundary === undefined ? {} : { boundary }),
        ...(tokenWindow === undefined ? {} : { tokenWindow }),
      });
    },
  });
}

function discoverPureScalarDagRegions(
  blockOperations: readonly OptIrOperation[],
  startRegionId: number,
  tokenIndex: OptIrEffectTokenIndex | undefined,
): readonly OptIrEGraphRegionCandidate[] {
  return discoverContiguousOperationSlices({
    blockOperations,
    startRegionId,
    shouldInclude: (operation) =>
      operation.effects.isRuntimePure &&
      !hasMemoryAccess(operation) &&
      operation.kind !== "constant",
    shouldSplit: () => false,
    buildCandidate: (current, regionId) => {
      const operationIds = uniqueOperationIdsInOrder(
        current.map((operation) => operation.operationId),
      );
      const boundary = firstBoundary(current);
      const tokenWindow = tokenWindowForOperations(current, tokenIndex);
      return freezeCandidate({
        regionId: optIrRewriteRegionId(regionId),
        containingRegionId: optIrRegionId(0),
        kind: "pureScalarDag",
        operationIds,
        rootOperationId: operationIds[operationIds.length - 1]!,
        ...(boundary === undefined ? {} : { boundary }),
        ...(tokenWindow === undefined ? {} : { tokenWindow }),
      });
    },
  });
}

function discoverContiguousOperationSlices(input: {
  readonly blockOperations: readonly OptIrOperation[];
  readonly startRegionId: number;
  readonly shouldInclude: (operation: OptIrOperation) => boolean;
  readonly shouldSplit: (previous: OptIrOperation, current: OptIrOperation) => boolean;
  readonly buildCandidate: (
    operations: readonly OptIrOperation[],
    regionId: number,
  ) => OptIrEGraphRegionCandidate | undefined;
}): readonly OptIrEGraphRegionCandidate[] {
  const slices: OptIrEGraphRegionCandidate[] = [];
  let current: OptIrOperation[] = [];
  let regionId = input.startRegionId;

  const flush = (): void => {
    if (current.length === 0) {
      return;
    }
    const candidate = input.buildCandidate(current, regionId);
    if (candidate !== undefined) {
      slices.push(candidate);
      regionId += 1;
    }
    current = [];
  };

  for (const operation of input.blockOperations) {
    if (!input.shouldInclude(operation)) {
      flush();
      continue;
    }
    if (current.length > 0) {
      const previous = current[current.length - 1];
      if (previous !== undefined && input.shouldSplit(previous, operation)) {
        flush();
      }
    }
    current.push(operation);
  }
  flush();
  return Object.freeze(slices);
}

function firstBoundary(operations: readonly OptIrOperation[]): OptIrEGraphBoundaryKind | undefined {
  for (const operation of operations) {
    const boundary = boundaryForOperation(operation);
    if (boundary !== undefined) {
      return boundary;
    }
  }
  return undefined;
}

function boundaryForOperation(operation: OptIrOperation): OptIrEGraphBoundaryKind | undefined {
  if (hasMemoryAccess(operation)) {
    return operation.memoryAccess.volatility === "volatile" ? "volatile" : undefined;
  }
  if (operation.effects.hasTerminalEffects) {
    return "terminal";
  }
  if (isCallbackCall(operation)) {
    return "callback";
  }
  if (isUnknownCall(operation)) {
    return "unknownCall";
  }
  if (isExternalRootCall(operation)) {
    return "externalRoot";
  }
  if (!operation.effects.isRuntimePure) {
    return "effectBoundary";
  }
  return undefined;
}

function tokenWindowForOperations(
  operations: readonly OptIrOperation[],
  tokenIndex: OptIrEffectTokenIndex | undefined,
): OptIrEGraphTokenWindow | undefined {
  if (tokenIndex === undefined) {
    return undefined;
  }
  const tokenized = operations.filter(
    (operation) => tokenIndex.requiredTokenKeysFor(operation.operationId).length > 0,
  );
  if (tokenized.length === 0) {
    return undefined;
  }
  const tokenInputKeys = uniqueSortedStrings(
    tokenized.flatMap((operation) => tokenIndex.requiredTokenKeysFor(operation.operationId)),
  );
  const tokenOutputKeys = tokenInputKeys.slice();
  return Object.freeze({
    operationIds: Object.freeze(
      uniqueOperationIdsInOrder(operations.map((operation) => operation.operationId)),
    ),
    tokenInputKeys: Object.freeze(tokenInputKeys),
    tokenOutputKeys: Object.freeze(tokenOutputKeys),
  });
}

function containingRegionForOperations(
  operations: readonly OptIrOperation[],
): ReturnType<typeof optIrRegionId> {
  const memoryOperation = operations.find(hasMemoryAccess);
  return memoryOperation?.memoryAccess.region ?? optIrRegionId(0);
}

function isCallbackCall(operation: OptIrOperation): boolean {
  return (
    (operation.kind === "sourceCall" ||
      operation.kind === "runtimeCall" ||
      operation.kind === "platformCall") &&
    operation.displayName?.includes("callback") === true
  );
}

function isUnknownCall(operation: OptIrOperation): boolean {
  return (
    (operation.kind === "sourceCall" ||
      operation.kind === "runtimeCall" ||
      operation.kind === "platformCall" ||
      operation.kind === "intrinsicCall") &&
    operation.target.kind === "externalUnknown"
  );
}

function isExternalRootCall(operation: OptIrOperation): boolean {
  return isExternalRootRuntimeOperation(operation);
}

export function orderedRegionDiscoveryOperations(
  program: OptIrProgram,
  operations: readonly OptIrOperation[],
): readonly OptIrOperation[] {
  return operationsInProgramOrder(program, operations);
}

function uniqueOperationIdsInOrder(
  operationIds: readonly OptIrOperationId[],
): readonly OptIrOperationId[] {
  const seen = new Set<OptIrOperationId>();
  const unique: OptIrOperationId[] = [];
  for (const operationId of operationIds) {
    if (seen.has(operationId)) {
      continue;
    }
    seen.add(operationId);
    unique.push(operationId);
  }
  return Object.freeze(unique);
}

function uniqueSortedStrings(values: readonly string[]): readonly string[] {
  return Object.freeze([...new Set(values)].sort(compareStrings));
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function freezeCandidate(candidate: OptIrEGraphRegionCandidate): OptIrEGraphRegionCandidate {
  return Object.freeze({
    ...candidate,
    operationIds: Object.freeze([...candidate.operationIds]),
    ...(candidate.containingOperationIds === undefined
      ? {}
      : { containingOperationIds: Object.freeze([...candidate.containingOperationIds]) }),
    ...(candidate.tokenWindow === undefined ? {} : { tokenWindow: candidate.tokenWindow }),
  });
}
