import { compareCodeUnitStrings } from "../../../../shared/deterministic-sort";
import { stableHash, stableJson } from "../../../../shared/stable-json";
import {
  aarch64BackendDiagnostic,
  sortAArch64BackendDiagnostics,
  type AArch64BackendDiagnostic,
  type AArch64BackendDiagnosticCode,
} from "../api/diagnostics";
import {
  aarch64BackendVerificationSummary,
  verifierRun,
  type AArch64BackendVerificationSummary,
} from "../api/verification-summary";
import {
  aarch64ObjectRelocation,
  relocationTargetForSymbolReference,
  relocationTargetsAreEquivalent,
  type AArch64ObjectRelocation,
  type AArch64ObjectRelocationTarget,
} from "./relocation-records";
import { aarch64ObjectUnwindRecord, type AArch64ObjectUnwindRecord } from "./object-unwind-record";

export { aarch64ObjectRelocation, aarch64ObjectUnwindRecord };
export type {
  AArch64ObjectRelocation,
  AArch64ObjectLinkerVeneerRequest,
  AArch64ObjectRelocationEncodingOwner,
  AArch64ObjectInstructionPatch,
  AArch64ObjectRelocationTarget,
} from "./relocation-records";
export type { AArch64ObjectUnwindRecord } from "./object-unwind-record";

export { verifierRun };
import {
  aarch64LiteralPoolId,
  aarch64ObjectFragmentId,
  aarch64ObjectSectionClassKey,
  aarch64ObjectSectionId,
  aarch64ObjectSymbolId,
  aarch64VeneerId,
  type AArch64LiteralPoolId,
  type AArch64ObjectFragmentId,
  type AArch64ObjectSectionClassKey,
  type AArch64ObjectSectionId,
  type AArch64ObjectSymbolId,
  type AArch64VeneerId,
} from "../api/ids";

export const AARCH64_OBJECT_SECTION_CLASS_EXECUTABLE_TEXT =
  aarch64ObjectSectionClassKey("executable-text");
export const AARCH64_OBJECT_SECTION_CLASS_READ_ONLY_DATA =
  aarch64ObjectSectionClassKey("read-only-data");
export const AARCH64_OBJECT_SECTION_CLASS_WRITABLE_DATA =
  aarch64ObjectSectionClassKey("writable-data");
export const AARCH64_OBJECT_SECTION_CLASS_UNWIND_PDATA =
  aarch64ObjectSectionClassKey("unwind-pdata");
export const AARCH64_OBJECT_SECTION_CLASS_UNWIND_XDATA =
  aarch64ObjectSectionClassKey("unwind-xdata");
export const AARCH64_OBJECT_SECTION_CLASS_DEBUG_PROVENANCE =
  aarch64ObjectSectionClassKey("debug-provenance");

export interface AArch64ObjectSection {
  readonly stableKey: AArch64ObjectSectionId;
  readonly classKey: AArch64ObjectSectionClassKey;
  readonly alignmentBytes: number;
  readonly bytes: Uint8Array;
  readonly fragments: readonly AArch64ObjectFragment[];
}

export interface AArch64ObjectFragment {
  readonly stableKey: AArch64ObjectFragmentId;
  readonly sectionKey: AArch64ObjectSectionId;
  readonly startOffsetBytes: number;
  readonly sizeBytes: number;
}

export type AArch64ObjectSymbol =
  | {
      readonly kind: "local-definition";
      readonly stableKey: AArch64ObjectSymbolId;
      readonly sectionKey: AArch64ObjectSectionId;
      readonly offsetBytes: number;
    }
  | {
      readonly kind: "global-definition";
      readonly stableKey: AArch64ObjectSymbolId;
      readonly linkageName: string;
      readonly sectionKey: AArch64ObjectSectionId;
      readonly offsetBytes: number;
    }
  | {
      readonly kind: "external-declaration";
      readonly stableKey: AArch64ObjectSymbolId;
      readonly linkageName: string;
    };

export interface AArch64ObjectLiteralPoolEntry {
  readonly stableKey: AArch64LiteralPoolId;
  readonly sectionKey: AArch64ObjectSectionId;
  readonly offsetBytes: number;
  readonly data: Uint8Array;
  readonly users: readonly AArch64ObjectLiteralPoolUser[];
}

