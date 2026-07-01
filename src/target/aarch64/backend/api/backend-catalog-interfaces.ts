export type AArch64PhysicalRegisterStableKey = string;
export type AArch64PhysicalAliasSetKey = string;
export type AArch64KnownByteFixtureId = string;
export type AArch64PhysicalOpcode = string;
export type AArch64InternalRelocationFamily = string;
export type AArch64PeCoffRelocationFamily = string;
export type AArch64FrameShapeKey = string;
export type AArch64VeneerSiteKind = string;
export type AArch64VeneerKindKey = string;
export type AArch64LiteralPoolClassKey = string;

export interface AArch64PhysicalRegisterRecord {
  readonly stableKey: AArch64PhysicalRegisterStableKey;
  readonly aliasSet: AArch64PhysicalAliasSetKey;
  readonly encodingNumber: number;
  readonly isAllocatable: boolean;
}

export interface AArch64AliasSetRecord {
  readonly stableKey: AArch64PhysicalAliasSetKey;
  readonly aliases: readonly AArch64PhysicalRegisterStableKey[];
}

export interface AArch64RegisterOperandPermissionQuery {
  readonly registerKey: AArch64PhysicalRegisterStableKey;
  readonly context: "general" | "stack-access" | "call" | "return";
  readonly operationKind?: string;
}

export interface AArch64EncodingCatalogEntry {
  readonly opcode: AArch64PhysicalOpcode;
  readonly stableKey: string;
  readonly family?: string;
  readonly requiredFeatures?: readonly string[];
  readonly knownByteFixtureIds?: readonly AArch64KnownByteFixtureId[];
  readonly instructionWordPatterns?: readonly AArch64InstructionWordPattern[];
  readonly permitsSp?: boolean;
  readonly permitsZr?: boolean;
  readonly relocationHole?: {
    readonly family: AArch64InternalRelocationFamily;
    readonly bitRange: readonly [number, number];
    readonly owner?: string;
  };
}

export interface AArch64KnownByteFixture {
  readonly fixtureId: AArch64KnownByteFixtureId;
  readonly opcode?: AArch64PhysicalOpcode;
  readonly operands?: readonly string[];
  readonly bytes: readonly number[];
}

export interface AArch64InstructionWordPattern {
  readonly mask: number;
  readonly value: number;
  readonly source: "decoder" | "known-byte-fixture";
}

export interface AArch64RelocationCatalogMapping {
  readonly internalFamily: AArch64InternalRelocationFamily;
  readonly peCoffFamilies: readonly AArch64PeCoffRelocationFamily[];
}

export interface AArch64UnwindTemplate {
  readonly frameShape: AArch64FrameShapeKey;
  readonly stableKey: string;
}

export interface AArch64FrameRecordRule {
  readonly stableKey: string;
  readonly frameShape: AArch64FrameShapeKey;
  readonly kind: string;
}

export interface AArch64FrameOffsetClass {
  readonly stableKey: string;
  readonly byteAlignment: number;
}

export interface AArch64VeneerPolicy {
  readonly stableKey: string;
  readonly allow: readonly AArch64VeneerKindKey[];
}

export interface AArch64VeneerKindRecord {
  readonly siteKind: AArch64VeneerSiteKind;
  readonly policy: AArch64VeneerPolicy;
}

export interface AArch64LiteralPoolClassRecord {
  readonly stableKey: AArch64LiteralPoolClassKey;
}

export interface AArch64LiteralPoolPlacementPolicy {
  readonly stableKey: string;
  readonly maxSpanBytes: number;
}

export interface AArch64LatencyWeight {
  readonly operationKind: string;
  readonly latency: number;
}

export interface AArch64ThroughputWeight {
  readonly operationKind: string;
  readonly throughput: number;
}

export interface AArch64PressureWeight {
  readonly resource: string;
  readonly pressure: number;
}

