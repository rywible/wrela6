import { compareCodeUnitStrings } from "../shared/deterministic-sort";
import { stableHash, stableJson } from "../shared/stable-json";
import { encodeAArch64RelocationValue } from "./aarch64/aarch64-relocations";
import type {
  AArch64LinkInputModule,
  AArch64LinkerVeneerProvider,
  AArch64SyntheticObjectModule,
} from "./aarch64/aarch64-linker";
import {
  linkerDiagnostic,
  linkerError,
  linkerOk,
  type LinkerDiagnostic,
  type LinkerDiagnosticMode,
  type LinkerResult,
  type LinkerVerificationSummary,
} from "./diagnostics";
import type { AArch64LinkerTargetSurface } from "./image-layout-policy";
import type {
  AppliedRelocation,
  ImageBaseRelocation,
  LinkedImageSection,
  ResolvedImageSymbol,
} from "./linked-image-layout";
import {
  normalizeAArch64LinkInputs,
  verifyAArch64LinkInputObjects,
  type NormalizedLinkGraph,
  type NormalizedObjectModule,
} from "./object-normalization";
import { validateSyntheticObjectModulesSurface } from "./object-module-surface";
import type {
  ApplyResolvedRelocationsInput,
  ApplyResolvedRelocationsOutput,
  PlannedRelocationPair,
  PlanPairedRelocationsInput,
} from "./relocation-application";
import type { LayoutImageSectionsInput, LayoutImageSectionsOutput } from "./section-layout";
import { relocationKeyFor } from "./stable-keys";
import type {
  MaterializeResolvedImageSymbolsInput,
  MaterializeResolvedImageSymbolsOutput,
} from "./symbol-rva";
import {
  resolveLinkSymbols,
  type ResolveLinkSymbolsOutput,
  type ResolvedLinkRelocationTarget,
} from "./symbol-resolution";
import {
  aarch64ObjectModule,
  aarch64ObjectRelocation,
  aarch64ObjectSymbol,
  type AArch64ObjectLinkerVeneerRequest,
  type AArch64ObjectModule,
  type AArch64ObjectRelocation,
  type AArch64ObjectSymbol,
} from "../target/aarch64/backend/object/object-module";

export interface LinkLayoutFixedPointFunctions {
  readonly layoutSections: (
    input: LayoutImageSectionsInput,
  ) => LinkerResult<LayoutImageSectionsOutput>;
  readonly materializeSymbols: (
    input: MaterializeResolvedImageSymbolsInput,
  ) => LinkerResult<MaterializeResolvedImageSymbolsOutput>;
  readonly planPairs: (
    input: PlanPairedRelocationsInput,
  ) => LinkerResult<readonly PlannedRelocationPair[]>;
  readonly applyRelocations: (
    input: ApplyResolvedRelocationsInput,
  ) => LinkerResult<ApplyResolvedRelocationsOutput>;
}

export interface LinkLayoutFixedPointInput {
  readonly target: AArch64LinkerTargetSurface;
  readonly graph: NormalizedLinkGraph;
  readonly resolvedSymbols: ResolveLinkSymbolsOutput;
  readonly veneerProvider?: AArch64LinkerVeneerProvider;
  readonly diagnosticMode?: LinkerDiagnosticMode;
}

export interface LinkLayoutFixedPointOutput {
  readonly graph: NormalizedLinkGraph;
  readonly layout: LayoutImageSectionsOutput;
  readonly symbols: readonly ResolvedImageSymbol[];
  readonly relocationTargets: readonly ResolvedLinkRelocationTarget[];
  readonly plannedPairs: readonly PlannedRelocationPair[];
  readonly sections: readonly LinkedImageSection[];
  readonly appliedRelocations: readonly AppliedRelocation[];
  readonly baseRelocations: readonly ImageBaseRelocation[];
}

export type LinkLayoutFixedPointFailedStage =
  | "layout-sections"
  | "materialize-symbol-rvas"
  | "plan-relocations"
  | "apply-relocations";

