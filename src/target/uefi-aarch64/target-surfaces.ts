import {
  authenticateAArch64LinkerTargetSurface,
  type AArch64LinkerTargetSurface,
} from "../../linker";
import {
  authenticateAArch64PeCoffEfiWriterTargetSurface,
  type AArch64PeCoffEfiWriterTargetSurface,
} from "../../pe-coff";
import {
  createAArch64Aapcs64AbiTargetSurface,
  EXPECTED_AARCH64_COMPONENT_FINGERPRINTS,
  WRELA_UEFI_AARCH64_RPI5_REQUIRED_FEATURES,
  type AArch64BackendTargetSurface,
  type AArch64TargetSurface,
} from "../aarch64";
import type { OptIrEffectRequirement } from "../../opt-ir/effects";
import { optIrAliasClassId } from "../../opt-ir/ids";
import {
  type OptIrIntrinsicLowering,
  type OptIrTargetEffectDescription,
  type OptIrTargetSurface,
} from "../../opt-ir";
import { optIrUnsignedIntegerType } from "../../opt-ir/types";
import type { TypeId } from "../../semantic/ids";
import type { CheckedType } from "../../semantic/surface/type-model";
import type { ProofAuthorityFingerprint } from "../../shared/proof-authority-types";
import { compareCodeUnitStrings } from "../../shared/deterministic-sort";
import { stableDigestHex } from "../../shared/stable-json";
import type { ProofMirBuildTargetContext } from "../../proof-mir/proof-mir-builder";
import { authenticateAArch64BackendTargetSurface } from "../aarch64/backend/api/backend-target-surface";
import { RPI5_BACKEND_CATALOGS } from "../aarch64/backend/catalogs/rpi5-backend-catalog-data";
import { authenticateAArch64TargetSurface } from "../aarch64/target-surface/profile-authentication";
import { canonicalUefiAArch64SemanticTargetSurface } from "./platform-catalog";
import {
  canonicalUefiAArch64ProofMirRuntimeCatalog,
  fingerprintUefiAArch64ProofMirRuntimeCatalog,
} from "./runtime-catalog";
import { uefiAArch64TargetDiagnostic, type UefiAArch64TargetDiagnostic } from "./diagnostics";
import {
  failedVerification,
  passedVerification,
  uefiAArch64Error,
  uefiAArch64Ok,
  type UefiAArch64TargetResult,
} from "./result";
import type { UefiAArch64TargetDriverSurface } from "./target-driver-surface";

const TARGET_SURFACES_VERIFIER_KEY = "uefi-aarch64-target-surfaces";

export { productionUefiAArch64LayoutTargetSurface } from "./layout-target-surface";
export { productionUefiAArch64ProofCheckInputAuthority } from "./proof-check-authority";

export interface UefiAArch64ResolvedTargetSurfaces {
  readonly aarch64Target: AArch64TargetSurface;
  readonly backendTarget: AArch64BackendTargetSurface;
  readonly linkerTarget: AArch64LinkerTargetSurface;
  readonly peCoffWriterTarget: AArch64PeCoffEfiWriterTargetSurface;
}

export interface UefiAArch64ResolvedTargetSurfaceFingerprints {
  readonly aarch64TargetFingerprint: string;
  readonly backendTargetFingerprint: string;
  readonly linkerTargetFingerprint: string;
  readonly peCoffWriterTargetFingerprint: string;
}

