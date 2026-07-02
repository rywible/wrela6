import { aarch64BackendSurfaceId } from "../../../../../src/target/aarch64/backend/api/ids";
import {
  type AArch64BackendCatalogInputs,
  type AArch64BackendSecurityCatalog,
  type AArch64BackendTuningModel,
  type AArch64EncodingCatalog,
  type AArch64FrameCatalog,
  type AArch64LiteralPoolCatalog,
  type AArch64PhysicalRegisterModel,
  type AArch64RelocationCatalog,
  type AArch64UnwindCatalog,
  type AArch64VeneerCatalog,
} from "../../../../../src/target/aarch64/backend/api/backend-catalog-interfaces";
import { compareCodeUnitStrings } from "../../../../../src/shared/deterministic-sort";
import {
  authenticateAArch64BackendTargetSurface,
  type AArch64BackendSurfaceAuthenticationInput,
  type AArch64BackendTargetSurface,
} from "../../../../../src/target/aarch64/backend/api/backend-target-surface";
import { IMPLEMENTED_AARCH64_ENCODER_OPCODES } from "../../../../../src/target/aarch64/backend/object/encoding-opcodes";
import { RPI5_BACKEND_CATALOGS } from "../../../../../src/target/aarch64/backend/catalogs/rpi5-backend-catalog-data";
import { fakeAArch64TargetSurface } from "../target-surface/fakes";
import { sortAArch64BackendDiagnostics } from "../../../../../src/target/aarch64/backend/api/diagnostics";

export function fakeRegisterModel(
  overrides: Partial<AArch64PhysicalRegisterModel> & {
    readonly x18Policy?: "reserved" | "allocatable";
    readonly registerRecords?: readonly {
      readonly stableKey: string;
      readonly encodingNumber: number;
      readonly aliasSet: string;
      readonly isAllocatable: boolean;
    }[];
  } = {},
): AArch64PhysicalRegisterModel {
  const registerRecords = [
    ...(overrides.registerRecords ?? defaultRegisterRecords(overrides.x18Policy ?? "reserved")),
  ]
    .map((entry) => ({
      stableKey: entry.stableKey,
      encodingNumber: entry.encodingNumber,
      aliasSet: entry.aliasSet,
      isAllocatable: entry.isAllocatable,
    }))
    .sort((left, right) => compareCodeUnitStrings(left.stableKey, right.stableKey));

  const findRegister = (key: string) => registerRecords.find((entry) => entry.stableKey === key);

  return {
    fingerprint: "backend-register-model:wrela-uefi-aarch64-rpi5-v1:v1",
    registers: Object.freeze([...registerRecords]),
    aliasSets: Object.freeze([
      { stableKey: "x", aliases: registerRecords.map((entry) => entry.stableKey) },
    ]),
    publicParameterGprs: Object.freeze(["x0", "x1"]),
    publicResultGprs: Object.freeze(["x0", "x1"]),
    publicCallerSavedGprs: Object.freeze(["x18", "x19", "x20"]),
    publicCalleeSavedGprs: Object.freeze(["x21", "x22", "x23"]),
    privateConventionCandidateGprs: Object.freeze(["x19", "x20"]),
    veneerScratchGprs: Object.freeze(["x9", "x10"]),
    encodingNumberOf: (register) => {
      const record = findRegister(register);
      return record?.encodingNumber ?? -1;
    },
    aliasSetOf: (register) => {
      const record = findRegister(register);
      return record?.aliasSet ?? "x";
    },
    canAllocate: (register) => {
      const record = findRegister(register);
      return record?.isAllocatable ?? false;
    },
    permitsOperand: () => true,
    ...overrides,
  };
}

export function fakeEncodingCatalog(
  overrides: Partial<AArch64EncodingCatalog> = {},
): AArch64EncodingCatalog {
  const { entries: overrideEntries, ...catalogOverrides } = overrides;
  const entries = Object.freeze(
    [
      ...IMPLEMENTED_AARCH64_ENCODER_OPCODES.map((opcode) => ({
        opcode,
        stableKey: `enc:${opcode}`,
        instructionWordPatterns: fakeInstructionWordPatternsForOpcode(opcode),
        relocationHole:
          opcode === "b-cond" || opcode === "cbz" || opcode === "cbnz"
            ? { family: "branch19", bitRange: [5, 23] as const, owner: `enc:${opcode}` }
            : opcode === "tbz" || opcode === "tbnz"
              ? { family: "branch14", bitRange: [5, 18] as const, owner: `enc:${opcode}` }
              : opcode === "b" || opcode === "bl"
                ? { family: "branch26", bitRange: [0, 25] as const, owner: `enc:${opcode}` }
                : opcode === "ldr-unsigned-immediate" || opcode === "str-unsigned-immediate"
                  ? {
                      family: "pageoffset-12l",
                      bitRange: [10, 21] as const,
                      owner: `enc:${opcode}`,
                    }
                  : undefined,
      })),
      ...(overrideEntries ?? []),
    ].sort((left, right) => compareCodeUnitStrings(left.opcode, right.opcode)),
  );

  return {
    fingerprint: "backend-encoding-catalog:wrela-uefi-aarch64-rpi5-v1:v1",
    entries,
    entryForOpcode: (opcode) => entries.find((entry) => entry.opcode === opcode),
    knownByteFixtureFor: () => undefined,
    ...catalogOverrides,
  };
}

