import { stableHash, stableJson } from "../../../../shared/stable-json";
import { compareCodeUnitStrings } from "../../../../shared/deterministic-sort";
import {
  WRELA_UEFI_AARCH64_RPI5_PROFILE_ID,
  WRELA_UEFI_AARCH64_RPI5_REQUIRED_FEATURES,
} from "../../target-surface/production-profile";
import {
  aarch64BackendDiagnostic,
  sortAArch64BackendDiagnostics,
  type AArch64BackendDiagnostic,
} from "./diagnostics";
import { aarch64BackendSurfaceId, type AArch64BackendSurfaceId } from "./ids";
import type { AArch64TargetSurface } from "../../target-surface/target-surface";
import type {
  AArch64EncodingCatalog,
  AArch64KnownByteFixture,
  AArch64FrameCatalog,
  AArch64LiteralPoolCatalog,
  AArch64BackendSecurityCatalog,
  AArch64PhysicalRegisterRecord,
  AArch64PhysicalRegisterModel,
  AArch64PhysicalRegisterStableKey,
  AArch64RelocationCatalog,
  AArch64RegisterOperandPermissionQuery,
  AArch64UnwindCatalog,
  AArch64VeneerCatalog,
  AArch64BackendTuningModel,
} from "./backend-catalog-interfaces";
import {
  authenticateAArch64EncodingCatalog,
  type AArch64AuthoredEncodingCatalogEntry,
} from "../object/encoding-catalog";
import { IMPLEMENTED_AARCH64_ENCODER_OPCODES } from "../object/encoding-opcodes";

const REQUIRED_PE_COFF_RELOCATION_MAPPINGS = Object.freeze([
  "branch26",
  "branch19",
  "branch14",
  "pagebase-rel21",
  "pageoffset-12a",
  "pageoffset-12l",
  "addr64",
  "addr32",
  "addr32nb",
  "rel32",
  "section-relative",
]);

export interface AArch64TargetProfileRecord {
  readonly profileId: string;
  readonly profileFingerprint: string;
  readonly tuningModel: string;
}

export interface AArch64BackendTargetSurface {
  readonly profile: AArch64TargetProfileRecord;
  readonly backendSurfaceId: AArch64BackendSurfaceId;
  readonly sourceSurfaceFingerprint: string;
  readonly backendSurfaceFingerprint: string;
  readonly registerModel: AArch64PhysicalRegisterModel;
  readonly encodingCatalog: AArch64EncodingCatalog;
  readonly relocationCatalog: AArch64RelocationCatalog;
  readonly unwindCatalog: AArch64UnwindCatalog;
  readonly frameCatalog: AArch64FrameCatalog;
  readonly veneerCatalog: AArch64VeneerCatalog;
  readonly literalPoolCatalog: AArch64LiteralPoolCatalog;
  readonly securityCatalog: AArch64BackendSecurityCatalog;
  readonly tuningModel: AArch64BackendTuningModel;
}

export interface AArch64BackendSurfaceAuthenticationInput {
  readonly sourceSurface: AArch64TargetSurface;
  readonly sourceSurfaceFingerprint?: string;
  readonly registerModel?: AArch64PhysicalRegisterModel;
  readonly encodingCatalog?: AArch64EncodingCatalog;
  readonly relocationCatalog?: AArch64RelocationCatalog;
  readonly unwindCatalog?: AArch64UnwindCatalog;
  readonly frameCatalog?: AArch64FrameCatalog;
  readonly veneerCatalog?: AArch64VeneerCatalog;
  readonly literalPoolCatalog?: AArch64LiteralPoolCatalog;
  readonly securityCatalog?: AArch64BackendSecurityCatalog;
  readonly tuningModel?: AArch64BackendTuningModel;
  readonly backendSurfaceId?: string;
}

export type AuthenticateAArch64BackendTargetSurfaceResult =
  | { readonly kind: "ok"; readonly value: AArch64BackendTargetSurface }
  | { readonly kind: "error"; readonly diagnostics: readonly AArch64BackendDiagnostic[] };