export function productionUefiAArch64ResolvedTargetSurfaces(): UefiAArch64TargetResult<UefiAArch64ResolvedTargetSurfaces> {
  const aarch64Target = productionAArch64TargetSurface();
  const targetAuthentication = authenticateAArch64TargetSurface(aarch64Target);
  if (targetAuthentication.kind === "error") {
    return targetSurfaceError("aarch64-target", targetAuthentication.diagnostics);
  }

  const backendTarget = authenticateAArch64BackendTargetSurface({
    sourceSurface: aarch64Target,
    registerModel: RPI5_BACKEND_CATALOGS.registerModel,
    encodingCatalog: RPI5_BACKEND_CATALOGS.encodingCatalog,
    relocationCatalog: RPI5_BACKEND_CATALOGS.relocationCatalog,
    unwindCatalog: RPI5_BACKEND_CATALOGS.unwindCatalog,
    frameCatalog: RPI5_BACKEND_CATALOGS.frameCatalog,
    veneerCatalog: RPI5_BACKEND_CATALOGS.veneerCatalog,
    literalPoolCatalog: RPI5_BACKEND_CATALOGS.literalPoolCatalog,
    securityCatalog: RPI5_BACKEND_CATALOGS.securityCatalog,
    tuningModel: RPI5_BACKEND_CATALOGS.tuningModel,
  });
  if (backendTarget.kind === "error") {
    return targetSurfaceError("aarch64-backend-target", backendTarget.diagnostics);
  }

  const linkerTarget = authenticateAArch64LinkerTargetSurface({
    backendSurfaceFingerprint: backendTarget.value.backendSurfaceFingerprint,
    relocationCatalogFingerprint: backendTarget.value.relocationCatalog.fingerprint,
  });
  if (linkerTarget.kind === "error") {
    return targetSurfaceError("aarch64-linker-target", linkerTarget.diagnostics);
  }

  const peCoffWriterTarget = authenticateAArch64PeCoffEfiWriterTargetSurface({
    linkedTargetPolicyFingerprint: linkerTarget.value.targetPolicyFingerprint,
  });
  if (peCoffWriterTarget.kind === "error") {
    return targetSurfaceError("aarch64-pe-coff-target", peCoffWriterTarget.diagnostics);
  }

  return uefiAArch64Ok({
    value: Object.freeze({
      aarch64Target,
      backendTarget: backendTarget.value,
      linkerTarget: linkerTarget.value,
      peCoffWriterTarget: peCoffWriterTarget.value,
    }),
    verification: passedVerification(TARGET_SURFACES_VERIFIER_KEY, "resolve"),
  });
}

export function productionUefiAArch64TargetSurfaceFingerprints(): UefiAArch64TargetResult<UefiAArch64ResolvedTargetSurfaceFingerprints> {
  const surfaces = productionUefiAArch64ResolvedTargetSurfaces();
  if (surfaces.kind === "error") return surfaces;

  const targetAuthentication = authenticateAArch64TargetSurface(surfaces.value.aarch64Target);
  if (targetAuthentication.kind === "error") {
    return targetSurfaceError("aarch64-target", targetAuthentication.diagnostics);
  }

  return uefiAArch64Ok({
    value: Object.freeze({
      aarch64TargetFingerprint: targetAuthentication.fingerprint,
      backendTargetFingerprint: surfaces.value.backendTarget.backendSurfaceFingerprint,
      linkerTargetFingerprint: surfaces.value.linkerTarget.targetPolicyFingerprint,
      peCoffWriterTargetFingerprint: surfaces.value.peCoffWriterTarget.targetPolicyFingerprint,
    }),
    verification: passedVerification(TARGET_SURFACES_VERIFIER_KEY, "fingerprints"),
  });
}

export function authenticateUefiAArch64PeCoffWriterTargetForLinkedPolicy(input: {
  readonly linkedTargetPolicyFingerprint: string;
}): UefiAArch64TargetResult<AArch64PeCoffEfiWriterTargetSurface> {
  const peCoffWriterTarget = authenticateAArch64PeCoffEfiWriterTargetSurface({
    linkedTargetPolicyFingerprint: input.linkedTargetPolicyFingerprint,
  });
  if (peCoffWriterTarget.kind === "error") {
    return targetSurfaceError("aarch64-pe-coff-target", peCoffWriterTarget.diagnostics);
  }
  return uefiAArch64Ok({
    value: peCoffWriterTarget.value,
    verification: passedVerification(TARGET_SURFACES_VERIFIER_KEY, "pe-coff-writer-for-link"),
  });
}

export interface UefiAArch64OptIrTargetSurfaceOptions {
  readonly sourceApiResultConstructorTypeId?: TypeId;
  readonly validationResultConstructorTypeIds?: readonly TypeId[];
  readonly statusCarrierPayloadTypeIds?: readonly TypeId[];
}

