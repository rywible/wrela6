import { compareCodeUnitStrings } from "../../../../shared/deterministic-sort";
import {
  aarch64BackendDiagnostic,
  backendError,
  backendOk,
  type AArch64BackendDiagnostic,
  type AArch64BackendResult,
} from "../api/diagnostics";
import {
  verifyAArch64SecurityLabelConservation,
  type AArch64SecurityLabelConservationInput,
} from "../facts/security-label-conservation";
import {
  AARCH64_OBJECT_SECTION_CLASS_EXECUTABLE_TEXT,
  type AArch64ObjectModule,
} from "../object/object-module";
import { RPI5_BACKEND_CATALOGS } from "../catalogs/rpi5-backend-catalog-data";
import type { AArch64BackendTargetSurface } from "../api/backend-target-surface";
import type {
  AArch64EncodingCatalog,
  AArch64EncodingCatalogEntry,
  AArch64RelocationCatalog,
} from "../api/backend-catalog-interfaces";
import {
  AARCH64_BRANCH26_REACH_BYTES,
  aarch64RelocationReachBytes,
  isWithinAArch64SignedScaledBranchReach,
} from "../object/branch-reach";
import { wordToU32Le } from "../object/encoding-core";
import { isAArch64InstructionRelocationFamily } from "../object/relocation-records";
import {
  verifyRelocationContract,
  verifySectionClasses,
  verifySymbolContract,
} from "./object-verifier-contract";
import { verifyUniqueByteProvenanceStableKeys } from "./object-verifier-byte-provenance";

export interface AArch64ObjectVerifierInput {
  readonly objectModule: AArch64ObjectModule;
  readonly target?: AArch64BackendTargetSurface;
  readonly encodingCatalog?: AArch64EncodingCatalog;
  readonly relocationCatalog?: AArch64RelocationCatalog;
  readonly security?: AArch64SecurityLabelConservationInput;
  readonly staleFactSubjectKeys?: readonly string[];
}

export interface AArch64ObjectVerificationReport {
  readonly checkedSections: readonly string[];
  readonly checkedRelocations: readonly string[];
}

type AArch64ByteProvenanceRecord = AArch64ObjectModule["byteProvenance"][number];

interface AArch64CatalogPatternOwner {
  readonly entry: AArch64EncodingCatalogEntry;
  readonly mask: number;
  readonly value: number;
}

interface AArch64ObjectVerifierIndexes {
  readonly symbolByStableKey: ReadonlyMap<string, AArch64ObjectModule["symbols"][number]>;
  readonly symbolsByLinkageName: ReadonlyMap<
    string,
    readonly AArch64ObjectModule["symbols"][number][]
  >;
  readonly byteProvenanceBySection: ReadonlyMap<string, readonly AArch64ByteProvenanceRecord[]>;
  readonly byteProvenanceBySectionAndStableKey: ReadonlyMap<
    string,
    ReadonlyMap<string, AArch64ByteProvenanceRecord>
  >;
  readonly catalogPatterns: readonly AArch64CatalogPatternOwner[];
}

