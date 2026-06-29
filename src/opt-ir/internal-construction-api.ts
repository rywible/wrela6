import type { LayoutFactProgram } from "../layout/layout-program";
import type { CheckedOptIrHandoff } from "../proof-check/model/opt-ir-handoff";
import type { ProofAuthorityFingerprint } from "../shared/proof-authority-types";
import type { OptIrProgram } from "./program";
import type { OptIrTargetSurface } from "./target-surface";
import type { OptIrOptimizationPolicy } from "./policy/optimization-profile";

export interface AuthenticatedLayoutFactProgram {
  readonly facts: LayoutFactProgram;
  readonly fingerprint: ProofAuthorityFingerprint;
}

export interface OptIrConstructionOptions {
  readonly deterministicIds?: boolean;
  readonly recordConstructionTrace?: boolean;
}

export interface InternalConstructOptIrInput {
  readonly handoff: CheckedOptIrHandoff;
  readonly layoutFacts: AuthenticatedLayoutFactProgram;
  readonly target: OptIrTargetSurface;
  readonly options?: OptIrConstructionOptions;
}

export interface OptIrFactSet {
  readonly entries: () => readonly unknown[];
}

export interface OptimizeOptIrInput {
  readonly program: OptIrProgram;
  readonly facts: OptIrFactSet;
  readonly target: OptIrTargetSurface;
  readonly policy: OptIrOptimizationPolicy;
}