export function authenticateAArch64BackendTargetSurface(
  input: AArch64BackendSurfaceAuthenticationInput,
): AuthenticateAArch64BackendTargetSurfaceResult {
  const diagnostics: AArch64BackendDiagnostic[] = [];
  const sourceSurfaceFingerprint =
    input.sourceSurfaceFingerprint ?? computeBackendSourceSurfaceFingerprint(input.sourceSurface);

  if (sourceSurfaceFingerprint !== computeBackendSourceSurfaceFingerprint(input.sourceSurface)) {
    diagnostics.push(diagnostic("backend-target:source-fingerprint-mismatch"));
  }

  if (input.sourceSurface.profile.profileId !== WRELA_UEFI_AARCH64_RPI5_PROFILE_ID) {
    diagnostics.push(
      diagnostic("backend-target:unsupported-profile:" + input.sourceSurface.profile.profileId),
    );
  }

  for (const requiredFeature of WRELA_UEFI_AARCH64_RPI5_REQUIRED_FEATURES) {
    if (!input.sourceSurface.profile.requiredFeatures.includes(requiredFeature)) {
      diagnostics.push(
        diagnostic(`backend-target:profile-missing-required-feature:${requiredFeature}`),
      );
    }
  }

  const normalizedRegisterModel = normalizeAArch64PhysicalRegisterModel(
    input.registerModel,
    diagnostics,
  );
  const normalizedEncodingCatalog = normalizeAArch64EncodingCatalog(
    input.encodingCatalog,
    diagnostics,
    input.sourceSurface.profile.requiredFeatures,
  );
  const normalizedRelocationCatalog = normalizeAArch64RelocationCatalog(
    input.relocationCatalog,
    diagnostics,
  );
  const normalizedUnwindCatalog = normalizeAArch64UnwindCatalog(input.unwindCatalog, diagnostics);
  const normalizedFrameCatalog = normalizeAArch64FrameCatalog(input.frameCatalog, diagnostics);
  const normalizedVeneerCatalog = normalizeAArch64VeneerCatalog(input.veneerCatalog, diagnostics);
  const normalizedLiteralPoolCatalog = normalizeAArch64LiteralPoolCatalog(
    input.literalPoolCatalog,
    diagnostics,
  );
  const normalizedSecurityCatalog = normalizeAArch64SecurityCatalog(
    input.securityCatalog,
    diagnostics,
  );
  const normalizedTuningModel = normalizeAArch64TuningModel(input.tuningModel, diagnostics);

  if (
    diagnostics.length > 0 ||
    normalizedRegisterModel === undefined ||
    normalizedEncodingCatalog === undefined ||
    normalizedRelocationCatalog === undefined ||
    normalizedUnwindCatalog === undefined ||
    normalizedFrameCatalog === undefined ||
    normalizedVeneerCatalog === undefined ||
    normalizedLiteralPoolCatalog === undefined ||
    normalizedSecurityCatalog === undefined ||
    normalizedTuningModel === undefined
  ) {
    return { kind: "error", diagnostics: sortAArch64BackendDiagnostics(diagnostics) };
  }

  if (
    input.sourceSurface.profile.profileId === WRELA_UEFI_AARCH64_RPI5_PROFILE_ID &&
    normalizedRegisterModel.canAllocate("x18")
  ) {
    diagnostics.push(
      diagnostic("backend-target:register-model:x18-must-be-reserved:wrela-uefi-aarch64-rpi5-v1"),
    );
  }

  if (normalizedRelocationCatalog.mappings.some((mapping) => mapping.peCoffFamilies.length === 0)) {
    diagnostics.push(diagnostic("backend-target:relocation-mapping-missing-pe-coff-family"));
  }
  const relocationFamilies = new Set(
    normalizedRelocationCatalog.mappings.map((mapping) => mapping.internalFamily),
  );
  for (const requiredFamily of REQUIRED_PE_COFF_RELOCATION_MAPPINGS) {
    if (!relocationFamilies.has(requiredFamily)) {
      diagnostics.push(diagnostic(`backend-target:relocation-mapping-missing:${requiredFamily}`));
    }
  }
  for (const entry of normalizedEncodingCatalog.entries) {
    const family = entry.relocationHole?.family;
    if (
      family !== undefined &&
      !relocationFamilies.has(family) &&
      !REQUIRED_PE_COFF_RELOCATION_MAPPINGS.includes(family)
    ) {
      diagnostics.push(
        diagnostic(`backend-target:encoding-relocation-family-unmapped:${entry.opcode}:${family}`),
      );
    }
  }

  if (normalizedFrameCatalog.stackAlignmentBytes !== 16) {
    diagnostics.push(diagnostic("backend-target:frame-must-be-16-byte-aligned"));
  }

  if (diagnostics.length > 0) {
    return { kind: "error", diagnostics: sortAArch64BackendDiagnostics(diagnostics) };
  }

  const backendSurfaceFingerprint = computeBackendSurfaceFingerprint({
    sourceSurfaceFingerprint,
    registerModel: normalizedRegisterModel,
    encodingCatalog: normalizedEncodingCatalog,
    relocationCatalog: normalizedRelocationCatalog,
    unwindCatalog: normalizedUnwindCatalog,
    frameCatalog: normalizedFrameCatalog,
    veneerCatalog: normalizedVeneerCatalog,
    literalPoolCatalog: normalizedLiteralPoolCatalog,
    securityCatalog: normalizedSecurityCatalog,
    tuningModel: normalizedTuningModel,
  });

  return {
    kind: "ok",
    value: {
      profile: {
        profileId: input.sourceSurface.profile.profileId,
        profileFingerprint: computeProfileFingerprint(input.sourceSurface),
        tuningModel: input.sourceSurface.profile.tuningModel,
      },
      backendSurfaceId: aarch64BackendSurfaceId(
        input.backendSurfaceId ?? `backend-surface:${sourceSurfaceFingerprint}`,
      ),
      sourceSurfaceFingerprint,
      backendSurfaceFingerprint,
      registerModel: normalizedRegisterModel,
      encodingCatalog: normalizedEncodingCatalog,
      relocationCatalog: normalizedRelocationCatalog,
      unwindCatalog: normalizedUnwindCatalog,
      frameCatalog: normalizedFrameCatalog,
      veneerCatalog: normalizedVeneerCatalog,
      literalPoolCatalog: normalizedLiteralPoolCatalog,
      securityCatalog: normalizedSecurityCatalog,
      tuningModel: normalizedTuningModel,
    },
  };
}

