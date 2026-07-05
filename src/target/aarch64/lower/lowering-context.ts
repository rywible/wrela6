import type { OptIrFactSet } from "../../../opt-ir/facts/fact-index";
import type { OptIrOperationId } from "../../../opt-ir/ids";
import type { OptIrOperation } from "../../../opt-ir/operations";
import type { OptIrProgram } from "../../../opt-ir/program";
import type { OptIrRegion } from "../../../opt-ir/regions";
import { emptyAArch64ProvenanceMap } from "../machine-ir/provenance";
import type { AArch64PreservedFactSet } from "../machine-ir/fact-set";
import type { AArch64TargetSurface } from "../target-surface/target-surface";
import type { AArch64LoweringOptions } from "../public-api";
import type { AArch64LoweringState } from "./pipeline-stages";

export interface CreateAArch64LoweringStateInput {
  readonly program: OptIrProgram;
  readonly operations?: ReadonlyMap<OptIrOperationId, OptIrOperation> | readonly OptIrOperation[];
  readonly optimizationRegions?: readonly OptIrRegion[];
  readonly facts: OptIrFactSet;
  readonly target: AArch64TargetSurface;
  readonly options: AArch64LoweringOptions;
  readonly preservedFacts: AArch64PreservedFactSet;
}

export function createAArch64LoweringState(
  input: CreateAArch64LoweringStateInput,
): AArch64LoweringState {
  const normalizedOperations = normalizeOptIrOperationMap(input.operations);
  return Object.freeze({
    program: input.program,
    operations: normalizedOperations.operations,
    optimizationRegions: Object.freeze([...(input.optimizationRegions ?? [])]),
    operationInputDuplicateIds: normalizedOperations.duplicateOperationIds,
    facts: input.facts,
    target: input.target,
    options: input.options,
    consultedSubsurfaceFingerprints: [],
    preservedFacts: input.preservedFacts,
    dependencyEdges: [],
    requiredEdges: [],
    scheduleOrderByBlock: Object.freeze({}),
    operationSupportContracts: new Map(),
    semanticCandidates: [],
    semanticDispatchDiagnostics: [],
    semanticManifestLiveOuts: Object.freeze({}),
    provenance: emptyAArch64ProvenanceMap(),
    selectionRecords: [],
    planningRecords: [],
    debugOutput: Object.freeze({ stageTrace: [], explanations: [] }),
  });
}

function normalizeOptIrOperationMap(
  operations: ReadonlyMap<OptIrOperationId, OptIrOperation> | readonly OptIrOperation[] | undefined,
): {
  readonly operations: ReadonlyMap<OptIrOperationId, OptIrOperation>;
  readonly duplicateOperationIds: readonly number[];
} {
  if (operations === undefined) {
    return { operations: new Map<OptIrOperationId, OptIrOperation>(), duplicateOperationIds: [] };
  }
  if (Array.isArray(operations)) {
    const seenOperationIds = new Set<number>();
    const duplicateOperationIds = new Set<number>();
    const entries = operations.map(
      (operationRecord): readonly [OptIrOperationId, OptIrOperation] => {
        const operationId = Number(operationRecord.operationId);
        if (seenOperationIds.has(operationId)) {
          duplicateOperationIds.add(operationId);
        } else {
          seenOperationIds.add(operationId);
        }
        return [operationRecord.operationId as OptIrOperationId, operationRecord];
      },
    );
    return {
      operations: new Map<OptIrOperationId, OptIrOperation>(
        entries.sort((left, right) => Number(left[0]) - Number(right[0])),
      ),
      duplicateOperationIds: Object.freeze(
        [...duplicateOperationIds].sort((left, right) => left - right),
      ),
    };
  }
  const entries = [...operations.entries()].map(
    (entry): readonly [OptIrOperationId, OptIrOperation] => [
      entry[0] as OptIrOperationId,
      entry[1],
    ],
  );
  return {
    operations: new Map<OptIrOperationId, OptIrOperation>(
      entries.sort((left, right) => Number(left[0]) - Number(right[0])),
    ),
    duplicateOperationIds: [],
  };
}