export interface AArch64ObjectLiteralPoolUser {
  readonly stableKey: string;
  readonly useOffsetBytes: number;
  readonly maxReachBytes: number;
}

export interface AArch64ObjectVeneer {
  readonly stableKey: AArch64VeneerId;
  readonly sectionKey: AArch64ObjectSectionId;
  readonly targetKey: string;
}

export interface AArch64ByteProvenanceRecord {
  readonly stableKey: string;
  readonly sectionKey: AArch64ObjectSectionId;
  readonly startOffsetBytes: number;
  readonly byteLength: number;
  readonly source: string;
  readonly factFamilies: readonly string[];
  readonly machineSubjectKey?: string;
}

export interface AArch64FactSpendingRecord {
  readonly stableKey: string;
  readonly authority: string;
  readonly payload: string;
}

export interface AArch64BackendDeterministicMetadata {
  readonly schema: "aarch64-object-module";
  readonly schemaVersion: "1";
  readonly sectionFingerprint: string;
  readonly symbolFingerprint: string;
  readonly relocationFingerprint: string;
  readonly literalPoolFingerprint: string;
  readonly byteProvenanceFingerprint: string;
  readonly recordCounts: {
    readonly sections: number;
    readonly symbols: number;
    readonly relocations: number;
    readonly literalPools: number;
    readonly veneers: number;
    readonly unwindRecords: number;
    readonly byteProvenanceRecords: number;
    readonly factSpendingRecords: number;
  };
  readonly moduleFingerprint: string;
}

export interface AArch64ObjectModule {
  readonly targetBackendSurfaceFingerprint: string;
  readonly closedImagePlanFingerprint: string;
  readonly sections: readonly AArch64ObjectSection[];
  readonly symbols: readonly AArch64ObjectSymbol[];
  readonly relocations: readonly AArch64ObjectRelocation[];
  readonly literalPools: readonly AArch64ObjectLiteralPoolEntry[];
  readonly veneers: readonly AArch64ObjectVeneer[];
  readonly unwindRecords: readonly AArch64ObjectUnwindRecord[];
  readonly diagnostics: readonly AArch64BackendDiagnostic[];
  readonly verification: AArch64BackendVerificationSummary;
  readonly byteProvenance: readonly AArch64ByteProvenanceRecord[];
  readonly factSpending: readonly AArch64FactSpendingRecord[];
  readonly deterministicMetadata: AArch64BackendDeterministicMetadata;
}