function computeBackendSourceSurfaceFingerprint(input: AArch64TargetSurface): string {
  return stableHash(
    stableJson({
      profileId: input.profile.profileId,
      selectionFingerprint: input.selection.selectionFingerprint,
      abiFingerprint: input.abi.abiFingerprint,
      relocationFingerprint: input.relocation.relocationFingerprint,
      memoryModel: input.memoryOrder.memoryModel,
      memoryModelFingerprint: input.memoryOrder.memoryModelFingerprint,
      planningFingerprint: input.planning.planningFingerprint,
      platformFingerprint: input.platform.platformFingerprint,
      operationMatrixFingerprint: input.operationMatrixFingerprint,
      requiredFeatures: [...input.profile.requiredFeatures].sort(compareCodeUnitStrings),
      requestedExtensions: [...input.profile.requestedExtensionFamilies].sort(
        compareCodeUnitStrings,
      ),
    }),
  );
}

function computeProfileFingerprint(input: AArch64TargetSurface): string {
  return stableHash(
    stableJson({
      profileId: input.profile.profileId,
      tuningModel: input.profile.tuningModel,
      architecture: input.profile.architecture,
      instructionSet: input.profile.instructionSet,
      imageProfile: input.profile.imageProfile,
      deviceModel: input.profile.deviceModel,
      requiredFeatures: [...input.profile.requiredFeatures].sort(compareCodeUnitStrings),
      requestedExtensions: [...input.profile.requestedExtensionFamilies].sort(
        compareCodeUnitStrings,
      ),
    }),
  );
}

function computeBackendSurfaceFingerprint(input: {
  readonly sourceSurfaceFingerprint: string;
  readonly registerModel: AArch64PhysicalRegisterModel;
  readonly encodingCatalog: AArch64EncodingCatalog;
  readonly relocationCatalog: AArch64RelocationCatalog;
  readonly unwindCatalog: AArch64UnwindCatalog;
  readonly frameCatalog: AArch64FrameCatalog;
  readonly veneerCatalog: AArch64VeneerCatalog;
  readonly literalPoolCatalog: AArch64LiteralPoolCatalog;
  readonly securityCatalog: AArch64BackendSecurityCatalog;
  readonly tuningModel: AArch64BackendTuningModel;
}): string {
  return stableHash(
    stableJson({
      sourceSurfaceFingerprint: input.sourceSurfaceFingerprint,
      registerModelFingerprint: input.registerModel.fingerprint,
      encodingCatalogFingerprint: input.encodingCatalog.fingerprint,
      relocationCatalogFingerprint: input.relocationCatalog.fingerprint,
      unwindCatalogFingerprint: input.unwindCatalog.fingerprint,
      frameCatalogFingerprint: input.frameCatalog.fingerprint,
      veneerCatalogFingerprint: input.veneerCatalog.fingerprint,
      literalPoolCatalogFingerprint: input.literalPoolCatalog.fingerprint,
      securityCatalogFingerprint: input.securityCatalog.fingerprint,
      tuningCatalogFingerprint: input.tuningModel.fingerprint,
    }),
  );
}

