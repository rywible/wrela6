import type { ProofMirRuntimeCatalog } from "../../runtime/runtime-catalog-types";
import type { SemanticTargetSurface } from "../../semantic/surface/platform-surface";
import { compareCodeUnitStrings } from "../../shared/deterministic-sort";
import { stableHash, stableJson } from "../../shared/stable-json";
import type { UefiAArch64SmokePolicy } from "./artifact";
import { uefiAArch64TargetDiagnostic, type UefiAArch64TargetDiagnostic } from "./diagnostics";
import {
  canonicalUefiAArch64EntryProfile,
  fingerprintUefiAArch64EntryProfile,
  validateUefiAArch64EntryProfile,
  type UefiAArch64EntryProfile,
} from "./entry-contract";
import {
  canonicalUefiAArch64FirmwareAbiSurface,
  fingerprintUefiAArch64FirmwareAbi,
  validateUefiAArch64FirmwareAbiSurface,
  type UefiAArch64FirmwareAbiSurface,
} from "./firmware-abi";
import {
  canonicalUefiAArch64FirmwareTableSurface,
  fingerprintUefiAArch64FirmwareTables,
  validateUefiAArch64FirmwareTableSurface,
  type UefiAArch64FirmwareTableSurface,
} from "./firmware-tables";
import {
  authenticateUefiAArch64PlatformLowerings,
  canonicalUefiAArch64PlatformLowerings,
  canonicalUefiAArch64SemanticTargetSurface,
  fingerprintUefiPlatformPrimitiveSpec,
  fingerprintUefiSemanticPlatformCatalog,
  type UefiAArch64PlatformPrimitiveLowering,
} from "./platform-catalog";
import {
  failedVerification,
  passedVerification,
  uefiAArch64Error,
  uefiAArch64Ok,
  type UefiAArch64TargetResult,
} from "./result";
import {
  authenticateUefiAArch64RuntimeMaterializations,
  fingerprintUefiAArch64ProofMirRuntimeCatalog,
  canonicalUefiAArch64ProofMirRuntimeCatalog,
  canonicalUefiAArch64RuntimeMaterializations,
  type UefiAArch64RuntimeMaterialization,
} from "./runtime-catalog";
import {
  canonicalUefiAArch64StatusPolicy,
  fingerprintUefiAArch64StatusPolicy,
  validateUefiAArch64StatusPolicy,
  type UefiAArch64StatusPolicy,
} from "./status-conversion";
import {
  validateUefiAArch64EntryWatchdogPolicy,
  type UefiAArch64EntryWatchdogPolicy,
} from "./watchdog-policy";
import {
  productionUefiAArch64TargetSurfaceFingerprints,
  type UefiAArch64ResolvedTargetSurfaceFingerprints,
} from "./target-surfaces";

export type UefiAArch64TargetKey = "wrela-uefi-aarch64-rpi5-v1";

export interface UefiAArch64TargetComponentFingerprint {
  readonly componentKey: string;
  readonly fingerprint: string;
}

export interface UefiAArch64TargetComponentFingerprints {
  readonly semanticPrimitives: readonly UefiAArch64TargetComponentFingerprint[];
  readonly runtimeOperations: readonly UefiAArch64TargetComponentFingerprint[];
  readonly firmwareCalls: readonly UefiAArch64TargetComponentFingerprint[];
}