export type LinkLayoutFixedPointResult =
  | {
      readonly kind: "ok";
      readonly value: LinkLayoutFixedPointOutput;
      readonly diagnostics: readonly LinkerDiagnostic[];
      readonly verification: LinkerVerificationSummary;
    }
  | {
      readonly kind: "error";
      readonly failedStage: LinkLayoutFixedPointFailedStage;
      readonly diagnostics: readonly LinkerDiagnostic[];
      readonly verification: LinkerVerificationSummary;
    };

interface FixedPointState {
  readonly graph: NormalizedLinkGraph;
  readonly resolvedSymbols: ResolveLinkSymbolsOutput;
  readonly retargetedRelocations: ReadonlyMap<string, string>;
  readonly veneerModules: ReadonlyMap<string, readonly AArch64LinkInputModule[]>;
}

interface IndexedRelocation {
  readonly module: NormalizedObjectModule;
  readonly relocationKey: string;
  readonly relocation: AArch64ObjectRelocation;
}

interface VeneerCandidate extends IndexedRelocation {
  readonly sourcePatchRva: number;
  readonly targetSymbolKey: string;
  readonly targetLinkageName?: string;
  readonly targetRva: number;
}

const MAX_FIXED_POINT_ITERATIONS = 8;
const FIXED_POINT_VERIFICATION: LinkerVerificationSummary = Object.freeze({
  runs: Object.freeze([
    Object.freeze({
      verifierKey: "linker-layout-fixed-point",
      runKey: "run-layout-fixed-point",
      status: "passed" as const,
    }),
  ]),
});

export function runLinkLayoutFixedPoint(
  input: LinkLayoutFixedPointInput,
  functions: LinkLayoutFixedPointFunctions,
): LinkLayoutFixedPointResult {
  let state: FixedPointState = Object.freeze({
    graph: input.graph,
    resolvedSymbols: input.resolvedSymbols,
    retargetedRelocations: new Map(),
    veneerModules: new Map(),
  });
  let previousFingerprint: string | undefined;
  let lastOutput: LinkLayoutFixedPointOutput | undefined;

  for (let iteration = 0; iteration < MAX_FIXED_POINT_ITERATIONS; iteration += 1) {
    const stages = runStages(input.target, state.graph, state.resolvedSymbols, functions);
    if (stages.kind === "error") {
      const recover = requestEligibleVeneers(input, state, stages.valueForRecovery);
      if (recover.kind === "error") {
        return fixedPointError({
          failedStage: stages.failedStage,
          diagnostics: recover.diagnostics,
        });
      }
      if (recover.changed) {
        state = recover.state;
        continue;
      }
      return fixedPointError({
        failedStage: stages.failedStage,
        diagnostics: stages.diagnostics,
      });
    }

    lastOutput = Object.freeze({
      graph: state.graph,
      layout: stages.value.layout,
      symbols: stages.value.symbols,
      relocationTargets: state.resolvedSymbols.relocationTargets,
      plannedPairs: stages.value.plannedPairs,
      sections: stages.value.sections,
      appliedRelocations: stages.value.appliedRelocations,
      baseRelocations: stages.value.baseRelocations,
    });

    const fingerprint = fixedPointFingerprint(state, lastOutput);
    if (previousFingerprint === fingerprint) {
      return linkerOk({ value: lastOutput, verification: FIXED_POINT_VERIFICATION });
    }
    previousFingerprint = fingerprint;

    const recover = requestEligibleVeneers(input, state, stages.value);
    if (recover.kind === "error") {
      return fixedPointError({
        failedStage: "apply-relocations",
        diagnostics: recover.diagnostics,
      });
    }
    if (!recover.changed) {
      return linkerOk({ value: lastOutput, verification: FIXED_POINT_VERIFICATION });
    }
    state = recover.state;
  }

  return fixedPointError({
    failedStage: "apply-relocations",
    diagnostics: [diagnostic(`section-layout:fixed-point-exhausted:${MAX_FIXED_POINT_ITERATIONS}`)],
  });
}

