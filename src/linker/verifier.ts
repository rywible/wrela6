import { compareCodeUnitStrings } from "../shared/deterministic-sort";
import { stableJson } from "../shared/stable-json";
import {
  AARCH64_RELOCATION_FIELD_SLICES,
  expectedAArch64RelocationWidthBytes,
  isAArch64InstructionRelocationFamily,
  type AArch64RelocationFieldSlice,
} from "./aarch64/aarch64-relocation-policy";
import { encodeAArch64RelocationValue } from "./aarch64/aarch64-relocations";
import {
  linkerDiagnostic,
  linkerError,
  linkerOk,
  type LinkerDiagnostic,
  type LinkerResult,
  type LinkerVerificationSummary,
} from "./diagnostics";
import {
  createAArch64LinkedImageLayout,
  type AArch64LinkedImageLayout,
  type AppliedRelocation,
  type LinkedImageSection,
  type ResolvedImageSymbol,
  type SectionContribution,
} from "./linked-image-layout";
import { wordToU32Le } from "../target/aarch64/backend/object/encoding-core";

const VERIFIER_KEY = "linked-image-verifier";
const OWNER_KEY = "linked-image-verifier";
const PREFERRED_IMAGE_BASE = 0n;

const PASSED_VERIFICATION: LinkerVerificationSummary = Object.freeze({
  runs: Object.freeze([
    Object.freeze({
      verifierKey: VERIFIER_KEY,
      runKey: "verify-linked-image-layout",
      status: "passed" as const,
    }),
  ]),
});

const FAILED_VERIFICATION: LinkerVerificationSummary = Object.freeze({
  runs: Object.freeze([
    Object.freeze({
      verifierKey: VERIFIER_KEY,
      runKey: "verify-linked-image-layout",
      status: "failed" as const,
    }),
  ]),
});

export function verifyLinkedImageLayout(
  layout: AArch64LinkedImageLayout,
): LinkerResult<LinkerVerificationSummary> {
  const diagnostics: LinkerDiagnostic[] = [];
  const sectionByKey = new Map(layout.sections.map((section) => [section.stableKey, section]));
  const contributionByKey = contributionIndex(layout.sections);
  const symbolByKey = new Map(layout.symbols.map((symbol) => [symbol.symbolKey, symbol]));
  const relocationByKey = new Map(
    layout.appliedRelocations.map((relocation) => [relocation.relocationKey, relocation]),
  );

  diagnostics.push(...duplicateDiagnostics(layout));
  diagnostics.push(...sectionDiagnostics(layout.sections));
  diagnostics.push(...contributionDiagnostics(layout, sectionByKey));
  diagnostics.push(...symbolDiagnostics(layout.symbols, sectionByKey, contributionByKey));
  diagnostics.push(...relocationDiagnostics(layout, sectionByKey, symbolByKey));
  diagnostics.push(...baseRelocationDiagnostics(layout, sectionByKey, relocationByKey));
  diagnostics.push(...unwindDiagnostics(layout, sectionByKey, symbolByKey));
  diagnostics.push(...entryDiagnostics(layout, symbolByKey));
  diagnostics.push(...provenanceDiagnostics(layout, sectionByKey));
  diagnostics.push(...factSpendingDiagnostics(layout));
  diagnostics.push(...metadataDiagnostics(layout));

  if (diagnostics.length > 0) {
    return linkerError({ diagnostics, verification: FAILED_VERIFICATION });
  }

  return linkerOk({
    value: PASSED_VERIFICATION,
    verification: PASSED_VERIFICATION,
  });
}

function duplicateDiagnostics(layout: AArch64LinkedImageLayout): readonly LinkerDiagnostic[] {
  return [
    ...duplicatesBy(layout.inputModules, (inputModule) => inputModule.moduleKey, "input-module"),
    ...duplicatesBy(layout.sections, (section) => section.stableKey, "section"),
    ...duplicatesBy(layout.symbols, (symbol) => symbol.symbolKey, "symbol"),
    ...duplicatesBy(
      layout.appliedRelocations,
      (relocation) => relocation.relocationKey,
      "relocation",
    ),
    ...duplicatesBy(layout.baseRelocations, (relocation) => relocation.stableKey, "base-reloc"),
    ...duplicatesBy(layout.provenance, (record) => record.stableKey, "provenance"),
    ...duplicatesBy(layout.factSpending, (record) => record.stableKey, "fact-spending"),
  ];
}