export interface UefiAArch64TargetDriverSurfaceInput {
  readonly targetKey: UefiAArch64TargetKey;
  readonly aarch64TargetFingerprint: string;
  readonly backendTargetFingerprint: string;
  readonly linkerTargetFingerprint: string;
  readonly peCoffWriterTargetFingerprint: string;
  readonly entryProfile: UefiAArch64EntryProfile;
  readonly firmwareAbi: UefiAArch64FirmwareAbiSurface;
  readonly firmwareTables: UefiAArch64FirmwareTableSurface;
  readonly firmwareAbiFingerprint: string;
  readonly firmwareTablesFingerprint: string;
  readonly semanticTarget?: SemanticTargetSurface;
  readonly semanticPlatformCatalogFingerprint: string;
  readonly proofMirRuntimeCatalog?: ProofMirRuntimeCatalog;
  readonly proofMirRuntimeCatalogFingerprint: string;
  readonly platformLowerings: readonly UefiAArch64PlatformPrimitiveLowering[];
  readonly runtimeMaterializations: readonly UefiAArch64RuntimeMaterialization[];
  readonly statusPolicy: UefiAArch64StatusPolicy;
  readonly statusPolicyFingerprint: string;
  readonly componentFingerprints: UefiAArch64TargetComponentFingerprints;
  readonly watchdogPolicy: UefiAArch64EntryWatchdogPolicy;
  readonly smokePolicy: UefiAArch64SmokePolicy;
}

export interface UefiAArch64TargetDriverSurface extends Omit<
  UefiAArch64TargetDriverSurfaceInput,
  "proofMirRuntimeCatalog" | "semanticTarget"
> {
  readonly targetDriverFingerprint: string;
}

export function canonicalUefiAArch64TargetDriverSurfaceInput(
  overrides: Partial<UefiAArch64TargetDriverSurfaceInput> = {},
): UefiAArch64TargetDriverSurfaceInput {
  const firmwareAbi = overrides.firmwareAbi ?? canonicalUefiAArch64FirmwareAbiSurface();
  const firmwareTables = overrides.firmwareTables ?? canonicalUefiAArch64FirmwareTableSurface();
  const statusPolicy = overrides.statusPolicy ?? canonicalUefiAArch64StatusPolicy();
  const semanticTarget = overrides.semanticTarget ?? canonicalUefiAArch64SemanticTargetSurface();
  const runtimeCatalog =
    overrides.proofMirRuntimeCatalog ?? canonicalUefiAArch64ProofMirRuntimeCatalog();
  const platformLowerings =
    overrides.platformLowerings ?? canonicalUefiAArch64PlatformLowerings(semanticTarget);
  const runtimeMaterializations =
    overrides.runtimeMaterializations ??
    canonicalUefiAArch64RuntimeMaterializations(runtimeCatalog);
  const targetSurfaceFingerprints = canonicalTargetSurfaceFingerprints();

  return Object.freeze({
    targetKey: "wrela-uefi-aarch64-rpi5-v1" as const,
    aarch64TargetFingerprint: targetSurfaceFingerprints.aarch64TargetFingerprint,
    backendTargetFingerprint: targetSurfaceFingerprints.backendTargetFingerprint,
    linkerTargetFingerprint: targetSurfaceFingerprints.linkerTargetFingerprint,
    peCoffWriterTargetFingerprint: targetSurfaceFingerprints.peCoffWriterTargetFingerprint,
    entryProfile: canonicalUefiAArch64EntryProfile(),
    firmwareAbi,
    firmwareTables,
    firmwareAbiFingerprint: fingerprintUefiAArch64FirmwareAbi(firmwareAbi),
    firmwareTablesFingerprint: fingerprintUefiAArch64FirmwareTables(firmwareTables),
    semanticTarget,
    semanticPlatformCatalogFingerprint: fingerprintUefiSemanticPlatformCatalog(semanticTarget),
    proofMirRuntimeCatalog: runtimeCatalog,
    proofMirRuntimeCatalogFingerprint: fingerprintUefiAArch64ProofMirRuntimeCatalog(runtimeCatalog),
    platformLowerings,
    runtimeMaterializations,
    statusPolicy,
    statusPolicyFingerprint: fingerprintUefiAArch64StatusPolicy(statusPolicy),
    componentFingerprints: componentFingerprintsForDefaults(
      platformLowerings,
      runtimeMaterializations,
      semanticTarget,
    ),
    watchdogPolicy: Object.freeze({ kind: "disable-before-source" as const }),
    smokePolicy: Object.freeze({ kind: "disabled" as const }),
    ...overrides,
  });
}