function runStages(
  target: AArch64LinkerTargetSurface,
  graph: NormalizedLinkGraph,
  resolvedSymbols: ResolveLinkSymbolsOutput,
  functions: LinkLayoutFixedPointFunctions,
):
  | {
      readonly kind: "ok";
      readonly value: StageOutput;
    }
  | {
      readonly kind: "error";
      readonly failedStage: LinkLayoutFixedPointFailedStage;
      readonly diagnostics: readonly LinkerDiagnostic[];
      readonly valueForRecovery?: PartialStageOutput;
    } {
  const layout = functions.layoutSections({ target, graph });
  if (layout.kind === "error")
    return { kind: "error", failedStage: "layout-sections", diagnostics: layout.diagnostics };
  const symbols = functions.materializeSymbols({ resolvedSymbols, layout: layout.value });
  if (symbols.kind === "error")
    return {
      kind: "error",
      failedStage: "materialize-symbol-rvas",
      diagnostics: symbols.diagnostics,
    };
  const plannedPairs = functions.planPairs({
    graph,
    relocationTargets: resolvedSymbols.relocationTargets,
  });
  if (plannedPairs.kind === "error") {
    return {
      kind: "error",
      failedStage: "plan-relocations",
      diagnostics: plannedPairs.diagnostics,
      valueForRecovery: { layout: layout.value, symbols: symbols.value.symbols },
    };
  }
  const applied = functions.applyRelocations({
    target,
    graph,
    sections: layout.value.sections,
    symbols: symbols.value.symbols,
    relocationTargets: resolvedSymbols.relocationTargets,
    plannedPairs: plannedPairs.value,
  });
  if (applied.kind === "error") {
    return {
      kind: "error",
      failedStage: "apply-relocations",
      diagnostics: applied.diagnostics,
      valueForRecovery: {
        layout: layout.value,
        symbols: symbols.value.symbols,
        plannedPairs: plannedPairs.value,
      },
    };
  }
  return {
    kind: "ok",
    value: Object.freeze({
      layout: layout.value,
      symbols: symbols.value.symbols,
      plannedPairs: plannedPairs.value,
      sections: applied.value.sections,
      appliedRelocations: applied.value.appliedRelocations,
      baseRelocations: applied.value.baseRelocations,
    }),
  };
}

function fixedPointError(input: {
  readonly failedStage: LinkLayoutFixedPointFailedStage;
  readonly diagnostics: readonly LinkerDiagnostic[];
}): LinkLayoutFixedPointResult {
  return Object.freeze({
    kind: "error" as const,
    failedStage: input.failedStage,
    diagnostics: linkerError({
      diagnostics: input.diagnostics,
      verification: FIXED_POINT_VERIFICATION,
    }).diagnostics,
    verification: FIXED_POINT_VERIFICATION,
  });
}

interface PartialStageOutput {
  readonly layout?: LayoutImageSectionsOutput;
  readonly symbols?: readonly ResolvedImageSymbol[];
  readonly plannedPairs?: readonly PlannedRelocationPair[];
}

interface StageOutput extends Required<PartialStageOutput> {
  readonly sections: readonly LinkedImageSection[];
  readonly appliedRelocations: readonly AppliedRelocation[];
  readonly baseRelocations: readonly ImageBaseRelocation[];
}