export function productionUefiAArch64OptIrTargetSurface(
  target: UefiAArch64TargetDriverSurface,
  options: UefiAArch64OptIrTargetSurfaceOptions = {},
): OptIrTargetSurface {
  const sourceApiResultConstructorTypeId = options.sourceApiResultConstructorTypeId;
  const statusCarrierConstructorTypeIds = new Set<TypeId>([
    ...(sourceApiResultConstructorTypeId === undefined ? [] : [sourceApiResultConstructorTypeId]),
    ...(options.validationResultConstructorTypeIds ?? []),
  ]);
  const statusCarrierPayloadTypeIds = new Set<TypeId>(options.statusCarrierPayloadTypeIds ?? []);
  const platformEffects = optIrEffectCatalog(
    "platform",
    target,
    target.platformLowerings.map((lowering) => ({
      effectKey: String(lowering.primitiveId),
      requirements: optIrPlatformEffectRequirements(
        lowering.lowering.kind,
        String(lowering.primitiveId),
      ),
    })),
  );
  const runtimeEffects = optIrEffectCatalog(
    "runtime",
    target,
    target.runtimeMaterializations.map((materialization, index) => ({
      effectKey: String(materialization.runtimeId),
      requirements: optIrRuntimeEffectRequirements(materialization.materialization, index),
    })),
  );
  const intrinsicLowerings = new Map<string, OptIrIntrinsicLowering>();

  return Object.freeze({
    targetId: canonicalUefiAArch64SemanticTargetSurface().targetId,
    dataModel: Object.freeze({
      endian: "little" as const,
      pointerWidthBits: 64 as const,
      addressableUnit: "byte" as const,
      maximumObjectSizeBytes: 1_073_741_824n,
      nativeIntegerWidths: Object.freeze([8, 16, 32, 64]),
    }),
    abi: Object.freeze({
      defaultCallingConvention: target.entryProfile.entryCallConvention,
      stackAlignmentBytes: 16n,
      aggregatePassing: "targetDefined" as const,
      returnValue: "targetDefined" as const,
    }),
    ...(statusCarrierConstructorTypeIds.size === 0
      ? {}
      : {
          sourceTypeAbi: Object.freeze({
            lowerType: (type: CheckedType) =>
              isSourceStatusCarrierType(type, statusCarrierConstructorTypeIds) ||
              isSourceStatusPayloadType(type, statusCarrierPayloadTypeIds)
                ? optIrUnsignedIntegerType(64)
                : undefined,
            lowerSwitchCaseLabel: (input: { readonly type: CheckedType; readonly label: string }) =>
              isSourceStatusCarrierType(input.type, statusCarrierConstructorTypeIds)
                ? sourceApiResultSwitchCaseLabel(input.label)
                : undefined,
            lowerSwitchCasePayload: (input: {
              readonly type: CheckedType;
              readonly label: string;
              readonly payloadType: CheckedType;
            }) =>
              isSourceStatusCarrierType(input.type, statusCarrierConstructorTypeIds) &&
              isSourceStatusPayloadType(input.payloadType, statusCarrierPayloadTypeIds) &&
              sourceApiResultSwitchCaseLabel(input.label) === "1"
                ? { kind: "scrutinee" as const }
                : undefined,
            lowerEmptyConstruct: (input: { readonly type: CheckedType }) =>
              isSourceStatusCarrierType(input.type, statusCarrierConstructorTypeIds)
                ? { kind: "integerConstant" as const, value: 0n }
                : undefined,
          }),
        }),
    platformEffects,
    runtimeEffects,
    vector: Object.freeze({
      enabled: false,
      legalLaneTypes: Object.freeze([optIrUnsignedIntegerType(8), optIrUnsignedIntegerType(32)]),
      legalLaneCounts: Object.freeze([]),
      preferredByteWidths: Object.freeze([16]),
      supportsUnalignedPacketLoads: false,
      supportsEndianSwapVectorIdioms: false,
    }),
    atomicAndVolatile: Object.freeze({
      atomicLoad: "preserve" as const,
      atomicStore: "preserve" as const,
      atomicReadModifyWrite: "lowerToRuntimeCall" as const,
      volatileLoad: "preserveOrdering" as const,
      volatileStore: "preserveOrdering" as const,
    }),
    // DDI0487 permits architectural little-endian operation, but UEFI firmware
    // table accesses and volatile reads remain target-owned side-effect boundaries.
    endianFoldContract: Object.freeze({
      permitsFirmwareEndianFold: false,
      permitsVolatileEndianFold: false,
    }),
    intrinsicLowering: Object.freeze({
      resolve: (intrinsicKey: string) => intrinsicLowerings.get(intrinsicKey),
    }),
  });
}