function sectionDiagnostics(sections: readonly LinkedImageSection[]): readonly LinkerDiagnostic[] {
  const diagnostics: LinkerDiagnostic[] = [];
  for (const section of sections) {
    if (!isNonNegativeInteger(section.rva) || !isPositiveInteger(section.alignmentBytes)) {
      diagnostics.push(diagnostic(`image-layout:section-rva-invalid:${section.stableKey}`));
      continue;
    }
    if (section.rva % section.alignmentBytes !== 0) {
      diagnostics.push(
        diagnostic(
          `image-layout:section-rva-misaligned:${section.stableKey}:${section.rva}:${section.alignmentBytes}`,
        ),
      );
    }
    if (section.virtualSizeBytes < section.bytes.length) {
      diagnostics.push(
        diagnostic(
          `image-layout:section-virtual-size-too-small:${section.stableKey}:${section.virtualSizeBytes}:${section.bytes.length}`,
        ),
      );
    }
  }

  const orderedSections = [...sections].sort((left, right) => {
    const rvaComparison = left.rva - right.rva;
    return rvaComparison === 0
      ? compareCodeUnitStrings(left.stableKey, right.stableKey)
      : rvaComparison;
  });
  for (let index = 1; index < orderedSections.length; index += 1) {
    const previous = orderedSections[index - 1]!;
    const current = orderedSections[index]!;
    const previousEnd = previous.rva + previous.virtualSizeBytes;
    const currentEnd = current.rva + current.virtualSizeBytes;
    if (previousEnd > current.rva) {
      diagnostics.push(
        diagnostic(
          `image-layout:section-rva-overlap:${previous.stableKey}:${current.stableKey}:${previous.rva}:${previousEnd}:${current.rva}:${currentEnd}`,
        ),
      );
    }
  }
  return diagnostics;
}

function contributionDiagnostics(
  layout: AArch64LinkedImageLayout,
  sectionByKey: ReadonlyMap<string, LinkedImageSection>,
): readonly LinkerDiagnostic[] {
  const inputModuleKeys = new Set(layout.inputModules.map((inputModule) => inputModule.moduleKey));
  const diagnostics: LinkerDiagnostic[] = [];
  for (const section of layout.sections) {
    for (const contribution of section.contributions) {
      if (contribution.outputSectionKey !== section.stableKey) {
        diagnostics.push(
          diagnostic(
            `image-layout:contribution-output-section-mismatch:${contribution.stableKey}:${contribution.outputSectionKey}:${section.stableKey}`,
          ),
        );
      }
      if (!inputModuleKeys.has(contribution.sourceModuleKey)) {
        diagnostics.push(
          diagnostic(
            `image-layout:contribution-module-missing:${contribution.stableKey}:${contribution.sourceModuleKey}`,
          ),
        );
      }
      const outputSection = sectionByKey.get(contribution.outputSectionKey);
      if (outputSection === undefined) continue;
      if (
        contribution.offsetBytes < 0 ||
        contribution.sizeBytes < 0 ||
        contribution.offsetBytes + contribution.sizeBytes > outputSection.bytes.length
      ) {
        diagnostics.push(
          diagnostic(
            `image-layout:contribution-range-out-of-section:${contribution.stableKey}:${outputSection.stableKey}:${contribution.offsetBytes}:${contribution.sizeBytes}:${outputSection.bytes.length}`,
          ),
        );
      }
      if (
        isPositiveInteger(contribution.alignmentBytes) &&
        contribution.offsetBytes % contribution.alignmentBytes !== 0
      ) {
        diagnostics.push(
          diagnostic(
            `image-layout:contribution-offset-misaligned:${contribution.stableKey}:${contribution.offsetBytes}:${contribution.alignmentBytes}`,
          ),
        );
      }
    }
  }
  return diagnostics;
}