export function authenticateUefiAArch64TargetDriverSurface(
  input: UefiAArch64TargetDriverSurfaceInput,
): UefiAArch64TargetResult<UefiAArch64TargetDriverSurface> {
  const diagnostics: UefiAArch64TargetDiagnostic[] = [];

  if (input.targetKey !== "wrela-uefi-aarch64-rpi5-v1") {
    diagnostics.push(
      targetDriverSurfaceDiagnostic(
        `target-driver-surface:unsupported-target-key:${String(input.targetKey)}`,
      ),
    );
  }
  diagnostics.push(...targetSurfaceFingerprintDiagnostics(input));
  diagnostics.push(...componentFingerprintDiagnostics(input));
  diagnostics.push(...resultDiagnostics(validateUefiAArch64EntryProfile(input.entryProfile)));
  diagnostics.push(...resultDiagnostics(validateUefiAArch64FirmwareAbiSurface(input.firmwareAbi)));
  diagnostics.push(
    ...resultDiagnostics(validateUefiAArch64FirmwareTableSurface(input.firmwareTables)),
  );
  diagnostics.push(...resultDiagnostics(validateUefiAArch64StatusPolicy(input.statusPolicy)));
  diagnostics.push(...policyDiagnostics(input));

  if (input.firmwareAbiFingerprint !== fingerprintUefiAArch64FirmwareAbi(input.firmwareAbi)) {
    diagnostics.push(
      targetDriverSurfaceDiagnostic("target-driver-surface:stale-firmware-abi-fingerprint"),
    );
  }
  if (
    input.firmwareTablesFingerprint !== fingerprintUefiAArch64FirmwareTables(input.firmwareTables)
  ) {
    diagnostics.push(
      targetDriverSurfaceDiagnostic("target-driver-surface:stale-firmware-tables-fingerprint"),
    );
  }
  if (input.statusPolicyFingerprint !== fingerprintUefiAArch64StatusPolicy(input.statusPolicy)) {
    diagnostics.push(
      targetDriverSurfaceDiagnostic("target-driver-surface:stale-status-policy-fingerprint"),
    );
  }

  const runtimeResult =
    input.proofMirRuntimeCatalog === undefined
      ? undefined
      : authenticateUefiAArch64RuntimeMaterializations({
          runtimeCatalog: input.proofMirRuntimeCatalog,
          runtimeCatalogFingerprint: input.proofMirRuntimeCatalogFingerprint,
          materializations: input.runtimeMaterializations,
        });
  if (input.proofMirRuntimeCatalog === undefined) {
    diagnostics.push(
      targetDriverSurfaceDiagnostic("target-driver-surface:missing-runtime-catalog"),
    );
    diagnostics.push(...duplicateRuntimeMaterializationDiagnostics(input.runtimeMaterializations));
  }
  if (runtimeResult !== undefined) {
    diagnostics.push(...resultDiagnostics(runtimeResult));
  }

  const platformResult =
    input.semanticTarget === undefined
      ? undefined
      : authenticateUefiAArch64PlatformLowerings({
          semanticTarget: input.semanticTarget,
          semanticPlatformCatalogFingerprint: input.semanticPlatformCatalogFingerprint,
          firmwareTables: input.firmwareTables,
          lowerings: input.platformLowerings,
        });
  if (input.semanticTarget === undefined) {
    diagnostics.push(
      targetDriverSurfaceDiagnostic("target-driver-surface:missing-semantic-target"),
    );
  }
  if (platformResult !== undefined) {
    diagnostics.push(...resultDiagnostics(platformResult));
  }
  diagnostics.push(
    ...runtimeHelperPlatformLoweringDiagnostics(
      input.platformLowerings,
      input.runtimeMaterializations,
    ),
  );

  if (diagnostics.length > 0) {
    return uefiAArch64Error({
      diagnostics,
      verification: failedVerification("uefi-aarch64-target-driver-surface", "authenticate"),
    });
  }

  const sortedPlatformLowerings =
    platformResult?.kind === "ok" ? platformResult.value : input.platformLowerings;
  const sortedRuntimeMaterializations =
    runtimeResult?.kind === "ok"
      ? runtimeResult.value
      : sortRuntimeMaterializations(input.runtimeMaterializations);
  const surface = freezeSurface(input, sortedPlatformLowerings, sortedRuntimeMaterializations);

  return uefiAArch64Ok({
    value: Object.freeze({
      ...surface,
      targetDriverFingerprint: fingerprintTargetDriverSurface(surface),
    }),
    verification: passedVerification("uefi-aarch64-target-driver-surface", "authenticate"),
  });
}