export function verifyAArch64ObjectModule(
  input: AArch64ObjectVerifierInput,
): AArch64BackendResult<AArch64ObjectVerificationReport> {
  const diagnostics: AArch64BackendDiagnostic[] = [];
  const module = input.objectModule;
  const encodingCatalog =
    input.encodingCatalog ?? input.target?.encodingCatalog ?? RPI5_BACKEND_CATALOGS.encodingCatalog;
  const relocationCatalog =
    input.relocationCatalog ??
    input.target?.relocationCatalog ??
    RPI5_BACKEND_CATALOGS.relocationCatalog;
  const sections = new Map(module.sections.map((section) => [String(section.stableKey), section]));
  const symbols = new Map(module.symbols.map((symbol) => [String(symbol.stableKey), symbol]));
  const indexes = objectVerifierIndexes(module, encodingCatalog);
  const literalPoolRangesBySection = literalPoolRanges(module);
  const alignmentPaddingRangesBySection = alignmentPaddingRanges(module);

  diagnostics.push(
    ...verifySorted(
      "section",
      module.sections.map((section) => String(section.stableKey)),
    ),
  );
  diagnostics.push(
    ...verifySorted(
      "symbol",
      module.symbols.map((symbol) => String(symbol.stableKey)),
    ),
  );
  diagnostics.push(
    ...verifySorted(
      "relocation",
      module.relocations.map((relocation) => String(relocation.stableKey)),
    ),
  );
  diagnostics.push(...verifySymbolPlacement(module, sections));
  diagnostics.push(...verifySectionClasses(module));
  diagnostics.push(...verifySymbolContract(module));
  diagnostics.push(...verifyUniqueLinkageNames(indexes));
  diagnostics.push(...verifyUniqueByteProvenanceStableKeys(module));

  for (const section of module.sections) {
    if (!isExecutableTextSection(section)) continue;
    const literalPoolRangesForSection =
      literalPoolRangesBySection.get(String(section.stableKey)) ?? [];
    const alignmentPaddingRangesForSection =
      alignmentPaddingRangesBySection.get(String(section.stableKey)) ?? [];
    for (let offset = 0; offset < section.bytes.length; ) {
      const literalPoolRange = literalPoolRangesForSection.find(
        (range) => offset >= range.start && offset < range.end,
      );
      if (literalPoolRange !== undefined) {
        offset = literalPoolRange.end;
        continue;
      }
      const alignmentPaddingRange = alignmentPaddingRangesForSection.find(
        (range) => offset >= range.start && offset < range.end,
      );
      if (alignmentPaddingRange !== undefined) {
        offset = alignmentPaddingRange.end;
        continue;
      }
      if (offset + 4 > section.bytes.length) {
        diagnostics.push(
          diagnostic(
            `object-verifier:section-size-not-instructions:${section.stableKey}:${section.bytes.length}`,
          ),
        );
        break;
      }
      const word = section.bytes.slice(offset, offset + 4);
      if (word.length === 4 && decodeAArch64CatalogOpcode(word, indexes) === undefined) {
        diagnostics.push(
          diagnostic(`object-verifier:unknown-encoding:${section.stableKey}:offset:${offset}`),
        );
      }
      offset += 4;
    }
  }

  for (const relocation of module.relocations) {
    diagnostics.push(...verifyRelocationContract(relocation, module));
    const section = sections.get(String(relocation.sectionKey));
    if (section === undefined) {
      diagnostics.push(
        diagnostic(
          `object-verifier:relocation-section-missing:${relocation.stableKey}:${relocation.sectionKey}`,
        ),
      );
      continue;
    }
    if (relocation.offsetBytes % 4 !== 0) {
      diagnostics.push(
        diagnostic(
          `object-verifier:relocation-offset-unaligned:${relocation.stableKey}:${relocation.offsetBytes}`,
        ),
      );
    }
    if (isAArch64InstructionRelocationFamily(relocation.family) && relocation.widthBytes !== 4) {
      diagnostics.push(
        diagnostic(
          `object-verifier:relocation-width-invalid:${relocation.stableKey}:${relocation.family}:${relocation.widthBytes}`,
        ),
      );
    }
    if (relocation.offsetBytes + relocation.widthBytes > section.bytes.length) {
      diagnostics.push(
        diagnostic(
          `object-verifier:relocation-patch-out-of-range:${relocation.sectionKey}:offset:${relocation.offsetBytes}:size:${section.bytes.length}`,
        ),
      );
    }
    diagnostics.push(...verifyRelocationPatchOwnerRegion(relocation, section, indexes));
    const relocationMapping = relocationCatalog.mappingFor(relocation.family);
    if (relocationMapping === undefined) {
      diagnostics.push(
        diagnostic(
          `object-verifier:relocation-family-unmapped:${relocation.stableKey}:${relocation.family}`,
        ),
      );
    } else if (isAArch64InstructionRelocationFamily(relocation.family)) {
      diagnostics.push(...verifyRelocationPatchOwner(relocation, section.bytes, indexes));
    }
    const targetResolution = resolveRelocationTargetSymbol(relocation, indexes);
    if (targetResolution.kind === "missing") {
      diagnostics.push(
        diagnostic(
          `object-verifier:symbol-missing:${relocation.stableKey}:${relocationTargetDiagnosticKey(relocation)}`,
        ),
      );
    } else {
      if (targetResolution.kind === "ambiguous") {
        diagnostics.push(
          diagnostic(
            `object-verifier:linkage-target-ambiguous:${relocation.stableKey}:${targetResolution.linkageName}:${targetResolution.symbolKeys.join(",")}`,
          ),
        );
        continue;
      }
      diagnostics.push(
        ...verifyRelocationRangeAndAddendPolicy(relocation, targetResolution.symbol, section),
      );
    }
  }

  diagnostics.push(...verifyLiteralPoolRanges(module));
  for (const literalPool of module.literalPools) {
    const section = sections.get(String(literalPool.sectionKey));
    if (section === undefined) {
      diagnostics.push(
        diagnostic(
          `object-verifier:literal-pool-section-missing:${literalPool.stableKey}:${literalPool.sectionKey}`,
        ),
      );
      continue;
    }
    if (literalPool.data.length === 0) {
      diagnostics.push(diagnostic(`object-verifier:literal-pool-empty:${literalPool.stableKey}`));
    }
    if (literalPool.offsetBytes + literalPool.data.length > section.bytes.length) {
      diagnostics.push(
        diagnostic(
          `object-verifier:literal-pool-out-of-range:${literalPool.sectionKey}:offset:${literalPool.offsetBytes}:size:${section.bytes.length}`,
        ),
      );
      continue;
    }
    const actualBytes = section.bytes.slice(
      literalPool.offsetBytes,
      literalPool.offsetBytes + literalPool.data.length,
    );
    if (!sameBytes(actualBytes, literalPool.data)) {
      diagnostics.push(
        diagnostic(`object-verifier:literal-pool-data-mismatch:${literalPool.stableKey}`),
      );
    }
    if (literalPoolHasSecretProvenance(indexes, literalPool)) {
      diagnostics.push(diagnostic(`object-verifier:literal-pool-secret:${literalPool.stableKey}`));
    }
    for (const user of literalPool.users) {
      const distanceBytes = Math.abs(literalPool.offsetBytes - user.useOffsetBytes);
      if (distanceBytes > user.maxReachBytes) {
        diagnostics.push(
          diagnostic(
            `object-verifier:literal-pool-reach-out-of-bounds:${literalPool.stableKey}:user:${user.stableKey}:distance:${distanceBytes}:limit:${user.maxReachBytes}`,
          ),
        );
      }
    }
  }

  for (const veneer of module.veneers) {
    const section = sections.get(String(veneer.sectionKey));
    if (section === undefined) {
      diagnostics.push(
        diagnostic(
          `object-verifier:veneer-section-missing:${veneer.stableKey}:${veneer.sectionKey}`,
        ),
      );
      continue;
    }
    const targetSymbol = symbols.get(veneer.targetKey);
    if (targetSymbol === undefined) {
      diagnostics.push(
        diagnostic(`object-verifier:veneer-target-missing:${veneer.stableKey}:${veneer.targetKey}`),
      );
    } else {
      diagnostics.push(...verifyVeneerRange(veneer, targetSymbol, indexes));
    }
    diagnostics.push(...verifyVeneerBytes(veneer, section, indexes));
    diagnostics.push(...verifyVeneerRelocation(veneer, module, indexes));
  }

  for (const unwind of module.unwindRecords) {
    if (!sections.has(String(unwind.sectionKey))) {
      diagnostics.push(
        diagnostic(
          `object-verifier:unwind-section-missing:${unwind.stableKey}:${unwind.sectionKey}`,
        ),
      );
    }
    const symbolKey = String(unwind.stableKey).startsWith("unwind:")
      ? String(unwind.stableKey).slice("unwind:".length)
      : undefined;
    if (symbolKey !== undefined && !symbols.has(symbolKey)) {
      diagnostics.push(
        diagnostic(`object-verifier:unwind-symbol-missing:${unwind.stableKey}:${symbolKey}`),
      );
    }
    if (!isKnownUnwindFrameShape(unwind.frameShape)) {
      diagnostics.push(
        diagnostic(
          `object-verifier:unwind-frame-shape-unknown:${unwind.stableKey}:${unwind.frameShape}`,
        ),
      );
    }
  }

  diagnostics.push(...verifyByteProvenance(module, indexes));
  for (const subjectKey of input.staleFactSubjectKeys ?? []) {
    diagnostics.push(diagnostic(`object-verifier:stale-fact-subject:${subjectKey}`));
  }

  if (input.security !== undefined) {
    const securityResult = verifyAArch64SecurityLabelConservation(input.security);
    if (securityResult.kind === "error") diagnostics.push(...securityResult.diagnostics);
  }

  if (diagnostics.length > 0) return backendError(diagnostics);
  return backendOk(
    Object.freeze({
      checkedSections: Object.freeze(module.sections.map((section) => String(section.stableKey))),
      checkedRelocations: Object.freeze(
        module.relocations.map((relocation) => String(relocation.stableKey)),
      ),
    }),
  );
}