function normalizeAArch64PhysicalRegisterModel(
  registerModel: AArch64PhysicalRegisterModel | undefined,
  diagnostics: AArch64BackendDiagnostic[],
): AArch64PhysicalRegisterModel | undefined {
  if (registerModel === undefined) {
    diagnostics.push(diagnostic("backend-target:missing-catalog:register-model"));
    return undefined;
  }

  const registers = Object.freeze(
    [...registerModel.registers].sort((left, right) =>
      compareCodeUnitStrings(left.stableKey, right.stableKey),
    ),
  );
  addDuplicateDiagnostics(
    registers,
    (register) => register.stableKey,
    (stableKey) => `backend-target:register-model:duplicate-register:${stableKey}`,
    diagnostics,
  );
  const aliasSets = Object.freeze(
    [...registerModel.aliasSets]
      .map((aliasSet) =>
        Object.freeze({
          ...aliasSet,
          aliases: Object.freeze([...aliasSet.aliases].sort(compareCodeUnitStrings)),
        }),
      )
      .sort((left, right) => compareCodeUnitStrings(left.stableKey, right.stableKey)),
  );
  const registerByKey = new Map(registers.map((register) => [register.stableKey, register]));
  const publicParameterGprs = sortedRegisterKeys(registerModel.publicParameterGprs);
  const publicResultGprs = sortedRegisterKeys(registerModel.publicResultGprs);
  const publicCallerSavedGprs = sortedRegisterKeys(registerModel.publicCallerSavedGprs);
  const publicCalleeSavedGprs = sortedRegisterKeys(registerModel.publicCalleeSavedGprs);
  const publicCalleeSavedSimd = sortedRegisterKeys(registerModel.publicCalleeSavedSimd);
  const privateConventionCandidateGprs = sortedRegisterKeys(
    registerModel.privateConventionCandidateGprs,
  );
  const veneerScratchGprs = sortedRegisterKeys(registerModel.veneerScratchGprs);

  return Object.freeze({
    ...registerModel,
    fingerprint: contentFingerprint("backend-register-model", {
      registers,
      aliasSets,
      publicParameterGprs,
      publicResultGprs,
      publicCallerSavedGprs,
      publicCalleeSavedGprs,
      publicCalleeSavedSimd,
      privateConventionCandidateGprs,
      veneerScratchGprs,
    }),
    registers,
    aliasSets,
    publicParameterGprs,
    publicResultGprs,
    publicCallerSavedGprs,
    publicCalleeSavedGprs,
    publicCalleeSavedSimd,
    privateConventionCandidateGprs,
    veneerScratchGprs,
    encodingNumberOf: (register: AArch64PhysicalRegisterStableKey) =>
      registerByKey.get(register)?.encodingNumber ?? -1,
    aliasSetOf: (register: AArch64PhysicalRegisterStableKey) =>
      registerByKey.get(register)?.aliasSet ?? "",
    canAllocate: (register: AArch64PhysicalRegisterStableKey) =>
      registerByKey.get(register)?.isAllocatable ?? false,
    permitsOperand: (query: AArch64RegisterOperandPermissionQuery) =>
      permitsOperandFromRegisterRecords(query, registerByKey),
  });
}

function sortedRegisterKeys(
  registers: readonly AArch64PhysicalRegisterStableKey[],
): readonly AArch64PhysicalRegisterStableKey[] {
  return Object.freeze([...registers].sort(compareCodeUnitStrings));
}

function permitsOperandFromRegisterRecords(
  query: AArch64RegisterOperandPermissionQuery,
  registerByKey: ReadonlyMap<string, AArch64PhysicalRegisterRecord>,
): boolean {
  const register = registerByKey.get(query.registerKey);
  if (register === undefined) return false;
  if (register.aliasSet === "sp" || query.registerKey === "sp") {
    return query.context === "stack-access";
  }
  if (
    register.aliasSet === "zr" ||
    register.aliasSet === "xzr" ||
    query.registerKey === "xzr" ||
    query.registerKey === "wzr"
  ) {
    return query.context === "general" && query.operationKind === "zero-register";
  }
  return query.context !== "stack-access";
}