function symbolDiagnostics(
  symbols: readonly ResolvedImageSymbol[],
  sectionByKey: ReadonlyMap<string, LinkedImageSection>,
  contributionByKey: ReadonlyMap<string, ContributionPlacement>,
): readonly LinkerDiagnostic[] {
  const diagnostics: LinkerDiagnostic[] = [];
  for (const symbol of symbols) {
    const section = sectionByKey.get(symbol.sectionKey);
    const placement = contributionByKey.get(symbol.contributionKey);
    if (section === undefined) {
      diagnostics.push(
        diagnostic(`image-layout:symbol-section-missing:${symbol.symbolKey}:${symbol.sectionKey}`),
      );
      continue;
    }
    if (placement === undefined) {
      diagnostics.push(
        diagnostic(
          `image-layout:symbol-contribution-missing:${symbol.symbolKey}:${symbol.contributionKey}`,
        ),
      );
      continue;
    }
    if (placement.section.stableKey !== symbol.sectionKey) {
      diagnostics.push(
        diagnostic(
          `image-layout:symbol-section-mismatch:${symbol.symbolKey}:${symbol.sectionKey}:${placement.section.stableKey}`,
        ),
      );
    }
    const expectedRva = section.rva + placement.contribution.offsetBytes + symbol.objectOffsetBytes;
    if (symbol.rva !== expectedRva) {
      diagnostics.push(
        diagnostic(
          `image-layout:symbol-rva-mismatch:${symbol.symbolKey}:${symbol.rva}:${expectedRva}`,
        ),
      );
    }
    if (
      symbol.objectOffsetBytes < 0 ||
      symbol.objectOffsetBytes > placement.contribution.sizeBytes
    ) {
      diagnostics.push(
        diagnostic(
          `image-layout:symbol-offset-out-of-contribution:${symbol.symbolKey}:${symbol.objectOffsetBytes}:${placement.contribution.sizeBytes}`,
        ),
      );
    }
  }
  return diagnostics;
}

function relocationDiagnostics(
  layout: AArch64LinkedImageLayout,
  sectionByKey: ReadonlyMap<string, LinkedImageSection>,
  symbolByKey: ReadonlyMap<string, ResolvedImageSymbol>,
): readonly LinkerDiagnostic[] {
  const diagnostics: LinkerDiagnostic[] = [];
  for (const relocation of layout.appliedRelocations) {
    const patchSection = sectionByKey.get(relocation.patchSectionKey);
    const targetSymbol = symbolByKey.get(relocation.targetSymbolKey);
    if (patchSection === undefined) {
      diagnostics.push(
        diagnostic(
          `image-layout:relocation-patch-section-missing:${relocation.relocationKey}:${relocation.patchSectionKey}`,
        ),
      );
      continue;
    }
    if (targetSymbol === undefined) {
      diagnostics.push(
        diagnostic(
          `image-layout:relocation-target-symbol-missing:${relocation.relocationKey}:${relocation.targetSymbolKey}`,
        ),
      );
      continue;
    }
    if (relocation.targetRva !== targetSymbol.rva) {
      diagnostics.push(
        diagnostic(
          `image-layout:relocation-target-rva-mismatch:${relocation.relocationKey}:${relocation.targetRva}:${targetSymbol.rva}`,
        ),
      );
    }
    const patchOffset = relocation.patchRva - patchSection.rva;
    if (
      patchOffset < 0 ||
      patchOffset + relocation.patchedBytes.length > patchSection.bytes.length
    ) {
      diagnostics.push(
        diagnostic(
          `image-layout:relocation-patch-range-out-of-section:${relocation.relocationKey}:${relocation.patchRva}:${relocation.patchedBytes.length}:${patchSection.stableKey}`,
        ),
      );
      continue;
    }
    const sectionBytes = patchSection.bytes.slice(
      patchOffset,
      patchOffset + relocation.patchedBytes.length,
    );
    if (!sameNumbers(sectionBytes, relocation.patchedBytes)) {
      diagnostics.push(
        diagnostic(`image-layout:relocation-patched-bytes-mismatch:${relocation.relocationKey}`),
      );
    }
    const encodedValue = encodeRelocation(layout, relocation, targetSymbol);
    if (encodedValue.kind === "error") {
      diagnostics.push(
        diagnostic(
          `image-layout:relocation-encoding-invalid:${relocation.relocationKey}:${encodedValue.diagnostics
            .map((item) => item.stableDetail)
            .join(",")}`,
        ),
      );
    } else if (encodedValue.value.encodedValue !== relocation.expectedEncodedValue) {
      diagnostics.push(
        diagnostic(
          `image-layout:relocation-encoded-value-mismatch:${relocation.relocationKey}:${relocation.expectedEncodedValue}:${encodedValue.value.encodedValue}`,
        ),
      );
    } else {
      const actualEncodedValue = actualEncodedRelocationValue(relocation, sectionBytes);
      if (actualEncodedValue.kind === "error") {
        diagnostics.push(
          diagnostic(
            `image-layout:relocation-actual-encoding-invalid:${relocation.relocationKey}:${actualEncodedValue.detail}`,
          ),
        );
      } else {
        const expectedActualValue = canonicalActualEncodedValue(
          relocation,
          encodedValue.value.encodedValue,
        );
        if (actualEncodedValue.value !== expectedActualValue) {
          diagnostics.push(
            diagnostic(
              `image-layout:relocation-actual-encoded-value-mismatch:${relocation.relocationKey}:${actualEncodedValue.value}:${expectedActualValue}`,
            ),
          );
        }
      }
    }
  }
  return diagnostics;
}