function objectVerifierIndexes(
  module: AArch64ObjectModule,
  encodingCatalog: AArch64EncodingCatalog,
): AArch64ObjectVerifierIndexes {
  const symbolByStableKey = new Map(
    module.symbols.map((symbol) => [String(symbol.stableKey), symbol] as const),
  );
  const symbolsByLinkageName = new Map<string, AArch64ObjectModule["symbols"][number][]>();
  for (const symbol of module.symbols) {
    if (symbol.kind === "local-definition") continue;
    symbolsByLinkageName.set(symbol.linkageName, [
      ...(symbolsByLinkageName.get(symbol.linkageName) ?? []),
      symbol,
    ]);
  }
  const byteProvenanceBySection = new Map<string, AArch64ByteProvenanceRecord[]>();
  const byteProvenanceBySectionAndStableKey = new Map<
    string,
    Map<string, AArch64ByteProvenanceRecord>
  >();
  for (const record of module.byteProvenance) {
    const sectionKey = String(record.sectionKey);
    const records = byteProvenanceBySection.get(sectionKey) ?? [];
    records.push(record);
    byteProvenanceBySection.set(sectionKey, records);

    const recordsByStableKey =
      byteProvenanceBySectionAndStableKey.get(sectionKey) ??
      new Map<string, AArch64ByteProvenanceRecord>();
    if (!recordsByStableKey.has(record.stableKey)) {
      recordsByStableKey.set(record.stableKey, record);
    }
    byteProvenanceBySectionAndStableKey.set(sectionKey, recordsByStableKey);
  }

  const frozenBySection = new Map<string, readonly AArch64ByteProvenanceRecord[]>();
  for (const [sectionKey, records] of byteProvenanceBySection.entries()) {
    frozenBySection.set(
      sectionKey,
      Object.freeze(
        [...records].sort((left, right) => left.startOffsetBytes - right.startOffsetBytes),
      ),
    );
  }

  return Object.freeze({
    symbolByStableKey,
    symbolsByLinkageName: new Map(
      [...symbolsByLinkageName.entries()].map(([linkageName, symbols]) => [
        linkageName,
        Object.freeze(
          [...symbols].sort((left, right) =>
            compareCodeUnitStrings(String(left.stableKey), String(right.stableKey)),
          ),
        ),
      ]),
    ),
    byteProvenanceBySection: frozenBySection,
    byteProvenanceBySectionAndStableKey: new Map(
      [...byteProvenanceBySectionAndStableKey.entries()].map(([sectionKey, records]) => [
        sectionKey,
        new Map(records),
      ]),
    ),
    catalogPatterns: catalogPatternOwners(encodingCatalog),
  });
}

