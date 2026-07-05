import { compareCodeUnitStrings } from "../shared/deterministic-sort";
import { stableHash, stableJson } from "../shared/stable-json";
import type { LinkerVerificationSummary } from "./diagnostics";
import type { AArch64InternalRelocationFamily } from "../target/aarch64/backend/object/relocation-records";

export interface LinkedImageInputModule {
  readonly moduleKey: string;
  readonly moduleFingerprint: string;
  readonly syntheticProviderKey?: string;
}

export interface LinkedImageSection {
  readonly stableKey: string;
  readonly classKey: string;
  readonly flags: number;
  readonly alignmentBytes: number;
  readonly rva: number;
  readonly virtualSizeBytes: number;
  readonly bytes: Uint8Array;
  readonly contributions: readonly SectionContribution[];
}

export interface SectionContribution {
  readonly stableKey: string;
  readonly sourceModuleKey: string;
  readonly sourceObjectSectionKey: string;
  readonly sourceObjectSectionClass: string;
  readonly outputSectionKey: string;
  readonly offsetBytes: number;
  readonly sizeBytes: number;
  readonly alignmentBytes: number;
}

export interface ResolvedImageSymbol {
  readonly symbolKey: string;
  readonly linkageName?: string;
  readonly binding: "local" | "global";
  readonly sourceModuleKey: string;
  readonly sectionKey: string;
  readonly contributionKey: string;
  readonly rva: number;
  readonly objectOffsetBytes: number;
}

export interface AppliedRelocation {
  readonly relocationKey: string;
  readonly sourceModuleKey: string;
  readonly family: AArch64InternalRelocationFamily;
  readonly patchSectionKey: string;
  readonly patchRva: number;
  readonly targetSymbolKey: string;
  readonly targetRva: number;
  readonly addend: bigint;
  readonly accessScaleBytes?: number;
  readonly expectedEncodedValue: bigint;
  readonly patchedBytes: Uint8Array;
  readonly baseRelocationKey?: string;
}

export interface ImageBaseRelocation {
  readonly stableKey: string;
  readonly kind: "dir64" | "highlow" | "target-specific";
  readonly sectionKey: string;
  readonly rva: number;
  readonly widthBytes: number;
  readonly sourceRelocationKey: string;
}

export interface AArch64LinkedImageEntry {
  readonly loaderEntryLinkageName: string;
  readonly loaderEntryRva: number;
  readonly wrelaBootLinkageName: string;
  readonly wrelaBootRva: number;
}

export interface LinkedUnwindRecord {
  readonly stableKey: string;
  readonly functionSymbolKey: string;
  readonly functionStartRva: number;
  readonly functionEndRva: number;
  readonly unwindInfoSectionKey: string;
  readonly unwindInfoRva: number;
}

export interface LinkedDataDirectorySource {
  readonly stableKey: string;
  readonly directoryKind: "exception" | "base-relocation" | "debug";
  readonly sectionKey: string;
  readonly rva: number;
  readonly sizeBytes: number;
}

export interface LinkedByteProvenance {
  readonly stableKey: string;
  readonly sectionKey: string;
  readonly rva: number;
  readonly byteLength: number;
  readonly sourceModuleKey?: string;
  readonly sourceObjectSectionKey?: string;
  readonly sourceObjectProvenanceKey?: string;
  readonly sourceRelocationKey?: string;
  readonly sourceSyntheticObjectKey?: string;
  readonly factFamilies: readonly string[];
  readonly machineSubjectKey?: string;
}

export interface LinkedFactSpendingRecord {
  readonly stableKey: string;
  readonly authority: string;
  readonly payload: string;
  readonly sourceModuleKeys: readonly string[];
}

export interface AArch64LinkedImageDeterministicMetadata {
  readonly schema: "wrela.linked-image-layout";
  readonly schemaVersion: 1;
  readonly inputFingerprint: string;
  readonly sectionFingerprint: string;
  readonly symbolFingerprint: string;
  readonly relocationFingerprint: string;
  readonly baseRelocationFingerprint: string;
  readonly entryFingerprint: string;
  readonly provenanceFingerprint: string;
  readonly layoutFingerprint: string;
}

