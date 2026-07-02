import { compareCodeUnitStrings } from "../shared/deterministic-sort";
import {
  linkerDiagnostic,
  linkerError,
  linkerOk,
  type LinkerDiagnostic,
  type LinkerResult,
  type LinkerVerificationSummary,
} from "./diagnostics";
import type { AArch64LinkerTargetSurface } from "./image-layout-policy";
import type {
  AArch64LinkedImageEntry,
  AppliedRelocation,
  LinkedImageSection,
  ResolvedImageSymbol,
} from "./linked-image-layout";
import type { NormalizedLinkGraph } from "./object-normalization";
import { relocationKeyFor } from "./stable-keys";

export interface ResolveLinkedImageEntryInput {
  readonly target: AArch64LinkerTargetSurface;
  readonly entry: {
    readonly wrelaBootLinkageName: string;
  };
  readonly symbols: readonly ResolvedImageSymbol[];
  readonly sections: readonly LinkedImageSection[];
  readonly appliedRelocations: readonly AppliedRelocation[];
  readonly graph?: NormalizedLinkGraph;
}

export interface ResolveLinkedImageEntryOutput {
  readonly entry: AArch64LinkedImageEntry;
}

const ENTRY_RESOLUTION_VERIFICATION: LinkerVerificationSummary = Object.freeze({
  runs: Object.freeze([
    Object.freeze({
      verifierKey: "linker-entry-resolution",
      runKey: "resolve-entry",
      status: "passed" as const,
    }),
  ]),
});

const PE32_PLUS_ENTRY_RVA_MAX = 0xffff_ffff;
const SECTION_FLAG_EXECUTE = 0x2000_0000;

export function resolveLinkedImageEntry(
  input: ResolveLinkedImageEntryInput,
): LinkerResult<ResolveLinkedImageEntryOutput> {
  const loaderEntryLinkageName = input.target.entryPolicy.loaderEntryLinkageName;
  const wrelaBootLinkageName = input.entry.wrelaBootLinkageName;
  const requiresBootHandoff = input.target.entryPolicy.requiresBootHandoff;
  const sectionsByKey = new Map(input.sections.map((section) => [section.stableKey, section]));
  const diagnostics: LinkerDiagnostic[] = [];

  const loaderEntry = resolveUniqueGlobalDefinition(input.symbols, loaderEntryLinkageName);
  if (loaderEntry.kind === "missing") {
    diagnostics.push(diagnostic(`entry:missing-loader-symbol:${loaderEntryLinkageName}`));
  } else if (loaderEntry.kind === "duplicate") {
    diagnostics.push(
      diagnostic(
        `entry:duplicate-loader-symbol:${loaderEntryLinkageName}:${loaderEntry.symbolKeys.join(":")}`,
      ),
    );
  }

  const bootSymbol = resolveUniqueGlobalDefinition(input.symbols, wrelaBootLinkageName);
  if (requiresBootHandoff && bootSymbol.kind === "missing") {
    diagnostics.push(diagnostic(`entry:missing-boot-symbol:${wrelaBootLinkageName}`));
  } else if (requiresBootHandoff && bootSymbol.kind === "duplicate") {
    diagnostics.push(
      diagnostic(
        `entry:duplicate-boot-symbol:${wrelaBootLinkageName}:${bootSymbol.symbolKeys.join(":")}`,
      ),
    );
  }

  if (loaderEntry.kind === "ok") {
    const section = sectionsByKey.get(loaderEntry.symbol.sectionKey);
    if (section === undefined) {
      diagnostics.push(
        diagnostic(
          `entry:missing-loader-section:${loaderEntryLinkageName}:${loaderEntry.symbol.sectionKey}`,
        ),
      );
    } else if (!satisfiesRequiredEntrySectionClass(input.target, section)) {
      diagnostics.push(
        diagnostic(`entry:non-executable-section:${loaderEntryLinkageName}:${section.stableKey}`),
      );
    }

    if (!isPe32PlusEntryRva(loaderEntry.symbol.rva)) {
      diagnostics.push(
        diagnostic(`entry:rva-out-of-range:${loaderEntryLinkageName}:${loaderEntry.symbol.rva}`),
      );
    }

    diagnostics.push(
      ...unresolvedLoaderRelocationDiagnostics({
        graph: input.graph,
        loaderEntry: loaderEntry.symbol,
        sections: input.sections,
        appliedRelocations: input.appliedRelocations,
      }),
    );
  }

  if (diagnostics.length > 0) {
    return linkerError({
      diagnostics,
      verification: ENTRY_RESOLUTION_VERIFICATION,
    });
  }

  if (loaderEntry.kind !== "ok" || (requiresBootHandoff && bootSymbol.kind !== "ok")) {
    return linkerError({
      diagnostics: [diagnostic("entry:internal-resolution-state-invalid")],
      verification: ENTRY_RESOLUTION_VERIFICATION,
    });
  }

  return linkerOk({
    value: Object.freeze({
      entry: Object.freeze({
        loaderEntryLinkageName,
        loaderEntryRva: loaderEntry.symbol.rva,
        wrelaBootLinkageName,
        wrelaBootRva: bootSymbol.kind === "ok" ? bootSymbol.symbol.rva : 0,
      }),
    }),
    verification: ENTRY_RESOLUTION_VERIFICATION,
  });
}

