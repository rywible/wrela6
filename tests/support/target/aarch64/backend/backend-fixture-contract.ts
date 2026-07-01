import type { CompileAArch64ObjectInput } from "../../../../../src/target/aarch64/backend/api/compile-aarch64-object";
import type { AArch64BackendTargetSurface } from "../../../../../src/target/aarch64/backend/api/backend-target-surface";
import type { AArch64ClosedImageBackendPlan } from "../../../../../src/target/aarch64/backend/api/closed-image-backend-plan";
import type { AArch64MachineProgram } from "../../../../../src/target/aarch64/machine-ir/machine-program";
import type { AArch64PreservedFactSet } from "../../../../../src/target/aarch64/machine-ir/fact-set";
import type {
  AArch64ObjectSection,
  AArch64ObjectSymbol,
} from "../../../../../src/target/aarch64/backend/object/object-module";

export interface BackendInputForTestOptions {
  readonly machineProgram?: AArch64MachineProgram;
  readonly preservedFacts?: AArch64PreservedFactSet;
  readonly target?: AArch64BackendTargetSurface;
  readonly closedImagePlan?: AArch64ClosedImageBackendPlan;
  readonly debugArtifacts?: CompileAArch64ObjectInput["debugArtifacts"];
}

export type SectionForTest = (
  input?: string | { readonly stableKey: string },
) => AArch64ObjectSection;
export type SymbolForTest = (input: string | { readonly stableKey: string }) => AArch64ObjectSymbol;
