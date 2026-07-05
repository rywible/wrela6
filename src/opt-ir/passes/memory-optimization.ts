import { buildOptIrEffectTokenIndex } from "../analyses/effect-tokens";
import { buildOptIrMemorySsa } from "../analyses/memory-ssa";
import { optIrReachableBlocksInCfgOrder, solveOptIrDataflow } from "../analyses/dataflow";
import type { OptIrDataflowLattice } from "../analyses/dataflow-lattice";
import { optIrMemoryRangeKey, type OptIrMemoryRangeKey } from "../analyses/memory-range-key";
import type { OptIrDiagnostic } from "../diagnostics";
import type { OptIrBlockId, OptIrOperationId, OptIrRegionId, OptIrValueId } from "../ids";
import type { OptIrOperation } from "../operations";
import { optIrFunctionTable, type OptIrFunction, type OptIrProgram } from "../program";
import type { OptIrRegion } from "../regions";
import { optIrTypeStableKey } from "../types";
import {
  isObservableStoreTarget,
  mayRemoveObservableStore,
  type OptIrMemoryOptimizationPolicy,
} from "../policy/memory-policy";
import type { RewriteInvariant } from "./pass-contract";

type OptIrMemoryOperation = Extract<OptIrOperation, { readonly memoryAccess: unknown }>;

export interface OptIrMemoryRewriteRecord {
  readonly subject:
    | { readonly kind: "operation"; readonly operationId: OptIrOperationId }
    | { readonly kind: "region"; readonly regionId: OptIrRegionId };
  readonly invariant: RewriteInvariant;
}

export interface OptIrMemoryOptimizationInput extends OptIrMemoryOptimizationPolicy {
  readonly program: OptIrProgram;
  readonly regions: readonly OptIrRegion[];
  readonly operations: readonly OptIrOperation[];
  readonly operationForId: (operationId: OptIrOperationId) => OptIrOperation | undefined;
}

export interface OptIrMemoryOptimizationResult {
  readonly program: OptIrProgram;
  readonly valueForwards: readonly {
    readonly sourceValue: OptIrValueId;
    readonly replacementValue: OptIrValueId;
  }[];
  readonly removedOperationIds: readonly OptIrOperationId[];
  readonly rewriteRecords: readonly OptIrMemoryRewriteRecord[];
  readonly diagnostics: readonly OptIrDiagnostic[];
}

export function runLoadStoreForwardingForTest(
  input: OptIrMemoryOptimizationInput,
  policy?: OptIrMemoryOptimizationPolicy,
): OptIrMemoryOptimizationResult {
  return runLoadStoreForwarding({ ...input, ...policy });
}

export function runDeadStoreEliminationForTest(
  input: OptIrMemoryOptimizationInput,
  policy?: OptIrMemoryOptimizationPolicy,
): OptIrMemoryOptimizationResult {
  return runDeadStoreElimination({ ...input, ...policy });
}

export function runLoadStoreForwarding(
  input: OptIrMemoryOptimizationInput,
): OptIrMemoryOptimizationResult {
  const analysis = buildMemoryOptimizationAnalysis(input);
  if (analysis.kind === "error") {
    return emptyMemoryOptimizationResult(input.program, analysis.diagnostics);
  }
  const valueForwards: {
    sourceValue: OptIrValueId;
    replacementValue: OptIrValueId;
  }[] = [];
  const rewriteRecords: OptIrMemoryRewriteRecord[] = [];

  for (const { block, operations } of analysis.blocks) {
    const blockState = new Map(analysis.reaching.inputStates.get(block.blockId) ?? []);
    for (const operation of operations) {
      if (!("memoryAccess" in operation)) {
        if (!operation.effects.isRuntimePure) {
          blockState.clear();
        }
        continue;
      }
      const rangeKey = memoryRangeKey(operation);
      if (operation.kind === "memoryLoad") {
        const reachingStoreId = blockState.get(rangeKey);
        const store =
          reachingStoreId === undefined || reachingStoreId === "conflict"
            ? undefined
            : analysis.reaching.storeById.get(reachingStoreId);
        if (
          store !== undefined &&
          canForward(input, analysis.memory, analysis.tokens, store, operation)
        ) {
          valueForwards.push({
            sourceValue: operation.resultIds[0]!,
            replacementValue: store.storeValue,
          });
          rewriteRecords.push({
            subject: { kind: "operation", operationId: operation.operationId },
            invariant: { kind: "noaliasMemoryEquivalence" },
          });
        }
        continue;
      }
      if (operation.kind !== "memoryStore") {
        blockState.delete(rangeKey);
        continue;
      }
      blockState.set(rangeKey, operation.operationId);
    }
  }

  return {
    program: input.program,
    valueForwards: valueForwards.sort(
      (left, right) => Number(left.sourceValue) - Number(right.sourceValue),
    ),
    removedOperationIds: [],
    rewriteRecords,
    diagnostics: [],
  };
}