export function fingerprintTargetDriverSurface(
  surface: UefiAArch64TargetDriverSurfaceInput | UefiAArch64TargetDriverSurface,
): string {
  return `uefi-aarch64-target-driver:${stableHash(
    stableJson({
      targetKey: surface.targetKey,
      aarch64TargetFingerprint: surface.aarch64TargetFingerprint,
      backendTargetFingerprint: surface.backendTargetFingerprint,
      linkerTargetFingerprint: surface.linkerTargetFingerprint,
      peCoffWriterTargetFingerprint: surface.peCoffWriterTargetFingerprint,
      entryProfile: surface.entryProfile,
      entryProfileFingerprint: fingerprintUefiAArch64EntryProfile(surface.entryProfile),
      firmwareAbiFingerprint: surface.firmwareAbiFingerprint,
      firmwareTablesFingerprint: surface.firmwareTablesFingerprint,
      semanticPlatformCatalogFingerprint: surface.semanticPlatformCatalogFingerprint,
      proofMirRuntimeCatalogFingerprint: surface.proofMirRuntimeCatalogFingerprint,
      statusPolicyFingerprint: surface.statusPolicyFingerprint,
      componentFingerprints: sortedComponentFingerprints(surface.componentFingerprints),
      platformLowerings: sortPlatformLowerings(surface.platformLowerings),
      runtimeMaterializations: sortRuntimeMaterializations(surface.runtimeMaterializations),
      watchdogPolicy: surface.watchdogPolicy,
      smokePolicy: surface.smokePolicy,
    }),
  )}`;
}

function componentFingerprintsForDefaults(
  platformLowerings: readonly UefiAArch64PlatformPrimitiveLowering[],
  runtimeMaterializations: readonly UefiAArch64RuntimeMaterialization[],
  semanticTarget: SemanticTargetSurface,
): UefiAArch64TargetComponentFingerprints {
  return Object.freeze({
    semanticPrimitives: Object.freeze(
      platformLowerings.map((lowering) => ({
        componentKey: String(lowering.primitiveId),
        fingerprint:
          semanticTarget.platformPrimitives.get(lowering.primitiveId) === undefined
            ? lowering.semanticPrimitiveFingerprint
            : fingerprintUefiPlatformPrimitiveSpec(
                semanticTarget.platformPrimitives.get(lowering.primitiveId)!,
              ),
      })),
    ),
    runtimeOperations: Object.freeze(
      runtimeMaterializations.map((materialization) => ({
        componentKey: String(materialization.runtimeId),
        fingerprint: materialization.runtimeOperationFingerprint,
      })),
    ),
    firmwareCalls: Object.freeze(
      platformLowerings
        .filter((lowering) => lowering.lowering.kind === "firmware-call")
        .map((lowering) => ({
          componentKey: String(lowering.primitiveId),
          fingerprint: lowering.semanticPrimitiveFingerprint,
        })),
    ),
  });
}