export function productionUefiAArch64ProofMirBuildTargetContext(
  target: UefiAArch64TargetDriverSurface,
): ProofMirBuildTargetContext {
  const runtimeCatalog = canonicalUefiAArch64ProofMirRuntimeCatalog();
  const runtimeCatalogFingerprint = fingerprintUefiAArch64ProofMirRuntimeCatalog(runtimeCatalog);
  if (target.proofMirRuntimeCatalogFingerprint !== runtimeCatalogFingerprint) {
    throw new RangeError(
      `UEFI AArch64 Proof-MIR adapter requires the production runtime catalog fingerprint '${runtimeCatalogFingerprint}'.`,
    );
  }
  return Object.freeze({
    targetId: canonicalUefiAArch64SemanticTargetSurface().targetId,
    features: Object.freeze([...runtimeCatalog.features]),
    runtimeCatalog,
  });
}

function proofAuthorityFingerprint(input: {
  readonly authorityKind: ProofAuthorityFingerprint["authorityKind"];
  readonly targetId: ProofAuthorityFingerprint["targetId"];
  readonly version: string;
  readonly content: unknown;
}): ProofAuthorityFingerprint {
  return {
    authorityKind: input.authorityKind,
    targetId: input.targetId,
    version: input.version,
    digestAlgorithm: "sha256",
    digestHex: stableDigestHex(input.content),
  };
}

function optIrEffectCatalog(
  authorityKind: ProofAuthorityFingerprint["authorityKind"],
  target: UefiAArch64TargetDriverSurface,
  entries: readonly {
    readonly effectKey: string;
    readonly requirements: readonly OptIrEffectRequirement[];
  }[],
): OptIrTargetSurface["platformEffects"] {
  const descriptions = new Map(
    [...entries]
      .sort((left, right) => compareCodeUnitStrings(left.effectKey, right.effectKey))
      .map((entry) => [
        entry.effectKey,
        optIrEffectDescription(entry.effectKey, entry.requirements),
      ]),
  );
  return Object.freeze({
    fingerprint: proofAuthorityFingerprint({
      authorityKind,
      targetId: canonicalUefiAArch64SemanticTargetSurface().targetId,
      version: "uefi-aarch64-opt-ir-effects-v1",
      content: {
        targetDriverFingerprint: target.targetDriverFingerprint,
        effects: [...descriptions.values()].map((description) => ({
          effectKey: description.effectKey,
          requirements: description.requirements,
          ordering: description.ordering,
        })),
      },
    }),
    resolve: (effectKey: string) => descriptions.get(effectKey),
  });
}

function optIrPlatformEffectRequirements(
  loweringKind:
    | "firmware-call"
    | "compiler-runtime-helper"
    | "constant-status"
    | "zero-runtime"
    | "inline",
  primitiveId: string,
): readonly OptIrEffectRequirement[] {
  if (loweringKind === "inline" || loweringKind === "zero-runtime") return Object.freeze([]);
  return Object.freeze([{ mode: "orderedEffectToken", tokenKey: `uefi-platform:${primitiveId}` }]);
}

function isSourceStatusCarrierType(
  type: CheckedType,
  constructorTypeIds: ReadonlySet<TypeId>,
): boolean {
  return (
    type.kind === "applied" &&
    type.constructor.kind === "source" &&
    constructorTypeIds.has(type.constructor.typeId)
  );
}

function isSourceStatusPayloadType(
  type: CheckedType,
  payloadTypeIds: ReadonlySet<TypeId>,
): boolean {
  return type.kind === "source" && payloadTypeIds.has(type.typeId);
}

function sourceApiResultSwitchCaseLabel(label: string): string | undefined {
  switch (label) {
    case "Ok":
      return "0";
    case "Err":
      return "1";
    default:
      return undefined;
  }
}