function requestEligibleVeneers(
  input: LinkLayoutFixedPointInput,
  state: FixedPointState,
  stages: PartialStageOutput | undefined,
):
  | { readonly kind: "ok"; readonly changed: false }
  | { readonly kind: "ok"; readonly changed: true; readonly state: FixedPointState }
  | { readonly kind: "error"; readonly diagnostics: readonly LinkerDiagnostic[] } {
  if (stages?.layout === undefined || stages.symbols === undefined)
    return { kind: "ok", changed: false };

  const candidates = outOfRangeVeneerCandidates(input.target, state, stages.layout, stages.symbols);
  if (candidates.kind === "error") return candidates;
  const pending = candidates.value.filter(
    (candidate) => !state.retargetedRelocations.has(candidate.relocationKey),
  );
  if (pending.length === 0) return { kind: "ok", changed: false };

  const diagnostics: LinkerDiagnostic[] = [];
  const newRetargets = new Map(state.retargetedRelocations);
  const newVeneers = new Map(state.veneerModules);
  for (const candidate of pending.sort(compareCandidates)) {
    const request = candidate.relocation.linkerVeneer;
    if (request === undefined) continue;
    const rejection = validateVeneerRequest(candidate, request, input.veneerProvider);
    if (rejection !== undefined) {
      diagnostics.push(rejection);
      continue;
    }
    const provider = input.veneerProvider;
    if (provider === undefined) continue;
    const providerResult = provider.provideVeneer({
      providerKey: provider.providerKey,
      request,
      target: input.target,
      sourceModuleKey: candidate.module.moduleKey,
      sourceRelocationKey: candidate.relocationKey,
      sourcePatchRva: candidate.sourcePatchRva,
      targetSymbolKey: candidate.targetSymbolKey,
      targetLinkageName: candidate.targetLinkageName,
      targetRva: candidate.targetRva,
      addend: candidate.relocation.addend,
      diagnosticMode: input.diagnosticMode,
    });
    if (providerResult.kind === "error") {
      diagnostics.push(...providerResult.diagnostics);
      continue;
    }

    const providerModules = validateSyntheticObjectModulesSurface({
      modules: providerResult.modules,
      malformedModules: () =>
        diagnostic(
          `relocation:linker-veneer-provider-modules-malformed:${candidate.relocationKey}:${provider.providerKey}`,
        ),
      emptyModules: () =>
        diagnostic(`relocation:linker-veneer-provider-empty:${candidate.relocationKey}`),
      malformedModule: (index) =>
        diagnostic(
          `relocation:linker-veneer-provider-module-malformed:${candidate.relocationKey}:${provider.providerKey}:${index}`,
        ),
    });
    if (providerModules.kind === "error") {
      diagnostics.push(...providerModules.diagnostics);
      continue;
    }

    const targetContractDiagnostic = validateVeneerProviderTargetContract(
      candidate,
      providerModules.modules,
    );
    if (targetContractDiagnostic !== undefined) {
      diagnostics.push(targetContractDiagnostic);
      continue;
    }

    const modules = deterministicVeneerModules(
      provider.providerKey,
      candidate,
      providerModules.modules,
    );
    const firstModule = modules[0];
    const veneerLinkageName =
      firstModule === undefined ? undefined : primaryVeneerLinkageName(firstModule);
    if (veneerLinkageName === undefined) {
      diagnostics.push(
        diagnostic(`relocation:linker-veneer-entry-missing:${candidate.relocationKey}`),
      );
      continue;
    }
    newVeneers.set(candidate.relocationKey, modules);
    newRetargets.set(candidate.relocationKey, veneerLinkageName);
  }

  if (diagnostics.length > 0) {
    return { kind: "error", diagnostics: Object.freeze(diagnostics.sort(compareDiagnostics)) };
  }

  const graph = rebuildGraph(input.target, state.graph, newRetargets, newVeneers);
  if (graph.kind === "error") return { kind: "error", diagnostics: graph.diagnostics };
  const resolvedSymbols = resolveLinkSymbols(graph.value);
  if (resolvedSymbols.kind === "error")
    return { kind: "error", diagnostics: resolvedSymbols.diagnostics };

  return {
    kind: "ok",
    changed: true,
    state: Object.freeze({
      graph: graph.value,
      resolvedSymbols: resolvedSymbols.value,
      retargetedRelocations: newRetargets,
      veneerModules: newVeneers,
    }),
  };
}

