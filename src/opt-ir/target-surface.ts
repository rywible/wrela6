import type { TargetId } from "../semantic/ids";
import type { CheckedType } from "../semantic/surface/type-model";
import type { ProofAuthorityFingerprint } from "../shared/proof-authority-types";
import type { OptIrEffectRequirement } from "./effects";
import type { OptIrScalarType, OptIrType } from "./types";

export type OptIrEndian = "little" | "big";

export interface OptIrTargetDataModel {
  readonly endian: OptIrEndian;
  readonly pointerWidthBits: 32 | 64;
  readonly addressableUnit: "byte";
  readonly maximumObjectSizeBytes: bigint;
  readonly nativeIntegerWidths: readonly number[];
}

export interface OptIrTargetAbiSurface {
  readonly defaultCallingConvention: string;
  readonly stackAlignmentBytes: bigint;
  readonly aggregatePassing: "byValue" | "byReference" | "targetDefined";
  readonly returnValue: "register" | "sretPointer" | "targetDefined";
}

export interface OptIrTargetEffectDescription {
  readonly effectKey: string;
  readonly requirements: readonly OptIrEffectRequirement[];
  readonly ordering: "unordered" | "readVersion" | "ordered";
  readonly observes: readonly string[];
  readonly mutates: readonly string[];
}

export interface OptIrTargetEffectCatalog {
  readonly fingerprint: ProofAuthorityFingerprint;
  readonly resolve: (effectKey: string) => OptIrTargetEffectDescription | undefined;
}

export interface OptIrVectorFeatureSurface {
  readonly enabled: boolean;
  readonly legalLaneTypes: readonly OptIrScalarType[];
  readonly legalLaneCounts: readonly number[];
  readonly preferredByteWidths: readonly number[];
  readonly supportsUnalignedPacketLoads: boolean;
  readonly supportsEndianSwapVectorIdioms: boolean;
}

export interface OptIrAtomicAndVolatilePolicy {
  readonly atomicLoad: "preserve" | "lowerToRuntimeCall" | "reject";
  readonly atomicStore: "preserve" | "lowerToRuntimeCall" | "reject";
  readonly atomicReadModifyWrite: "preserve" | "lowerToRuntimeCall" | "reject";
  readonly volatileLoad: "preserveOrdering" | "lowerToRuntimeCall" | "reject";
  readonly volatileStore: "preserveOrdering" | "lowerToRuntimeCall" | "reject";
}

export interface OptIrEndianFoldContract {
  readonly permitsFirmwareEndianFold: boolean;
  readonly permitsVolatileEndianFold: boolean;
}

export type OptIrIntrinsicLowering =
  | {
      readonly kind: "targetInstruction";
      readonly instruction: string;
    }
  | {
      readonly kind: "runtimeCall";
      readonly runtimeKey: string;
    }
  | {
      readonly kind: "expand";
      readonly sequenceKey: string;
    }
  | {
      readonly kind: "unsupported";
      readonly reason: string;
    };

export interface OptIrIntrinsicLoweringSurface {
  readonly resolve: (intrinsicKey: string) => OptIrIntrinsicLowering | undefined;
}

export interface OptIrSourceTypeAbiSurface {
  readonly lowerType: (type: CheckedType) => OptIrType | undefined;
  readonly lowerSwitchCaseLabel?: (input: {
    readonly type: CheckedType;
    readonly label: string;
  }) => string | undefined;
  readonly lowerSwitchCasePayload?: (input: {
    readonly type: CheckedType;
    readonly label: string;
    readonly payloadType: CheckedType;
  }) => { readonly kind: "scrutinee" } | undefined;
  readonly lowerEmptyConstruct?: (input: {
    readonly type: CheckedType;
  }) => { readonly kind: "integerConstant"; readonly value: bigint } | undefined;
}

export interface OptIrTargetSurface {
  readonly targetId: TargetId;
  readonly dataModel: OptIrTargetDataModel;
  readonly abi: OptIrTargetAbiSurface;
  readonly sourceTypeAbi?: OptIrSourceTypeAbiSurface;
  readonly platformEffects: OptIrTargetEffectCatalog;
  readonly runtimeEffects: OptIrTargetEffectCatalog;
  readonly vector: OptIrVectorFeatureSurface;
  readonly atomicAndVolatile: OptIrAtomicAndVolatilePolicy;
  readonly endianFoldContract: OptIrEndianFoldContract;
  readonly intrinsicLowering: OptIrIntrinsicLoweringSurface;
}
