import type { OptIrBoundsAuthority } from "../operations";
import type { OptIrDiagnostic } from "../diagnostics";
import type { OptIrBlockId, OptIrMemoryVersionId, OptIrOperationId, OptIrRegionId } from "../ids";
import { optIrMemoryVersionId } from "../ids";
import type { OptIrOperationKind } from "../operation-kinds";
import type { OptIrOperation } from "../operations";
import type { OptIrFunction, OptIrProgram } from "../program";
import type { OptIrRegion, OptIrRegionKind } from "../regions";
import { optIrReachableBlocksInCfgOrder, solveOptIrDataflow } from "./dataflow";
import type { OptIrDataflowLattice } from "./dataflow-lattice";
import {
  buildEffectTokenIndexForTest,
  buildOptIrEffectTokenIndex,
  type OptIrEffectTokenBuildInput,
  type OptIrEffectTokenBuildResult,
} from "./effect-tokens";
import {
  optIrMemoryRangeKey,
  optIrRegionIdFromMemoryRangeKey,
  type OptIrMemoryRangeKey,
} from "./memory-range-key";

export { buildEffectTokenIndexForTest, buildOptIrEffectTokenIndex };
export type { OptIrEffectTokenBuildInput, OptIrEffectTokenBuildResult };

type OptIrMemoryOperation = Extract<OptIrOperation, { readonly memoryAccess: unknown }>;

export interface OptIrMemorySsaBuildInput extends OptIrEffectTokenBuildInput {
  readonly program: OptIrProgram;
  readonly regions: readonly OptIrRegion[];
  readonly operationForId: (operationId: OptIrOperationId) => OptIrOperation | undefined;
}

export interface OptIrMemorySsaIndex {
  readonly trackedRegions: () => readonly OptIrRegionId[];
  readonly versionBefore: (
    operationId: OptIrOperationId,
    regionId: OptIrRegionId,
  ) => OptIrMemoryVersionId | undefined;
  readonly versionAfter: (
    operationId: OptIrOperationId,
    regionId: OptIrRegionId,
  ) => OptIrMemoryVersionId | undefined;
  readonly readOnlyVersionFor: (regionId: OptIrRegionId) => OptIrMemoryVersionId | undefined;
  readonly boundsAuthorityFor: (operationId: OptIrOperationId) => OptIrBoundsAuthority | undefined;
  readonly unknownMergeStates: () => readonly OptIrMemorySsaUnknownMergeState[];
}

export interface OptIrMemorySsaUnknownMergeState {
  readonly operationId: OptIrOperationId;
  readonly regionId: OptIrRegionId;
  readonly stableDetail: string;
}

export type OptIrMemorySsaBuildResult =
  | { readonly kind: "ok"; readonly index: OptIrMemorySsaIndex }
  | { readonly kind: "error"; readonly diagnostics: readonly OptIrDiagnostic[] };

export interface OptIrMemorySsaTriggerInput {
  readonly operationKinds: readonly OptIrOperationKind[];
  readonly regionKinds: readonly OptIrRegionKind[];
  readonly pipelineRequiresMemoryPrecision: boolean;
}

const MEMORY_ACCESS_OPERATION_KINDS: ReadonlySet<OptIrOperationKind> = new Set([
  "memoryLoad",
  "memoryStore",
  "vectorLoad",
  "vectorMaskedLoad",
  "vectorStore",
  "vectorMaskedStore",
]);

export function buildMemorySsaForTest(input: OptIrMemorySsaBuildInput): OptIrMemorySsaBuildResult {
  return buildOptIrMemorySsa(input);
}