export function aarch64ObjectModule(input: {
  readonly targetBackendSurfaceFingerprint: string;
  readonly closedImagePlanFingerprint: string;
  readonly sections?: readonly AArch64ObjectSection[];
  readonly symbols?: readonly AArch64ObjectSymbol[];
  readonly relocations?: readonly AArch64ObjectRelocation[];
  readonly literalPools?: readonly AArch64ObjectLiteralPoolEntry[];
  readonly veneers?: readonly AArch64ObjectVeneer[];
  readonly unwindRecords?: readonly AArch64ObjectUnwindRecord[];
  readonly diagnostics?: readonly AArch64BackendDiagnostic[];
  readonly verification?: AArch64BackendVerificationSummary;
  readonly byteProvenance?: readonly AArch64ByteProvenanceRecord[];
  readonly factSpending?: readonly AArch64FactSpendingRecord[];
}): AArch64ObjectModule {
  verifyObjectModuleInputFingerprints(input);

  const sections = normalizeAndFreezeRecords(
    (input.sections ?? []).map((section) =>
      aarch64ObjectSection({
        stableKey: section.stableKey,
        classKey: section.classKey,
        alignmentBytes: section.alignmentBytes,
        bytes: section.bytes,
        fragments: section.fragments,
      }),
    ),
    "section",
    (section) => section.stableKey,
  );

  const symbols = normalizeAndFreezeRecords(
    (input.symbols ?? []).map((symbol) => normalizeObjectSymbol(symbol)),
    "symbol",
    (symbol) => symbol.stableKey,
  );

  const relocations = normalizeAndFreezeRecords(
    (input.relocations ?? []).map((relocation) =>
      aarch64ObjectRelocation({
        stableKey: relocation.stableKey,
        sectionKey: relocation.sectionKey,
        offsetBytes: relocation.offsetBytes,
        widthBytes: relocation.widthBytes,
        family: relocation.family,
        target: normalizedRelocationTarget(relocation, symbols),
        targetSymbol: relocation.targetSymbol,
        addend: relocation.addend,
        instructionPatch: relocation.instructionPatch,
        pairedRelocationKey: relocation.pairedRelocationKey,
        linkerVeneer: relocation.linkerVeneer,
      }),
    ),
    "relocation",
    (relocation) => relocation.stableKey,
  );

  const literalPools = normalizeAndFreezeRecords(
    (input.literalPools ?? []).map((entry) =>
      aarch64ObjectLiteralPoolEntry({
        stableKey: entry.stableKey,
        sectionKey: entry.sectionKey,
        offsetBytes: entry.offsetBytes,
        data: entry.data,
        users: entry.users ?? [],
      }),
    ),
    "literal-pool",
    (entry) => entry.stableKey,
  );

  const veneers = normalizeAndFreezeRecords(
    (input.veneers ?? []).map((entry) =>
      aarch64ObjectVeneer({
        stableKey: entry.stableKey,
        sectionKey: entry.sectionKey,
        targetKey: entry.targetKey,
      }),
    ),
    "veneer",
    (entry) => entry.stableKey,
  );

  const unwindRecords = normalizeAndFreezeRecords(
    (input.unwindRecords ?? []).map((entry) =>
      aarch64ObjectUnwindRecord({
        stableKey: entry.stableKey,
        sectionKey: entry.sectionKey,
        frameShape: entry.frameShape,
        frameSizeBytes: entry.frameSizeBytes,
        savedRegisters: entry.savedRegisters,
      }),
    ),
    "unwind",
    (entry) => entry.stableKey,
  );

  const factSpending = normalizeAndFreezeRecords(
    (input.factSpending ?? []).map((entry) =>
      aarch64FactSpendingRecord({
        stableKey: entry.stableKey,
        authority: entry.authority,
        payload: entry.payload,
      }),
    ),
    "fact-spending",
    (entry) => entry.stableKey,
  );

  validateSectionCrossChecks({
    sections,
    symbols,
    relocations,
    literalPools,
  });
  const byteProvenance = normalizeAndFreezeByteProvenance(
    input.byteProvenance ?? defaultByteProvenanceFromSections(sections),
    sections,
  );

  const verification =
    input.verification ??
    aarch64BackendVerificationSummary({
      runs: [
        verifierRun({
          verifierKey: "object-module",
          runKey: "backend.object-module",
          status: "passed",
        }),
      ],
    });

  const deterministicMetadata = aarch64ObjectModuleDeterministicMetadata({
    targetBackendSurfaceFingerprint: input.targetBackendSurfaceFingerprint,
    closedImagePlanFingerprint: input.closedImagePlanFingerprint,
    sections,
    symbols,
    relocations,
    literalPools,
    veneers,
    unwindRecords,
    byteProvenance,
    factSpending,
  });

  return Object.freeze({
    targetBackendSurfaceFingerprint: input.targetBackendSurfaceFingerprint,
    closedImagePlanFingerprint: input.closedImagePlanFingerprint,
    sections,
    symbols,
    relocations,
    literalPools,
    veneers,
    unwindRecords,
    diagnostics: sortAArch64BackendDiagnostics(input.diagnostics ?? []),
    verification,
    byteProvenance,
    factSpending,
    deterministicMetadata,
  });
}

function normalizedRelocationTarget(
  relocation: {
    readonly target?: AArch64ObjectRelocationTarget;
    readonly targetSymbol?: string;
    readonly sectionKey: AArch64ObjectSectionId;
  },
  symbols: readonly AArch64ObjectSymbol[],
): AArch64ObjectRelocationTarget | undefined {
  const compatibilityTarget = relocationTargetForSymbolReference({
    targetSymbol: relocation.targetSymbol,
    symbols,
  });
  if (relocation.target === undefined) return compatibilityTarget;
  if (isLegacyConstructorCompatibilityTarget(relocation, compatibilityTarget)) {
    return compatibilityTarget;
  }
  if (
    compatibilityTarget !== undefined &&
    !relocationTargetsAreEquivalent(relocation.target, compatibilityTarget)
  ) {
    throw new RangeError(
      `Relocation target conflicts with targetSymbol: ${relocation.targetSymbol}.`,
    );
  }
  return relocation.target;
}