function verifyUniqueLinkageNames(
  indexes: AArch64ObjectVerifierIndexes,
): readonly AArch64BackendDiagnostic[] {
  const diagnostics: AArch64BackendDiagnostic[] = [];
  for (const [linkageName, symbols] of [...indexes.symbolsByLinkageName.entries()].sort(
    ([left], [right]) => compareCodeUnitStrings(left, right),
  )) {
    if (symbols.length <= 1) continue;
    diagnostics.push(
      diagnostic(
        `object-verifier:duplicate-linkage-name:${linkageName}:${symbols
          .map((symbol) => String(symbol.stableKey))
          .join(",")}`,
      ),
    );
  }
  return diagnostics;
}

function catalogPatternOwners(
  encodingCatalog: AArch64EncodingCatalog,
): readonly AArch64CatalogPatternOwner[] {
  return Object.freeze(
    encodingCatalog.entries.flatMap((entry) =>
      (entry.instructionWordPatterns ?? []).map((pattern) =>
        Object.freeze({
          entry,
          mask: pattern.mask,
          value: pattern.value,
        }),
      ),
    ),
  );
}

function byteProvenanceRecordsForSection(
  indexes: AArch64ObjectVerifierIndexes,
  sectionKey: unknown,
): readonly AArch64ByteProvenanceRecord[] {
  return indexes.byteProvenanceBySection.get(String(sectionKey)) ?? [];
}

function byteProvenanceRecordForStableKey(
  indexes: AArch64ObjectVerifierIndexes,
  sectionKey: unknown,
  stableKey: string,
): AArch64ByteProvenanceRecord | undefined {
  return indexes.byteProvenanceBySectionAndStableKey.get(String(sectionKey))?.get(stableKey);
}

function isExecutableTextSection(section: AArch64ObjectModule["sections"][number]): boolean {
  return section.classKey === AARCH64_OBJECT_SECTION_CLASS_EXECUTABLE_TEXT;
}

function verifyRelocationPatchOwner(
  relocation: AArch64ObjectModule["relocations"][number],
  sectionBytes: readonly number[],
  indexes: AArch64ObjectVerifierIndexes,
): readonly AArch64BackendDiagnostic[] {
  if (relocation.offsetBytes % 4 !== 0 || relocation.offsetBytes + 4 > sectionBytes.length) {
    return [];
  }
  const word = sectionBytes.slice(relocation.offsetBytes, relocation.offsetBytes + 4);
  const entry = decodeAArch64CatalogEntry(word, indexes, relocation.family);
  if (entry === undefined) return [];
  const opcode = entry.opcode;
  if (entry.relocationHole === undefined) {
    return [
      diagnostic(
        `object-verifier:relocation-owner-missing:${relocation.stableKey}:${relocation.family}:opcode:${opcode}`,
      ),
    ];
  }
  if (entry.relocationHole.family !== relocation.family) {
    return [
      diagnostic(
        `object-verifier:relocation-owner-family-mismatch:${relocation.stableKey}:${relocation.family}:opcode:${opcode}:expected:${entry.relocationHole.family}`,
      ),
    ];
  }
  const bitRange = relocation.instructionPatch?.bitRange;
  if (
    bitRange !== undefined &&
    (bitRange[0] !== entry.relocationHole.bitRange[0] ||
      bitRange[1] !== entry.relocationHole.bitRange[1])
  ) {
    return [
      diagnostic(
        `object-verifier:relocation-owner-bit-range-mismatch:${relocation.stableKey}:${relocation.family}:opcode:${opcode}:expected:${entry.relocationHole.bitRange[0]}-${entry.relocationHole.bitRange[1]}:actual:${bitRange[0]}-${bitRange[1]}`,
      ),
    ];
  }
  return [];
}