export function buildOptIrMemorySsa(input: OptIrMemorySsaBuildInput): OptIrMemorySsaBuildResult {
  const tokenResult = buildOptIrEffectTokenIndex(input);
  if (tokenResult.kind === "error") {
    return tokenResult;
  }

  const trackedRegions = input.regions
    .filter((region) => shouldTrackRegionInMemorySsa(region))
    .map((region) => region.regionId)
    .sort(compareIds);
  const tracked = new Set(trackedRegions);
  const readOnlyRegions = new Set(
    input.regions
      .filter(
        (region) =>
          region.kind !== "constantData" && region.effects.ordering === "readOnlyRegionVersion",
      )
      .map((region) => region.regionId),
  );
  const readOnlyVersions = new Map<OptIrRegionId, OptIrMemoryVersionId>();
  const before = new Map<string, OptIrMemoryVersionId>();
  const after = new Map<string, OptIrMemoryVersionId>();
  const bounds = new Map<OptIrOperationId, OptIrBoundsAuthority>();
  const unknownMerges = new Map<string, OptIrMemorySsaUnknownMergeState>();

  for (const regionId of [...readOnlyRegions].sort(compareIds)) {
    readOnlyVersions.set(regionId, optIrMemoryVersionId(0));
  }

  for (const func of input.program.functions.entries()) {
    const storeVersions = assignStoreVersions(input, func);
    const solution = solveFunctionMemoryStates(input, func, trackedRegions, storeVersions);
    if (solution.kind === "error") {
      return { kind: "error", diagnostics: [solution.diagnostic] };
    }
    recordFunctionMemoryVersions({
      input,
      func,
      tracked,
      readOnlyVersions,
      storeVersions,
      blockInputStates: solution.inputStates,
      before,
      after,
      bounds,
      unknownMerges,
    });
  }

  return {
    kind: "ok",
    index: Object.freeze({
      trackedRegions() {
        return trackedRegions.slice();
      },
      versionBefore(operationId: OptIrOperationId, regionId: OptIrRegionId) {
        return before.get(memoryMapKey(operationId, regionId));
      },
      versionAfter(operationId: OptIrOperationId, regionId: OptIrRegionId) {
        return after.get(memoryMapKey(operationId, regionId));
      },
      readOnlyVersionFor(regionId: OptIrRegionId) {
        return readOnlyVersions.get(regionId);
      },
      boundsAuthorityFor(operationId: OptIrOperationId) {
        return bounds.get(operationId);
      },
      unknownMergeStates() {
        return [...unknownMerges.values()].sort(
          (left, right) =>
            compareIds(left.operationId, right.operationId) ||
            compareIds(left.regionId, right.regionId) ||
            compareStrings(left.stableDetail, right.stableDetail),
        );
      },
    }),
  };
}

export function shouldBuildMemorySsaForFixedPipeline(input: OptIrMemorySsaTriggerInput): boolean {
  if (!input.pipelineRequiresMemoryPrecision) {
    return false;
  }
  const hasMemoryAccess = input.operationKinds.some((kind) =>
    MEMORY_ACCESS_OPERATION_KINDS.has(kind),
  );
  if (!hasMemoryAccess) {
    return false;
  }
  return input.regionKinds.some(
    (kind) =>
      kind !== "constantData" &&
      kind !== "packetSource" &&
      kind !== "validatedPayload" &&
      kind !== "imageDevice" &&
      kind !== "firmwareTable" &&
      kind !== "runtimeMemory" &&
      kind !== "externalUnknown",
  );
}

function shouldTrackRegionInMemorySsa(region: OptIrRegion): boolean {
  return (
    region.kind !== "constantData" &&
    region.kind !== "firmwareTable" &&
    region.kind !== "imageDevice" &&
    region.kind !== "runtimeMemory" &&
    region.kind !== "externalUnknown" &&
    region.effects.ordering !== "readOnlyRegionVersion" &&
    region.effects.ordering !== "orderedEffectToken"
  );
}

type RegionVersionState =
  | { readonly kind: "known"; readonly version: OptIrMemoryVersionId }
  | { readonly kind: "unknown"; readonly stableDetail: string };

type RangeVersionState =
  | {
      readonly kind: "known";
      readonly version: OptIrMemoryVersionId;
      readonly storeId?: OptIrOperationId;
    }
  | { readonly kind: "unknown"; readonly stableDetail: string };

interface MemoryBlockState {
  readonly regions: ReadonlyMap<OptIrRegionId, RegionVersionState>;
  readonly ranges: ReadonlyMap<OptIrMemoryRangeKey, RangeVersionState>;
}

type MemoryStateSolution =
  | {
      readonly kind: "ok";
      readonly inputStates: ReadonlyMap<OptIrBlockId, MemoryBlockState>;
      readonly outputStates: ReadonlyMap<OptIrBlockId, MemoryBlockState>;
    }
  | { readonly kind: "error"; readonly diagnostic: OptIrDiagnostic };