export interface AArch64PhysicalRegisterModel {
  readonly fingerprint: string;
  readonly registers: readonly AArch64PhysicalRegisterRecord[];
  readonly aliasSets: readonly AArch64AliasSetRecord[];
  readonly publicParameterGprs: readonly AArch64PhysicalRegisterStableKey[];
  readonly publicResultGprs: readonly AArch64PhysicalRegisterStableKey[];
  readonly publicCallerSavedGprs: readonly AArch64PhysicalRegisterStableKey[];
  readonly publicCalleeSavedGprs: readonly AArch64PhysicalRegisterStableKey[];
  readonly privateConventionCandidateGprs: readonly AArch64PhysicalRegisterStableKey[];
  readonly veneerScratchGprs: readonly AArch64PhysicalRegisterStableKey[];
  readonly encodingNumberOf: (register: AArch64PhysicalRegisterStableKey) => number;
  readonly aliasSetOf: (register: AArch64PhysicalRegisterStableKey) => AArch64PhysicalAliasSetKey;
  readonly canAllocate: (register: AArch64PhysicalRegisterStableKey) => boolean;
  readonly permitsOperand: (input: AArch64RegisterOperandPermissionQuery) => boolean;
}

export interface AArch64EncodingCatalog {
  readonly fingerprint: string;
  readonly entries: readonly AArch64EncodingCatalogEntry[];
  readonly entryForOpcode: (
    opcode: AArch64PhysicalOpcode,
  ) => AArch64EncodingCatalogEntry | undefined;
  readonly knownByteFixtureFor: (
    fixtureId: AArch64KnownByteFixtureId,
  ) => AArch64KnownByteFixture | undefined;
}

export interface AArch64RelocationCatalog {
  readonly fingerprint: string;
  readonly mappings: readonly AArch64RelocationCatalogMapping[];
  readonly mappingFor: (
    family: AArch64InternalRelocationFamily,
  ) => AArch64RelocationCatalogMapping | undefined;
}

export interface AArch64UnwindCatalog {
  readonly fingerprint: string;
  readonly templates: readonly AArch64UnwindTemplate[];
  readonly templateForFrame: (shape: AArch64FrameShapeKey) => AArch64UnwindTemplate | undefined;
}

export interface AArch64FrameCatalog {
  readonly fingerprint: string;
  readonly stackAlignmentBytes: 16;
  readonly frameRecordRules: readonly AArch64FrameRecordRule[];
  readonly encodableOffsetClasses: readonly AArch64FrameOffsetClass[];
}

export interface AArch64VeneerCatalog {
  readonly fingerprint: string;
  readonly veneerKinds: readonly AArch64VeneerKindRecord[];
  readonly policyFor: (site: AArch64VeneerSiteKind) => AArch64VeneerPolicy | undefined;
}

export interface AArch64LiteralPoolCatalog {
  readonly fingerprint: string;
  readonly literalClasses: readonly AArch64LiteralPoolClassRecord[];
  readonly placementPolicyFor: (
    literalClass: AArch64LiteralPoolClassKey,
  ) => AArch64LiteralPoolPlacementPolicy | undefined;
}

export interface AArch64BackendSecurityCatalog {
  readonly fingerprint: string;
  readonly constantTimeInstructions: readonly AArch64PhysicalOpcode[];
  readonly constantTimeHelpers: readonly string[];
  readonly secretLiteralPolicy: "forbid" | "catalog-approved-only";
}

export interface AArch64BackendTuningModel {
  readonly fingerprint: string;
  readonly latencyWeights: readonly AArch64LatencyWeight[];
  readonly throughputWeights: readonly AArch64ThroughputWeight[];
  readonly pressureWeights: readonly AArch64PressureWeight[];
}

export interface AArch64BackendCatalogInputs {
  readonly registerModel?: AArch64PhysicalRegisterModel;
  readonly encodingCatalog?: AArch64EncodingCatalog;
  readonly relocationCatalog?: AArch64RelocationCatalog;
  readonly unwindCatalog?: AArch64UnwindCatalog;
  readonly frameCatalog?: AArch64FrameCatalog;
  readonly veneerCatalog?: AArch64VeneerCatalog;
  readonly literalPoolCatalog?: AArch64LiteralPoolCatalog;
  readonly securityCatalog?: AArch64BackendSecurityCatalog;
  readonly tuningModel?: AArch64BackendTuningModel;
}