function fakeInstructionWordPatternsForOpcode(opcode: string) {
  return Object.freeze([
    ...(RPI5_BACKEND_CATALOGS.encodingCatalog.entryForOpcode(opcode)?.instructionWordPatterns ??
      []),
  ]);
}

export function fakeRelocationCatalog(
  overrides: Partial<AArch64RelocationCatalog> & {
    readonly mappingEntries?: readonly {
      readonly internalFamily: string;
      readonly peCoffFamilies: readonly string[];
    }[];
  } = {},
): AArch64RelocationCatalog {
  const mappings = Object.freeze([
    { internalFamily: "branch26", peCoffFamilies: ["IMAGE_REL_ARM64_BRANCH26"] },
    { internalFamily: "branch19", peCoffFamilies: ["IMAGE_REL_ARM64_BRANCH19"] },
    { internalFamily: "branch14", peCoffFamilies: ["IMAGE_REL_ARM64_BRANCH14"] },
    { internalFamily: "pagebase-rel21", peCoffFamilies: ["IMAGE_REL_ARM64_PAGEBASE_REL21"] },
    { internalFamily: "pageoffset-12a", peCoffFamilies: ["IMAGE_REL_ARM64_PAGEOFFSET_12A"] },
    { internalFamily: "pageoffset-12l", peCoffFamilies: ["IMAGE_REL_ARM64_PAGEOFFSET_12L"] },
    { internalFamily: "addr64", peCoffFamilies: ["IMAGE_REL_ARM64_ADDR64"] },
    { internalFamily: "addr32", peCoffFamilies: ["IMAGE_REL_ARM64_ADDR32"] },
    { internalFamily: "addr32nb", peCoffFamilies: ["IMAGE_REL_ARM64_ADDR32NB"] },
    { internalFamily: "rel32", peCoffFamilies: ["IMAGE_REL_ARM64_REL32"] },
    { internalFamily: "section-relative", peCoffFamilies: ["IMAGE_REL_ARM64_SECREL"] },
    ...(overrides.mappingEntries ?? []),
  ]);

  return {
    fingerprint: "backend-relocation-catalog:wrela-uefi-aarch64-rpi5-v1:v1",
    mappings,
    mappingFor: (family) => mappings.find((entry) => entry.internalFamily === family),
    ...overrides,
  };
}

export function fakeUnwindCatalog(
  overrides: Partial<AArch64UnwindCatalog> = {},
): AArch64UnwindCatalog {
  return {
    fingerprint: "backend-unwind-catalog:wrela-uefi-aarch64-rpi5-v1:v1",
    templates: Object.freeze([
      { frameShape: "prologue", stableKey: "unwind:prologue" },
      { frameShape: "epilogue", stableKey: "unwind:epilogue" },
    ]),
    templateForFrame: (frameShape) =>
      frameShape === "prologue"
        ? { frameShape, stableKey: "unwind:prologue" }
        : frameShape === "epilogue"
          ? { frameShape, stableKey: "unwind:epilogue" }
          : undefined,
    ...overrides,
  };
}

export function fakeFrameCatalog(
  overrides: Partial<AArch64FrameCatalog> = {},
): AArch64FrameCatalog {
  return {
    fingerprint: "backend-frame-catalog:wrela-uefi-aarch64-rpi5-v1:v1",
    stackAlignmentBytes: 16,
    frameRecordRules: Object.freeze([
      { stableKey: "frame-rule:prologue", frameShape: "prologue", kind: "normal" },
    ]),
    encodableOffsetClasses: Object.freeze([{ stableKey: "offset:16", byteAlignment: 16 }]),
    ...overrides,
  };
}

export function fakeVeneerCatalog(
  overrides: Partial<AArch64VeneerCatalog> = {},
): AArch64VeneerCatalog {
  return {
    fingerprint: "backend-veneer-catalog:wrela-uefi-aarch64-rpi5-v1:v1",
    veneerKinds: Object.freeze([
      {
        siteKind: "call",
        policy: { stableKey: "veneer:policy:call", allow: ["call"] },
      },
    ]),
    policyFor: (siteKind) =>
      siteKind === "call" ? { stableKey: "veneer:policy:call", allow: ["call"] } : undefined,
    ...overrides,
  };
}

export function fakeLiteralPoolCatalog(
  overrides: Partial<AArch64LiteralPoolCatalog> = {},
): AArch64LiteralPoolCatalog {
  return {
    fingerprint: "backend-literal-pool-catalog:wrela-uefi-aarch64-rpi5-v1:v1",
    literalClasses: Object.freeze([{ stableKey: "default" }]),
    placementPolicyFor: (literalClass) =>
      literalClass === "default" ? { stableKey: "literal:default", maxSpanBytes: 4096 } : undefined,
    ...overrides,
  };
}