function baseRelocationDiagnostics(
  layout: AArch64LinkedImageLayout,
  sectionByKey: ReadonlyMap<string, LinkedImageSection>,
  relocationByKey: ReadonlyMap<string, AppliedRelocation>,
): readonly LinkerDiagnostic[] {
  const diagnostics: LinkerDiagnostic[] = [];
  for (const baseRelocation of layout.baseRelocations) {
    const section = sectionByKey.get(baseRelocation.sectionKey);
    const source = relocationByKey.get(baseRelocation.sourceRelocationKey);
    if (section === undefined) {
      diagnostics.push(
        diagnostic(
          `image-layout:base-relocation-section-missing:${baseRelocation.stableKey}:${baseRelocation.sectionKey}`,
        ),
      );
      continue;
    }
    if (source === undefined) {
      diagnostics.push(
        diagnostic(
          `image-layout:base-relocation-source-missing:${baseRelocation.stableKey}:${baseRelocation.sourceRelocationKey}`,
        ),
      );
      continue;
    }
    if (
      source.family !== "addr64" ||
      source.baseRelocationKey !== baseRelocation.stableKey ||
      source.patchSectionKey !== baseRelocation.sectionKey ||
      source.patchRva !== baseRelocation.rva
    ) {
      diagnostics.push(
        diagnostic(
          `image-layout:base-relocation-target-mismatch:${baseRelocation.stableKey}:${baseRelocation.rva}:${source.patchRva}`,
        ),
      );
    }
    if (
      source.family === "addr64" &&
      (baseRelocation.kind !== "dir64" || baseRelocation.widthBytes !== 8)
    ) {
      diagnostics.push(
        diagnostic(
          `image-layout:base-relocation-kind-mismatch:${baseRelocation.stableKey}:${source.family}:${baseRelocation.kind}:${baseRelocation.widthBytes}:expected:dir64:8`,
        ),
      );
    }
    const offset = baseRelocation.rva - section.rva;
    if (offset < 0 || offset + baseRelocation.widthBytes > section.bytes.length) {
      diagnostics.push(
        diagnostic(
          `image-layout:base-relocation-range-out-of-section:${baseRelocation.stableKey}:${baseRelocation.rva}:${baseRelocation.widthBytes}`,
        ),
      );
    }
  }
  for (const relocation of layout.appliedRelocations) {
    if (relocation.family !== "addr64") {
      if (relocation.baseRelocationKey === undefined) continue;
      if (
        !layout.baseRelocations.some(
          (candidate) => candidate.stableKey === relocation.baseRelocationKey,
        )
      ) {
        diagnostics.push(
          diagnostic(
            `image-layout:base-relocation-missing:${relocation.relocationKey}:${relocation.baseRelocationKey}`,
          ),
        );
      }
      continue;
    }

    const expectedKey = `base-reloc:dir64:${relocation.patchSectionKey}:${relocation.patchRva}`;
    if (relocation.baseRelocationKey !== expectedKey) {
      diagnostics.push(
        diagnostic(
          `image-layout:base-relocation-key-mismatch:${relocation.relocationKey}:${relocation.baseRelocationKey ?? "<missing>"}:${expectedKey}`,
        ),
      );
    }
    if (!layout.baseRelocations.some((candidate) => candidate.stableKey === expectedKey)) {
      diagnostics.push(
        diagnostic(
          `image-layout:base-relocation-missing:${relocation.relocationKey}:${expectedKey}`,
        ),
      );
    }
  }
  return diagnostics;
}