export function runDeadStoreElimination(
  input: OptIrMemoryOptimizationInput,
): OptIrMemoryOptimizationResult {
  const analysis = buildMemoryOptimizationAnalysis(input);
  if (analysis.kind === "error") {
    return emptyMemoryOptimizationResult(input.program, analysis.diagnostics);
  }
  const removedOperationIds: OptIrOperationId[] = [];
  const rewriteRecords: OptIrMemoryRewriteRecord[] = [];
  const observedStoreIds = new Set<OptIrOperationId>();

  for (const { block, operations } of analysis.blocks) {
    const blockState = new Map(analysis.reaching.inputStates.get(block.blockId) ?? []);
    const lastStoreInBlockByRange = new Map<
      OptIrMemoryRangeKey,
      OptIrOperation & { readonly kind: "memoryStore" }
    >();
    for (const operation of operations) {
      if (!("memoryAccess" in operation)) {
        if (!operation.effects.isRuntimePure) {
          blockState.clear();
          lastStoreInBlockByRange.clear();
        }
        continue;
      }
      const rangeKey = memoryRangeKey(operation);
      if (operation.kind === "memoryLoad") {
        const reachingStoreId = blockState.get(rangeKey);
        const store =
          reachingStoreId === undefined || reachingStoreId === "conflict"
            ? undefined
            : analysis.reaching.storeById.get(reachingStoreId);
        if (store !== undefined) {
          observedStoreIds.add(store.operationId);
        }
        continue;
      }
      if (operation.kind !== "memoryStore") {
        blockState.delete(rangeKey);
        lastStoreInBlockByRange.delete(rangeKey);
        continue;
      }
      const previous = lastStoreInBlockByRange.get(rangeKey);
      if (previous !== undefined) {
        const region = analysis.regionById.get(previous.memoryAccess.region);
        if (
          region !== undefined &&
          !observedStoreIds.has(previous.operationId) &&
          canRemoveDeadStore(previous, region, input)
        ) {
          removedOperationIds.push(previous.operationId);
          rewriteRecords.push({
            subject: { kind: "operation", operationId: previous.operationId },
            invariant: {
              kind: isObservableStoreTarget(region)
                ? "effectBoundaryEquivalence"
                : "noaliasMemoryEquivalence",
            },
          });
        }
      }
      blockState.set(rangeKey, operation.operationId);
      lastStoreInBlockByRange.set(rangeKey, operation);
    }
  }

  return {
    program: removeOperationsFromProgram(input.program, new Set(removedOperationIds)),
    valueForwards: [],
    removedOperationIds: removedOperationIds.sort((left, right) => Number(left) - Number(right)),
    rewriteRecords,
    diagnostics: [],
  };
}

function emptyMemoryOptimizationResult(
  program: OptIrProgram,
  diagnostics: readonly OptIrDiagnostic[],
): OptIrMemoryOptimizationResult {
  return {
    program,
    valueForwards: [],
    removedOperationIds: [],
    rewriteRecords: [],
    diagnostics,
  };
}

function buildMemoryOptimizationAnalysis(input: OptIrMemoryOptimizationInput):
  | {
      readonly kind: "ok";
      readonly regionById: ReadonlyMap<OptIrRegionId, OptIrRegion>;
      readonly memory: ReturnType<typeof buildOptIrMemorySsa>;
      readonly tokens: ReturnType<typeof buildOptIrEffectTokenIndex>;
      readonly reaching: ReachingStoreSuccess;
      readonly blocks: ReturnType<typeof blocksWithOperations>;
    }
  | { readonly kind: "error"; readonly diagnostics: readonly OptIrDiagnostic[] } {
  const reaching = computeReachingStores(input);
  if (reaching.kind === "error") {
    return { kind: "error", diagnostics: [reaching.diagnostic] };
  }
  return {
    kind: "ok",
    regionById: new Map(input.regions.map((region) => [region.regionId, region])),
    memory: buildOptIrMemorySsa(input),
    tokens: buildOptIrEffectTokenIndex(input),
    reaching,
    blocks: blocksWithOperations(input),
  };
}