type UniqueGlobalDefinition =
  | { readonly kind: "ok"; readonly symbol: ResolvedImageSymbol }
  | { readonly kind: "missing" }
  | { readonly kind: "duplicate"; readonly symbolKeys: readonly string[] };

function resolveUniqueGlobalDefinition(
  symbols: readonly ResolvedImageSymbol[],
  linkageName: string,
): UniqueGlobalDefinition {
  const definitions = symbols
    .filter((symbol) => symbol.binding === "global" && symbol.linkageName === linkageName)
    .sort((left, right) => compareCodeUnitStrings(left.symbolKey, right.symbolKey));
  if (definitions.length === 0) return { kind: "missing" };
  if (definitions.length > 1) {
    return {
      kind: "duplicate",
      symbolKeys: Object.freeze(definitions.map((symbol) => symbol.symbolKey)),
    };
  }
  return { kind: "ok", symbol: definitions[0] as ResolvedImageSymbol };
}

function isPe32PlusEntryRva(rva: number): boolean {
  return Number.isSafeInteger(rva) && rva >= 0 && rva <= PE32_PLUS_ENTRY_RVA_MAX;
}

function satisfiesRequiredEntrySectionClass(
  target: AArch64LinkerTargetSurface,
  section: LinkedImageSection,
): boolean {
  if (target.entryPolicy.requiredEntrySectionClass !== "executable") return false;
  return section.classKey === "executable-text" && (section.flags & SECTION_FLAG_EXECUTE) !== 0;
}

function unresolvedLoaderRelocationDiagnostics(input: {
  readonly graph?: NormalizedLinkGraph;
  readonly loaderEntry: ResolvedImageSymbol;
  readonly sections: readonly LinkedImageSection[];
  readonly appliedRelocations: readonly AppliedRelocation[];
}): readonly LinkerDiagnostic[] {
  if (input.graph === undefined) return [];

  const appliedRelocationKeys = new Set(
    input.appliedRelocations.map((relocation) => relocation.relocationKey),
  );
  const diagnostics: LinkerDiagnostic[] = [];
  const loaderContribution = contributionForLoader(input.graph, input.sections, input.loaderEntry);
  if (loaderContribution === undefined) return [];

  for (const relocation of loaderContribution.module.objectModule.relocations) {
    if (String(relocation.sectionKey) !== loaderContribution.sourceObjectSectionKey) continue;
    const relocationKey = relocationKeyFor(
      loaderContribution.module.moduleKey,
      String(relocation.stableKey),
    );
    if (appliedRelocationKeys.has(relocationKey)) continue;
    diagnostics.push(diagnostic(`entry:unresolved-relocation:${relocationKey}`));
  }

  return Object.freeze(
    diagnostics.sort((left, right) =>
      compareCodeUnitStrings(left.stableDetail, right.stableDetail),
    ),
  );
}

function contributionForLoader(
  graph: NormalizedLinkGraph,
  sections: readonly LinkedImageSection[],
  loaderEntry: ResolvedImageSymbol,
):
  | {
      readonly module: NormalizedLinkGraph["modules"][number];
      readonly sourceObjectSectionKey: string;
    }
  | undefined {
  const module = graph.modules.find(
    (candidate) => candidate.moduleKey === loaderEntry.sourceModuleKey,
  );
  if (module === undefined) return undefined;
  const contribution = sections
    .flatMap((section) => section.contributions)
    .find((candidate) => candidate.stableKey === loaderEntry.contributionKey);
  if (contribution === undefined) return undefined;
  return {
    module,
    sourceObjectSectionKey: contribution.sourceObjectSectionKey,
  };
}

function diagnostic(stableDetail: string): LinkerDiagnostic {
  return linkerDiagnostic({
    code: "LINKER_ENTRY_RESOLUTION_FAILED",
    ownerKey: "entry-resolution",
    stableDetail,
  });
}