function isLegacyConstructorCompatibilityTarget(
  relocation: {
    readonly target?: AArch64ObjectRelocationTarget;
    readonly targetSymbol?: string;
  },
  compatibilityTarget: AArch64ObjectRelocationTarget | undefined,
): boolean {
  return (
    relocation.target?.kind === "linkage-name" &&
    relocation.target.linkageName === relocation.targetSymbol &&
    compatibilityTarget?.kind === "symbol-stable-key"
  );
}

export function aarch64ObjectSection(input: {
  readonly stableKey: string;
  readonly classKey: string;
  readonly alignmentBytes?: number;
  readonly bytes?: Uint8Array | readonly number[];
  readonly fragments?: readonly {
    readonly stableKey: string;
    readonly startOffsetBytes: number;
    readonly sizeBytes: number;
  }[];
}): AArch64ObjectSection {
  const alignmentBytes = input.alignmentBytes ?? 1;
  if (!Number.isInteger(alignmentBytes) || alignmentBytes < 1) {
    throw new RangeError("section alignment must be a positive integer.");
  }

  const sectionKey = aarch64ObjectSectionId(input.stableKey);
  const classKey = aarch64ObjectSectionClassKey(input.classKey);
  const bytes = freezeBytes(input.bytes ?? []);
  const fragments = normalizeAndFreezeRecords(
    (input.fragments ?? []).map((fragment) =>
      aarch64ObjectFragment({
        stableKey: fragment.stableKey,
        sectionKey,
        startOffsetBytes: fragment.startOffsetBytes,
        sizeBytes: fragment.sizeBytes,
      }),
    ),
    "section-fragment",
    (fragment) => fragment.stableKey,
  );

  return Object.freeze({
    stableKey: sectionKey,
    classKey,
    alignmentBytes,
    bytes,
    fragments,
  });
}

export function aarch64ObjectFragment(input: {
  readonly stableKey: string;
  readonly sectionKey: string;
  readonly startOffsetBytes: number;
  readonly sizeBytes: number;
}): AArch64ObjectFragment {
  if (!Number.isInteger(input.startOffsetBytes) || input.startOffsetBytes < 0) {
    throw new RangeError("fragment start offset must be a non-negative integer.");
  }
  if (!Number.isInteger(input.sizeBytes) || input.sizeBytes <= 0) {
    throw new RangeError("fragment size must be a positive integer.");
  }

  return Object.freeze({
    stableKey: aarch64ObjectFragmentId(input.stableKey),
    sectionKey: aarch64ObjectSectionId(input.sectionKey),
    startOffsetBytes: input.startOffsetBytes,
    sizeBytes: input.sizeBytes,
  });
}

export function aarch64ObjectSymbol(
  input:
    | {
        readonly kind: "local-definition";
        readonly stableKey: string;
        readonly sectionKey: string;
        readonly offsetBytes: number;
      }
    | {
        readonly kind: "global-definition";
        readonly stableKey: string;
        readonly linkageName: string;
        readonly sectionKey: string;
        readonly offsetBytes: number;
      }
    | {
        readonly kind: "external-declaration";
        readonly stableKey: string;
        readonly linkageName: string;
      },
): AArch64ObjectSymbol {
  if (input.kind === "external-declaration") {
    return Object.freeze({
      kind: input.kind,
      stableKey: aarch64ObjectSymbolId(input.stableKey),
      linkageName: input.linkageName,
    });
  }
  if (!Number.isInteger(input.offsetBytes) || input.offsetBytes < 0) {
    throw new RangeError("symbol offset must be a non-negative integer.");
  }
  if (input.kind === "local-definition") {
    return Object.freeze({
      kind: input.kind,
      stableKey: aarch64ObjectSymbolId(input.stableKey),
      sectionKey: aarch64ObjectSectionId(input.sectionKey),
      offsetBytes: input.offsetBytes,
    });
  }
  return Object.freeze({
    kind: input.kind,
    stableKey: aarch64ObjectSymbolId(input.stableKey),
    linkageName: input.linkageName,
    sectionKey: aarch64ObjectSectionId(input.sectionKey),
    offsetBytes: input.offsetBytes,
  });
}

