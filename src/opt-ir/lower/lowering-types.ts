import type { OptIrOriginId, OptIrValueId } from "../ids";
import type { OptIrOperation } from "../operations";
import type { OptIrProgram } from "../program";
import type { OptIrOrigin } from "../provenance";
import type { OptIrRegion } from "../regions";
import type { OptIrProofOnlyValueMarker } from "./block-argument-builder";

export type OptIrSkeletonLoweringResult =
  | {
      readonly kind: "ok";
      readonly program: OptIrProgram;
      readonly origins: ReadonlyMap<OptIrOriginId, OptIrOrigin>;
      readonly regions: readonly OptIrRegion[];
      readonly operations: readonly OptIrOperation[];
      readonly valueIdsByKey: ReadonlyMap<string, OptIrValueId>;
      readonly executableValueIds: readonly OptIrValueId[];
      readonly proofOnlyValueIds: readonly OptIrValueId[];
      readonly valuesMarkedForErasure: readonly OptIrProofOnlyValueMarker[];
    }
  | { readonly kind: "error"; readonly diagnostics: readonly string[] };