function normalizeAArch64EncodingCatalog(
  encodingCatalog: AArch64EncodingCatalog | undefined,
  diagnostics: AArch64BackendDiagnostic[],
  supportedFeatures: readonly string[],
): AArch64EncodingCatalog | undefined {
  if (encodingCatalog === undefined) {
    diagnostics.push(diagnostic("backend-target:missing-catalog:encoding"));
    return undefined;
  }

  const entries = Object.freeze(
    [...encodingCatalog.entries].sort((left, right) =>
      compareCodeUnitStrings(left.opcode, right.opcode),
    ),
  );
  const fixtures = fixturesReferencedByEncodingCatalog(encodingCatalog, entries);
  const authenticated = authenticateAArch64EncodingCatalog({
    supportedFeatures: Object.freeze([...new Set(supportedFeatures)].sort(compareCodeUnitStrings)),
    fixtures,
    entries: Object.freeze(
      entries.map(
        (entry): AArch64AuthoredEncodingCatalogEntry =>
          Object.freeze({
            ...entry,
            family: entry.family ?? "unknown",
            requiredFeatures: Object.freeze([...(entry.requiredFeatures ?? [])]),
            knownByteFixtureIds: Object.freeze([...(entry.knownByteFixtureIds ?? [])]),
            permitsSp: entry.permitsSp ?? false,
            permitsZr: entry.permitsZr ?? false,
          }),
      ),
    ),
  });
  if (authenticated.kind === "error") {
    diagnostics.push(...authenticated.diagnostics);
    return undefined;
  }
  const authenticatedOpcodes = new Set(authenticated.value.entries.map((entry) => entry.opcode));
  for (const opcode of IMPLEMENTED_AARCH64_ENCODER_OPCODES) {
    if (!authenticatedOpcodes.has(opcode)) {
      diagnostics.push(diagnostic(`backend-target:encoding-missing-emitted-opcode:${opcode}`));
    }
  }
  return authenticated.value;
}

function fixturesReferencedByEncodingCatalog(
  encodingCatalog: AArch64EncodingCatalog,
  entries: readonly AArch64EncodingCatalog["entries"][number][],
): readonly AArch64KnownByteFixture[] {
  const fixturesById = new Map<string, AArch64KnownByteFixture>();
  for (const entry of entries) {
    for (const fixtureId of entry.knownByteFixtureIds ?? []) {
      const fixture = encodingCatalog.knownByteFixtureFor(fixtureId);
      if (fixture !== undefined) fixturesById.set(fixtureId, fixture);
    }
  }
  return Object.freeze(
    [...fixturesById.values()].sort((left, right) =>
      compareCodeUnitStrings(left.fixtureId, right.fixtureId),
    ),
  );
}

function normalizeAArch64RelocationCatalog(
  relocationCatalog: AArch64RelocationCatalog | undefined,
  diagnostics: AArch64BackendDiagnostic[],
): AArch64RelocationCatalog | undefined {
  if (relocationCatalog === undefined) {
    diagnostics.push(diagnostic("backend-target:missing-catalog:relocation"));
    return undefined;
  }

  const mappings = Object.freeze(
    [...relocationCatalog.mappings]
      .map((mapping) =>
        Object.freeze({
          ...mapping,
          peCoffFamilies: Object.freeze([...mapping.peCoffFamilies].sort(compareCodeUnitStrings)),
        }),
      )
      .sort((left, right) => compareCodeUnitStrings(left.internalFamily, right.internalFamily)),
  );
  addDuplicateDiagnostics(
    mappings,
    (mapping) => mapping.internalFamily,
    (internalFamily) => `backend-target:relocation-mapping-duplicate:${internalFamily}`,
    diagnostics,
  );

  return {
    ...relocationCatalog,
    fingerprint: contentFingerprint("backend-relocation-catalog", { mappings }),
    mappings,
    mappingFor: (family) => mappings.find((mapping) => mapping.internalFamily === family),
  };
}