function normalizeObjectSymbol(symbol: AArch64ObjectSymbol): AArch64ObjectSymbol {
  switch (symbol.kind) {
    case "local-definition":
      return aarch64ObjectSymbol({
        kind: symbol.kind,
        stableKey: symbol.stableKey,
        sectionKey: symbol.sectionKey,
        offsetBytes: symbol.offsetBytes,
      });
    case "global-definition":
      return aarch64ObjectSymbol({
        kind: symbol.kind,
        stableKey: symbol.stableKey,
        linkageName: symbol.linkageName,
        sectionKey: symbol.sectionKey,
        offsetBytes: symbol.offsetBytes,
      });
    case "external-declaration":
      return aarch64ObjectSymbol({
        kind: symbol.kind,
        stableKey: symbol.stableKey,
        linkageName: symbol.linkageName,
      });
  }
}

export function aarch64ObjectLiteralPoolEntry(input: {
  readonly stableKey: string;
  readonly sectionKey: string;
  readonly offsetBytes: number;
  readonly data: Uint8Array | readonly number[];
  readonly users?: readonly {
    readonly stableKey: string;
    readonly useOffsetBytes: number;
    readonly maxReachBytes: number;
  }[];
}): AArch64ObjectLiteralPoolEntry {
  if (!Number.isInteger(input.offsetBytes) || input.offsetBytes < 0) {
    throw new RangeError("literal-pool offset must be a non-negative integer.");
  }
  return Object.freeze({
    stableKey: aarch64LiteralPoolId(input.stableKey),
    sectionKey: aarch64ObjectSectionId(input.sectionKey),
    offsetBytes: input.offsetBytes,
    data: freezeBytes(input.data),
    users: Object.freeze(
      [...(input.users ?? [])]
        .map((user) => {
          if (!Number.isInteger(user.useOffsetBytes) || user.useOffsetBytes < 0) {
            throw new RangeError("literal-pool user offset must be a non-negative integer.");
          }
          if (!Number.isInteger(user.maxReachBytes) || user.maxReachBytes < 0) {
            throw new RangeError("literal-pool user reach must be a non-negative integer.");
          }
          return Object.freeze({
            stableKey: user.stableKey,
            useOffsetBytes: user.useOffsetBytes,
            maxReachBytes: user.maxReachBytes,
          });
        })
        .sort((left, right) => compareCodeUnitStrings(left.stableKey, right.stableKey)),
    ),
  });
}

export function aarch64ObjectVeneer(input: {
  readonly stableKey: string;
  readonly sectionKey: string;
  readonly targetKey: string;
}): AArch64ObjectVeneer {
  return Object.freeze({
    stableKey: aarch64VeneerId(input.stableKey),
    sectionKey: aarch64ObjectSectionId(input.sectionKey),
    targetKey: input.targetKey,
  });
}

export function aarch64ObjectByteProvenance(input: {
  readonly stableKey: string;
  readonly sectionKey: string;
  readonly startOffsetBytes: number;
  readonly byteLength: number;
  readonly source: string;
  readonly factFamilies?: readonly string[];
  readonly machineSubjectKey?: string;
}): AArch64ByteProvenanceRecord {
  if (!Number.isInteger(input.startOffsetBytes) || input.startOffsetBytes < 0) {
    throw new RangeError("byte-provenance start offset must be a non-negative integer.");
  }
  if (!Number.isInteger(input.byteLength) || input.byteLength <= 0) {
    throw new RangeError("byte-provenance length must be a positive integer.");
  }
  return Object.freeze({
    stableKey: String(input.stableKey),
    sectionKey: aarch64ObjectSectionId(input.sectionKey),
    startOffsetBytes: input.startOffsetBytes,
    byteLength: input.byteLength,
    source: input.source,
    factFamilies: Object.freeze([...(input.factFamilies ?? [])].sort(compareCodeUnitStrings)),
    ...(input.machineSubjectKey === undefined
      ? {}
      : { machineSubjectKey: input.machineSubjectKey }),
  });
}

export function aarch64FactSpendingRecord(input: {
  readonly stableKey: string;
  readonly authority: string;
  readonly payload: string;
}): AArch64FactSpendingRecord {
  return Object.freeze({
    stableKey: String(input.stableKey),
    authority: input.authority,
    payload: input.payload,
  });
}