function verifySymbolPlacement(
  module: AArch64ObjectModule,
  sections: ReadonlyMap<string, AArch64ObjectModule["sections"][number]>,
): readonly AArch64BackendDiagnostic[] {
  const diagnostics: AArch64BackendDiagnostic[] = [];
  for (const symbol of module.symbols) {
    if (symbol.kind === "external-declaration") continue;
    const section = sections.get(String(symbol.sectionKey));
    if (section === undefined) {
      diagnostics.push(
        diagnostic(
          `object-verifier:symbol-section-missing:${symbol.stableKey}:${symbol.sectionKey}`,
        ),
      );
      continue;
    }
    if (symbol.offsetBytes < 0 || symbol.offsetBytes > section.bytes.length) {
      diagnostics.push(
        diagnostic(
          `object-verifier:symbol-offset-out-of-range:${symbol.stableKey}:${symbol.offsetBytes}:size:${section.bytes.length}`,
        ),
      );
    }
  }
  return diagnostics;
}

function verifyRelocationPatchOwnerRegion(
  relocation: AArch64ObjectModule["relocations"][number],
  section: AArch64ObjectModule["sections"][number],
  indexes: AArch64ObjectVerifierIndexes,
): readonly AArch64BackendDiagnostic[] {
  const patchEnd = relocation.offsetBytes + relocation.widthBytes;
  if (patchEnd > section.bytes.length) return [];
  const fragmentOwner = section.fragments.find(
    (fragment) =>
      relocation.offsetBytes >= fragment.startOffsetBytes &&
      patchEnd <= fragment.startOffsetBytes + fragment.sizeBytes,
  );
  if (fragmentOwner !== undefined) return [];
  const veneerOwner = byteProvenanceRecordsForSection(indexes, section.stableKey).find(
    (record) =>
      record.stableKey.startsWith("byte:veneer:") &&
      relocation.offsetBytes >= record.startOffsetBytes &&
      patchEnd <= record.startOffsetBytes + record.byteLength,
  );
  return veneerOwner === undefined
    ? [
        diagnostic(
          `object-verifier:relocation-patch-outside-fragment:${relocation.stableKey}:${relocation.sectionKey}:offset:${relocation.offsetBytes}`,
        ),
      ]
    : [];
}

function verifyRelocationRangeAndAddendPolicy(
  relocation: AArch64ObjectModule["relocations"][number],
  targetSymbol: AArch64ObjectModule["symbols"][number],
  section: AArch64ObjectModule["sections"][number],
): readonly AArch64BackendDiagnostic[] {
  const diagnostics: AArch64BackendDiagnostic[] = [];
  if (targetSymbol.kind === "external-declaration") return diagnostics;
  if (String(relocation.sectionKey) !== String(targetSymbol.sectionKey)) return diagnostics;
  const distanceBytes = targetSymbol.offsetBytes - relocation.offsetBytes;
  const reachBytes = aarch64RelocationReachBytes(relocation.family);
  if (
    reachBytes !== undefined &&
    !isWithinAArch64SignedScaledBranchReach(distanceBytes, reachBytes)
  ) {
    diagnostics.push(
      diagnostic(
        `object-verifier:relocation-range-out-of-bounds:${relocation.stableKey}:${relocation.family}:distance:${distanceBytes}:limit:${reachBytes}`,
      ),
    );
  }
  if (relocation.family !== "pageoffset-12a" && relocation.family !== "pageoffset-12l") {
    return diagnostics;
  }
  const expectedOffset = pageOffset12(targetSymbol.offsetBytes);
  if (expectedOffset === undefined) {
    diagnostics.push(
      diagnostic(
        `object-verifier:relocation-addend-out-of-range:${relocation.stableKey}:${relocation.family}:${targetSymbol.offsetBytes}`,
      ),
    );
    return diagnostics;
  }
  const encodedOffset = encodedPageOffset12(relocation, section.bytes);
  if (encodedOffset !== undefined && encodedOffset !== expectedOffset) {
    diagnostics.push(
      diagnostic(
        `object-verifier:relocation-pageoffset-mismatch:${relocation.stableKey}:${relocation.family}:encoded:${encodedOffset}:expected:${expectedOffset}`,
      ),
    );
  }
  return diagnostics;
}

function pageOffset12(offsetBytes: number): number | undefined {
  if (offsetBytes < 0) return undefined;
  return offsetBytes & 0xfff;
}

