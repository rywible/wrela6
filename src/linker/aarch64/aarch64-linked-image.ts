import { compareCodeUnitStrings } from "../../shared/deterministic-sort";
import {
  linkerDiagnostic,
  linkerError,
  linkerOk,
  type LinkerDiagnostic,
  type LinkerResult,
  type LinkerVerificationSummary,
} from "../diagnostics";
import type { AArch64LinkerTargetSurface } from "../image-layout-policy";
import type {
  LinkedDataDirectorySource,
  LinkedImageSection,
  LinkedUnwindRecord,
  ResolvedImageSymbol,
  SectionContribution,
} from "../linked-image-layout";
import type { NormalizedLinkGraph, NormalizedObjectModule } from "../object-normalization";
import type { AArch64ObjectSymbol } from "../../target/aarch64/backend/object/object-module";
import { AARCH64_UNWIND_PROVIDER_KEY } from "./aarch64-entry-objects";

export interface MaterializeLinkedUnwindRecordsInput {
  readonly target: AArch64LinkerTargetSurface;
  readonly graph: NormalizedLinkGraph;
  readonly sections: readonly LinkedImageSection[];
  readonly symbols: readonly ResolvedImageSymbol[];
}

export interface MaterializeLinkedUnwindRecordsOutput {
  readonly unwindRecords: readonly LinkedUnwindRecord[];
  readonly dataDirectorySources: readonly LinkedDataDirectorySource[];
}

interface ContributionPlacement {
  readonly section: LinkedImageSection;
  readonly contribution: SectionContribution;
}

const UNWIND_VERIFICATION: LinkerVerificationSummary = Object.freeze({
  runs: Object.freeze([
    Object.freeze({
      verifierKey: "aarch64-linked-image",
      runKey: "materialize-unwind-metadata",
      status: "passed" as const,
    }),
  ]),
});

const IMAGE_SCN_MEM_EXECUTE = 0x20000000;

