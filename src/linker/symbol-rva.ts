import { compareCodeUnitStrings } from "../shared/deterministic-sort";
import {
  linkerDiagnostic,
  linkerError,
  linkerOk,
  type LinkerDiagnostic,
  type LinkerResult,
  type LinkerVerificationSummary,
} from "./diagnostics";
import type {
  LinkedImageSection,
  ResolvedImageSymbol,
  SectionContribution,
} from "./linked-image-layout";
import type { LayoutImageSectionsOutput } from "./section-layout";
import type { LinkSymbol, ResolveLinkSymbolsOutput } from "./symbol-resolution";

export interface MaterializeResolvedImageSymbolsInput {
  readonly resolvedSymbols: ResolveLinkSymbolsOutput;
  readonly layout: LayoutImageSectionsOutput;
}

export interface MaterializeResolvedImageSymbolsOutput {
  readonly symbols: readonly ResolvedImageSymbol[];
}

interface ContributionPlacement {
  readonly contribution: SectionContribution;
  readonly section: LinkedImageSection;
}

const SYMBOL_RVA_VERIFICATION: LinkerVerificationSummary = Object.freeze({
  runs: Object.freeze([
    Object.freeze({
      verifierKey: "linker-symbol-rva",
      runKey: "materialize-symbol-rvas",
      status: "passed" as const,
    }),
  ]),
});

export function materializeResolvedImageSymbols(
  input: MaterializeResolvedImageSymbolsInput,
): LinkerResult<MaterializeResolvedImageSymbolsOutput> {
  const contributionBySymbolLocation = contributionIndexFor(input.layout.sections);
  const diagnostics: LinkerDiagnostic[] = [];
  const symbols: ResolvedImageSymbol[] = [];

  for (const symbol of input.resolvedSymbols.symbols) {
    if (symbol.definition === "declaration") continue;
    if (symbol.binding === "external") continue;

    const placement = contributionBySymbolLocation.get(symbolLocationKey(symbol));
    if (placement === undefined) {
      diagnostics.push(
        diagnostic(
          `symbol-rva:missing-layout-contribution:${symbol.symbolKey}:${symbol.sourceModuleKey}:${symbol.objectSectionKey ?? "<missing>"}`,
        ),
      );
      continue;
    }

    const objectOffsetBytes = symbol.objectOffsetBytes;
    if (
      objectOffsetBytes === undefined ||
      !Number.isSafeInteger(objectOffsetBytes) ||
      objectOffsetBytes < 0 ||
      objectOffsetBytes > placement.contribution.sizeBytes
    ) {
      diagnostics.push(
        diagnostic(
          `symbol-rva:symbol-offset-outside-contribution:${symbol.symbolKey}:${String(
            objectOffsetBytes,
          )}:${placement.contribution.stableKey}:${placement.contribution.sizeBytes}`,
        ),
      );
      continue;
    }

    const contributionRva = checkedAdd(placement.section.rva, placement.contribution.offsetBytes);
    const rva =
      contributionRva === undefined ? undefined : checkedAdd(contributionRva, objectOffsetBytes);
    if (rva === undefined) {
      diagnostics.push(diagnostic(`symbol-rva:integer-overflow:${symbol.symbolKey}`));
      continue;
    }

    symbols.push(
      Object.freeze({
        symbolKey: symbol.symbolKey,
        ...(symbol.linkageName === undefined ? {} : { linkageName: symbol.linkageName }),
        binding: symbol.binding,
        sourceModuleKey: symbol.sourceModuleKey,
        sectionKey: placement.contribution.outputSectionKey,
        contributionKey: placement.contribution.stableKey,
        rva,
        objectOffsetBytes,
      }),
    );
  }

  if (diagnostics.length > 0) {
    return linkerError({ diagnostics, verification: SYMBOL_RVA_VERIFICATION });
  }

  return linkerOk({
    value: Object.freeze({
      symbols: Object.freeze(symbols.sort(compareResolvedImageSymbols)),
    }),
    verification: SYMBOL_RVA_VERIFICATION,
  });
}

function contributionIndexFor(
  sections: readonly LinkedImageSection[],
): ReadonlyMap<string, ContributionPlacement> {
  const index = new Map<string, ContributionPlacement>();
  for (const section of sections) {
    for (const contribution of section.contributions) {
      index.set(contributionLocationKey(contribution), Object.freeze({ contribution, section }));
    }
  }
  return index;
}

function symbolLocationKey(symbol: LinkSymbol): string {
  return `${symbol.sourceModuleKey}\0${symbol.objectSectionKey ?? ""}`;
}

function contributionLocationKey(contribution: SectionContribution): string {
  return `${contribution.sourceModuleKey}\0${contribution.sourceObjectSectionKey}`;
}

function checkedAdd(left: number, right: number): number | undefined {
  const value = left + right;
  if (!Number.isSafeInteger(value) || value < 0) return undefined;
  return value;
}

function compareResolvedImageSymbols(
  left: ResolvedImageSymbol,
  right: ResolvedImageSymbol,
): number {
  return compareCodeUnitStrings(left.symbolKey, right.symbolKey);
}

function diagnostic(stableDetail: string): LinkerDiagnostic {
  return linkerDiagnostic({
    code: "LINKER_IMAGE_LAYOUT_INVALID",
    ownerKey: "symbol-rva",
    stableDetail,
  });
}