export function aarch64ObjectModuleDeterministicMetadata(input: {
  readonly targetBackendSurfaceFingerprint: string;
  readonly closedImagePlanFingerprint: string;
  readonly sections: readonly AArch64ObjectSection[];
  readonly symbols: readonly AArch64ObjectSymbol[];
  readonly relocations: readonly AArch64ObjectRelocation[];
  readonly literalPools: readonly AArch64ObjectLiteralPoolEntry[];
  readonly veneers: readonly AArch64ObjectVeneer[];
  readonly unwindRecords: readonly AArch64ObjectUnwindRecord[];
  readonly byteProvenance: readonly AArch64ByteProvenanceRecord[];
  readonly factSpending: readonly AArch64FactSpendingRecord[];
}): AArch64BackendDeterministicMetadata {
  const sectionFingerprint = stableHash(
    stableJson(
      input.sections.map((section) => ({
        stableKey: section.stableKey,
        classKey: section.classKey,
        alignmentBytes: section.alignmentBytes,
        bytes: section.bytes,
        fragments: section.fragments.map((fragment) => ({
          stableKey: fragment.stableKey,
          sectionKey: fragment.sectionKey,
          startOffsetBytes: fragment.startOffsetBytes,
          sizeBytes: fragment.sizeBytes,
        })),
      })),
    ),
  );
  const symbolFingerprint = stableHash(
    stableJson(
      input.symbols.map((symbol) => ({
        kind: symbol.kind,
        stableKey: symbol.stableKey,
        ...(symbol.kind === "external-declaration"
          ? { linkageName: symbol.linkageName }
          : {
              sectionKey: symbol.sectionKey,
              offsetBytes: symbol.offsetBytes,
              ...(symbol.kind === "global-definition" ? { linkageName: symbol.linkageName } : {}),
            }),
      })),
    ),
  );
  const relocationFingerprint = stableHash(
    stableJson(
      input.relocations.map((entry) => ({
        stableKey: entry.stableKey,
        sectionKey: entry.sectionKey,
        offsetBytes: entry.offsetBytes,
        widthBytes: entry.widthBytes,
        family: entry.family,
        target: entry.target,
        targetSymbol: entry.targetSymbol,
        addend: entry.addend.toString(),
        instructionPatch: entry.instructionPatch,
        pairedRelocationKey: entry.pairedRelocationKey,
        linkerVeneer: entry.linkerVeneer,
      })),
    ),
  );
  const literalPoolFingerprint = stableHash(
    stableJson(
      input.literalPools.map((entry) => ({
        stableKey: entry.stableKey,
        sectionKey: entry.sectionKey,
        offsetBytes: entry.offsetBytes,
        data: entry.data,
        users: entry.users.map((user) => ({
          stableKey: user.stableKey,
          useOffsetBytes: user.useOffsetBytes,
          maxReachBytes: user.maxReachBytes,
        })),
      })),
    ),
  );
  const byteProvenanceFingerprint = stableHash(
    stableJson(
      input.byteProvenance.map((entry) => ({
        stableKey: entry.stableKey,
        sectionKey: entry.sectionKey,
        startOffsetBytes: entry.startOffsetBytes,
        byteLength: entry.byteLength,
        source: entry.source,
        factFamilies: entry.factFamilies,
        machineSubjectKey: entry.machineSubjectKey,
      })),
    ),
  );

  const moduleFingerprint = stableHash(
    stableJson({
      targetBackendSurfaceFingerprint: input.targetBackendSurfaceFingerprint,
      closedImagePlanFingerprint: input.closedImagePlanFingerprint,
      sectionFingerprint,
      symbolFingerprint,
      relocationFingerprint,
      literalPoolFingerprint,
      byteProvenanceFingerprint,
      veneers: input.veneers.map((entry) => ({
        stableKey: entry.stableKey,
        sectionKey: entry.sectionKey,
        targetKey: entry.targetKey,
      })),
      unwindRecords: input.unwindRecords.map((entry) => ({
        stableKey: entry.stableKey,
        sectionKey: entry.sectionKey,
        frameShape: entry.frameShape,
        frameSizeBytes: entry.frameSizeBytes,
        savedRegisters: entry.savedRegisters,
      })),
      factSpending: input.factSpending.map((entry) => ({
        stableKey: entry.stableKey,
        authority: entry.authority,
        payload: entry.payload,
      })),
      recordCounts: {
        sections: input.sections.length,
        symbols: input.symbols.length,
        relocations: input.relocations.length,
        literalPools: input.literalPools.length,
        veneers: input.veneers.length,
        unwindRecords: input.unwindRecords.length,
        byteProvenanceRecords: input.byteProvenance.length,
        factSpendingRecords: input.factSpending.length,
      },
    }),
  );

  return Object.freeze({
    schema: "aarch64-object-module",
    schemaVersion: "1",
    sectionFingerprint,
    symbolFingerprint,
    relocationFingerprint,
    literalPoolFingerprint,
    byteProvenanceFingerprint,
    recordCounts: Object.freeze({
      sections: input.sections.length,
      symbols: input.symbols.length,
      relocations: input.relocations.length,
      literalPools: input.literalPools.length,
      veneers: input.veneers.length,
      unwindRecords: input.unwindRecords.length,
      byteProvenanceRecords: input.byteProvenance.length,
      factSpendingRecords: input.factSpending.length,
    }),
    moduleFingerprint,
  });
}