function unwindDiagnostics(
  layout: AArch64LinkedImageLayout,
  sectionByKey: ReadonlyMap<string, LinkedImageSection>,
  symbolByKey: ReadonlyMap<string, ResolvedImageSymbol>,
): readonly LinkerDiagnostic[] {
  const diagnostics: LinkerDiagnostic[] = [];
  for (const record of layout.unwindRecords) {
    const symbol = symbolByKey.get(record.functionSymbolKey);
    const functionSection = symbol === undefined ? undefined : sectionByKey.get(symbol.sectionKey);
    const unwindSection = sectionByKey.get(record.unwindInfoSectionKey);
    if (symbol === undefined || functionSection === undefined) {
      diagnostics.push(
        diagnostic(
          `image-layout:unwind-function-symbol-missing:${record.stableKey}:${record.functionSymbolKey}`,
        ),
      );
      continue;
    }
    if (
      record.functionStartRva !== symbol.rva ||
      record.functionEndRva <= record.functionStartRva ||
      record.functionStartRva < functionSection.rva ||
      record.functionEndRva > functionSection.rva + functionSection.virtualSizeBytes
    ) {
      diagnostics.push(
        diagnostic(
          `image-layout:unwind-function-range-invalid:${record.stableKey}:${record.functionStartRva}:${record.functionEndRva}`,
        ),
      );
    }
    if (
      unwindSection === undefined ||
      record.unwindInfoRva < unwindSection.rva ||
      record.unwindInfoRva >= unwindSection.rva + unwindSection.virtualSizeBytes
    ) {
      diagnostics.push(
        diagnostic(
          `image-layout:unwind-info-range-invalid:${record.stableKey}:${record.unwindInfoSectionKey}:${record.unwindInfoRva}`,
        ),
      );
    }
  }
  return diagnostics;
}

function entryDiagnostics(
  layout: AArch64LinkedImageLayout,
  symbolByKey: ReadonlyMap<string, ResolvedImageSymbol>,
): readonly LinkerDiagnostic[] {
  const diagnostics: LinkerDiagnostic[] = [];
  const loaderSymbols = layout.symbols
    .filter(
      (symbol) =>
        symbol.binding === "global" && symbol.linkageName === layout.entry.loaderEntryLinkageName,
    )
    .sort(compareSymbols);
  if (loaderSymbols.length !== 1) {
    diagnostics.push(
      diagnostic(
        `image-layout:entry-symbol-resolution-invalid:${layout.entry.loaderEntryLinkageName}:${loaderSymbols.length}`,
      ),
    );
  } else if (loaderSymbols[0]!.rva !== layout.entry.loaderEntryRva) {
    diagnostics.push(
      diagnostic(
        `image-layout:entry-rva-mismatch:${layout.entry.loaderEntryLinkageName}:${layout.entry.loaderEntryRva}:${loaderSymbols[0]!.rva}`,
      ),
    );
  }

  const bootSymbols = [...symbolByKey.values()]
    .filter(
      (symbol) =>
        symbol.binding === "global" && symbol.linkageName === layout.entry.wrelaBootLinkageName,
    )
    .sort(compareSymbols);
  if (bootSymbols.length !== 1) {
    diagnostics.push(
      diagnostic(
        `image-layout:boot-symbol-resolution-invalid:${layout.entry.wrelaBootLinkageName}:${bootSymbols.length}`,
      ),
    );
  } else if (bootSymbols[0]!.rva !== layout.entry.wrelaBootRva) {
    diagnostics.push(
      diagnostic(
        `image-layout:boot-rva-mismatch:${layout.entry.wrelaBootLinkageName}:${layout.entry.wrelaBootRva}:${bootSymbols[0]!.rva}`,
      ),
    );
  }
  return diagnostics;
}

