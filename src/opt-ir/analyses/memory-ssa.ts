import type { OptIrBoundsAuthority } from "../operations";
import type { OptIrDiagnostic } from "../diagnostics";
import type { OptIrMemoryVersionId, OptIrOperationId, OptIrRegionId } from "../ids";
import { optIrMemoryVersionId } from "../ids";
import type { OptIrOperationKind } from "../operation-kinds";
import type { OptIrOperation } from "../operations";
import type { OptIrProgram } from "../program";
import type { OptIrRegion, OptIrRegionKind } from "../regions";
import {
  buildEffectTokenIndexForTest,
  buildOptIrEffectTokenIndex,
  type OptIrEffectTokenBuildInput,
  type OptIrEffectTokenBuildResult,
} from "./effect-tokens";

export { buildEffectTokenIndexForTest, buildOptIrEffectTokenIndex };
export type { OptIrEffectTokenBuildInput, OptIrEffectTokenBuildResult };

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
  const currentVersions = new Map<OptIrRegionId, OptIrMemoryVersionId>();
  const readOnlyVersions = new Map<OptIrRegionId, OptIrMemoryVersionId>();
  const before = new Map<string, OptIrMemoryVersionId>();
  const after = new Map<string, OptIrMemoryVersionId>();
  const bounds = new Map<OptIrOperationId, OptIrBoundsAuthority>();

  for (const regionId of trackedRegions) {
    currentVersions.set(regionId, optIrMemoryVersionId(0));
  }
  for (const regionId of [...readOnlyRegions].sort(compareIds)) {
    readOnlyVersions.set(regionId, optIrMemoryVersionId(0));
  }

  for (const operation of operationsInProgramOrder(input)) {
    if (!("memoryAccess" in operation)) {
      continue;
    }
    const regionId = operation.memoryAccess.region;
    bounds.set(operation.operationId, operation.memoryAccess.boundsAuthority);
    if (readOnlyRegions.has(regionId)) {
      const version = readOnlyVersions.get(regionId) ?? optIrMemoryVersionId(0);
      before.set(memoryMapKey(operation.operationId, regionId), version);
      after.set(memoryMapKey(operation.operationId, regionId), version);
      continue;
    }
    if (!tracked.has(regionId)) {
      continue;
    }
    const current = currentVersions.get(regionId) ?? optIrMemoryVersionId(0);
    before.set(memoryMapKey(operation.operationId, regionId), current);
    const next =
      operation.kind === "memoryStore" ||
      operation.kind === "vectorStore" ||
      operation.kind === "vectorMaskedStore"
        ? optIrMemoryVersionId(Number(current) + 1)
        : current;
    currentVersions.set(regionId, next);
    after.set(memoryMapKey(operation.operationId, regionId), next);
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

function operationsInProgramOrder(input: OptIrMemorySsaBuildInput): readonly OptIrOperation[] {
  const operations: OptIrOperation[] = [];
  for (const func of input.program.functions.entries()) {
    for (const block of [...func.blocks].sort((left, right) =>
      compareIds(left.blockId, right.blockId),
    )) {
      for (const operationId of block.operations) {
        const operation = input.operationForId(operationId);
        if (operation !== undefined) {
          operations.push(operation);
        }
      }
    }
  }
  return operations;
}

function memoryMapKey(operationId: OptIrOperationId, regionId: OptIrRegionId): string {
  return `${operationId}:${regionId}`;
}

function compareIds(left: number, right: number): number {
  return Number(left) - Number(right);
}