function encodedPageOffset12(
  relocation: AArch64ObjectModule["relocations"][number],
  sectionBytes: readonly number[],
): number | undefined {
  if (relocation.offsetBytes % 4 !== 0 || relocation.offsetBytes + 4 > sectionBytes.length) {
    return undefined;
  }
  const word = wordToU32Le(sectionBytes.slice(relocation.offsetBytes, relocation.offsetBytes + 4));
  const field = (word >>> 10) & 0xfff;
  if (relocation.family === "pageoffset-12l") {
    const accessScaleBytes = relocation.instructionPatch?.encodingOwner?.accessScaleBytes;
    return accessScaleBytes === undefined ? undefined : field * accessScaleBytes;
  }
  return field;
}

function verifyLiteralPoolRanges(module: AArch64ObjectModule): readonly AArch64BackendDiagnostic[] {
  const diagnostics: AArch64BackendDiagnostic[] = [];
  const ranges = module.literalPools
    .map((literalPool) => ({
      stableKey: String(literalPool.stableKey),
      sectionKey: String(literalPool.sectionKey),
      start: literalPool.offsetBytes,
      end: literalPool.offsetBytes + literalPool.data.length,
    }))
    .sort(
      (left, right) =>
        compareCodeUnitStrings(left.sectionKey, right.sectionKey) ||
        left.start - right.start ||
        compareCodeUnitStrings(left.stableKey, right.stableKey),
    );
  for (let index = 1; index < ranges.length; index += 1) {
    const left = ranges[index - 1];
    const right = ranges[index];
    if (left === undefined || right === undefined || left.sectionKey !== right.sectionKey) continue;
    if (left.end > right.start) {
      diagnostics.push(
        diagnostic(
          `object-verifier:literal-pool-overlap:${left.stableKey}:${right.stableKey}:${right.sectionKey}:offset:${right.start}`,
        ),
      );
    }
  }
  return diagnostics;
}

function literalPoolHasSecretProvenance(
  indexes: AArch64ObjectVerifierIndexes,
  literalPool: AArch64ObjectModule["literalPools"][number],
): boolean {
  const literalStart = literalPool.offsetBytes;
  const literalEnd = literalPool.offsetBytes + literalPool.data.length;
  return byteProvenanceRecordsForSection(indexes, literalPool.sectionKey).some(
    (record) =>
      record.startOffsetBytes < literalEnd &&
      literalStart < record.startOffsetBytes + record.byteLength &&
      record.factFamilies.some(isSecretLiteralFactFamily),
  );
}

function isSecretLiteralFactFamily(family: string): boolean {
  return family === "secret-literal" || family === "security-and-secret-lifetime";
}

function verifyVeneerBytes(
  veneer: AArch64ObjectModule["veneers"][number],
  section: AArch64ObjectModule["sections"][number],
  indexes: AArch64ObjectVerifierIndexes,
): readonly AArch64BackendDiagnostic[] {
  const record = byteProvenanceRecordForStableKey(
    indexes,
    veneer.sectionKey,
    `byte:${veneer.stableKey}`,
  );
  if (record === undefined) {
    return [diagnostic(`object-verifier:veneer-bytes-missing:${veneer.stableKey}`)];
  }
  const diagnostics: AArch64BackendDiagnostic[] = [];
  if (record.byteLength !== 4 || record.startOffsetBytes % 4 !== 0) {
    diagnostics.push(
      diagnostic(
        `object-verifier:veneer-bytes-invalid:${veneer.stableKey}:offset:${record.startOffsetBytes}:length:${record.byteLength}`,
      ),
    );
  }
  if (record.startOffsetBytes + record.byteLength > section.bytes.length) {
    diagnostics.push(
      diagnostic(
        `object-verifier:veneer-bytes-out-of-range:${veneer.stableKey}:offset:${record.startOffsetBytes}:size:${section.bytes.length}`,
      ),
    );
    return diagnostics;
  }
  const opcode = decodeAArch64CatalogOpcode(
    section.bytes.slice(record.startOffsetBytes, record.startOffsetBytes + 4),
    indexes,
  );
  if (opcode !== "b") {
    diagnostics.push(
      diagnostic(
        `object-verifier:veneer-encoding-invalid:${veneer.stableKey}:opcode:${opcode ?? "unknown"}`,
      ),
    );
  }
  return diagnostics;
}

