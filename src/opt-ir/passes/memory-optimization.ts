import { buildOptIrEffectTokenIndex } from "../analyses/effect-tokens";
import { buildOptIrMemorySsa } from "../analyses/memory-ssa";
import type { OptIrOperationId, OptIrRegionId, OptIrValueId } from "../ids";
import type { OptIrOperation } from "../operations";
import { optIrFunctionTable, type OptIrProgram } from "../program";
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
}

export function runMemoryOptimizationForTest(
  input: OptIrMemoryOptimizationInput,
  policy?: OptIrMemoryOptimizationPolicy,
): OptIrMemoryOptimizationResult {
  return runMemoryOptimization({ ...input, ...policy });
}

export function runMemoryOptimization(
  input: OptIrMemoryOptimizationInput,
): OptIrMemoryOptimizationResult {
  const regionById = new Map(input.regions.map((region) => [region.regionId, region]));
  const memory = buildOptIrMemorySsa(input);
  const tokens = buildOptIrEffectTokenIndex(input);
  const valueForwards: {
    sourceValue: OptIrValueId;
    replacementValue: OptIrValueId;
  }[] = [];
  const removedOperationIds: OptIrOperationId[] = [];
  const rewriteRecords: OptIrMemoryRewriteRecord[] = [];
  const lastStoreByRange = new Map<string, OptIrOperation & { readonly kind: "memoryStore" }>();
  const observedStoreIds = new Set<OptIrOperationId>();

  for (const operation of operationsInProgramOrder(input)) {
    if (!("memoryAccess" in operation)) {
      if (!operation.effects.isRuntimePure) {
        lastStoreByRange.clear();
      }
      continue;
    }
    const rangeKey = memoryRangeKey(operation);
    if (operation.kind === "memoryLoad") {
      const store = lastStoreByRange.get(rangeKey);
      if (store !== undefined && canForward(input, memory, tokens, store, operation)) {
        valueForwards.push({
          sourceValue: operation.resultIds[0]!,
          replacementValue: store.storeValue,
        });
        rewriteRecords.push({
          subject: { kind: "operation", operationId: operation.operationId },
          invariant: { kind: "noaliasMemoryEquivalence" },
        });
      }
      if (store !== undefined) {
        observedStoreIds.add(store.operationId);
      }
      continue;
    }
    if (operation.kind !== "memoryStore") {
      lastStoreByRange.delete(rangeKey);
      continue;
    }

    const previous = lastStoreByRange.get(rangeKey);
    if (previous !== undefined) {
      const region = regionById.get(previous.memoryAccess.region);
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
    lastStoreByRange.set(rangeKey, operation);
  }

  return {
    program: removeOperationsFromProgram(input.program, new Set(removedOperationIds)),
    valueForwards: valueForwards.sort(
      (left, right) => Number(left.sourceValue) - Number(right.sourceValue),
    ),
    removedOperationIds: removedOperationIds.sort((left, right) => Number(left) - Number(right)),
    rewriteRecords,
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

function operationsInProgramOrder(input: OptIrMemoryOptimizationInput): readonly OptIrOperation[] {
  const byId = new Map(input.operations.map((operation) => [operation.operationId, operation]));
  const ordered: OptIrOperation[] = [];
  for (const function_ of input.program.functions.entries()) {
    for (const block of [...function_.blocks].sort(
      (left, right) => Number(left.blockId) - Number(right.blockId),
    )) {
      for (const operationId of block.operations) {
        const operation = byId.get(operationId) ?? input.operationForId(operationId);
        if (operation !== undefined) {
          ordered.push(operation);
        }
      }
    }
  }
  return ordered;
}

function memoryRangeKey(operation: OptIrMemoryOperation): string {
  const access = operation.memoryAccess;
  return `${access.region}:${access.byteOffset}:${access.byteWidth}:${access.endian}`;
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