function normalizeAndFreezeRecords<RecordValue extends { readonly stableKey: string }>(
  records: readonly RecordValue[],
  label: string,
  stableKeyOf: (record: RecordValue) => string,
): readonly RecordValue[] {
  const sorted = Object.freeze(
    [...records].sort((left, right) =>
      compareCodeUnitStrings(stableKeyOf(left), stableKeyOf(right)),
    ),
  );
  const seen = new Set<string>();

  for (const entry of sorted) {
    const key = stableKeyOf(entry);
    if (seen.has(key)) {
      throw new RangeError(`Conflicting ${label} stable key: ${key}.`);
    }
    seen.add(key);
  }

  return sorted;
}

function normalizeAndFreezeByteProvenance(
  records: readonly AArch64ByteProvenanceRecord[],
  sections: readonly AArch64ObjectSection[],
): readonly AArch64ByteProvenanceRecord[] {
  const normalized = normalizeAndFreezeRecords(
    records.map((entry) =>
      aarch64ObjectByteProvenance({
        stableKey: entry.stableKey,
        sectionKey: entry.sectionKey,
        startOffsetBytes: entry.startOffsetBytes,
        byteLength: entry.byteLength,
        source: entry.source,
        factFamilies: entry.factFamilies,
        machineSubjectKey: entry.machineSubjectKey,
      }),
    ),
    "byte-provenance",
    (entry) => entry.stableKey,
  );
  verifyByteProvenanceCoverage({
    sections,
    byteProvenance: normalized,
  });
  return Object.freeze(
    [...normalized].sort((left, right) => {
      const sectionOrder = compareCodeUnitStrings(left.sectionKey, right.sectionKey);
      if (sectionOrder !== 0) return sectionOrder;
      return left.startOffsetBytes - right.startOffsetBytes;
    }),
  );
}

function validateSectionCrossChecks(input: {
  readonly sections: readonly AArch64ObjectSection[];
  readonly symbols: readonly AArch64ObjectSymbol[];
  readonly relocations: readonly AArch64ObjectRelocation[];
  readonly literalPools: readonly AArch64ObjectLiteralPoolEntry[];
}): void {
  const sectionLengths = new Map<string, number>();
  for (const section of input.sections) {
    sectionLengths.set(section.stableKey, section.bytes.length);
  }

  for (const symbol of input.symbols) {
    if (symbol.kind === "external-declaration") continue;
    const sectionLength = sectionLengths.get(symbol.sectionKey);
    if (sectionLength === undefined) {
      throw new RangeError(`Symbol references unknown section: ${symbol.sectionKey}`);
    }
    if (symbol.offsetBytes > sectionLength) {
      throw new RangeError(`Symbol offset exceeds section length: ${symbol.stableKey}`);
    }
  }

  for (const relocation of input.relocations) {
    const sectionLength = sectionLengths.get(relocation.sectionKey);
    if (sectionLength === undefined) {
      throw new RangeError(`Relocation references unknown section: ${relocation.sectionKey}`);
    }
    if (relocation.offsetBytes + relocation.widthBytes > sectionLength) {
      throw new RangeError(`Relocation exceeds section length: ${relocation.stableKey}`);
    }
  }

  for (const literalPool of input.literalPools) {
    const sectionLength = sectionLengths.get(literalPool.sectionKey);
    if (sectionLength === undefined) {
      throw new RangeError(`Literal pool references unknown section: ${literalPool.sectionKey}`);
    }
    if (literalPool.offsetBytes + literalPool.data.length > sectionLength) {
      throw new RangeError(`Literal pool exceeds section length: ${literalPool.stableKey}`);
    }
  }

  for (const section of input.sections) {
    for (const fragment of section.fragments) {
      if (fragment.startOffsetBytes + fragment.sizeBytes > section.bytes.length) {
        throw new RangeError(`Section fragment exceeds section length: ${fragment.stableKey}`);
      }
    }
  }
}

