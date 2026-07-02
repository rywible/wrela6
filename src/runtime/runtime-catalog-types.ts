import type { ProofAuthorityFingerprint } from "../shared/proof-authority-types";
import type { ParameterId, TargetId } from "../semantic/ids";

export type ProofMirRuntimeOperationId = number & {
  readonly __brand: "ProofMirRuntimeOperationId";
};

export function proofMirRuntimeOperationId(value: number): ProofMirRuntimeOperationId {
  if (!Number.isInteger(value) || value < 0) {
    throw new RangeError(
      `ProofMirRuntimeOperationId must be a non-negative integer, got ${value}.`,
    );
  }
  return value as ProofMirRuntimeOperationId;
}

export type ProofMirRuntimeLoweringOwner =
  | "panicAbort"
  | "validatedBufferHelper"
  | "coroutineFrame"
  | "moveRingCoreTransfer"
  | "targetMemoryHelper"
  | "uefiStatusConversion"
  | "uefiEntryContext"
  | "uefiBootServices"
  | "uefiFirmwareString"
  | "uefiConsoleDiagnostic";

export type ProofMirRuntimeTargetAvailability =
  | { readonly kind: "allTargets" }
  | { readonly kind: "target"; readonly targetId: TargetId }
  | { readonly kind: "targetFeature"; readonly targetId: TargetId; readonly feature: string };

export type ProofMirRuntimePlaceSchema =
  | { readonly kind: "receiver" }
  | { readonly kind: "argument"; readonly parameterId?: ParameterId; readonly index: number }
  | { readonly kind: "result" }
  | { readonly kind: "synthetic"; readonly name: string };

export type ProofMirRuntimeFactRole = "requirement" | "trustedAxiom";

export interface ProofMirRuntimeFactSchema {
  readonly name: string;
  readonly role: ProofMirRuntimeFactRole;
  readonly operands: readonly ProofMirRuntimePlaceSchema[];
}

export type ProofMirRuntimeEffectSchema =
  | { readonly kind: "pure" }
  | { readonly kind: "readsMemory"; readonly place: ProofMirRuntimePlaceSchema }
  | { readonly kind: "writesMemory"; readonly place: ProofMirRuntimePlaceSchema }
  | { readonly kind: "advancesPrivateState"; readonly place: ProofMirRuntimePlaceSchema }
  | { readonly kind: "mayPanic" }
  | { readonly kind: "doesNotReturn" };

export type ProofMirRuntimeAbiReference =
  | { readonly kind: "compilerRuntime"; readonly symbol: string }
  | { readonly kind: "runtimeAbi"; readonly runtimeId: ProofMirRuntimeOperationId };

export interface ProofMirRuntimeOperation {
  readonly runtimeId: ProofMirRuntimeOperationId;
  readonly name: string;
  readonly authorityKey?: string;
  readonly targetAvailability: ProofMirRuntimeTargetAvailability;
  readonly requiredFactSchemas: readonly ProofMirRuntimeFactSchema[];
  readonly consumedCapabilitySchemas: readonly ProofMirRuntimePlaceSchema[];
  readonly producedCapabilitySchemas: readonly ProofMirRuntimePlaceSchema[];
  readonly effectSchemas: readonly ProofMirRuntimeEffectSchema[];
  readonly abi: ProofMirRuntimeAbiReference;
  readonly loweringOwner: ProofMirRuntimeLoweringOwner;
}

export interface ProofMirRuntimeCatalog {
  readonly targetId: TargetId;
  readonly features: readonly string[];
  readonly fingerprint?: ProofAuthorityFingerprint;
  get(runtimeId: ProofMirRuntimeOperationId): ProofMirRuntimeOperation | undefined;
  entries(): readonly ProofMirRuntimeOperation[];
}