function verifyVeneerRelocation(
  veneer: AArch64ObjectModule["veneers"][number],
  module: AArch64ObjectModule,
  indexes: AArch64ObjectVerifierIndexes,
): readonly AArch64BackendDiagnostic[] {
  const record = byteProvenanceRecordForStableKey(
    indexes,
    veneer.sectionKey,
    `byte:${veneer.stableKey}`,
  );
  if (record === undefined) return [];
  const relocation = module.relocations.find(
    (candidate) =>
      String(candidate.sectionKey) === String(veneer.sectionKey) &&
      candidate.offsetBytes === record.startOffsetBytes,
  );
  if (relocation === undefined) {
    return [diagnostic(`object-verifier:veneer-relocation-missing:${veneer.stableKey}`)];
  }

  const diagnostics: AArch64BackendDiagnostic[] = [];
  if (relocation.family !== "branch26") {
    diagnostics.push(
      diagnostic(
        `object-verifier:veneer-relocation-family-invalid:${veneer.stableKey}:${relocation.family}`,
      ),
    );
  }
  if (relocation.widthBytes !== 4) {
    diagnostics.push(
      diagnostic(
        `object-verifier:veneer-relocation-width-invalid:${veneer.stableKey}:${relocation.widthBytes}`,
      ),
    );
  }
  const bitRange = relocation.instructionPatch?.bitRange;
  if (bitRange === undefined || bitRange[0] !== 0 || bitRange[1] !== 25) {
    diagnostics.push(
      diagnostic(
        `object-verifier:veneer-relocation-bit-range-invalid:${veneer.stableKey}:${bitRange?.[0] ?? "missing"}-${bitRange?.[1] ?? "missing"}`,
      ),
    );
  }
  if (relocationTargetDiagnosticKey(relocation) !== veneer.targetKey) {
    diagnostics.push(
      diagnostic(
        `object-verifier:veneer-relocation-target-mismatch:${veneer.stableKey}:${relocationTargetDiagnosticKey(relocation)}:expected:${veneer.targetKey}`,
      ),
    );
  }
  return diagnostics;
}

type RelocationTargetSymbolResolution =
  | { readonly kind: "resolved"; readonly symbol: AArch64ObjectModule["symbols"][number] }
  | { readonly kind: "missing" }
  | {
      readonly kind: "ambiguous";
      readonly linkageName: string;
      readonly symbolKeys: readonly string[];
    };

function resolveRelocationTargetSymbol(
  relocation: AArch64ObjectModule["relocations"][number],
  indexes: AArch64ObjectVerifierIndexes,
): RelocationTargetSymbolResolution {
  const target = relocation.target;
  if (target.kind === "symbol-stable-key") {
    const symbol = indexes.symbolByStableKey.get(target.stableKey);
    return symbol === undefined ? { kind: "missing" } : { kind: "resolved", symbol };
  }
  const symbols = indexes.symbolsByLinkageName.get(target.linkageName) ?? [];
  if (symbols.length === 0) return { kind: "missing" };
  if (symbols.length > 1) {
    return {
      kind: "ambiguous",
      linkageName: target.linkageName,
      symbolKeys: Object.freeze(symbols.map((symbol) => String(symbol.stableKey))),
    };
  }
  const symbol = symbols[0];
  return symbol === undefined ? { kind: "missing" } : { kind: "resolved", symbol };
}

function relocationTargetDiagnosticKey(
  relocation: AArch64ObjectModule["relocations"][number],
): string {
  return relocation.target.kind === "symbol-stable-key"
    ? relocation.target.stableKey
    : relocation.target.linkageName;
}

function verifyVeneerRange(
  veneer: AArch64ObjectModule["veneers"][number],
  targetSymbol: AArch64ObjectModule["symbols"][number],
  indexes: AArch64ObjectVerifierIndexes,
): readonly AArch64BackendDiagnostic[] {
  if (targetSymbol.kind === "external-declaration") return [];
  if (String(veneer.sectionKey) !== String(targetSymbol.sectionKey)) return [];
  const record = byteProvenanceRecordForStableKey(
    indexes,
    veneer.sectionKey,
    `byte:${veneer.stableKey}`,
  );
  if (record === undefined) return [];
  const distanceBytes = targetSymbol.offsetBytes - record.startOffsetBytes;
  return !isWithinAArch64SignedScaledBranchReach(distanceBytes, AARCH64_BRANCH26_REACH_BYTES)
    ? [
        diagnostic(
          `object-verifier:veneer-target-out-of-range:${veneer.stableKey}:${veneer.targetKey}:distance:${distanceBytes}`,
        ),
      ]
    : [];
}

function sameBytes(left: readonly number[], right: readonly number[]): boolean {
  return left.length === right.length && left.every((byte, index) => byte === right[index]);
}

function literalPoolRanges(
  module: AArch64ObjectModule,
): ReadonlyMap<string, readonly { readonly start: number; readonly end: number }[]> {
  const rangesBySection = new Map<string, { readonly start: number; readonly end: number }[]>();
  for (const literalPool of module.literalPools) {
    const ranges = rangesBySection.get(String(literalPool.sectionKey)) ?? [];
    ranges.push({
      start: literalPool.offsetBytes,
      end: literalPool.offsetBytes + literalPool.data.length,
    });
    rangesBySection.set(String(literalPool.sectionKey), ranges);
  }
  return new Map(
    [...rangesBySection.entries()].map(([sectionKey, ranges]) => [
      sectionKey,
      Object.freeze([...ranges].sort((left, right) => left.start - right.start)),
    ]),
  );
}