export function materializeLinkedUnwindRecords(
  input: MaterializeLinkedUnwindRecordsInput,
): LinkerResult<MaterializeLinkedUnwindRecordsOutput> {
  const diagnostics: LinkerDiagnostic[] = [];
  const symbolByModuleAndObjectKey = symbolIndexFor(input.symbols);
  const globalSymbolsByLinkageName = globalSymbolIndexFor(input.symbols);
  const globalSymbolsByContributionKey = globalSymbolsByContributionKeyFor(input.symbols);
  const objectSymbolByModuleAndObjectKey = objectSymbolIndexFor(input.graph);
  const contributionByModuleAndObjectSection = contributionIndexFor(input.sections);
  const contributionByStableKey = contributionStableKeyIndexFor(input.sections);
  const syntheticUnwindFunctionSymbols = syntheticUnwindFunctionSymbolKeys({
    graph: input.graph,
    symbolByModuleAndObjectKey,
    globalSymbolsByLinkageName,
    objectSymbolByModuleAndObjectKey,
  });
  const seenFunctionSymbols = new Set<string>();
  const unwindRecords: LinkedUnwindRecord[] = [];

  for (const module of input.graph.modules) {
    for (const objectRecord of module.objectModule.unwindRecords) {
      if (isOmittableSourceLeafRecord(module, objectRecord)) continue;

      const unwindStableKey = String(objectRecord.stableKey);
      const functionObjectKey = functionStableKeyFromUnwindRecord(unwindStableKey);
      if (functionObjectKey === undefined) {
        diagnostics.push(
          diagnostic(`image-layout:unwind-function-symbol-missing:${unwindStableKey}`),
        );
        continue;
      }

      const functionSymbol = functionSymbolForUnwindRecord({
        module,
        functionObjectKey,
        symbolByModuleAndObjectKey,
        objectSymbolByModuleAndObjectKey,
        globalSymbolsByLinkageName,
      });
      if (functionSymbol.kind === "missing") {
        diagnostics.push(
          diagnostic(
            `image-layout:unwind-function-symbol-missing:${unwindStableKey}:${module.moduleKey}:${functionObjectKey}`,
          ),
        );
        continue;
      }
      if (functionSymbol.kind === "ambiguous") {
        diagnostics.push(
          diagnostic(
            `image-layout:unwind-function-symbol-ambiguous:${unwindStableKey}:${functionSymbol.linkageName}:${functionSymbol.symbolKeys.join(":")}`,
          ),
        );
        continue;
      }

      if (
        module.syntheticProviderKey !== AARCH64_UNWIND_PROVIDER_KEY &&
        syntheticUnwindFunctionSymbols.has(functionSymbol.symbol.symbolKey)
      ) {
        continue;
      }

      if (seenFunctionSymbols.has(functionSymbol.symbol.symbolKey)) {
        diagnostics.push(
          diagnostic(
            `image-layout:duplicate-unwind-record:${functionSymbol.symbol.symbolKey}:${unwindStableKey}`,
          ),
        );
        continue;
      }
      seenFunctionSymbols.add(functionSymbol.symbol.symbolKey);

      const functionPlacement = contributionByStableKey.get(functionSymbol.symbol.contributionKey);
      if (functionPlacement === undefined) {
        diagnostics.push(
          diagnostic(
            `image-layout:unwind-function-contribution-missing:${unwindStableKey}:${functionSymbol.symbol.contributionKey}`,
          ),
        );
        continue;
      }

      const functionEndRva = functionEndRvaFor(
        functionSymbol.symbol,
        functionPlacement,
        globalSymbolsByContributionKey,
      );
      if (functionSymbol.symbol.rva >= functionEndRva) {
        diagnostics.push(
          diagnostic(
            `image-layout:unwind-function-range-unordered:${unwindStableKey}:${functionSymbol.symbol.rva}:${functionEndRva}`,
          ),
        );
        continue;
      }

      if (
        !isExecutableSection(functionPlacement.section) ||
        !rangeInSection(functionSymbol.symbol.rva, functionEndRva, functionPlacement.section)
      ) {
        diagnostics.push(
          diagnostic(
            `image-layout:unwind-function-not-executable:${unwindStableKey}:${functionSymbol.symbol.sectionKey}`,
          ),
        );
        continue;
      }

      const unwindPlacement = contributionByModuleAndObjectSection.get(
        moduleObjectKey(module.moduleKey, String(objectRecord.sectionKey)),
      );
      if (unwindPlacement === undefined) {
        diagnostics.push(
          diagnostic(
            `image-layout:unwind-info-contribution-missing:${unwindStableKey}:${module.moduleKey}:${String(
              objectRecord.sectionKey,
            )}`,
          ),
        );
        continue;
      }

      const unwindInfoRva = unwindPlacement.section.rva + unwindPlacement.contribution.offsetBytes;
      if (!isTargetUnwindDataSection(input.target, unwindPlacement.section)) {
        diagnostics.push(
          diagnostic(
            `image-layout:unwind-info-not-in-xdata:${unwindStableKey}:${unwindPlacement.section.stableKey}`,
          ),
        );
        continue;
      }

      unwindRecords.push(
        Object.freeze({
          stableKey: unwindStableKey,
          functionSymbolKey: functionSymbol.symbol.symbolKey,
          functionStartRva: functionSymbol.symbol.rva,
          functionEndRva,
          unwindInfoSectionKey: unwindPlacement.section.stableKey,
          unwindInfoRva,
        }),
      );
    }
  }

  if (diagnostics.length > 0) {
    return linkerError({ diagnostics, verification: UNWIND_VERIFICATION });
  }

  return linkerOk({
    value: Object.freeze({
      unwindRecords: Object.freeze(unwindRecords.sort(compareUnwindRecords)),
      dataDirectorySources: Object.freeze(dataDirectorySourcesFor(input.target, input.sections)),
    }),
    verification: UNWIND_VERIFICATION,
  });
}

function isOmittableSourceLeafRecord(
  module: NormalizedObjectModule,
  objectRecord: { readonly frameShape: string },
): boolean {
  return (
    module.syntheticProviderKey !== AARCH64_UNWIND_PROVIDER_KEY &&
    objectRecord.frameShape === "frameless-leaf"
  );
}

