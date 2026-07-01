import { sortAArch64Diagnostics, type AArch64LoweringDiagnostic } from "../machine-ir/diagnostics";
import type { AArch64PreservedFactSet } from "../machine-ir/fact-set";
import type { AArch64MachineProgram } from "../machine-ir/machine-program";
import type { AArch64AbiTargetSurface } from "../target-surface/target-surface";
import { defaultAArch64MachineVerifierSuite } from "./default-verifier-suite";
import {
  makeAArch64MachineVerifierDiagnostic,
  type AArch64MachineVerifierDescriptor,
  type AArch64MachineVerifierOptions,
} from "./verifier-suite";

export { AARCH64_MACHINE_VERIFIER_KEYS } from "./verifier-suite";
export type {
  AArch64MachineVerifierDescriptor,
  AArch64MachineVerifierKey,
  AArch64MachineVerifierOptions,
} from "./verifier-suite";
export { defaultAArch64MachineVerifierSuite } from "./default-verifier-suite";

export type VerifyAArch64MachineProgramResult =
  | { readonly kind: "ok"; readonly diagnostics: readonly [] }
  | { readonly kind: "error"; readonly diagnostics: readonly AArch64LoweringDiagnostic[] };

export interface VerifyAArch64MachineProgramInput {
  readonly program: AArch64MachineProgram;
  readonly options?: AArch64MachineVerifierOptions;
  readonly verifierSuite?: readonly AArch64MachineVerifierDescriptor[];
  readonly preservedFacts?: AArch64PreservedFactSet;
  readonly abi?: AArch64AbiTargetSurface;
  readonly preservedOptIrFactIds?: readonly number[];
  readonly selectionCandidates?: Parameters<
    AArch64MachineVerifierDescriptor["verify"]
  >[0]["selectionCandidates"];
  readonly requiredSelectionCoverage?: Parameters<
    AArch64MachineVerifierDescriptor["verify"]
  >[0]["requiredSelectionCoverage"];
  readonly semanticCandidates?: Parameters<
    AArch64MachineVerifierDescriptor["verify"]
  >[0]["semanticCandidates"];
  readonly semanticManifestLiveOuts?: Parameters<
    AArch64MachineVerifierDescriptor["verify"]
  >[0]["semanticManifestLiveOuts"];
  readonly semanticOperationKindsById?: Parameters<
    AArch64MachineVerifierDescriptor["verify"]
  >[0]["semanticOperationKindsById"];
  readonly targetProfileFeatures?: Parameters<
    AArch64MachineVerifierDescriptor["verify"]
  >[0]["targetProfileFeatures"];
  readonly dependencyEdges?: Parameters<
    AArch64MachineVerifierDescriptor["verify"]
  >[0]["dependencyEdges"];
  readonly requiredEdges?: Parameters<
    AArch64MachineVerifierDescriptor["verify"]
  >[0]["requiredEdges"];
  readonly scheduleOrderByBlock?: Parameters<
    AArch64MachineVerifierDescriptor["verify"]
  >[0]["scheduleOrderByBlock"];
}

export function verifyAArch64MachineProgram(
  input: VerifyAArch64MachineProgramInput,
): VerifyAArch64MachineProgramResult {
  const context = {
    program: input.program,
    options: input.options ?? {},
    preservedFacts: input.preservedFacts,
    abi: input.abi,
    preservedOptIrFactIds: input.preservedOptIrFactIds,
    selectionCandidates: input.selectionCandidates,
    requiredSelectionCoverage: input.requiredSelectionCoverage,
    semanticCandidates: input.semanticCandidates,
    semanticManifestLiveOuts: input.semanticManifestLiveOuts,
    semanticOperationKindsById: input.semanticOperationKindsById,
    targetProfileFeatures: input.targetProfileFeatures,
    dependencyEdges: input.dependencyEdges,
    requiredEdges: input.requiredEdges,
    scheduleOrderByBlock: input.scheduleOrderByBlock,
    makeDiagnostic: makeAArch64MachineVerifierDiagnostic,
  };
  const diagnostics = [
    ...requiredVerifierContextDiagnostics(context),
    ...(input.verifierSuite ?? defaultAArch64MachineVerifierSuite).flatMap((descriptor) =>
      descriptor.verify(context),
    ),
  ];
  const sorted = sortAArch64Diagnostics(diagnostics);
  return sorted.length === 0
    ? { kind: "ok", diagnostics: [] }
    : { kind: "error", diagnostics: sorted };
}

function requiredVerifierContextDiagnostics(
  context: Parameters<AArch64MachineVerifierDescriptor["verify"]>[0],
): readonly AArch64LoweringDiagnostic[] {
  const required = new Set(context.options.requiredVerifierKeys ?? []);
  if (required.size === 0) return [];
  const diagnostics: AArch64LoweringDiagnostic[] = [];
  if (required.has("facts") && context.preservedFacts === undefined) {
    diagnostics.push(missingContextDiagnostic("facts", "preservedFacts"));
  }
  if (required.has("tiling") && context.selectionCandidates === undefined) {
    diagnostics.push(missingContextDiagnostic("tiling", "selectionCandidates"));
  }
  if (required.has("scheduler")) {
    if (context.dependencyEdges === undefined) {
      diagnostics.push(missingContextDiagnostic("scheduler", "dependencyEdges"));
    }
    if (context.requiredEdges === undefined) {
      diagnostics.push(missingContextDiagnostic("scheduler", "requiredEdges"));
    }
  }
  return diagnostics;
}

function missingContextDiagnostic(verifierKey: string, field: string): AArch64LoweringDiagnostic {
  return makeAArch64MachineVerifierDiagnostic({
    code: "AARCH64_INPUT_CONTRACT_INVALID",
    ownerKey: `verifier:${verifierKey}`,
    rootCauseKey: "verifier-context",
    stableDetail: `verifier-context-missing:${verifierKey}:${field}`,
  });
}