function outOfRangeVeneerCandidates(
  target: AArch64LinkerTargetSurface,
  state: FixedPointState,
  layout: LayoutImageSectionsOutput,
  symbols: readonly ResolvedImageSymbol[],
): LinkerResult<readonly VeneerCandidate[]> {
  const symbolsByKey = new Map(symbols.map((symbol) => [symbol.symbolKey, symbol]));
  const relocationTargetsByKey = new Map(
    state.resolvedSymbols.relocationTargets.map((relocationTarget) => [
      relocationTarget.relocationKey,
      relocationTarget,
    ]),
  );
  const candidates: VeneerCandidate[] = [];

  for (const indexed of indexedRelocations(state.graph)) {
    const relocation = indexed.relocation;
    if (relocation.family !== "branch26" || relocation.linkerVeneer === undefined) continue;
    const relocationTarget = relocationTargetsByKey.get(indexed.relocationKey);
    if (relocationTarget === undefined) continue;
    const targetSymbol = symbolsByKey.get(relocationTarget.targetSymbolKey);
    const patchRva = patchRvaFor(layout.sections, indexed);
    if (targetSymbol === undefined || patchRva === undefined) continue;
    const encoded = encodeAArch64RelocationValue({
      family: "branch26",
      relocationKey: indexed.relocationKey,
      symbolRva: BigInt(targetSymbol.rva),
      patchRva: BigInt(patchRva),
      addend: relocation.addend,
      preferredImageBase: target.constants.preferredImageBase,
    });
    if (isOutOfRangeBranch26Relocation(encoded, indexed.relocationKey)) {
      candidates.push(
        Object.freeze({
          ...indexed,
          sourcePatchRva: patchRva,
          targetSymbolKey: relocationTarget.targetSymbolKey,
          targetLinkageName: targetSymbol.linkageName,
          targetRva: targetSymbol.rva,
        }),
      );
    }
  }

  return linkerOk({
    value: Object.freeze(candidates.sort(compareCandidates)),
    verification: FIXED_POINT_VERIFICATION,
  });
}

function isOutOfRangeBranch26Relocation(
  result: ReturnType<typeof encodeAArch64RelocationValue>,
  relocationKey: string,
): boolean {
  if (result.kind !== "error") return false;
  const outOfRangePrefix = `relocation:out-of-range:${relocationKey}:branch26:`;
  return result.diagnostics.some((diagnostic) =>
    diagnostic.stableDetail.startsWith(outOfRangePrefix),
  );
}

function validateVeneerRequest(
  candidate: VeneerCandidate,
  request: AArch64ObjectLinkerVeneerRequest,
  provider: AArch64LinkerVeneerProvider | undefined,
): LinkerDiagnostic | undefined {
  if (provider === undefined) {
    return diagnostic(`relocation:linker-veneer-provider-missing:${candidate.relocationKey}`);
  }
  if (request.securityLabels.length > 0 || request.provenanceKeys.length === 0) {
    return diagnostic(`relocation:linker-veneer-security-rejected:${candidate.relocationKey}`);
  }
  if (request.scratchRegisters.length === 0) {
    return diagnostic(`relocation:linker-veneer-scratch-missing:${candidate.relocationKey}`);
  }
  if (candidate.targetLinkageName === undefined) {
    return diagnostic(
      `relocation:linker-veneer-target-not-linkable:${candidate.relocationKey}:${candidate.targetSymbolKey}`,
    );
  }
  return undefined;
}

function validateVeneerProviderTargetContract(
  candidate: VeneerCandidate,
  modules: readonly AArch64SyntheticObjectModule[],
): LinkerDiagnostic | undefined {
  const targetLinkageName = candidate.targetLinkageName;
  if (targetLinkageName === undefined) {
    return diagnostic(
      `relocation:linker-veneer-target-not-linkable:${candidate.relocationKey}:${candidate.targetSymbolKey}`,
    );
  }

  const hasOnwardRelocation = modules.some((module) =>
    module.objectModule.relocations.some(
      (relocation) =>
        relocation.target.kind === "linkage-name" &&
        relocation.target.linkageName === targetLinkageName,
    ),
  );
  return hasOnwardRelocation
    ? undefined
    : diagnostic(
        `relocation:linker-veneer-target-relocation-missing:${candidate.relocationKey}:${targetLinkageName}`,
      );
}

