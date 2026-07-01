import type { OptIrOperationId, OptIrValueId } from "../../../opt-ir/ids";
import type {
  AArch64MachineInstructionId,
  AArch64PatternId,
  AArch64VirtualRegisterId,
} from "./ids";

export type AArch64ProvenanceOrigin =
  | { readonly kind: "source"; readonly sourceKey: string }
  | { readonly kind: "hir"; readonly hirKey: string }
  | { readonly kind: "mono"; readonly monoKey: string }
  | { readonly kind: "proofMir"; readonly proofMirKey: string }
  | { readonly kind: "checkedMir"; readonly checkedMirKey: string }
  | { readonly kind: "layout"; readonly layoutKey: string }
  | {
      readonly kind: "optIr";
      readonly operationId?: OptIrOperationId;
      readonly valueId?: OptIrValueId;
    }
  | { readonly kind: "targetSurface"; readonly fingerprint: string }
  | {
      readonly kind: "selectedPattern";
      readonly patternId: AArch64PatternId;
      readonly instructionId?: AArch64MachineInstructionId;
    }
  | { readonly kind: "syntheticLowering"; readonly stableKey: string }
  | { readonly kind: "machinePlanning"; readonly planningKey: string };

export interface AArch64ProvenanceMap {
  readonly origins: readonly AArch64ProvenanceOrigin[];
  readonly ownerIds: readonly AArch64VirtualRegisterId[];
}

export function syntheticAArch64Origin(stableKey: string): AArch64ProvenanceOrigin {
  if (stableKey.length === 0) {
    throw new RangeError("synthetic origin key must be non-empty.");
  }
  return Object.freeze({ kind: "syntheticLowering", stableKey });
}

export function selectedAArch64PatternOrigin(input: {
  readonly patternId: AArch64PatternId;
  readonly instructionId?: AArch64MachineInstructionId;
}): AArch64ProvenanceOrigin {
  return Object.freeze({
    kind: "selectedPattern",
    patternId: input.patternId,
    ...(input.instructionId === undefined ? {} : { instructionId: input.instructionId }),
  });
}

export function aarch64ProvenanceMap(input: AArch64ProvenanceMap): AArch64ProvenanceMap {
  return Object.freeze({
    origins: Object.freeze(input.origins.map((origin) => Object.freeze({ ...origin }))),
    ownerIds: Object.freeze([...input.ownerIds]),
  });
}

export function emptyAArch64ProvenanceMap(): AArch64ProvenanceMap {
  return aarch64ProvenanceMap({ origins: [], ownerIds: [] });
}
