import type { OptIrProgram } from "./program";
import type { OptIrDiagnostic } from "./diagnostics";
import type { OptIrFactSet } from "./facts/fact-index";
import type { OptIrOriginId } from "./ids";
import type { OptIrProofErasureProvenance } from "./lower/proof-erasure";
import type { OptIrOperation } from "./operations";
import type { OptIrRegion } from "./regions";
import type { ProofAuthorityFingerprint } from "../shared/proof-authority-types";

export interface ConstructedOptIrProvenanceSnapshot {
  readonly originIds: readonly OptIrOriginId[];
  readonly fingerprint: ProofAuthorityFingerprint;
}

export type ConstructedOptIrProgram = Omit<OptIrProgram, "provenance"> & {
  readonly provenance: ConstructedOptIrProvenanceSnapshot;
};

export type ConstructOptIrResult =
  | {
      readonly kind: "ok";
      readonly program: ConstructedOptIrProgram;
      readonly operations: readonly OptIrOperation[];
      readonly optimizationRegions: readonly OptIrRegion[];
      readonly facts: OptIrFactSet;
      readonly provenance: ConstructedOptIrProvenanceSnapshot;
      readonly proofErasureProvenance: OptIrProofErasureProvenance;
      readonly diagnostics: readonly OptIrDiagnostic[];
    }
  | { readonly kind: "error"; readonly diagnostics: readonly OptIrDiagnostic[] };