export interface AArch64LinkedImageLayout {
  readonly targetKey: string;
  readonly targetFingerprint: string;
  readonly targetPolicyFingerprint: string;
  readonly inputModules: readonly LinkedImageInputModule[];
  readonly sections: readonly LinkedImageSection[];
  readonly symbols: readonly ResolvedImageSymbol[];
  readonly appliedRelocations: readonly AppliedRelocation[];
  readonly baseRelocations: readonly ImageBaseRelocation[];
  readonly entry: AArch64LinkedImageEntry;
  readonly unwindRecords: readonly LinkedUnwindRecord[];
  readonly dataDirectorySources: readonly LinkedDataDirectorySource[];
  readonly provenance: readonly LinkedByteProvenance[];
  readonly factSpending: readonly LinkedFactSpendingRecord[];
  readonly verification: LinkerVerificationSummary;
  readonly deterministicMetadata: AArch64LinkedImageDeterministicMetadata;
}

export interface CreateAArch64LinkedImageLayoutInput {
  readonly targetKey: string;
  readonly targetFingerprint: string;
  readonly targetPolicyFingerprint: string;
  readonly inputModules: readonly LinkedImageInputModule[];
  readonly sections: readonly LinkedImageSectionInput[];
  readonly symbols: readonly ResolvedImageSymbol[];
  readonly appliedRelocations: readonly AppliedRelocationInput[];
  readonly baseRelocations: readonly ImageBaseRelocation[];
  readonly entry: AArch64LinkedImageEntry;
  readonly unwindRecords: readonly LinkedUnwindRecord[];
  readonly dataDirectorySources: readonly LinkedDataDirectorySource[];
  readonly provenance: readonly LinkedByteProvenance[];
  readonly factSpending: readonly LinkedFactSpendingRecord[];
  readonly verification: LinkerVerificationSummary;
}

export type LinkedImageSectionInput = Omit<LinkedImageSection, "bytes"> & {
  readonly bytes: Uint8Array | readonly number[];
};

export type AppliedRelocationInput = Omit<AppliedRelocation, "patchedBytes"> & {
  readonly patchedBytes: Uint8Array | readonly number[];
};