function deterministicVeneerModules(
  providerKey: string,
  candidate: IndexedRelocation,
  modules: readonly AArch64SyntheticObjectModule[],
): readonly AArch64LinkInputModule[] {
  return Object.freeze(
    [...modules]
      .sort((left, right) => compareCodeUnitStrings(left.moduleKey, right.moduleKey))
      .map((module, index) =>
        Object.freeze({
          moduleKey:
            index === 0
              ? `module:synthetic:veneer:${candidate.relocationKey}`
              : `module:synthetic:veneer:${candidate.relocationKey}:${module.objectKey}`,
          objectModule: module.objectModule,
          syntheticProviderKey: providerKey,
          syntheticObjectKey: module.objectKey,
        }),
      ),
  );
}

function rebuildGraph(
  target: AArch64LinkerTargetSurface,
  graph: NormalizedLinkGraph,
  retargets: ReadonlyMap<string, string>,
  veneerModules: ReadonlyMap<string, readonly AArch64LinkInputModule[]>,
): LinkerResult<NormalizedLinkGraph> {
  const veneerModulesSorted = [...veneerModules.values()]
    .flatMap((modules) => [...modules])
    .sort((left, right) => compareCodeUnitStrings(left.moduleKey, right.moduleKey));
  const veneerModuleKeys = new Set(veneerModulesSorted.map((module) => module.moduleKey));
  const veneerModulePrefixes = new Set(
    [...veneerModules.keys()].map((relocationKey) => `module:synthetic:veneer:${relocationKey}`),
  );
  const retargetedVeneerModules = veneerModulesSorted.map((module) =>
    retargetedInputModule(module, retargets),
  );
  const modules = [
    ...graph.modules
      .filter(
        (module) =>
          !veneerModuleKeys.has(module.moduleKey) &&
          !isLinkerOwnedVeneerModule(module.moduleKey, veneerModulePrefixes),
      )
      .map((module) => retargetedInputModule(module, retargets)),
    ...retargetedVeneerModules,
  ];
  const objectModules = Object.freeze(modules);
  const verified = verifyAArch64LinkInputObjects({ target, objectModules });
  if (verified.kind === "error") return verified;
  return normalizeAArch64LinkInputs({ target, objectModules: verified.value.modules });
}

function retargetedInputModule(
  module: AArch64LinkInputModule | NormalizedObjectModule,
  retargets: ReadonlyMap<string, string>,
): AArch64LinkInputModule {
  const declaredLinkageNames = new Set(
    module.objectModule.symbols.flatMap((symbol) =>
      symbol.kind === "local-definition" ? [] : [String(symbol.linkageName)],
    ),
  );
  const veneerExternalSymbols: AArch64ObjectSymbol[] = [];
  const relocations = module.objectModule.relocations.map((relocation) => {
    const relocationKey = relocationKeyFor(module.moduleKey, String(relocation.stableKey));
    const linkageName = retargets.get(relocationKey);
    if (linkageName === undefined) return relocation;
    if (!declaredLinkageNames.has(linkageName)) {
      declaredLinkageNames.add(linkageName);
      veneerExternalSymbols.push(
        aarch64ObjectSymbol({
          kind: "external-declaration",
          stableKey: `extern:linker-veneer:${linkageName}`,
          linkageName,
        }),
      );
    }
    return aarch64ObjectRelocation({
      stableKey: relocation.stableKey,
      sectionKey: relocation.sectionKey,
      offsetBytes: relocation.offsetBytes,
      widthBytes: relocation.widthBytes,
      family: relocation.family,
      target: { kind: "linkage-name", linkageName },
      addend: 0n,
      instructionPatch: relocation.instructionPatch,
      pairedRelocationKey: relocation.pairedRelocationKey,
    });
  });

  return Object.freeze({
    moduleKey: module.moduleKey,
    objectModule: cloneObjectModule(module.objectModule, relocations, veneerExternalSymbols),
    syntheticProviderKey: module.syntheticProviderKey,
    syntheticObjectKey: module.syntheticObjectKey,
  });
}