function canForward(
  input: OptIrMemoryOptimizationInput,
  memory: ReturnType<typeof buildOptIrMemorySsa>,
  tokens: ReturnType<typeof buildOptIrEffectTokenIndex>,
  store: OptIrOperation & { readonly kind: "memoryStore" },
  load: OptIrOperation & { readonly kind: "memoryLoad" },
): boolean {
  if (memoryValueTypeKey(store) !== memoryValueTypeKey(load)) {
    return false;
  }
  if (store.memoryAccess.volatility === "volatile" || load.memoryAccess.volatility === "volatile") {
    return false;
  }
  if (tokens.kind !== "ok") {
    return false;
  }
  const afterStore =
    memory.kind === "ok"
      ? memory.index.versionAfter(store.operationId, store.memoryAccess.region)
      : undefined;
  const beforeLoad =
    memory.kind === "ok"
      ? memory.index.versionBefore(load.operationId, load.memoryAccess.region)
      : undefined;
  const memoryCompatible =
    afterStore !== undefined && beforeLoad !== undefined && afterStore === beforeLoad;
  const tokenCompatible = effectTokensCompatible(tokens, store, load);

  if (tokens.index.requiredTokenKeysFor(load.operationId).length > 0) {
    return memoryCompatible || tokenCompatible;
  }

  return memoryCompatible;
}

function effectTokensCompatible(
  tokens: Extract<ReturnType<typeof buildOptIrEffectTokenIndex>, { readonly kind: "ok" }>,
  store: OptIrOperation & { readonly kind: "memoryStore" },
  load: OptIrOperation & { readonly kind: "memoryLoad" },
): boolean {
  const required = tokens.index.requiredTokenKeysFor(load.operationId);
  return (
    required.length > 0 &&
    required.every((tokenKey) => {
      const afterStore = tokens.index.tokenAfter(store.operationId, tokenKey);
      const beforeLoad = tokens.index.tokenBefore(load.operationId, tokenKey);
      return (
        afterStore !== undefined &&
        beforeLoad !== undefined &&
        afterStore.version === beforeLoad.version
      );
    })
  );
}

function canRemoveDeadStore(
  store: OptIrOperation & { readonly kind: "memoryStore" },
  region: OptIrRegion,
  input: OptIrMemoryOptimizationInput,
): boolean {
  if (isObservableStoreTarget(region)) {
    return mayRemoveObservableStore(store, region, input);
  }
  return true;
}

function blocksWithOperations(input: OptIrMemoryOptimizationInput): readonly {
  readonly block: OptIrFunction["blocks"][number];
  readonly operations: readonly OptIrOperation[];
}[] {
  const byId = new Map(input.operations.map((operation) => [operation.operationId, operation]));
  const ordered: {
    readonly block: OptIrFunction["blocks"][number];
    readonly operations: readonly OptIrOperation[];
  }[] = [];
  for (const function_ of input.program.functions.entries()) {
    for (const block of optIrReachableBlocksInCfgOrder(function_)) {
      const operations: OptIrOperation[] = [];
      for (const operationId of block.operations) {
        const operation = byId.get(operationId) ?? input.operationForId(operationId);
        if (operation !== undefined) {
          operations.push(operation);
        }
      }
      ordered.push({ block, operations });
    }
  }
  return ordered;
}

type ReachingStoreValue = OptIrOperationId | "conflict";
type ReachingStoreState = ReadonlyMap<OptIrMemoryRangeKey, ReachingStoreValue>;
type ReachingStoreSuccess = {
  readonly kind: "ok";
  readonly inputStates: ReadonlyMap<OptIrBlockId, ReachingStoreState>;
  readonly outputStates: ReadonlyMap<OptIrBlockId, ReachingStoreState>;
  readonly storeById: ReadonlyMap<
    OptIrOperationId,
    OptIrOperation & { readonly kind: "memoryStore" }
  >;
};
type ReachingStoreSolution =
  | ReachingStoreSuccess
  | { readonly kind: "error"; readonly diagnostic: OptIrDiagnostic };