export function createAArch64LinkedImageLayout(
  input: CreateAArch64LinkedImageLayoutInput,
): AArch64LinkedImageLayout {
  const inputModules = sortByStableKey(
    input.inputModules.map((inputModule) => deepFreeze({ ...inputModule })),
    (inputModule) => inputModule.moduleKey,
    "input module",
  );
  const sections = preserveOrderWithUniqueStableKeys(
    input.sections.map((section) =>
      deepFreeze({
        ...section,
        bytes: Uint8Array.from(section.bytes),
        contributions: sortByStableKey(
          section.contributions.map((contribution) => deepFreeze({ ...contribution })),
          (contribution) => contribution.stableKey,
          "section contribution",
        ),
      }),
    ),
    (section) => section.stableKey,
    "section",
  );
  const symbols = sortByStableKey(
    input.symbols.map((symbol) => deepFreeze({ ...symbol })),
    (symbol) => symbol.symbolKey,
    "symbol",
  );
  const appliedRelocations = sortByStableKey(
    input.appliedRelocations.map((relocation) =>
      deepFreeze({
        ...relocation,
        patchedBytes: Uint8Array.from(relocation.patchedBytes),
      }),
    ),
    (relocation) => relocation.relocationKey,
    "applied relocation",
  );
  const baseRelocations = sortBaseRelocations(
    input.baseRelocations.map((relocation) => deepFreeze({ ...relocation })),
  );
  const entry = deepFreeze({ ...input.entry });
  const unwindRecords = sortByStableKey(
    input.unwindRecords.map((record) => deepFreeze({ ...record })),
    (record) => record.stableKey,
    "unwind record",
  );
  const dataDirectorySources = sortByStableKey(
    input.dataDirectorySources.map((source) => deepFreeze({ ...source })),
    (source) => source.stableKey,
    "data directory source",
  );
  const provenance = sortByStableKey(
    input.provenance.map((record) =>
      deepFreeze({
        ...record,
        factFamilies: sortStrings(record.factFamilies),
      }),
    ),
    (record) => record.stableKey,
    "provenance",
  );
  const factSpending = sortByStableKey(
    input.factSpending.map((record) =>
      deepFreeze({
        ...record,
        sourceModuleKeys: sortStrings(record.sourceModuleKeys),
      }),
    ),
    (record) => record.stableKey,
    "fact spending",
  );
  const verification = deepFreeze({
    runs: sortByStableKey(
      input.verification.runs.map((run) => deepFreeze({ ...run })),
      verifierRunStableKey,
      "verifier run",
    ),
  });

  const inputFingerprint = inputFingerprintFor(inputModules);
  const sectionFingerprint = sectionFingerprintFor(sections);
  const symbolFingerprint = symbolFingerprintFor(symbols);
  const relocationFingerprint = relocationFingerprintFor(appliedRelocations);
  const baseRelocationFingerprint = baseRelocationFingerprintFor(baseRelocations);
  const entryFingerprint = entryFingerprintFor(entry);
  const provenanceFingerprint = provenanceFingerprintFor({
    dataDirectorySources,
    factSpending,
    provenance,
    unwindRecords,
  });

  const layoutFingerprint = layoutFingerprintFor({
    schema: "wrela.linked-image-layout",
    schemaVersion: 1,
    targetKey: input.targetKey,
    targetFingerprint: input.targetFingerprint,
    targetPolicyFingerprint: input.targetPolicyFingerprint,
    inputFingerprint,
    sectionFingerprint,
    symbolFingerprint,
    relocationFingerprint,
    baseRelocationFingerprint,
    entryFingerprint,
    provenanceFingerprint,
    verification,
  });

  const deterministicMetadata = deepFreeze({
    schema: "wrela.linked-image-layout" as const,
    schemaVersion: 1 as const,
    inputFingerprint,
    sectionFingerprint,
    symbolFingerprint,
    relocationFingerprint,
    baseRelocationFingerprint,
    entryFingerprint,
    provenanceFingerprint,
    layoutFingerprint,
  });

  return deepFreeze({
    targetKey: input.targetKey,
    targetFingerprint: input.targetFingerprint,
    targetPolicyFingerprint: input.targetPolicyFingerprint,
    inputModules,
    sections,
    symbols,
    appliedRelocations,
    baseRelocations,
    entry,
    unwindRecords,
    dataDirectorySources,
    provenance,
    factSpending,
    verification,
    deterministicMetadata,
  });
}

function sortByStableKey<Value>(
  values: readonly Value[],
  stableKey: (value: Value) => string,
  recordKind: string,
): readonly Value[] {
  const sortedValues = [...values].sort((left, right) =>
    compareCodeUnitStrings(stableKey(left), stableKey(right)),
  );

  let previousKey: string | undefined;
  for (const value of sortedValues) {
    const key = stableKey(value);
    if (key === previousKey) {
      throw new RangeError(`Conflicting ${recordKind} stable key: ${key}.`);
    }
    previousKey = key;
  }

  return Object.freeze(sortedValues);
}

function preserveOrderWithUniqueStableKeys<Value>(
  values: readonly Value[],
  stableKey: (value: Value) => string,
  recordKind: string,
): readonly Value[] {
  const stableKeys = new Set<string>();
  for (const value of values) {
    const key = stableKey(value);
    if (stableKeys.has(key)) {
      throw new RangeError(`Conflicting ${recordKind} stable key: ${key}.`);
    }
    stableKeys.add(key);
  }
  return Object.freeze([...values]);
}