function provenanceDiagnostics(
  layout: AArch64LinkedImageLayout,
  sectionByKey: ReadonlyMap<string, LinkedImageSection>,
): readonly LinkerDiagnostic[] {
  const diagnostics: LinkerDiagnostic[] = [];
  const inputModuleKeys = new Set(layout.inputModules.map((inputModule) => inputModule.moduleKey));
  for (const section of layout.sections) {
    const intervals = layout.provenance
      .filter((record) => record.sectionKey === section.stableKey)
      .map((record) => ({
        record,
        start: record.rva - section.rva,
        end: record.rva - section.rva + record.byteLength,
      }))
      .sort((left, right) => {
        const startComparison = left.start - right.start;
        return startComparison === 0
          ? compareCodeUnitStrings(left.record.stableKey, right.record.stableKey)
          : startComparison;
      });
    let cursor = 0;
    for (const interval of intervals) {
      if (
        interval.start < 0 ||
        interval.end > section.bytes.length ||
        interval.start > interval.end
      ) {
        diagnostics.push(
          diagnostic(
            `image-layout:provenance-range-out-of-section:${interval.record.stableKey}:${section.stableKey}:${interval.start}:${interval.end}`,
          ),
        );
        continue;
      }
      if (interval.start > cursor) {
        diagnostics.push(diagnostic(`image-layout:provenance-gap:${section.stableKey}:${cursor}`));
      }
      if (interval.start < cursor) {
        diagnostics.push(
          diagnostic(
            `image-layout:provenance-overlap:${section.stableKey}:${interval.record.stableKey}:${interval.start}:${cursor}`,
          ),
        );
      }
      cursor = Math.max(cursor, interval.end);
      if (
        interval.record.sourceModuleKey !== undefined &&
        !inputModuleKeys.has(interval.record.sourceModuleKey)
      ) {
        diagnostics.push(
          diagnostic(
            `image-layout:provenance-module-missing:${interval.record.stableKey}:${interval.record.sourceModuleKey}`,
          ),
        );
      }
      const partitionDetail = provenancePartitionDetail(interval.record);
      if (partitionDetail !== undefined) {
        diagnostics.push(diagnostic(partitionDetail));
      }
    }
    if (cursor < section.bytes.length) {
      diagnostics.push(diagnostic(`image-layout:provenance-gap:${section.stableKey}:${cursor}`));
    }
  }
  for (const record of layout.provenance) {
    if (!sectionByKey.has(record.sectionKey)) {
      diagnostics.push(
        diagnostic(
          `image-layout:provenance-section-missing:${record.stableKey}:${record.sectionKey}`,
        ),
      );
    }
  }
  return diagnostics;
}

function provenancePartitionDetail(
  record: AArch64LinkedImageLayout["provenance"][number],
): string | undefined {
  const hasObjectSource =
    record.sourceModuleKey !== undefined ||
    record.sourceObjectSectionKey !== undefined ||
    record.sourceObjectProvenanceKey !== undefined;
  const completeObjectSource =
    record.sourceModuleKey !== undefined &&
    record.sourceObjectSectionKey !== undefined &&
    record.sourceObjectProvenanceKey !== undefined;
  const hasRelocationSource = record.sourceRelocationKey !== undefined;
  const hasSyntheticIdentity = record.sourceSyntheticObjectKey !== undefined;
  const hasMachineSubject = record.machineSubjectKey !== undefined;

  if (!hasObjectSource && !hasRelocationSource && !hasSyntheticIdentity && !hasMachineSubject) {
    return record.factFamilies.length === 0
      ? undefined
      : `image-layout:provenance-partition-invalid:${record.stableKey}:padding-has-facts`;
  }

  if (hasRelocationSource) {
    return hasObjectSource || hasSyntheticIdentity || hasMachineSubject
      ? `image-layout:provenance-partition-invalid:${record.stableKey}:mixed-relocation-source`
      : undefined;
  }

  if (hasObjectSource) {
    return completeObjectSource
      ? undefined
      : `image-layout:provenance-partition-invalid:${record.stableKey}:partial-object-source`;
  }

  if (hasSyntheticIdentity) {
    return hasMachineSubject
      ? `image-layout:provenance-partition-invalid:${record.stableKey}:mixed-synthetic-source`
      : undefined;
  }

  return `image-layout:provenance-partition-invalid:${record.stableKey}:missing-source-identity`;
}