export function fakeSecurityCatalog(
  overrides: Partial<AArch64BackendSecurityCatalog> = {},
): AArch64BackendSecurityCatalog {
  return {
    fingerprint: "backend-security-catalog:wrela-uefi-aarch64-rpi5-v1:v1",
    constantTimeInstructions: Object.freeze(["csel", "ccmp"]),
    constantTimeHelpers: Object.freeze(["ct.memcmp.fixed"]),
    secretLiteralPolicy: "forbid",
    ...overrides,
  };
}

export function fakeTuningModel(
  overrides: Partial<AArch64BackendTuningModel> = {},
): AArch64BackendTuningModel {
  return {
    fingerprint: "backend-tuning-model:wrela-uefi-aarch64-rpi5-v1:v1",
    latencyWeights: Object.freeze([{ operationKind: "add", latency: 1 }]),
    throughputWeights: Object.freeze([{ operationKind: "add", throughput: 1 }]),
    pressureWeights: Object.freeze([{ resource: "alu", pressure: 1 }]),
    ...overrides,
  };
}

export function fakeBackendCatalogs(
  overrides: Partial<AArch64BackendCatalogInputs> = {},
): AArch64BackendCatalogInputs {
  return {
    registerModel: fakeRegisterModel(),
    encodingCatalog: fakeEncodingCatalog(),
    relocationCatalog: fakeRelocationCatalog(),
    unwindCatalog: fakeUnwindCatalog(),
    frameCatalog: fakeFrameCatalog(),
    veneerCatalog: fakeVeneerCatalog(),
    literalPoolCatalog: fakeLiteralPoolCatalog(),
    securityCatalog: fakeSecurityCatalog(),
    tuningModel: fakeTuningModel(),
    ...overrides,
  };
}

export function fakeBackendSurfaceAuthenticationInput(
  overrides: Partial<AArch64BackendSurfaceAuthenticationInput> = {},
): AArch64BackendSurfaceAuthenticationInput {
  const sourceSurface = fakeAArch64TargetSurface();
  const catalogs = fakeBackendCatalogs();

  return {
    sourceSurface,
    backendSurfaceId: aarch64BackendSurfaceId(`backend-surface:${sourceSurface.profile.profileId}`),
    sourceSurfaceFingerprint: undefined,
    registerModel: catalogs.registerModel,
    encodingCatalog: catalogs.encodingCatalog,
    relocationCatalog: catalogs.relocationCatalog,
    unwindCatalog: catalogs.unwindCatalog,
    frameCatalog: catalogs.frameCatalog,
    veneerCatalog: catalogs.veneerCatalog,
    literalPoolCatalog: catalogs.literalPoolCatalog,
    securityCatalog: catalogs.securityCatalog,
    tuningModel: catalogs.tuningModel,
    ...overrides,
  };
}

export function authenticatedBackendTargetSurfaceForTest(
  overrides: Partial<AArch64BackendSurfaceAuthenticationInput> = {},
): AArch64BackendTargetSurface {
  const result = authenticateAArch64BackendTargetSurface(
    fakeBackendSurfaceAuthenticationInput(overrides),
  );
  if (result.kind === "error") {
    throw new Error(
      `backend surface auth failed: ${sortAArch64BackendDiagnostics(result.diagnostics)
        .map((diagnostic) => diagnostic.stableDetail)
        .join(",")}`,
    );
  }

  return result.value;
}

function defaultRegisterRecords(x18Policy: "reserved" | "allocatable") {
  return Object.freeze([
    { stableKey: "x0", encodingNumber: 0, aliasSet: "x", isAllocatable: true },
    { stableKey: "x1", encodingNumber: 1, aliasSet: "x", isAllocatable: true },
    { stableKey: "x2", encodingNumber: 2, aliasSet: "x", isAllocatable: true },
    { stableKey: "x3", encodingNumber: 3, aliasSet: "x", isAllocatable: true },
    { stableKey: "x9", encodingNumber: 9, aliasSet: "x", isAllocatable: true },
    { stableKey: "x10", encodingNumber: 10, aliasSet: "x", isAllocatable: true },
    {
      stableKey: "x18",
      encodingNumber: 18,
      aliasSet: "x",
      isAllocatable: x18Policy === "allocatable",
    },
    { stableKey: "x19", encodingNumber: 19, aliasSet: "x", isAllocatable: true },
    { stableKey: "x20", encodingNumber: 20, aliasSet: "x", isAllocatable: true },
    { stableKey: "x29", encodingNumber: 29, aliasSet: "x", isAllocatable: false },
    { stableKey: "x30", encodingNumber: 30, aliasSet: "x", isAllocatable: false },
    { stableKey: "sp", encodingNumber: 31, aliasSet: "sp", isAllocatable: false },
  ]);
}
