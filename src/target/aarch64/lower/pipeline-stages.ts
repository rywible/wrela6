import type { OptIrFactSet } from "../../../opt-ir/facts/fact-index";
import type { OptIrOperationId } from "../../../opt-ir/ids";
import type { OptIrOperation } from "../../../opt-ir/operations";
import type { OptIrProgram } from "../../../opt-ir/program";
import type { OptIrRegion } from "../../../opt-ir/regions";
import type { AArch64MachineInstructionId } from "../machine-ir/ids";
import type { AArch64MachineFactSubject } from "../machine-ir/fact-set";
import type { AArch64ProvenanceMap } from "../machine-ir/provenance";
import type { AArch64LoweringDiagnostic } from "../machine-ir/diagnostics";
import type { AArch64MachineProgram } from "../machine-ir/machine-program";
import type { AArch64PreservedFactSet } from "../machine-ir/fact-set";
import type { AArch64TargetSurface } from "../target-surface/target-surface";
import type { AArch64OperationSupportStatus } from "../target-surface/operation-matrix";
import type { AArch64LoweringOptions } from "../public-api";
import type { AArch64SemanticCandidate } from "../select/semantic-superselector";
import type { AArch64DependencyEdge } from "../plan/required-constraints";

export const AARCH64_LOWERING_STAGE_KEYS = [
  "authenticate-target",
  "verify-input-contract",
  "verify-operation-matrix",
  "lower-function-shells",
  "lower-abi",
  "lower-regions",
  "lower-uefi-image-context",
  "materialize-constants",
  "lower-calls",
  "select-local-scalar",
  "lower-terminators",
  "propagate-security-labels",
  "tile-selection-candidates",
  "select-smart-memory-and-endian",
  "lower-memory-order",
  "select-vectors",
  "select-fp-numeric",
  "apply-out-of-profile-and-errata",
  "semantic-superselection",
  "build-dependency-graph",
  "post-selection-cse-and-remat",
  "plan-pairs-prefetch-barriers-schedule",
  "preserve-machine-facts",
  "verify-machine-ir",
  "build-debug-output",
] as const;

export type AArch64LoweringStageKey = (typeof AARCH64_LOWERING_STAGE_KEYS)[number];

export interface AArch64LoweringSelectionRecord {
  readonly stageKey: AArch64LoweringStageKey | "selector";
  readonly subjectKey: string;
  readonly patternId: string;
  readonly tier: "local" | "window" | "semantic" | "helper" | "planning";
  readonly coveredOperationIds?: readonly number[];
  readonly factsUsed: readonly number[];
  readonly emittedOpcodes: readonly string[];
  readonly emittedInstructionIds?: readonly AArch64MachineInstructionId[];
  readonly factPreservationMappings?: readonly AArch64FactPreservationMapping[];
  readonly explanation: readonly string[];
}

export interface AArch64FactPreservationMapping {
  readonly optIrFactIds: readonly number[];
  readonly extensionKey?: string;
  readonly subject: AArch64MachineFactSubject;
  readonly payload?: Readonly<Record<string, unknown>>;
  readonly upstreamVerifierKey?: string;
  readonly targetDeclarationKeys?: readonly string[];
  readonly manifestGate?: string;
}

export interface AArch64LoweringPlanningRecord {
  readonly stageKey: AArch64LoweringStageKey | "planner";
  readonly subjectKey: string;
  readonly action: string;
  readonly explanation: readonly string[];
}

export interface AArch64OperationSupportContract {
  readonly operationId: number;
  readonly operationKind: string;
  readonly status: AArch64OperationSupportStatus;
  readonly authorization:
    | "required"
    | "fact-gated-fallback"
    | "fact-gated-fact"
    | "helper-catalog"
    | "semantic-plugin";
  readonly factsUsed: readonly number[];
  readonly helperPatternIds: readonly string[];
  readonly explanation: readonly string[];
}

export interface AArch64LoweringDebugOutput {
  readonly stageTrace: readonly AArch64LoweringStageKey[];
  readonly deterministicDump?: string;
  readonly explanations: readonly string[];
}

export interface AArch64LoweringState {
  readonly program: OptIrProgram;
  readonly operations: ReadonlyMap<OptIrOperationId, OptIrOperation>;
  readonly optimizationRegions: readonly OptIrRegion[];
  readonly operationInputDuplicateIds: readonly number[];
  readonly facts: OptIrFactSet;
  readonly target: AArch64TargetSurface;
  readonly options: AArch64LoweringOptions;
  readonly authenticatedTargetFingerprint?: string;
  readonly consultedSubsurfaceFingerprints: readonly string[];
  readonly machineProgram?: AArch64MachineProgram;
  readonly preservedFacts?: AArch64PreservedFactSet;
  readonly dependencyEdges: readonly AArch64DependencyEdge[];
  readonly requiredEdges: readonly AArch64DependencyEdge[];
  readonly scheduleOrderByBlock: Readonly<Record<string, readonly number[]>>;
  readonly operationSupportContracts: ReadonlyMap<number, AArch64OperationSupportContract>;
  readonly semanticCandidates: readonly AArch64SemanticCandidate[];
  readonly semanticDispatchDiagnostics: readonly string[];
  readonly semanticManifestLiveOuts: Readonly<Record<string, readonly string[]>>;
  readonly provenance: AArch64ProvenanceMap;
  readonly selectionRecords: readonly AArch64LoweringSelectionRecord[];
  readonly planningRecords: readonly AArch64LoweringPlanningRecord[];
  readonly debugOutput: AArch64LoweringDebugOutput;
}

export interface AArch64LoweringPipelineInput {
  readonly state: AArch64LoweringState;
}

export interface AArch64LoweringPipelineOutput {
  readonly state: AArch64LoweringState;
}

export type AArch64LoweringPipelineStageResult =
  | {
      readonly kind: "ok";
      readonly output: AArch64LoweringPipelineOutput;
      readonly diagnostics: readonly AArch64LoweringDiagnostic[];
    }
  | { readonly kind: "error"; readonly diagnostics: readonly AArch64LoweringDiagnostic[] };

export interface AArch64LoweringPipelineStage {
  readonly stageKey: AArch64LoweringStageKey;
  readonly run: (input: AArch64LoweringPipelineInput) => AArch64LoweringPipelineStageResult;
}

export function okAArch64LoweringStage(
  state: AArch64LoweringState,
  diagnostics: readonly AArch64LoweringDiagnostic[] = [],
): AArch64LoweringPipelineStageResult {
  return {
    kind: "ok",
    output: { state },
    diagnostics: Object.freeze([...diagnostics]),
  };
}

export function appendAArch64StageTrace(
  state: AArch64LoweringState,
  stageKey: AArch64LoweringStageKey,
): AArch64LoweringState {
  return Object.freeze({
    ...state,
    debugOutput: Object.freeze({
      ...state.debugOutput,
      stageTrace: Object.freeze([...state.debugOutput.stageTrace, stageKey]),
    }),
  });
}

export function appendAArch64SelectionRecord(
  state: AArch64LoweringState,
  record: AArch64LoweringSelectionRecord,
): AArch64LoweringState {
  return Object.freeze({
    ...state,
    selectionRecords: Object.freeze([...state.selectionRecords, Object.freeze(record)]),
  });
}

export function appendAArch64PlanningRecord(
  state: AArch64LoweringState,
  record: AArch64LoweringPlanningRecord,
): AArch64LoweringState {
  return Object.freeze({
    ...state,
    planningRecords: Object.freeze([...state.planningRecords, Object.freeze(record)]),
  });
}