function normalizeAArch64UnwindCatalog(
  unwindCatalog: AArch64UnwindCatalog | undefined,
  diagnostics: AArch64BackendDiagnostic[],
): AArch64UnwindCatalog | undefined {
  if (unwindCatalog === undefined) {
    diagnostics.push(diagnostic("backend-target:missing-catalog:unwind"));
    return undefined;
  }

  const templates = Object.freeze(
    [...unwindCatalog.templates]
      .map((template) => Object.freeze({ ...template }))
      .sort((left, right) => compareCodeUnitStrings(left.frameShape, right.frameShape)),
  );

  return {
    ...unwindCatalog,
    fingerprint: contentFingerprint("backend-unwind-catalog", { templates }),
    templates,
    templateForFrame: (shape) => templates.find((template) => template.frameShape === shape),
  };
}

function normalizeAArch64FrameCatalog(
  frameCatalog: AArch64FrameCatalog | undefined,
  diagnostics: AArch64BackendDiagnostic[],
): AArch64FrameCatalog | undefined {
  if (frameCatalog === undefined) {
    diagnostics.push(diagnostic("backend-target:missing-catalog:frame"));
    return undefined;
  }

  const frameRecordRules = Object.freeze(
    [...frameCatalog.frameRecordRules]
      .map((rule) => Object.freeze({ ...rule }))
      .sort((left, right) => compareCodeUnitStrings(left.stableKey, right.stableKey)),
  );
  const encodableOffsetClasses = Object.freeze(
    [...frameCatalog.encodableOffsetClasses]
      .map((entry) => Object.freeze({ ...entry }))
      .sort((left, right) => compareCodeUnitStrings(left.stableKey, right.stableKey)),
  );

  return {
    ...frameCatalog,
    fingerprint: contentFingerprint("backend-frame-catalog", {
      stackAlignmentBytes: frameCatalog.stackAlignmentBytes,
      frameRecordRules,
      encodableOffsetClasses,
    }),
    frameRecordRules,
    encodableOffsetClasses,
  };
}

function normalizeAArch64VeneerCatalog(
  veneerCatalog: AArch64VeneerCatalog | undefined,
  diagnostics: AArch64BackendDiagnostic[],
): AArch64VeneerCatalog | undefined {
  if (veneerCatalog === undefined) {
    diagnostics.push(diagnostic("backend-target:missing-catalog:veneer"));
    return undefined;
  }

  const veneerKinds = Object.freeze(
    [...veneerCatalog.veneerKinds]
      .map((entry) =>
        Object.freeze({
          ...entry,
          policy: Object.freeze({
            ...entry.policy,
            allow: Object.freeze([...entry.policy.allow].sort(compareCodeUnitStrings)),
          }),
        }),
      )
      .sort((left, right) => compareCodeUnitStrings(left.siteKind, right.siteKind)),
  );

  return {
    ...veneerCatalog,
    fingerprint: contentFingerprint("backend-veneer-catalog", { veneerKinds }),
    veneerKinds,
    policyFor: (site) => veneerKinds.find((entry) => entry.siteKind === site)?.policy,
  };
}

function normalizeAArch64LiteralPoolCatalog(
  literalPoolCatalog: AArch64LiteralPoolCatalog | undefined,
  diagnostics: AArch64BackendDiagnostic[],
): AArch64LiteralPoolCatalog | undefined {
  if (literalPoolCatalog === undefined) {
    diagnostics.push(diagnostic("backend-target:missing-catalog:literal-pool"));
    return undefined;
  }

  const literalClasses = Object.freeze(
    [...literalPoolCatalog.literalClasses]
      .map((entry) => Object.freeze({ ...entry }))
      .sort((left, right) => compareCodeUnitStrings(left.stableKey, right.stableKey)),
  );
  const placementPolicies = Object.freeze(
    literalClasses.map((literalClass) => {
      const policy = literalPoolCatalog.placementPolicyFor(literalClass.stableKey);
      return Object.freeze({
        literalClassKey: literalClass.stableKey,
        ...(policy === undefined
          ? {}
          : {
              policy: Object.freeze({
                ...policy,
              }),
            }),
      });
    }),
  );
  const policyByClass = new Map(
    placementPolicies.flatMap((entry) =>
      entry.policy === undefined ? [] : [[entry.literalClassKey, entry.policy] as const],
    ),
  );

  return {
    ...literalPoolCatalog,
    fingerprint: contentFingerprint("backend-literal-pool-catalog", {
      literalClasses,
      placementPolicies,
    }),
    literalClasses,
    placementPolicyFor: (literalClass) => policyByClass.get(literalClass),
  };
}