function solveFunctionMemoryStates(
  input: OptIrMemorySsaBuildInput,
  func: OptIrFunction,
  trackedRegions: readonly OptIrRegionId[],
  storeVersions: ReadonlyMap<OptIrOperationId, OptIrMemoryVersionId>,
): MemoryStateSolution {
  const boundary = initialMemoryState(trackedRegions);
  const result = solveOptIrDataflow({
    direction: "forward",
    function: func,
    lattice: memoryStateLattice(trackedRegions),
    boundary,
    transfer(block, state) {
      return transferMemoryBlock(input, block.operations, state, storeVersions);
    },
    maxIterations: Math.max(1, func.blocks.length * func.blocks.length * 4),
  });
  return result.kind === "ok"
    ? {
        kind: "ok",
        inputStates: result.inputStates,
        outputStates: result.outputStates,
      }
    : result;
}

function recordFunctionMemoryVersions(input: {
  readonly input: OptIrMemorySsaBuildInput;
  readonly func: OptIrFunction;
  readonly tracked: ReadonlySet<OptIrRegionId>;
  readonly readOnlyVersions: ReadonlyMap<OptIrRegionId, OptIrMemoryVersionId>;
  readonly storeVersions: ReadonlyMap<OptIrOperationId, OptIrMemoryVersionId>;
  readonly blockInputStates: ReadonlyMap<OptIrBlockId, MemoryBlockState>;
  readonly before: Map<string, OptIrMemoryVersionId>;
  readonly after: Map<string, OptIrMemoryVersionId>;
  readonly bounds: Map<OptIrOperationId, OptIrBoundsAuthority>;
  readonly unknownMerges: Map<string, OptIrMemorySsaUnknownMergeState>;
}): void {
  for (const block of optIrReachableBlocksInCfgOrder(input.func)) {
    let state = input.blockInputStates.get(block.blockId) ?? initialMemoryState([]);
    for (const operationId of block.operations) {
      const operation = input.input.operationForId(operationId);
      if (operation === undefined || !isMemoryOperation(operation)) {
        continue;
      }

      const regionId = operation.memoryAccess.region;
      input.bounds.set(operation.operationId, operation.memoryAccess.boundsAuthority);
      if (input.readOnlyVersions.has(regionId)) {
        const version = input.readOnlyVersions.get(regionId) ?? optIrMemoryVersionId(0);
        input.before.set(memoryMapKey(operation.operationId, regionId), version);
        input.after.set(memoryMapKey(operation.operationId, regionId), version);
        continue;
      }
      if (!input.tracked.has(regionId)) {
        continue;
      }

      const rangeState = memoryRangeState(operation, state);
      const regionState = state.regions.get(regionId) ?? knownRegion(optIrMemoryVersionId(0));
      const beforeVersion =
        rangeState?.kind === "known"
          ? rangeState.version
          : regionState.kind === "known" && rangeState?.kind !== "unknown"
            ? regionState.version
            : undefined;
      if (beforeVersion !== undefined) {
        input.before.set(memoryMapKey(operation.operationId, regionId), beforeVersion);
      }
      if (rangeState?.kind === "unknown") {
        recordUnknownMerge(input.unknownMerges, operation, rangeState);
      } else if (regionState.kind === "unknown") {
        recordUnknownMerge(input.unknownMerges, operation, regionState);
      }

      state = transferMemoryOperation(operation, state, input.storeVersions);
      const afterState = memoryRangeState(operation, state);
      if (afterState?.kind === "known") {
        input.after.set(memoryMapKey(operation.operationId, regionId), afterState.version);
      } else if (beforeVersion !== undefined) {
        input.after.set(memoryMapKey(operation.operationId, regionId), beforeVersion);
      }
    }
  }
}

function assignStoreVersions(
  input: OptIrMemorySsaBuildInput,
  func: OptIrFunction,
): ReadonlyMap<OptIrOperationId, OptIrMemoryVersionId> {
  const versions = new Map<OptIrOperationId, OptIrMemoryVersionId>();
  let nextVersion = 1;
  for (const block of optIrReachableBlocksInCfgOrder(func)) {
    for (const operationId of block.operations) {
      const operation = input.operationForId(operationId);
      if (operation !== undefined && isStoreOperation(operation)) {
        versions.set(operation.operationId, optIrMemoryVersionId(nextVersion));
        nextVersion += 1;
      }
    }
  }
  return versions;
}