function componentFingerprintDiagnostics(
  input: UefiAArch64TargetDriverSurfaceInput,
): readonly UefiAArch64TargetDiagnostic[] {
  const diagnostics: UefiAArch64TargetDiagnostic[] = [];
  const semanticFingerprints = fingerprintMap(input.componentFingerprints.semanticPrimitives);
  const runtimeFingerprints = fingerprintMap(input.componentFingerprints.runtimeOperations);
  const firmwareCallFingerprints = fingerprintMap(input.componentFingerprints.firmwareCalls);

  for (const lowering of input.platformLowerings) {
    const key = String(lowering.primitiveId);
    if (semanticFingerprints.get(key) !== lowering.semanticPrimitiveFingerprint) {
      diagnostics.push(
        targetDriverSurfaceDiagnostic(
          `target-driver-surface:missing-component-fingerprint:semantic-primitive:${key}`,
        ),
      );
    }
    if (
      lowering.lowering.kind === "firmware-call" &&
      firmwareCallFingerprints.get(key) !== lowering.semanticPrimitiveFingerprint
    ) {
      diagnostics.push(
        targetDriverSurfaceDiagnostic(
          `target-driver-surface:missing-component-fingerprint:firmware-call:${key}`,
        ),
      );
    }
  }
  for (const materialization of input.runtimeMaterializations) {
    const key = String(materialization.runtimeId);
    if (runtimeFingerprints.get(key) !== materialization.runtimeOperationFingerprint) {
      diagnostics.push(
        targetDriverSurfaceDiagnostic(
          `target-driver-surface:missing-component-fingerprint:runtime-operation:${key}`,
        ),
      );
    }
  }
  diagnostics.push(
    ...duplicateComponentFingerprintDiagnostics(
      "semantic-primitive",
      input.componentFingerprints.semanticPrimitives,
    ),
    ...duplicateComponentFingerprintDiagnostics(
      "runtime-operation",
      input.componentFingerprints.runtimeOperations,
    ),
    ...duplicateComponentFingerprintDiagnostics(
      "firmware-call",
      input.componentFingerprints.firmwareCalls,
    ),
  );
  return diagnostics;
}

function targetSurfaceFingerprintDiagnostics(
  input: UefiAArch64TargetDriverSurfaceInput,
): readonly UefiAArch64TargetDiagnostic[] {
  const fingerprints = productionUefiAArch64TargetSurfaceFingerprints();
  if (fingerprints.kind === "error") return resultDiagnostics(fingerprints);
  const diagnostics: UefiAArch64TargetDiagnostic[] = [];
  if (input.aarch64TargetFingerprint !== fingerprints.value.aarch64TargetFingerprint) {
    diagnostics.push(
      targetDriverSurfaceDiagnostic("target-driver-surface:stale-aarch64-target-fingerprint"),
    );
  }
  if (input.backendTargetFingerprint !== fingerprints.value.backendTargetFingerprint) {
    diagnostics.push(
      targetDriverSurfaceDiagnostic("target-driver-surface:stale-backend-target-fingerprint"),
    );
  }
  if (input.linkerTargetFingerprint !== fingerprints.value.linkerTargetFingerprint) {
    diagnostics.push(
      targetDriverSurfaceDiagnostic("target-driver-surface:stale-linker-target-fingerprint"),
    );
  }
  if (input.peCoffWriterTargetFingerprint !== fingerprints.value.peCoffWriterTargetFingerprint) {
    diagnostics.push(
      targetDriverSurfaceDiagnostic(
        "target-driver-surface:stale-pe-coff-writer-target-fingerprint",
      ),
    );
  }
  return diagnostics;
}

function policyDiagnostics(
  input: UefiAArch64TargetDriverSurfaceInput,
): readonly UefiAArch64TargetDiagnostic[] {
  const diagnostics: UefiAArch64TargetDiagnostic[] = [];
  const watchdogPolicyResult = validateUefiAArch64EntryWatchdogPolicy({
    watchdogPolicy: input.watchdogPolicy,
    platformLowerings: input.platformLowerings,
  });
  if (watchdogPolicyResult.kind === "error") {
    diagnostics.push(
      ...watchdogPolicyResult.diagnostics.map((diagnostic) =>
        targetDriverSurfaceDiagnostic(
          diagnostic.stableDetail.startsWith("watchdog-policy:unsupported-kind:")
            ? `target-driver-surface:unsupported-watchdog-policy:${input.watchdogPolicy.kind}`
            : diagnostic.stableDetail,
        ),
      ),
    );
  }
  if (!validateSmokePolicy(input.smokePolicy)) {
    diagnostics.push(
      targetDriverSurfaceDiagnostic("target-driver-surface:unsupported-smoke-policy"),
    );
  }
  return diagnostics;
}