function optIrRuntimeEffectRequirements(
  materialization: "backend-object" | "source-runtime" | "inline-only",
  index: number,
): readonly OptIrEffectRequirement[] {
  switch (materialization) {
    case "backend-object":
      return Object.freeze([
        { mode: "orderedEffectToken", tokenKey: `uefi-runtime:backend-object:${index}` },
      ]);
    case "source-runtime":
      return Object.freeze([{ mode: "mutate", region: optIrAliasClassId(index + 1) }]);
    case "inline-only":
      return Object.freeze([]);
  }
}

function optIrEffectDescription(
  effectKey: string,
  requirements: readonly OptIrEffectRequirement[],
): OptIrTargetEffectDescription {
  return Object.freeze({
    effectKey,
    requirements: Object.freeze([...requirements]),
    ordering: optIrEffectOrdering(requirements),
    observes: Object.freeze(
      requirements
        .filter((requirement) => requirement.mode === "observe")
        .map((requirement) => `region:${String(requirement.region)}`),
    ),
    mutates: Object.freeze(
      requirements
        .filter((requirement) => requirement.mode === "mutate")
        .map((requirement) => `region:${String(requirement.region)}`),
    ),
  });
}

function optIrEffectOrdering(
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

function productionAArch64TargetSurface(): AArch64TargetSurface {
  return Object.freeze({
    profile: Object.freeze({
      profileId: "wrela-uefi-aarch64-rpi5-v1",
      architecture: "Armv8.2-A",
      instructionSet: "raspberry-pi-5-class",
      imageProfile: "uefi-pe-coff",
      deviceModel: "virtio",
      tuningModel: "cortex-a76-rpi5-like",
      requiredFeatures: WRELA_UEFI_AARCH64_RPI5_REQUIRED_FEATURES,
      requestedExtensionFamilies: Object.freeze([]),
    }),
    selection: Object.freeze({
      selectionFingerprint: EXPECTED_AARCH64_COMPONENT_FINGERPRINTS.selection,
      fpEnvironment: Object.freeze({
        rounding: "nearestTiesToEven" as const,
        exceptionFlagsObservable: false,
        flushToZero: false,
        defaultNaN: false,
        signedZero: "preserve" as const,
        nanPayload: "preserve" as const,
      }),
    }),
    abi: createAArch64Aapcs64AbiTargetSurface(),
    relocation: Object.freeze({
      relocationFingerprint: EXPECTED_AARCH64_COMPONENT_FINGERPRINTS.relocation,
    }),
    memoryOrder: Object.freeze({
      memoryModel: "armv8.2-a-release-acquire" as const,
      memoryModelFingerprint: EXPECTED_AARCH64_COMPONENT_FINGERPRINTS.memoryOrder,
    }),
    planning: Object.freeze({
      planningFingerprint: EXPECTED_AARCH64_COMPONENT_FINGERPRINTS.planning,
    }),
    platform: Object.freeze({
      platformFingerprint: EXPECTED_AARCH64_COMPONENT_FINGERPRINTS.platform,
    }),
    operationMatrixFingerprint: EXPECTED_AARCH64_COMPONENT_FINGERPRINTS.operationMatrix,
  });
}

function targetSurfaceError<Value = never>(
  ownerKey: string,
  diagnostics: readonly { readonly code?: string; readonly stableDetail: string }[],
): UefiAArch64TargetResult<Value> {
  return uefiAArch64Error({
    diagnostics: mapTargetSurfaceDiagnostics(ownerKey, diagnostics),
    verification: failedVerification(TARGET_SURFACES_VERIFIER_KEY, ownerKey),
  });
}

function mapTargetSurfaceDiagnostics(
  ownerKey: string,
  diagnostics: readonly { readonly code?: string; readonly stableDetail: string }[],
): readonly UefiAArch64TargetDiagnostic[] {
  return Object.freeze(
    diagnostics.map((diagnostic) =>
      uefiAArch64TargetDiagnostic({
        code: "UEFI_AARCH64_TARGET_AUTH_FAILED",
        ownerKey,
        stableDetail:
          diagnostic.code === undefined
            ? diagnostic.stableDetail
            : `${diagnostic.code}:${diagnostic.stableDetail}`,
      }),
    ),
  );
}