function cloneObjectModule(
  objectModule: AArch64ObjectModule,
  relocations: readonly AArch64ObjectRelocation[],
  additionalSymbols: readonly AArch64ObjectSymbol[] = [],
): AArch64ObjectModule {
  return aarch64ObjectModule({
    targetBackendSurfaceFingerprint: objectModule.targetBackendSurfaceFingerprint,
    closedImagePlanFingerprint: objectModule.closedImagePlanFingerprint,
    sections: objectModule.sections,
    symbols: [...objectModule.symbols, ...additionalSymbols],
    relocations,
    literalPools: objectModule.literalPools,
    veneers: objectModule.veneers,
    unwindRecords: objectModule.unwindRecords,
    byteProvenance: objectModule.byteProvenance,
    factSpending: objectModule.factSpending,
  });
}

function primaryVeneerLinkageName(module: AArch64LinkInputModule): string | undefined {
  const definitions = [...module.objectModule.symbols]
    .filter(
      (symbol): symbol is Extract<AArch64ObjectSymbol, { readonly linkageName: string }> =>
        symbol.kind === "global-definition",
    )
    .sort((left, right) => compareCodeUnitStrings(String(left.stableKey), String(right.stableKey)));
  if (definitions.length === 0) return undefined;

  const entryByObjectKey = definitions.find(
    (definition) => String(definition.stableKey) === module.syntheticObjectKey,
  );
  if (entryByObjectKey !== undefined) return entryByObjectKey.linkageName;
  return definitions.length === 1 ? definitions[0]!.linkageName : undefined;
}

function isLinkerOwnedVeneerModule(
  moduleKey: string,
  veneerModulePrefixes: ReadonlySet<string>,
): boolean {
  for (const prefix of veneerModulePrefixes) {
    if (moduleKey === prefix || moduleKey.startsWith(`${prefix}:`)) return true;
  }
  return false;
}

function indexedRelocations(graph: NormalizedLinkGraph): readonly IndexedRelocation[] {
  return graph.modules.flatMap((module) =>
    module.objectModule.relocations.map((relocation) =>
      Object.freeze({
        module,
        relocation,
        relocationKey: relocationKeyFor(module.moduleKey, String(relocation.stableKey)),
      }),
    ),
  );
}

function patchRvaFor(
  sections: readonly LinkedImageSection[],
  indexed: IndexedRelocation,
): number | undefined {
  for (const section of sections) {
    const contribution = section.contributions.find(
      (candidate) =>
        candidate.sourceModuleKey === indexed.module.moduleKey &&
        candidate.sourceObjectSectionKey === String(indexed.relocation.sectionKey),
    );
    if (contribution === undefined) continue;
    return section.rva + contribution.offsetBytes + indexed.relocation.offsetBytes;
  }
  return undefined;
}

function fixedPointFingerprint(state: FixedPointState, output: LinkLayoutFixedPointOutput): string {
  return stableHash(
    stableJson({
      veneerModuleKeys: [...state.veneerModules.values()]
        .flatMap((modules) => modules.map((module) => module.moduleKey))
        .sort(compareCodeUnitStrings),
      sections: output.sections.map((section) => ({
        stableKey: section.stableKey,
        rva: section.rva,
        virtualSizeBytes: section.virtualSizeBytes,
      })),
      symbols: output.symbols.map((symbol) => ({ symbolKey: symbol.symbolKey, rva: symbol.rva })),
      baseRelocations: output.baseRelocations,
    }),
  );
}

function compareCandidates(left: IndexedRelocation, right: IndexedRelocation): number {
  return compareCodeUnitStrings(left.relocationKey, right.relocationKey);
}

function compareDiagnostics(left: LinkerDiagnostic, right: LinkerDiagnostic): number {
  return compareCodeUnitStrings(left.stableDetail, right.stableDetail);
}

function diagnostic(stableDetail: string): LinkerDiagnostic {
  return linkerDiagnostic({
    code: "LINKER_IMAGE_LAYOUT_INVALID",
    ownerKey: "section-layout",
    stableDetail,
  });
}
