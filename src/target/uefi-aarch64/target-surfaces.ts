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
import { authenticateAArch64BackendTargetSurface } from "../aarch64/backend/api/backend-target-surface";
import { RPI5_BACKEND_CATALOGS } from "../aarch64/backend/catalogs/rpi5-backend-catalog-data";
import { authenticateAArch64TargetSurface } from "../aarch64/target-surface/profile-authentication";
import { uefiAArch64TargetDiagnostic, type UefiAArch64TargetDiagnostic } from "./diagnostics";
import {
  failedVerification,
  passedVerification,
  uefiAArch64Error,
  uefiAArch64Ok,
  type UefiAArch64TargetResult,
} from "./result";

const TARGET_SURFACES_VERIFIER_KEY = "uefi-aarch64-target-surfaces";

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