function alignmentPaddingRanges(
  module: AArch64ObjectModule,
): ReadonlyMap<string, readonly { readonly start: number; readonly end: number }[]> {
  const rangesBySection = new Map<string, { readonly start: number; readonly end: number }[]>();
  for (const record of module.byteProvenance) {
    if (!isAlignmentPaddingProvenance(record)) continue;
    const sectionKey = String(record.sectionKey);
    const ranges = rangesBySection.get(sectionKey) ?? [];
    ranges.push({
      start: record.startOffsetBytes,
      end: record.startOffsetBytes + record.byteLength,
    });
    rangesBySection.set(sectionKey, ranges);
  }
  return new Map(
    [...rangesBySection.entries()].map(([sectionKey, ranges]) => [
      sectionKey,
      Object.freeze([...ranges].sort((left, right) => left.start - right.start)),
    ]),
  );
}

function isAlignmentPaddingProvenance(
  record: AArch64ObjectModule["byteProvenance"][number],
): boolean {
  return (
    String(record.stableKey).startsWith(`byte:${record.sectionKey}:align:`) &&
    record.source.startsWith("align:")
  );
}

function verifySorted(label: string, keys: readonly string[]): readonly AArch64BackendDiagnostic[] {
  const sorted = [...keys].sort(compareCodeUnitStrings);
  return keys.every((key, index) => key === sorted[index])
    ? []
    : [diagnostic(`object-verifier:nondeterministic-${label}-order:${keys.join(",")}`)];
}

function verifyByteProvenance(
  module: AArch64ObjectModule,
  indexes: AArch64ObjectVerifierIndexes,
): readonly AArch64BackendDiagnostic[] {
  const diagnostics: AArch64BackendDiagnostic[] = [];
  for (const section of module.sections) {
    const records = byteProvenanceRecordsForSection(indexes, section.stableKey);
    let cursor = 0;
    for (const record of records) {
      if (record.startOffsetBytes > cursor) {
        diagnostics.push(
          diagnostic(`object-verifier:byte-provenance-gap:${section.stableKey}:offset:${cursor}`),
        );
        cursor = record.startOffsetBytes + record.byteLength;
        continue;
      }
      if (record.startOffsetBytes < cursor) {
        diagnostics.push(
          diagnostic(
            `object-verifier:byte-provenance-overlap:${section.stableKey}:offset:${record.startOffsetBytes}`,
          ),
        );
        cursor = Math.max(cursor, record.startOffsetBytes + record.byteLength);
        continue;
      }
      cursor += record.byteLength;
      if (cursor > section.bytes.length) {
        diagnostics.push(
          diagnostic(
            `object-verifier:byte-provenance-out-of-range:${section.stableKey}:offset:${record.startOffsetBytes}:size:${section.bytes.length}`,
          ),
        );
      }
    }
    if (cursor !== section.bytes.length) {
      diagnostics.push(
        diagnostic(`object-verifier:byte-provenance-gap:${section.stableKey}:offset:${cursor}`),
      );
    }
  }
  return diagnostics;
}

function isKnownUnwindFrameShape(frameShape: string): boolean {
  return [
    "frameless-leaf",
    "serializable-unwind",
    "unreachable-body",
    "leaf",
    "prologue",
    "frame-record",
    "large-frame",
  ].includes(frameShape);
}

function decodeAArch64CatalogOpcode(
  bytes: readonly number[],
  indexes: AArch64ObjectVerifierIndexes,
): string | undefined {
  return decodeAArch64CatalogEntry(bytes, indexes)?.opcode;
}

function decodeAArch64CatalogEntry(
  bytes: readonly number[],
  indexes: AArch64ObjectVerifierIndexes,
  relocationFamily?: string,
): AArch64EncodingCatalogEntry | undefined {
  const word = wordToU32Le(bytes);
  let firstMatch: AArch64EncodingCatalogEntry | undefined;
  for (const pattern of indexes.catalogPatterns) {
    if ((word & pattern.mask) >>> 0 !== pattern.value) continue;
    firstMatch ??= pattern.entry;
    if (
      relocationFamily !== undefined &&
      pattern.entry.relocationHole?.family === relocationFamily
    ) {
      return pattern.entry;
    }
  }
  return firstMatch;
}

function diagnostic(stableDetail: string): AArch64BackendDiagnostic {
  return aarch64BackendDiagnostic({
    code: "AARCH64_BACKEND_OBJECT_INVALID",
    stableDetail,
    ownerKey: "object-verifier",
    rootCauseKey: stableDetail,
  });
}
