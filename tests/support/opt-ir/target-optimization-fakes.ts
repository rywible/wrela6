import { optIrAliasClassId } from "../../../src/opt-ir/ids";
import type { OptIrEffectRequirement } from "../../../src/opt-ir/effects";
import {
  type OptIrIntrinsicLowering,
  type OptIrTargetEffectDescription,
  type OptIrTargetSurface,
} from "../../../src/opt-ir/target-surface";
import { optIrUnsignedIntegerType } from "../../../src/opt-ir/types";
import { targetId } from "../../../src/semantic/ids";
import type { ProofAuthorityFingerprint } from "../../../src/shared/proof-authority-types";

export interface TargetEffectEntryForTest {
  readonly targetKey: string;
  readonly requirements: readonly OptIrEffectRequirement[];
}

export interface RuntimeEffectEntryForTest {
  readonly runtimeKey: string;
  readonly requirements: readonly OptIrEffectRequirement[];
}

export interface IntrinsicLoweringEntryForTest {
  readonly intrinsicKey: string;
  readonly lowering: OptIrIntrinsicLowering;
}

export interface TargetOptimizationSurfaceForTestOptions {
  readonly vectorEnabled?: boolean;
  readonly platformEffects?: readonly TargetEffectEntryForTest[];
  readonly runtimeEffects?: readonly RuntimeEffectEntryForTest[];
  readonly intrinsics?: readonly IntrinsicLoweringEntryForTest[];
}

export function effectRequirementForTest(
  requirement: OptIrEffectRequirement,
): OptIrEffectRequirement {
  return requirement;
}

function fingerprint(
  authorityKind: ProofAuthorityFingerprint["authorityKind"],
  digestHex: string,
): ProofAuthorityFingerprint {
  return {
    authorityKind,
    targetId: targetId("opt-ir-fixture-target"),
    version: "v1",
    digestAlgorithm: "sha256",
    digestHex,
  };
}

function effectOrdering(
  requirements: readonly OptIrEffectRequirement[],
): OptIrTargetEffectDescription["ordering"] {
  if (
    requirements.some(
      (requirement) =>
        requirement.mode === "orderedEffectToken" ||
        requirement.mode === "advancePrivateState" ||
        requirement.mode === "terminal",
    )
  ) {
    return "ordered";
  }
  if (requirements.some((requirement) => requirement.mode === "readVersionToken")) {
    return "readVersion";
  }
  return "unordered";
}

function observedRegions(requirements: readonly OptIrEffectRequirement[]): string[] {
  return requirements
    .filter((requirement) => requirement.mode === "observe")
    .map((requirement) => `region:${String(requirement.region)}`);
}

function mutatedRegions(requirements: readonly OptIrEffectRequirement[]): string[] {
  return requirements
    .filter((requirement) => requirement.mode === "mutate")
    .map((requirement) => `region:${String(requirement.region)}`);
}

function effectDescription(
  effectKey: string,
  requirements: readonly OptIrEffectRequirement[],
): OptIrTargetEffectDescription {
  return {
    effectKey,
    requirements,
    ordering: effectOrdering(requirements),
    observes: observedRegions(requirements),
    mutates: mutatedRegions(requirements),
  };
}

export function targetOptimizationSurfaceForTest(
  options: TargetOptimizationSurfaceForTestOptions = {},
): OptIrTargetSurface {
  const platformEffectEntries = options.platformEffects ?? [
    {
      targetKey: "platform.read_timer",
      requirements: [{ mode: "orderedEffectToken", tokenKey: "platform:timer" }],
    },
  ];
  const runtimeEffectEntries = options.runtimeEffects ?? [
    {
      runtimeKey: "runtime.copy",
      requirements: [{ mode: "mutate", region: optIrAliasClassId(1) }],
    },
    {
      runtimeKey: "runtime.bounds_check",
      requirements: [{ mode: "readVersionToken", tokenKey: "bounds:payload" }],
    },
  ];
  const intrinsicEntries = options.intrinsics ?? [
    {
      intrinsicKey: "bswap32",
      lowering: { kind: "targetInstruction", instruction: "bswap32" } as const,
    },
    {
      intrinsicKey: "ctz32",
      lowering: { kind: "targetInstruction", instruction: "ctz32" } as const,
    },
  ];

  const platformEffects = new Map(
    platformEffectEntries.map((entry) => [
      entry.targetKey,
      effectDescription(entry.targetKey, entry.requirements),
    ]),
  );
  const runtimeEffects = new Map(
    runtimeEffectEntries.map((entry) => [
      entry.runtimeKey,
      effectDescription(entry.runtimeKey, entry.requirements),
    ]),
  );
  const intrinsics = new Map(intrinsicEntries.map((entry) => [entry.intrinsicKey, entry.lowering]));

  return {
    targetId: targetId("opt-ir-fixture-target"),
    dataModel: {
      endian: "little",
      pointerWidthBits: 64,
      addressableUnit: "byte",
      maximumObjectSizeBytes: 2n ** 32n,
      nativeIntegerWidths: [8, 16, 32, 64],
    },
    abi: {
      defaultCallingConvention: "wrela-fixture",
      stackAlignmentBytes: 16n,
      aggregatePassing: "targetDefined",
      returnValue: "targetDefined",
    },
    platformEffects: {
      fingerprint: fingerprint("platform", "cc".repeat(32)),
      resolve: (effectKey) => platformEffects.get(effectKey),
    },
    runtimeEffects: {
      fingerprint: fingerprint("runtime", "dd".repeat(32)),
      resolve: (effectKey) => runtimeEffects.get(effectKey),
    },
    vector: {
      enabled: options.vectorEnabled ?? false,
      legalLaneTypes: [optIrUnsignedIntegerType(8), optIrUnsignedIntegerType(32)],
      legalLaneCounts: options.vectorEnabled === true ? [4, 8, 16] : [],
      preferredByteWidths: [16],
      supportsUnalignedPacketLoads: options.vectorEnabled === true,
      supportsEndianSwapVectorIdioms: options.vectorEnabled === true,
    },
    atomicAndVolatile: {
      atomicLoad: "preserve",
      atomicStore: "preserve",
      atomicReadModifyWrite: "lowerToRuntimeCall",
      volatileLoad: "preserveOrdering",
      volatileStore: "preserveOrdering",
    },
    intrinsicLowering: {
      resolve: (intrinsicKey) => intrinsics.get(intrinsicKey),
    },
  };
}