function syntheticUnwindFunctionSymbolKeys(input: {
  readonly graph: NormalizedLinkGraph;
  readonly symbolByModuleAndObjectKey: ReadonlyMap<string, ResolvedImageSymbol>;
  readonly globalSymbolsByLinkageName: ReadonlyMap<string, readonly ResolvedImageSymbol[]>;
  readonly objectSymbolByModuleAndObjectKey: ReadonlyMap<string, AArch64ObjectSymbol>;
}): ReadonlySet<string> {
  const functionSymbolKeys = new Set<string>();
  for (const module of input.graph.modules) {
    if (module.syntheticProviderKey === undefined) continue;
    for (const objectRecord of module.objectModule.unwindRecords) {
      const functionObjectKey = functionStableKeyFromUnwindRecord(String(objectRecord.stableKey));
      if (functionObjectKey === undefined) continue;
      const functionSymbol = functionSymbolForUnwindRecord({
        module,
        functionObjectKey,
        symbolByModuleAndObjectKey: input.symbolByModuleAndObjectKey,
        objectSymbolByModuleAndObjectKey: input.objectSymbolByModuleAndObjectKey,
        globalSymbolsByLinkageName: input.globalSymbolsByLinkageName,
      });
      if (functionSymbol.kind === "ok") functionSymbolKeys.add(functionSymbol.symbol.symbolKey);
    }
  }
  return functionSymbolKeys;
}

function symbolIndexFor(
  symbols: readonly ResolvedImageSymbol[],
): ReadonlyMap<string, ResolvedImageSymbol> {
  const index = new Map<string, ResolvedImageSymbol>();
  for (const symbol of symbols) {
    const objectKeyPrefix = `${symbol.sourceModuleKey}:symbol:`;
    if (!symbol.symbolKey.startsWith(objectKeyPrefix)) continue;
    index.set(
      moduleObjectKey(symbol.sourceModuleKey, symbol.symbolKey.slice(objectKeyPrefix.length)),
      symbol,
    );
  }
  return index;
}

function globalSymbolIndexFor(
  symbols: readonly ResolvedImageSymbol[],
): ReadonlyMap<string, readonly ResolvedImageSymbol[]> {
  const index = new Map<string, ResolvedImageSymbol[]>();
  for (const symbol of symbols) {
    if (symbol.binding !== "global" || symbol.linkageName === undefined) continue;
    index.set(symbol.linkageName, [...(index.get(symbol.linkageName) ?? []), symbol]);
  }
  for (const [linkageName, linkageSymbols] of index) {
    index.set(linkageName, linkageSymbols.sort(compareSymbolsByRvaThenKey));
  }
  return index;
}

function globalSymbolsByContributionKeyFor(
  symbols: readonly ResolvedImageSymbol[],
): ReadonlyMap<string, readonly ResolvedImageSymbol[]> {
  const index = new Map<string, ResolvedImageSymbol[]>();
  for (const symbol of symbols) {
    if (symbol.binding !== "global") continue;
    index.set(symbol.contributionKey, [...(index.get(symbol.contributionKey) ?? []), symbol]);
  }
  for (const [contributionKey, contributionSymbols] of index) {
    index.set(contributionKey, contributionSymbols.sort(compareSymbolsByRvaThenKey));
  }
  return index;
}

function objectSymbolIndexFor(
  graph: NormalizedLinkGraph,
): ReadonlyMap<string, AArch64ObjectSymbol> {
  const index = new Map<string, AArch64ObjectSymbol>();
  for (const module of graph.modules) {
    for (const symbol of module.objectModule.symbols) {
      index.set(moduleObjectKey(module.moduleKey, String(symbol.stableKey)), symbol);
    }
  }
  return index;
}

type UnwindFunctionSymbolResolution =
  | { readonly kind: "ok"; readonly symbol: ResolvedImageSymbol }
  | { readonly kind: "missing" }
  | {
      readonly kind: "ambiguous";
      readonly linkageName: string;
      readonly symbolKeys: readonly string[];
    };

function functionSymbolForUnwindRecord(input: {
  readonly module: NormalizedObjectModule;
  readonly functionObjectKey: string;
  readonly symbolByModuleAndObjectKey: ReadonlyMap<string, ResolvedImageSymbol>;
  readonly objectSymbolByModuleAndObjectKey: ReadonlyMap<string, AArch64ObjectSymbol>;
  readonly globalSymbolsByLinkageName: ReadonlyMap<string, readonly ResolvedImageSymbol[]>;
}): UnwindFunctionSymbolResolution {
  const sameModuleSymbol = input.symbolByModuleAndObjectKey.get(
    moduleObjectKey(input.module.moduleKey, input.functionObjectKey),
  );
  if (sameModuleSymbol !== undefined) return { kind: "ok", symbol: sameModuleSymbol };

  const objectSymbol = input.objectSymbolByModuleAndObjectKey.get(
    moduleObjectKey(input.module.moduleKey, input.functionObjectKey),
  );
  const linkageName = linkageNameForObjectSymbol(objectSymbol);
  if (linkageName === undefined) return { kind: "missing" };

  const definitions = input.globalSymbolsByLinkageName.get(linkageName) ?? [];
  if (definitions.length === 1) return { kind: "ok", symbol: definitions[0]! };
  if (definitions.length > 1) {
    return {
      kind: "ambiguous",
      linkageName,
      symbolKeys: Object.freeze(definitions.map((definition) => definition.symbolKey)),
    };
  }
  return { kind: "missing" };
}