function runtimeHelperPlatformLoweringDiagnostics(
  lowerings: readonly UefiAArch64PlatformPrimitiveLowering[],
  materializations: readonly UefiAArch64RuntimeMaterialization[],
): readonly UefiAArch64TargetDiagnostic[] {
  const materializationByRuntimeId = new Map(
    materializations.map((materialization) => [String(materialization.runtimeId), materialization]),
  );
  const diagnostics: UefiAArch64TargetDiagnostic[] = [];

  for (const lowering of lowerings) {
    if (lowering.lowering.kind !== "compiler-runtime-helper") continue;
    const primitiveId = String(lowering.primitiveId);
    const runtimeId = String(lowering.lowering.runtimeId);
    const materialization = materializationByRuntimeId.get(runtimeId);
    if (materialization === undefined) {
      diagnostics.push(
        targetDriverSurfaceDiagnostic(
          `target-driver-surface:missing-runtime-helper-materialization:${primitiveId}:${runtimeId}`,
        ),
      );
      continue;
    }
    if (materialization.linkageName !== lowering.lowering.helperLinkageName) {
      diagnostics.push(
        targetDriverSurfaceDiagnostic(
          `target-driver-surface:runtime-helper-linkage-mismatch:${primitiveId}:${runtimeId}:expected:${materialization.linkageName}:actual:${lowering.lowering.helperLinkageName}`,
        ),
      );
    }
  }

  return diagnostics;
}

export function validateSmokePolicy(policy: UefiAArch64SmokePolicy): boolean {
  return policy.kind === "disabled" || policy.kind === "qemu";
}

function resultDiagnostics(result: UefiAArch64TargetResult<unknown>) {
  return result.kind === "error" ? result.diagnostics : [];
}

function duplicateRuntimeMaterializationDiagnostics(
  materializations: readonly UefiAArch64RuntimeMaterialization[],
): readonly UefiAArch64TargetDiagnostic[] {
  const diagnostics: UefiAArch64TargetDiagnostic[] = [];
  const seen = new Set<string>();
  for (const materialization of materializations) {
    const key = String(materialization.runtimeId);
    if (seen.has(key)) {
      diagnostics.push(
        targetDriverSurfaceDiagnostic(`runtime-materialization:duplicate-runtime-id:${key}`),
      );
    }
    seen.add(key);
  }
  return diagnostics;
}

function duplicateComponentFingerprintDiagnostics(
  kind: string,
  fingerprints: readonly UefiAArch64TargetComponentFingerprint[],
): readonly UefiAArch64TargetDiagnostic[] {
  const diagnostics: UefiAArch64TargetDiagnostic[] = [];
  const seen = new Set<string>();
  for (const fingerprint of fingerprints) {
    if (fingerprint.fingerprint.length === 0) {
      diagnostics.push(
        targetDriverSurfaceDiagnostic(
          `target-driver-surface:empty-component-fingerprint:${kind}:${fingerprint.componentKey}`,
        ),
      );
    }
    if (seen.has(fingerprint.componentKey)) {
      diagnostics.push(
        targetDriverSurfaceDiagnostic(
          `target-driver-surface:duplicate-component-fingerprint:${kind}:${fingerprint.componentKey}`,
        ),
      );
    }
    seen.add(fingerprint.componentKey);
  }
  return diagnostics;
}

function fingerprintMap(
  fingerprints: readonly UefiAArch64TargetComponentFingerprint[],
): ReadonlyMap<string, string> {
  return new Map(
    fingerprints.map((fingerprint) => [fingerprint.componentKey, fingerprint.fingerprint]),
  );
}