function sortStrings(values: readonly string[]): readonly string[] {
  return Object.freeze([...values].sort(compareCodeUnitStrings));
}

function sortBaseRelocations(
  relocations: readonly ImageBaseRelocation[],
): readonly ImageBaseRelocation[] {
  const sortedRelocations = [...relocations].sort((left, right) => {
    const rvaComparison = left.rva - right.rva;
    if (rvaComparison !== 0) return rvaComparison;

    const sectionComparison = compareCodeUnitStrings(left.sectionKey, right.sectionKey);
    if (sectionComparison !== 0) return sectionComparison;

    const sourceComparison = compareCodeUnitStrings(
      left.sourceRelocationKey,
      right.sourceRelocationKey,
    );
    return sourceComparison === 0
      ? compareCodeUnitStrings(left.stableKey, right.stableKey)
      : sourceComparison;
  });

  let previousStableKey: string | undefined;
  for (const relocation of [...sortedRelocations].sort((left, right) =>
    compareCodeUnitStrings(left.stableKey, right.stableKey),
  )) {
    if (relocation.stableKey === previousStableKey) {
      throw new RangeError(`Conflicting base relocation stable key: ${relocation.stableKey}.`);
    }
    previousStableKey = relocation.stableKey;
  }

  return Object.freeze(sortedRelocations);
}

function verifierRunStableKey(run: LinkerVerificationSummary["runs"][number]): string {
  return stableJson([
    run.verifierKey,
    run.runKey,
    run.status,
    Object.hasOwn(run, "stableDetail"),
    run.stableDetail ?? null,
  ]);
}

function inputFingerprintFor(inputModules: readonly LinkedImageInputModule[]): string {
  return stableHash(stableJson(inputModules));
}

function sectionFingerprintFor(sections: readonly LinkedImageSection[]): string {
  return stableHash(stableJson(sections));
}

function symbolFingerprintFor(symbols: readonly ResolvedImageSymbol[]): string {
  return stableHash(stableJson(symbols));
}

function relocationFingerprintFor(appliedRelocations: readonly AppliedRelocation[]): string {
  return stableHash(stableJson(appliedRelocations));
}

function baseRelocationFingerprintFor(baseRelocations: readonly ImageBaseRelocation[]): string {
  return stableHash(stableJson(baseRelocations));
}

function entryFingerprintFor(entry: AArch64LinkedImageEntry): string {
  return stableHash(stableJson(entry));
}

interface ProvenanceFingerprintPayload {
  readonly dataDirectorySources: readonly LinkedDataDirectorySource[];
  readonly factSpending: readonly LinkedFactSpendingRecord[];
  readonly provenance: readonly LinkedByteProvenance[];
  readonly unwindRecords: readonly LinkedUnwindRecord[];
}

function provenanceFingerprintFor(payload: ProvenanceFingerprintPayload): string {
  return stableHash(stableJson(payload));
}

interface LayoutFingerprintPayload {
  readonly schema: "wrela.linked-image-layout";
  readonly schemaVersion: 1;
  readonly targetKey: string;
  readonly targetFingerprint: string;
  readonly targetPolicyFingerprint: string;
  readonly inputFingerprint: string;
  readonly sectionFingerprint: string;
  readonly symbolFingerprint: string;
  readonly relocationFingerprint: string;
  readonly baseRelocationFingerprint: string;
  readonly entryFingerprint: string;
  readonly provenanceFingerprint: string;
  readonly verification: LinkerVerificationSummary;
}

function layoutFingerprintFor(payload: LayoutFingerprintPayload): string {
  return stableHash(stableJson(payload));
}

function deepFreeze<Value>(value: Value): Value {
  if (value === null || typeof value !== "object") return value;
  if (value instanceof Uint8Array) return value;

  for (const propertyName of Object.getOwnPropertyNames(value)) {
    const propertyValue = (value as Record<string, unknown>)[propertyName];
    deepFreeze(propertyValue);
  }

  return Object.freeze(value);
}
