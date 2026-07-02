import { compareCodeUnitStrings } from "../shared/deterministic-sort";
import {
  linkerDiagnostic,
  linkerError,
  linkerOk,
  type LinkerDiagnostic,
  type LinkerResult,
  type LinkerVerificationSummary,
} from "./diagnostics";
import type { NormalizedLinkGraph, NormalizedObjectModule } from "./object-normalization";
import { relocationKeyFor } from "./stable-keys";
import type {
  AArch64ObjectRelocation,
  AArch64ObjectSymbol,
} from "../target/aarch64/backend/object/object-module";

export type LinkSymbolBinding = "local" | "global" | "external";
export type LinkSymbolDefinition = "defined" | "declaration";

export interface LinkSymbol {
  readonly symbolKey: string;
  readonly linkageName?: string;
  readonly sourceModuleKey: string;
  readonly objectSymbolKey: string;
  readonly binding: LinkSymbolBinding;
  readonly definition: LinkSymbolDefinition;
  readonly objectSectionKey?: string;
  readonly objectOffsetBytes?: number;
}

export interface ResolvedLinkRelocationTarget {
  readonly relocationKey: string;
  readonly sourceModuleKey: string;
  readonly targetSymbolKey: string;
}

export interface ResolveLinkSymbolsOutput {
  readonly symbols: readonly LinkSymbol[];
  readonly relocationTargets: readonly ResolvedLinkRelocationTarget[];
}

const SYMBOL_RESOLUTION_VERIFICATION: LinkerVerificationSummary = Object.freeze({
  runs: Object.freeze([
    Object.freeze({
      verifierKey: "linker-symbol-resolution",
      runKey: "resolve-symbols",
      status: "passed" as const,
    }),
  ]),
});

export function resolveLinkSymbols(
  graph: NormalizedLinkGraph,
): LinkerResult<ResolveLinkSymbolsOutput> {
  const symbols = buildSymbols(graph);
  const indexes = buildSymbolIndexes(symbols);
  const diagnostics = [
    ...duplicateGlobalDiagnostics(indexes.globalDefinitionsByLinkageName),
    ...unresolvedExternalDiagnostics(indexes),
  ];
  const relocationTargets = resolveRelocationTargets(graph, indexes, diagnostics);

  if (diagnostics.length > 0) {
    return linkerError({
      diagnostics,
      verification: SYMBOL_RESOLUTION_VERIFICATION,
    });
  }

  return linkerOk({
    value: Object.freeze({
      symbols,
      relocationTargets,
    }),
    verification: SYMBOL_RESOLUTION_VERIFICATION,
  });
}

function buildSymbols(graph: NormalizedLinkGraph): readonly LinkSymbol[] {
  return Object.freeze(
    graph.modules
      .flatMap((module) => module.objectModule.symbols.map((symbol) => linkSymbol(module, symbol)))
      .sort(compareSymbols),
  );
}

function linkSymbol(module: NormalizedObjectModule, symbol: AArch64ObjectSymbol): LinkSymbol {
  const symbolKey = symbolKeyFor(module.moduleKey, String(symbol.stableKey));
  if (symbol.kind === "external-declaration") {
    return Object.freeze({
      symbolKey,
      linkageName: symbol.linkageName,
      sourceModuleKey: module.moduleKey,
      objectSymbolKey: String(symbol.stableKey),
      binding: "external",
      definition: "declaration",
    });
  }

  return Object.freeze({
    symbolKey,
    ...(symbol.kind === "global-definition" ? { linkageName: symbol.linkageName } : {}),
    sourceModuleKey: module.moduleKey,
    objectSymbolKey: String(symbol.stableKey),
    binding: symbol.kind === "global-definition" ? "global" : "local",
    definition: "defined",
    objectSectionKey: String(symbol.sectionKey),
    objectOffsetBytes: symbol.offsetBytes,
  });
}

interface SymbolIndexes {
  readonly byModuleAndObjectKey: ReadonlyMap<string, LinkSymbol>;
  readonly globalDefinitionsByLinkageName: ReadonlyMap<string, readonly LinkSymbol[]>;
  readonly declarationsByLinkageName: ReadonlyMap<string, readonly LinkSymbol[]>;
}

function buildSymbolIndexes(symbols: readonly LinkSymbol[]): SymbolIndexes {
  const byModuleAndObjectKey = new Map<string, LinkSymbol>();
  const mutableGlobalDefinitionsByLinkageName = new Map<string, LinkSymbol[]>();
  const mutableDeclarationsByLinkageName = new Map<string, LinkSymbol[]>();

  for (const symbol of symbols) {
    byModuleAndObjectKey.set(
      moduleObjectSymbolIndexKey(symbol.sourceModuleKey, symbol.objectSymbolKey),
      symbol,
    );
    if (symbol.linkageName === undefined) continue;

    if (symbol.binding === "global") {
      const definitions = mutableGlobalDefinitionsByLinkageName.get(symbol.linkageName) ?? [];
      definitions.push(symbol);
      mutableGlobalDefinitionsByLinkageName.set(symbol.linkageName, definitions);
    } else if (symbol.binding === "external") {
      const declarations = mutableDeclarationsByLinkageName.get(symbol.linkageName) ?? [];
      declarations.push(symbol);
      mutableDeclarationsByLinkageName.set(symbol.linkageName, declarations);
    }
  }

  return Object.freeze({
    byModuleAndObjectKey,
    globalDefinitionsByLinkageName: freezeSymbolMap(mutableGlobalDefinitionsByLinkageName),
    declarationsByLinkageName: freezeSymbolMap(mutableDeclarationsByLinkageName),
  });
}

