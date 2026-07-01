import { aarch64Diagnostic, type AArch64LoweringDiagnostic } from "../machine-ir/diagnostics";
import type { AArch64PreservedFactSet } from "../machine-ir/fact-set";
import type { AArch64MachineProgram } from "../machine-ir/machine-program";
import type { AArch64DependencyEdge } from "../plan/required-constraints";
import type { AArch64AbiTargetSurface } from "../target-surface/target-surface";

export const AARCH64_MACHINE_VERIFIER_KEYS = [
  "structural",
  "nzcv",
  "abi",
  "regions",
  "facts",
  "tiling",
  "superselection",
  "memory-order",
  "scheduler",
  "fp-environment",
  "security",
] as const;

export type AArch64MachineVerifierKey = (typeof AARCH64_MACHINE_VERIFIER_KEYS)[number];

export interface AArch64MachineVerifierOptions {
  readonly checkInstructionSchema?: boolean;
  readonly checkResources?: boolean;
  readonly requiredVerifierKeys?: readonly AArch64MachineVerifierKey[];
}

export interface AArch64MachineVerifierDiagnosticInput {
  readonly code: Parameters<typeof aarch64Diagnostic>[0]["code"];
  readonly messageTemplate?: string;
  readonly ownerKey: string;
  readonly rootCauseKey: string;
  readonly stableDetail: string;
}

export interface AArch64MachineVerifierContext {
  readonly program: AArch64MachineProgram;
  readonly options: AArch64MachineVerifierOptions;
  readonly preservedFacts?: AArch64PreservedFactSet;
  readonly abi?: AArch64AbiTargetSurface;
  readonly preservedOptIrFactIds?: readonly number[];
  readonly selectionCandidates?: readonly {
    readonly patternId: string;
    readonly covers: readonly number[];
    readonly tier: "local" | "window" | "semantic" | "helper";
    readonly cost: number;
    readonly factsUsed?: readonly number[];
    readonly emittedOpcodes?: readonly string[];
    readonly replacesBaselinePatternIds?: readonly string[];
  }[];
  readonly requiredSelectionCoverage?: readonly number[];
  readonly semanticCandidates?: readonly {
    readonly patternId: string;
    readonly consumedOperations: readonly number[];
    readonly liveOuts: readonly string[];
    readonly effects: readonly string[];
    readonly factsUsed?: readonly number[];
  }[];
  readonly semanticManifestLiveOuts?: Readonly<Record<string, readonly string[]>>;
  readonly semanticOperationKindsById?: Readonly<Record<number, string>>;
  readonly targetProfileFeatures?: readonly string[];
  readonly dependencyEdges?: readonly AArch64DependencyEdge[];
  readonly requiredEdges?: readonly AArch64DependencyEdge[];
  readonly scheduleOrderByBlock?: Readonly<Record<string, readonly number[]>>;
  readonly makeDiagnostic: (
    input: AArch64MachineVerifierDiagnosticInput,
  ) => AArch64LoweringDiagnostic;
}

export interface AArch64MachineVerifierDescriptor {
  readonly key: AArch64MachineVerifierKey;
  readonly verify: (context: AArch64MachineVerifierContext) => readonly AArch64LoweringDiagnostic[];
}

export function makeAArch64MachineVerifierDiagnostic(
  input: AArch64MachineVerifierDiagnosticInput,
): AArch64LoweringDiagnostic {
  return aarch64Diagnostic(input);
}