function factSpendingDiagnostics(layout: AArch64LinkedImageLayout): readonly LinkerDiagnostic[] {
  const inputModuleKeys = new Set(layout.inputModules.map((inputModule) => inputModule.moduleKey));
  const diagnostics: LinkerDiagnostic[] = [];
  const aggregateKeys = new Map<string, string[]>();
  for (const record of layout.factSpending) {
    if (!record.stableKey.startsWith(`fact-spent:${record.authority}:`)) {
      diagnostics.push(
        diagnostic(
          `image-layout:fact-spending-key-mismatch:${record.stableKey}:${record.authority}`,
        ),
      );
    }
    if (record.sourceModuleKeys.length === 0) {
      diagnostics.push(diagnostic(`image-layout:fact-spending-empty:${record.stableKey}`));
    }
    const sortedSourceModuleKeys = [...record.sourceModuleKeys].sort(compareCodeUnitStrings);
    if (stableJson(record.sourceModuleKeys) !== stableJson(sortedSourceModuleKeys)) {
      diagnostics.push(diagnostic(`image-layout:fact-spending-module-order:${record.stableKey}`));
    }
    const aggregateKey = stableJson([record.authority, record.payload]);
    aggregateKeys.set(aggregateKey, [...(aggregateKeys.get(aggregateKey) ?? []), record.stableKey]);
    for (const moduleKey of record.sourceModuleKeys) {
      if (!inputModuleKeys.has(moduleKey)) {
        diagnostics.push(
          diagnostic(`image-layout:fact-spending-module-missing:${record.stableKey}:${moduleKey}`),
        );
      }
    }
    diagnostics.push(
      ...duplicatesBy(record.sourceModuleKeys, (moduleKey) => moduleKey, "fact-spending-module"),
    );
  }
  for (const stableKeys of aggregateKeys.values()) {
    if (stableKeys.length <= 1) continue;
    diagnostics.push(
      diagnostic(
        `image-layout:fact-spending-aggregate-split:${stableKeys.sort(compareCodeUnitStrings).join(":")}`,
      ),
    );
  }
  return diagnostics;
}

function metadataDiagnostics(layout: AArch64LinkedImageLayout): readonly LinkerDiagnostic[] {
  let expected: AArch64LinkedImageLayout["deterministicMetadata"];
  try {
    expected = createAArch64LinkedImageLayout({
      targetKey: layout.targetKey,
      targetFingerprint: layout.targetFingerprint,
      targetPolicyFingerprint: layout.targetPolicyFingerprint,
      inputModules: layout.inputModules,
      sections: layout.sections,
      symbols: layout.symbols,
      appliedRelocations: layout.appliedRelocations,
      baseRelocations: layout.baseRelocations,
      entry: layout.entry,
      unwindRecords: layout.unwindRecords,
      dataDirectorySources: layout.dataDirectorySources,
      provenance: layout.provenance,
      factSpending: layout.factSpending,
      verification: layout.verification,
    }).deterministicMetadata;
  } catch (error) {
    return Object.freeze([
      diagnostic(`image-layout:metadata-recompute-invalid:${stableErrorMessage(error)}`),
    ]);
  }

  const diagnostics: LinkerDiagnostic[] = [];
  for (const key of Object.keys(expected) as (keyof typeof expected)[]) {
    if (layout.deterministicMetadata[key] !== expected[key]) {
      diagnostics.push(
        diagnostic(
          `image-layout:metadata-fingerprint-mismatch:${key}:${layout.deterministicMetadata[key]}:${expected[key]}`,
        ),
      );
    }
  }
  return diagnostics;
}

type ActualEncodedRelocationValue =
  | { readonly kind: "ok"; readonly value: bigint }
  | { readonly kind: "error"; readonly detail: string };