function transferMemoryBlock(
  input: OptIrMemorySsaBuildInput,
  operationIds: readonly OptIrOperationId[],
  inputState: MemoryBlockState,
  storeVersions: ReadonlyMap<OptIrOperationId, OptIrMemoryVersionId>,
): MemoryBlockState {
  let state = inputState;
  for (const operationId of operationIds) {
    const operation = input.operationForId(operationId);
    if (operation !== undefined) {
      state = transferMemoryOperation(operation, state, storeVersions);
    }
  }
  return state;
}

function transferMemoryOperation(
  operation: OptIrOperation,
  state: MemoryBlockState,
  storeVersions: ReadonlyMap<OptIrOperationId, OptIrMemoryVersionId>,
): MemoryBlockState {
  if (!isMemoryOperation(operation) || !state.regions.has(operation.memoryAccess.region)) {
    return state;
  }
  if (!isStoreOperation(operation)) {
    return state;
  }
  const version = storeVersions.get(operation.operationId);
  if (version === undefined) {
    return state;
  }
  const nextRegions = new Map(state.regions);
  const nextRanges = new Map(state.ranges);
  nextRegions.set(operation.memoryAccess.region, knownRegion(version));
  nextRanges.set(memoryRangeKey(operation), {
    kind: "known",
    version,
    storeId: operation.operationId,
  });
  return freezeMemoryState({ regions: nextRegions, ranges: nextRanges });
}

function mergeMemoryStates(
  states: readonly MemoryBlockState[],
  trackedRegions: readonly OptIrRegionId[],
): MemoryBlockState {
  if (states.length === 0) {
    return initialMemoryState(trackedRegions);
  }
  const regions = new Map<OptIrRegionId, RegionVersionState>();
  const ranges = new Map<OptIrMemoryRangeKey, RangeVersionState>();
  for (const regionId of trackedRegions) {
    regions.set(regionId, mergeRegionStates(regionId, states));
  }
  for (const key of sortedStrings(new Set(states.flatMap((state) => [...state.ranges.keys()])))) {
    ranges.set(key, mergeRangeStates(key, states));
  }
  return freezeMemoryState({ regions, ranges });
}

function mergeRegionStates(
  regionId: OptIrRegionId,
  states: readonly MemoryBlockState[],
): RegionVersionState {
  const first = states[0]?.regions.get(regionId) ?? knownRegion(optIrMemoryVersionId(0));
  if (
    first.kind === "known" &&
    states.every((state) => {
      const candidate = state.regions.get(regionId) ?? knownRegion(optIrMemoryVersionId(0));
      return candidate.kind === "known" && candidate.version === first.version;
    })
  ) {
    return first;
  }
  return { kind: "unknown", stableDetail: `memory-ssa:unknown-region:${regionId}` };
}

function mergeRangeStates(
  key: OptIrMemoryRangeKey,
  states: readonly MemoryBlockState[],
): RangeVersionState {
  const candidates = states.map((state) => {
    const explicit = state.ranges.get(key);
    if (explicit !== undefined) return explicit;
    const region =
      state.regions.get(optIrRegionIdFromMemoryRangeKey(key)) ??
      knownRegion(optIrMemoryVersionId(0));
    if (region.kind === "unknown") return region;
    return { kind: "known" as const, version: region.version };
  });
  const first = candidates[0];
  if (
    first !== undefined &&
    first.kind === "known" &&
    candidates.every(
      (candidate) =>
        candidate.kind === "known" &&
        candidate.version === first.version &&
        candidate.storeId === first.storeId,
    )
  ) {
    return first;
  }
  return { kind: "unknown", stableDetail: `memory-ssa:unknown-merge:${key}` };
}

function memoryRangeState(
  operation: OptIrMemoryOperation,
  state: MemoryBlockState,
): RangeVersionState | undefined {
  return state.ranges.get(memoryRangeKey(operation));
}

function recordUnknownMerge(
  unknownMerges: Map<string, OptIrMemorySsaUnknownMergeState>,
  operation: OptIrMemoryOperation,
  state: { readonly stableDetail: string },
): void {
  unknownMerges.set(memoryMapKey(operation.operationId, operation.memoryAccess.region), {
    operationId: operation.operationId,
    regionId: operation.memoryAccess.region,
    stableDetail: state.stableDetail,
  });
}