function linkageNameForObjectSymbol(symbol: AArch64ObjectSymbol | undefined): string | undefined {
  return symbol?.kind === "global-definition" || symbol?.kind === "external-declaration"
    ? symbol.linkageName
    : undefined;
}

function functionEndRvaFor(
  functionSymbol: ResolvedImageSymbol,
  functionPlacement: ContributionPlacement,
  globalSymbolsByContributionKey: ReadonlyMap<string, readonly ResolvedImageSymbol[]>,
): number {
  const nextSymbol = globalSymbolsByContributionKey
    .get(functionSymbol.contributionKey)
    ?.find((symbol) => symbol.rva > functionSymbol.rva);
  if (nextSymbol !== undefined) return nextSymbol.rva;

  return (
    functionPlacement.section.rva +
    functionPlacement.contribution.offsetBytes +
    functionPlacement.contribution.sizeBytes
  );
}

function contributionIndexFor(
  sections: readonly LinkedImageSection[],
): ReadonlyMap<string, ContributionPlacement> {
  const index = new Map<string, ContributionPlacement>();
  for (const section of sections) {
    for (const contribution of section.contributions) {
      index.set(
        moduleObjectKey(contribution.sourceModuleKey, contribution.sourceObjectSectionKey),
        Object.freeze({ section, contribution }),
      );
    }
  }
  return index;
}

function contributionStableKeyIndexFor(
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

function dataDirectorySourcesFor(
  target: AArch64LinkerTargetSurface,
  sections: readonly LinkedImageSection[],
): readonly LinkedDataDirectorySource[] {
  const pdataSectionKey = target.outputSectionByObjectClass.get("unwind-pdata");
  const pdataSection = sections.find((section) => section.stableKey === pdataSectionKey);
  if (pdataSection === undefined) return Object.freeze([]);
  return Object.freeze([
    Object.freeze({
      stableKey: "directory:exception",
      directoryKind: "exception" as const,
      sectionKey: pdataSection.stableKey,
      rva: pdataSection.rva,
      sizeBytes: pdataSection.virtualSizeBytes,
    }),
  ]);
}

function functionStableKeyFromUnwindRecord(stableKey: string): string | undefined {
  return stableKey.startsWith("unwind:") ? stableKey.slice("unwind:".length) : undefined;
}

function moduleObjectKey(moduleKey: string, objectKey: string): string {
  return `${moduleKey}\0${objectKey}`;
}

function isExecutableSection(section: LinkedImageSection): boolean {
  return (section.flags & IMAGE_SCN_MEM_EXECUTE) !== 0;
}

function rangeInSection(startRva: number, endRva: number, section: LinkedImageSection): boolean {
  const sectionEndRva = section.rva + section.virtualSizeBytes;
  return startRva >= section.rva && endRva <= sectionEndRva;
}

function isTargetUnwindDataSection(
  target: AArch64LinkerTargetSurface,
  section: LinkedImageSection,
): boolean {
  return target.outputSectionByObjectClass.get("unwind-xdata") === section.stableKey;
}

function compareUnwindRecords(left: LinkedUnwindRecord, right: LinkedUnwindRecord): number {
  return compareCodeUnitStrings(left.stableKey, right.stableKey);
}

function compareSymbolsByRvaThenKey(left: ResolvedImageSymbol, right: ResolvedImageSymbol): number {
  const rvaComparison = left.rva - right.rva;
  return rvaComparison === 0
    ? compareCodeUnitStrings(left.symbolKey, right.symbolKey)
    : rvaComparison;
}

function diagnostic(stableDetail: string): LinkerDiagnostic {
  return linkerDiagnostic({
    code: "LINKER_IMAGE_LAYOUT_INVALID",
    ownerKey: "aarch64-linked-image",
    stableDetail,
  });
}