function actualEncodedRelocationValue(
  relocation: AppliedRelocation,
  patchBytes: readonly number[],
): ActualEncodedRelocationValue {
  const expectedWidthBytes = expectedAArch64RelocationWidthBytes(relocation.family);
  if (patchBytes.length !== expectedWidthBytes) {
    return {
      kind: "error",
      detail: `width:${patchBytes.length}:expected:${expectedWidthBytes}`,
    };
  }

  if (isAArch64InstructionRelocationFamily(relocation.family)) {
    const fieldSlices = (
      AARCH64_RELOCATION_FIELD_SLICES as Partial<
        Record<AppliedRelocation["family"], readonly AArch64RelocationFieldSlice[]>
      >
    )[relocation.family];
    if (fieldSlices === undefined || fieldSlices.length === 0) {
      return { kind: "error", detail: `missing-field-slices:${relocation.family}` };
    }
    const instructionWord = BigInt(wordToU32Le(patchBytes));
    let value = 0n;
    for (const slice of fieldSlices) {
      const mask = (1n << BigInt(slice.bitCount)) - 1n;
      const fieldValue = (instructionWord >> BigInt(slice.instructionStartBit)) & mask;
      value |= fieldValue << BigInt(slice.encodedValueStartBit);
    }
    return { kind: "ok", value };
  }

  let value = 0n;
  for (let index = 0; index < patchBytes.length; index += 1) {
    value |= BigInt(patchBytes[index]! & 0xff) << BigInt(index * 8);
  }
  return { kind: "ok", value };
}

function canonicalActualEncodedValue(relocation: AppliedRelocation, encodedValue: bigint): bigint {
  const bitWidth = BigInt(expectedAArch64RelocationWidthBytes(relocation.family) * 8);
  return BigInt.asUintN(Number(bitWidth), encodedValue);
}

function stableErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/\s+/g, " ");
}

interface ContributionPlacement {
  readonly section: LinkedImageSection;
  readonly contribution: SectionContribution;
}

function contributionIndex(
  sections: readonly LinkedImageSection[],
): ReadonlyMap<string, ContributionPlacement> {
  const index = new Map<string, ContributionPlacement>();
  for (const section of sections) {
    for (const contribution of section.contributions) {
      index.set(contribution.stableKey, Object.freeze({ section, contribution }));
    }
  }
  return index;
}

function encodeRelocation(
  layout: AArch64LinkedImageLayout,
  relocation: AppliedRelocation,
  targetSymbol: ResolvedImageSymbol,
): ReturnType<typeof encodeAArch64RelocationValue> {
  const targetSection = layout.sections.find(
    (section) => section.stableKey === targetSymbol.sectionKey,
  );
  return encodeAArch64RelocationValue({
    family: relocation.family,
    relocationKey: relocation.relocationKey,
    symbolRva: BigInt(targetSymbol.rva),
    patchRva: BigInt(relocation.patchRva),
    addend: relocation.addend,
    preferredImageBase: PREFERRED_IMAGE_BASE,
    containingSectionRva: BigInt(targetSection?.rva ?? 0),
    accessScaleBytes: relocation.accessScaleBytes,
  });
}

function duplicatesBy<Value>(
  values: readonly Value[],
  keyFor: (value: Value) => string,
  recordKind: string,
): readonly LinkerDiagnostic[] {
  const seen = new Set<string>();
  const duplicateKeys = new Set<string>();
  for (const value of values) {
    const key = keyFor(value);
    if (seen.has(key)) duplicateKeys.add(key);
    seen.add(key);
  }
  return [...duplicateKeys]
    .sort(compareCodeUnitStrings)
    .map((key) => diagnostic(`image-layout:duplicate-${recordKind}:${key}`));
}

function compareSymbols(left: ResolvedImageSymbol, right: ResolvedImageSymbol): number {
  const rvaComparison = left.rva - right.rva;
  return rvaComparison === 0
    ? compareCodeUnitStrings(left.symbolKey, right.symbolKey)
    : rvaComparison;
}

function sameNumbers(left: readonly number[], right: readonly number[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function isNonNegativeInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

function isPositiveInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}

function diagnostic(stableDetail: string): LinkerDiagnostic {
  return linkerDiagnostic({
    code: "LINKER_IMAGE_LAYOUT_INVALID",
    ownerKey: OWNER_KEY,
    stableDetail,
    provenance: [stableJson([VERIFIER_KEY, stableDetail])],
  });
}
