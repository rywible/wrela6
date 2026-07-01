import { applyOutOfProfileAndErrataStage } from "./stages/apply-out-of-profile-and-errata";
import { authenticateTargetStage } from "./stages/authenticate-target";
import { buildDebugOutputStage } from "./stages/build-debug-output";
import { buildDependencyGraphStage } from "./stages/build-dependency-graph";
import { lowerAbiStage } from "./stages/lower-abi";
import { lowerCallsStage } from "./stages/lower-calls";
import { lowerFunctionShellsStage } from "./stages/lower-function-shells";
import { lowerMemoryOrderStage } from "./stages/lower-memory-order";
import { lowerRegionsStage } from "./stages/lower-regions";
import { lowerTerminatorsStage } from "./stages/lower-terminators";
import { lowerUefiImageContextStage } from "./stages/lower-uefi-image-context";
import { materializeConstantsStage } from "./stages/materialize-constants";
import { planPairsPrefetchBarriersScheduleStage } from "./stages/plan-pairs-prefetch-barriers-schedule";
import { postSelectionCseAndRematStage } from "./stages/post-selection-cse-and-remat";
import { preserveMachineFactsStage } from "./stages/preserve-machine-facts";
import { propagateSecurityLabelsStage } from "./stages/propagate-security-labels";
import { selectFpNumericStage } from "./stages/select-fp-numeric";
import { selectLocalScalarStage } from "./stages/select-local-scalar";
import { selectSmartMemoryAndEndianStage } from "./stages/select-smart-memory-and-endian";
import { selectVectorsStage } from "./stages/select-vectors";
import { semanticSuperselectionStage } from "./stages/semantic-superselection";
import { tileSelectionCandidatesStage } from "./stages/tile-selection-candidates";
import { verifyInputContractStage } from "./stages/verify-input-contract";
import { verifyMachineIrStage } from "./stages/verify-machine-ir";
import { verifyOperationMatrixStage } from "./stages/verify-operation-matrix";
import {
  AARCH64_LOWERING_STAGE_KEYS,
  type AArch64LoweringPipelineStage,
  type AArch64LoweringStageKey,
} from "./pipeline-stages";

const AARCH64_LOWERING_STAGE_DESCRIPTORS = Object.freeze({
  "authenticate-target": authenticateTargetStage,
  "verify-input-contract": verifyInputContractStage,
  "verify-operation-matrix": verifyOperationMatrixStage,
  "lower-function-shells": lowerFunctionShellsStage,
  "lower-abi": lowerAbiStage,
  "lower-regions": lowerRegionsStage,
  "lower-uefi-image-context": lowerUefiImageContextStage,
  "materialize-constants": materializeConstantsStage,
  "lower-calls": lowerCallsStage,
  "select-local-scalar": selectLocalScalarStage,
  "lower-terminators": lowerTerminatorsStage,
  "propagate-security-labels": propagateSecurityLabelsStage,
  "tile-selection-candidates": tileSelectionCandidatesStage,
  "select-smart-memory-and-endian": selectSmartMemoryAndEndianStage,
  "lower-memory-order": lowerMemoryOrderStage,
  "select-vectors": selectVectorsStage,
  "select-fp-numeric": selectFpNumericStage,
  "apply-out-of-profile-and-errata": applyOutOfProfileAndErrataStage,
  "semantic-superselection": semanticSuperselectionStage,
  "build-dependency-graph": buildDependencyGraphStage,
  "post-selection-cse-and-remat": postSelectionCseAndRematStage,
  "plan-pairs-prefetch-barriers-schedule": planPairsPrefetchBarriersScheduleStage,
  "preserve-machine-facts": preserveMachineFactsStage,
  "verify-machine-ir": verifyMachineIrStage,
  "build-debug-output": buildDebugOutputStage,
} satisfies Record<AArch64LoweringStageKey, AArch64LoweringPipelineStage>);

export const defaultAArch64LoweringPipeline = Object.freeze(
  AARCH64_LOWERING_STAGE_KEYS.map((stageKey) => AARCH64_LOWERING_STAGE_DESCRIPTORS[stageKey]),
);

export function buildAArch64LoweringPipelineForTest(input: {
  readonly stageOverrides?: Partial<Record<AArch64LoweringStageKey, AArch64LoweringPipelineStage>>;
}): readonly AArch64LoweringPipelineStage[] {
  return Object.freeze(
    AARCH64_LOWERING_STAGE_KEYS.map(
      (stageKey) =>
        input.stageOverrides?.[stageKey] ?? AARCH64_LOWERING_STAGE_DESCRIPTORS[stageKey],
    ),
  );
}