function computeReachingStores(input: OptIrMemoryOptimizationInput): ReachingStoreSolution {
  const storeById = new Map<OptIrOperationId, OptIrOperation & { readonly kind: "memoryStore" }>();
  for (const operation of input.operations) {
    if (operation.kind === "memoryStore") {
      storeById.set(operation.operationId, operation);
    }
  }
  const operationById = new Map(
    input.operations.map((operation) => [operation.operationId, operation]),
  );
  const inputStates = new Map<OptIrBlockId, ReachingStoreState>();
  const outputStates = new Map<OptIrBlockId, ReachingStoreState>();
  for (const function_ of input.program.functions.entries()) {
    const result = solveOptIrDataflow({
      direction: "forward",
      function: function_,
      lattice: reachingStoreLattice(),
      boundary: new Map(),
      transfer(block, state) {
        return transferReachingStores(block.operations, state, operationById);
      },
      maxIterations: Math.max(1, function_.blocks.length * function_.blocks.length * 4),
    });
    if (result.kind === "error") {
      return result;
    }
    for (const [blockId, state] of result.inputStates) inputStates.set(blockId, state);
    for (const [blockId, state] of result.outputStates) outputStates.set(blockId, state);
  }

  return { kind: "ok", inputStates, outputStates, storeById };
}

function transferReachingStores(
  operationIds: readonly OptIrOperationId[],
  inputState: ReachingStoreState,
  operationById: ReadonlyMap<OptIrOperationId, OptIrOperation>,
): ReachingStoreState {
  const state = new Map(inputState);
  for (const operationId of operationIds) {
    const operation = operationById.get(operationId);
    if (operation === undefined) {
      continue;
    }
    if (!("memoryAccess" in operation)) {
      if (!operation.effects.isRuntimePure) {
        state.clear();
      }
      continue;
    }
    const rangeKey = memoryRangeKey(operation);
    if (operation.kind === "memoryStore") {
      state.set(rangeKey, operation.operationId);
    } else {
      state.delete(rangeKey);
    }
  }
  return state;
}

function mergeReachingStoreStates(states: readonly ReachingStoreState[]): ReachingStoreState {
  if (states.length === 0) {
    return new Map();
  }
  const keys = new Set(states.flatMap((state) => [...state.keys()]));
  const merged = new Map<OptIrMemoryRangeKey, ReachingStoreValue>();
  for (const key of keys) {
    const values = states.map((state) => state.get(key));
    const first = values[0];
    if (first !== undefined && values.every((value) => value === first)) {
      merged.set(key, first);
    } else {
      merged.set(key, "conflict");
    }
  }
  return merged;
}

function sameReachingStoreState(left: ReachingStoreState, right: ReachingStoreState): boolean {
  return left.size === right.size && [...left].every(([key, value]) => right.get(key) === value);
}

function reachingStoreLattice(): OptIrDataflowLattice<ReachingStoreState> {
  return {
    bottom() {
      return new Map();
    },
    equals: sameReachingStoreState,
    meet(left, right) {
      if (left.size === 0) return right;
      if (right.size === 0) return left;
      return mergeReachingStoreStates([left, right]);
    },
    format(state) {
      return [...state]
        .map(([key, value]) => `${key}:${value}`)
        .sort()
        .join(",");
    },
  };
}

function memoryRangeKey(operation: OptIrMemoryOperation): OptIrMemoryRangeKey {
  return optIrMemoryRangeKey(operation.memoryAccess);
}

function memoryValueTypeKey(operation: OptIrMemoryOperation): string {
  return optIrTypeStableKey(operation.memoryAccess.valueType);
}

function removeOperationsFromProgram(
  program: OptIrProgram,
  removed: ReadonlySet<OptIrOperationId>,
): OptIrProgram {
  if (removed.size === 0) {
    return program;
  }
  const functions = program.functions.entries().map((function_) => ({
    ...function_,
    blocks: function_.blocks.map((block) => ({
      ...block,
      operations: block.operations.filter((operationId) => !removed.has(operationId)),
    })),
  }));
  return { ...program, functions: optIrFunctionTable(functions) };
}