function canonicalTargetSurfaceFingerprints(): UefiAArch64ResolvedTargetSurfaceFingerprints {
  const fingerprints = productionUefiAArch64TargetSurfaceFingerprints();
  if (fingerprints.kind === "ok") return fingerprints.value;
  const failureFingerprint = `target-surface-auth-failed:${stableHash(
    stableJson(fingerprints.diagnostics.map((diagnostic) => diagnostic.stableDetail)),
  )}`;
  return Object.freeze({
    aarch64TargetFingerprint: failureFingerprint,
    backendTargetFingerprint: failureFingerprint,
    linkerTargetFingerprint: failureFingerprint,
    peCoffWriterTargetFingerprint: failureFingerprint,
  });
}

function freezeSurface(
  input: UefiAArch64TargetDriverSurfaceInput,
  platformLowerings: readonly UefiAArch64PlatformPrimitiveLowering[],
  runtimeMaterializations: readonly UefiAArch64RuntimeMaterialization[],
): Omit<UefiAArch64TargetDriverSurface, "targetDriverFingerprint"> {
  return Object.freeze({
    targetKey: input.targetKey,
    aarch64TargetFingerprint: input.aarch64TargetFingerprint,
    backendTargetFingerprint: input.backendTargetFingerprint,
    linkerTargetFingerprint: input.linkerTargetFingerprint,
    peCoffWriterTargetFingerprint: input.peCoffWriterTargetFingerprint,
    entryProfile: Object.freeze({ ...input.entryProfile }),
    firmwareAbi: input.firmwareAbi,
    firmwareTables: input.firmwareTables,
    firmwareAbiFingerprint: input.firmwareAbiFingerprint,
    firmwareTablesFingerprint: input.firmwareTablesFingerprint,
    semanticPlatformCatalogFingerprint: input.semanticPlatformCatalogFingerprint,
    proofMirRuntimeCatalogFingerprint: input.proofMirRuntimeCatalogFingerprint,
    platformLowerings: sortPlatformLowerings(platformLowerings),
    runtimeMaterializations: sortRuntimeMaterializations(runtimeMaterializations),
    statusPolicy: input.statusPolicy,
    statusPolicyFingerprint: input.statusPolicyFingerprint,
    componentFingerprints: sortedComponentFingerprints(input.componentFingerprints),
    watchdogPolicy: Object.freeze({ ...input.watchdogPolicy }),
    smokePolicy: Object.freeze({ ...input.smokePolicy }),
  });
}

function sortPlatformLowerings(
  lowerings: readonly UefiAArch64PlatformPrimitiveLowering[],
): readonly UefiAArch64PlatformPrimitiveLowering[] {
  return Object.freeze(
    [...lowerings].sort((left, right) =>
      compareCodeUnitStrings(String(left.primitiveId), String(right.primitiveId)),
    ),
  );
}

function sortRuntimeMaterializations(
  materializations: readonly UefiAArch64RuntimeMaterialization[],
): readonly UefiAArch64RuntimeMaterialization[] {
  return Object.freeze(
    [...materializations].sort((left, right) =>
      compareCodeUnitStrings(String(left.runtimeId), String(right.runtimeId)),
    ),
  );
}

function sortedComponentFingerprints(
  fingerprints: UefiAArch64TargetComponentFingerprints,
): UefiAArch64TargetComponentFingerprints {
  return Object.freeze({
    semanticPrimitives: sortComponentFingerprints(fingerprints.semanticPrimitives),
    runtimeOperations: sortComponentFingerprints(fingerprints.runtimeOperations),
    firmwareCalls: sortComponentFingerprints(fingerprints.firmwareCalls),
  });
}

function sortComponentFingerprints(
  fingerprints: readonly UefiAArch64TargetComponentFingerprint[],
): readonly UefiAArch64TargetComponentFingerprint[] {
  return Object.freeze(
    fingerprints
      .map((fingerprint) => Object.freeze({ ...fingerprint }))
      .sort((left, right) => compareCodeUnitStrings(left.componentKey, right.componentKey)),
  );
}

function targetDriverSurfaceDiagnostic(stableDetail: string): UefiAArch64TargetDiagnostic {
  return uefiAArch64TargetDiagnostic({
    code: "UEFI_AARCH64_TARGET_AUTH_FAILED",
    ownerKey: "target-driver-surface",
    stableDetail,
  });
}