function initialMemoryState(trackedRegions: readonly OptIrRegionId[]): MemoryBlockState {
  return freezeMemoryState({
    regions: new Map(
      trackedRegions.map((regionId) => [regionId, knownRegion(optIrMemoryVersionId(0))]),
    ),
    ranges: new Map(),
  });
}

function knownRegion(version: OptIrMemoryVersionId): RegionVersionState {
  return { kind: "known", version };
}

function freezeMemoryState(input: {
  readonly regions: ReadonlyMap<OptIrRegionId, RegionVersionState>;
  readonly ranges: ReadonlyMap<OptIrMemoryRangeKey, RangeVersionState>;
}): MemoryBlockState {
  return Object.freeze({
    regions: new Map(input.regions),
    ranges: new Map(input.ranges),
  });
}

function memoryStateLattice(
  trackedRegions: readonly OptIrRegionId[],
): OptIrDataflowLattice<MemoryBlockState> {
  return {
    bottom() {
      return freezeMemoryState({ regions: new Map(), ranges: new Map() });
    },
    equals: sameMemoryState,
    meet(left, right) {
      if (isDataflowBottom(left)) return right;
      if (isDataflowBottom(right)) return left;
      return mergeMemoryStates([left, right], trackedRegions);
    },
    format(state) {
      return [
        ...[...state.regions].map(
          ([regionId, value]) => `${regionId}:${formatVersionState(value)}`,
        ),
        ...[...state.ranges].map(([key, value]) => `${key}:${formatVersionState(value)}`),
      ]
        .sort(compareStrings)
        .join(",");
    },
  };
}

function isDataflowBottom(state: MemoryBlockState): boolean {
  return state.regions.size === 0 && state.ranges.size === 0;
}

function formatVersionState(state: RegionVersionState | RangeVersionState): string {
  return state.kind === "known"
    ? `known:${state.version}:${storeIdOf(state) ?? ""}`
    : state.stableDetail;
}

function sameMemoryState(left: MemoryBlockState, right: MemoryBlockState): boolean {
  return sameStateMap(left.regions, right.regions) && sameStateMap(left.ranges, right.ranges);
}

function sameStateMap<Key, Value extends RegionVersionState | RangeVersionState>(
  left: ReadonlyMap<Key, Value>,
  right: ReadonlyMap<Key, Value>,
): boolean {
  if (left.size !== right.size) return false;
  for (const [key, leftValue] of left) {
    const rightValue = right.get(key);
    if (rightValue === undefined || !sameVersionState(leftValue, rightValue)) return false;
  }
  return true;
}

function sameVersionState(
  left: RegionVersionState | RangeVersionState,
  right: RegionVersionState | RangeVersionState,
): boolean {
  if (left.kind !== right.kind) return false;
  if (left.kind === "unknown" && right.kind === "unknown") {
    return left.stableDetail === right.stableDetail;
  }
  if (left.kind === "known" && right.kind === "known") {
    return left.version === right.version && storeIdOf(left) === storeIdOf(right);
  }
  return false;
}

function storeIdOf(state: RegionVersionState | RangeVersionState): OptIrOperationId | undefined {
  return "storeId" in state ? state.storeId : undefined;
}

function isMemoryOperation(operation: OptIrOperation): operation is OptIrMemoryOperation {
  return "memoryAccess" in operation;
}

function isStoreOperation(operation: OptIrOperation): operation is OptIrMemoryOperation {
  return (
    operation.kind === "memoryStore" ||
    operation.kind === "vectorStore" ||
    operation.kind === "vectorMaskedStore"
  );
}

function memoryRangeKey(operation: OptIrMemoryOperation): OptIrMemoryRangeKey {
  return optIrMemoryRangeKey(operation.memoryAccess);
}

function memoryMapKey(operationId: OptIrOperationId, regionId: OptIrRegionId): string {
  return `${operationId}:${regionId}`;
}

function sortedStrings<Key extends string>(values: ReadonlySet<Key>): readonly Key[] {
  return [...values].sort(compareStrings);
}

function compareIds(left: number, right: number): number {
  return Number(left) - Number(right);
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