function duplicateGlobalDiagnostics(
  globalDefinitionsByLinkageName: ReadonlyMap<string, readonly LinkSymbol[]>,
): readonly LinkerDiagnostic[] {
  const diagnostics: LinkerDiagnostic[] = [];

  for (const [linkageName, definitions] of globalDefinitionsByLinkageName) {
    if (definitions.length <= 1) continue;
    diagnostics.push(
      symbolDiagnostic(
        `symbol-resolution:duplicate-global-definition:${linkageName}:${definitions
          .map((symbol) => symbol.symbolKey)
          .join(":")}`,
      ),
    );
  }

  return Object.freeze(diagnostics);
}

function unresolvedExternalDiagnostics(indexes: SymbolIndexes): readonly LinkerDiagnostic[] {
  const diagnostics: LinkerDiagnostic[] = [];

  for (const [linkageName, declarations] of indexes.declarationsByLinkageName) {
    if ((indexes.globalDefinitionsByLinkageName.get(linkageName) ?? []).length > 0) continue;
    diagnostics.push(
      symbolDiagnostic(
        `symbol-resolution:unresolved-external:${linkageName}:${declarations
          .map((symbol) => symbol.symbolKey)
          .join(":")}`,
      ),
    );
  }

  return Object.freeze(diagnostics);
}

function resolveRelocationTargets(
  graph: NormalizedLinkGraph,
  indexes: SymbolIndexes,
  diagnostics: LinkerDiagnostic[],
): readonly ResolvedLinkRelocationTarget[] {
  const relocationTargets: ResolvedLinkRelocationTarget[] = [];

  for (const module of graph.modules) {
    for (const relocation of module.objectModule.relocations) {
      const targetSymbol = resolveRelocationTarget(module.moduleKey, relocation, indexes);
      if (targetSymbol === undefined) {
        diagnostics.push(unresolvedRelocationDiagnostic(module.moduleKey, relocation));
        continue;
      }
      relocationTargets.push(
        Object.freeze({
          relocationKey: relocationKeyFor(module.moduleKey, String(relocation.stableKey)),
          sourceModuleKey: module.moduleKey,
          targetSymbolKey: targetSymbol.symbolKey,
        }),
      );
    }
  }

  return Object.freeze(relocationTargets.sort(compareRelocationTargets));
}

function resolveRelocationTarget(
  moduleKey: string,
  relocation: AArch64ObjectRelocation,
  indexes: SymbolIndexes,
): LinkSymbol | undefined {
  if (relocation.target.kind === "symbol-stable-key") {
    return indexes.byModuleAndObjectKey.get(
      moduleObjectSymbolIndexKey(moduleKey, relocation.target.stableKey),
    );
  }

  const globalDefinitions =
    indexes.globalDefinitionsByLinkageName.get(relocation.target.linkageName) ?? [];
  const sameModuleDefinition = globalDefinitions.find(
    (symbol) => symbol.sourceModuleKey === moduleKey,
  );
  if (sameModuleDefinition !== undefined) return sameModuleDefinition;
  if (globalDefinitions.length === 1) return globalDefinitions[0];

  return undefined;
}

function unresolvedRelocationDiagnostic(
  moduleKey: string,
  relocation: AArch64ObjectRelocation,
): LinkerDiagnostic {
  if (relocation.target.kind === "symbol-stable-key") {
    return symbolDiagnostic(
      `symbol-resolution:unresolved-symbol-stable-key:${moduleKey}:reloc:${relocation.stableKey}:${relocation.target.stableKey}`,
    );
  }

  return symbolDiagnostic(
    `symbol-resolution:unresolved-linkage-name:${moduleKey}:reloc:${relocation.stableKey}:${relocation.target.linkageName}`,
  );
}

function freezeSymbolMap(
  input: ReadonlyMap<string, LinkSymbol[]>,
): ReadonlyMap<string, readonly LinkSymbol[]> {
  return new Map(
    [...input.entries()]
      .sort(([left], [right]) => compareCodeUnitStrings(left, right))
      .map(([key, symbols]) => [key, Object.freeze([...symbols].sort(compareSymbols))]),
  );
}

function symbolKeyFor(moduleKey: string, objectSymbolStableKey: string): string {
  return `${moduleKey}:symbol:${objectSymbolStableKey}`;
}

function moduleObjectSymbolIndexKey(moduleKey: string, objectSymbolStableKey: string): string {
  return `${moduleKey}\0${objectSymbolStableKey}`;
}

function compareSymbols(left: LinkSymbol, right: LinkSymbol): number {
  return compareCodeUnitStrings(left.symbolKey, right.symbolKey);
}

function compareRelocationTargets(
  left: ResolvedLinkRelocationTarget,
  right: ResolvedLinkRelocationTarget,
): number {
  return compareCodeUnitStrings(left.relocationKey, right.relocationKey);
}

function symbolDiagnostic(stableDetail: string): LinkerDiagnostic {
  return linkerDiagnostic({
    code: "LINKER_SYMBOL_RESOLUTION_FAILED",
    ownerKey: "symbol-resolution",
    stableDetail,
  });
}