function normalizeAArch64SecurityCatalog(
  securityCatalog: AArch64BackendSecurityCatalog | undefined,
  diagnostics: AArch64BackendDiagnostic[],
): AArch64BackendSecurityCatalog | undefined {
  if (securityCatalog === undefined) {
    diagnostics.push(diagnostic("backend-target:missing-catalog:security"));
    return undefined;
  }

  const constantTimeInstructions = Object.freeze(
    [...securityCatalog.constantTimeInstructions].sort(compareCodeUnitStrings),
  );
  const constantTimeHelpers = Object.freeze(
    [...securityCatalog.constantTimeHelpers].sort(compareCodeUnitStrings),
  );

  return {
    ...securityCatalog,
    fingerprint: contentFingerprint("backend-security-catalog", {
      constantTimeInstructions,
      constantTimeHelpers,
      secretLiteralPolicy: securityCatalog.secretLiteralPolicy,
    }),
    constantTimeInstructions,
    constantTimeHelpers,
  };
}

function normalizeAArch64TuningModel(
  tuningModel: AArch64BackendTuningModel | undefined,
  diagnostics: AArch64BackendDiagnostic[],
): AArch64BackendTuningModel | undefined {
  if (tuningModel === undefined) {
    diagnostics.push(diagnostic("backend-target:missing-catalog:tuning"));
    return undefined;
  }

  const latencyWeights = Object.freeze(
    [...tuningModel.latencyWeights]
      .map((entry) => Object.freeze({ ...entry }))
      .sort((left, right) => {
        const operation = compareCodeUnitStrings(left.operationKind, right.operationKind);
        if (operation !== 0) return operation;
        return left.latency - right.latency;
      }),
  );
  const throughputWeights = Object.freeze(
    [...tuningModel.throughputWeights]
      .map((entry) => Object.freeze({ ...entry }))
      .sort((left, right) => {
        const operation = compareCodeUnitStrings(left.operationKind, right.operationKind);
        if (operation !== 0) return operation;
        return left.throughput - right.throughput;
      }),
  );
  const pressureWeights = Object.freeze(
    [...tuningModel.pressureWeights]
      .map((entry) => Object.freeze({ ...entry }))
      .sort((left, right) => {
        const resource = compareCodeUnitStrings(left.resource, right.resource);
        if (resource !== 0) return resource;
        return left.pressure - right.pressure;
      }),
  );

  return {
    ...tuningModel,
    fingerprint: contentFingerprint("backend-tuning-model", {
      latencyWeights,
      throughputWeights,
      pressureWeights,
    }),
    latencyWeights,
    throughputWeights,
    pressureWeights,
  };
}

function contentFingerprint(prefix: string, payload: unknown): string {
  return `${prefix}:${stableHash(stableJson(payload))}`;
}

function diagnostic(stableDetail: string): AArch64BackendDiagnostic {
  return aarch64BackendDiagnostic({
    code: "AARCH64_BACKEND_TARGET_SURFACE_INVALID",
    ownerKey: "backend-target-surface",
    rootCauseKey: "backend-target-surface",
    stableDetail,
  });
}

function addDuplicateDiagnostics<RecordType>(
  records: readonly RecordType[],
  keyFor: (record: RecordType) => string,
  detailFor: (key: string) => string,
  diagnostics: AArch64BackendDiagnostic[],
): void {
  const seen = new Set<string>();
  const reported = new Set<string>();
  for (const record of records) {
    const key = keyFor(record);
    if (!seen.has(key)) {
      seen.add(key);
      continue;
    }
    if (reported.has(key)) continue;
    reported.add(key);
    diagnostics.push(diagnostic(detailFor(key)));
  }
}

export function computeBackendTargetSurfaceFingerprint(input: {
  readonly sourceSurfaceFingerprint: string;
  readonly registerModel: AArch64PhysicalRegisterModel;
  readonly encodingCatalog: AArch64EncodingCatalog;
  readonly relocationCatalog: AArch64RelocationCatalog;
  readonly unwindCatalog: AArch64UnwindCatalog;
  readonly frameCatalog: AArch64FrameCatalog;
  readonly veneerCatalog: AArch64VeneerCatalog;
  readonly literalPoolCatalog: AArch64LiteralPoolCatalog;
  readonly securityCatalog: AArch64BackendSecurityCatalog;
  readonly tuningModel: AArch64BackendTuningModel;
}): string {
  return computeBackendSurfaceFingerprint(input);
}