function verifyObjectModuleInputFingerprints(input: {
  readonly targetBackendSurfaceFingerprint: string;
  readonly closedImagePlanFingerprint: string;
}): void {
  if (input.targetBackendSurfaceFingerprint.length === 0) {
    throw new RangeError("targetBackendSurfaceFingerprint must be non-empty.");
  }
  if (input.closedImagePlanFingerprint.length === 0) {
    throw new RangeError("closedImagePlanFingerprint must be non-empty.");
  }
}

function verifyByteProvenanceCoverage(input: {
  readonly sections: readonly AArch64ObjectSection[];
  readonly byteProvenance: readonly AArch64ByteProvenanceRecord[];
}): void {
  const bySection = new Map<string, AArch64ByteProvenanceRecord[]>();

  for (const record of input.byteProvenance) {
    const sectionLength = input.sections.find((section) => section.stableKey === record.sectionKey)
      ?.bytes.length;
    if (sectionLength === undefined) {
      throw new RangeError(`Byte provenance references unknown section: ${record.sectionKey}`);
    }
    if (record.startOffsetBytes + record.byteLength > sectionLength) {
      throw new RangeError(`Byte provenance exceeds section length: ${record.sectionKey}`);
    }

    const records = bySection.get(record.sectionKey) ?? [];
    records.push(record);
    bySection.set(record.sectionKey, records);
  }

  for (const section of input.sections) {
    const records = (bySection.get(section.stableKey) ?? []).sort(
      (left, right) => left.startOffsetBytes - right.startOffsetBytes,
    );

    if (section.bytes.length === 0) {
      if (records.length > 0) {
        continue;
      }
      continue;
    }

    if (records.length === 0) {
      throw new RangeError(`Missing byte provenance records for section: ${section.stableKey}`);
    }

    let cursor = 0;
    for (const record of records) {
      if (record.startOffsetBytes !== cursor) {
        throw new RangeError(`Byte provenance coverage gap at: ${section.stableKey}`);
      }
      cursor += record.byteLength;
    }
    if (cursor !== section.bytes.length) {
      throw new RangeError(
        `Byte provenance does not fully cover section: ${section.stableKey} ${cursor}/${section.bytes.length}`,
      );
    }
  }
}

function defaultByteProvenanceFromSections(
  sections: readonly AArch64ObjectSection[],
): readonly AArch64ByteProvenanceRecord[] {
  return sections.flatMap((section) =>
    section.bytes.length === 0
      ? []
      : [
          aarch64ObjectByteProvenance({
            stableKey: `coverage:${section.stableKey}`,
            sectionKey: section.stableKey,
            startOffsetBytes: 0,
            byteLength: section.bytes.length,
            source: "object-module",
          }),
        ],
  );
}

function freezeBytes(values: Uint8Array | readonly number[]): Uint8Array {
  const bytes = Uint8Array.from(values);
  for (const byteValue of bytes) {
    if (!Number.isInteger(byteValue) || byteValue < 0 || byteValue > 0xff) {
      throw new RangeError("byte values must be integers in the range 0..255.");
    }
  }
  return bytes;
}

export function objectModuleSortDiagnostics(input: {
  readonly diagnostics: readonly AArch64BackendDiagnostic[];
}): readonly AArch64BackendDiagnostic[] {
  return sortAArch64BackendDiagnostics(input.diagnostics);
}

export function objectModuleDiagnostic(input: {
  readonly code: AArch64BackendDiagnosticCode;
  readonly ownerKey: string;
  readonly rootCauseKey: string;
  readonly stableDetail: string;
}): AArch64BackendDiagnostic {
  return aarch64BackendDiagnostic(input);
}
