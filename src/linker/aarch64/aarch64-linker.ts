import { compareCodeUnitStrings } from "../../shared/deterministic-sort";
import {
  linkerDiagnostic,
  linkerError,
  linkerOk,
  sortLinkerDiagnostics,
  type LinkerDiagnostic,
  type LinkerDiagnosticMode,
  type LinkerResult,
  type LinkerVerificationSummary,
} from "../diagnostics";
import { materializeLinkedUnwindRecords } from "./aarch64-linked-image";
import { resolveLinkedImageEntry } from "../entry-resolution";
import {
  authenticateAArch64LinkerTargetSurface,
  type AArch64LinkerTargetSurface,
  type AArch64LinkerTargetSurfaceInput,
} from "../image-layout-policy";
import { runLinkLayoutFixedPoint } from "../layout-fixed-point";
import {
  createAArch64LinkedImageLayout,
  type AArch64LinkedImageLayout,
  type LinkedImageInputModule,
} from "../linked-image-layout";
import {
  normalizeAArch64LinkInputs,
  verifyAArch64LinkInputObjects,
  type NormalizedLinkGraph,
} from "../object-normalization";
import {
  validateSyntheticObjectModulesSurface,
  type SyntheticObjectModuleSurface,
} from "../object-module-surface";
import { applyResolvedRelocations, planPairedRelocations } from "../relocation-application";
import { layoutImageSections } from "../section-layout";
import { materializeResolvedImageSymbols } from "../symbol-rva";
import { resolveLinkSymbols } from "../symbol-resolution";
import { verifyLinkedImageLayout } from "../verifier";
import type {
  AArch64ObjectLinkerVeneerRequest,
  AArch64ObjectModule,
} from "../../target/aarch64/backend/object/object-module";

export interface LinkAArch64ImageInput {
  readonly objectModules: readonly AArch64LinkInputModule[];
  readonly target: AArch64LinkerTargetSurface;
  readonly entry: AArch64ImageEntryRequest;
  readonly syntheticObjects?: readonly AArch64SyntheticObjectProvider[];
  readonly veneerProvider?: AArch64LinkerVeneerProvider;
  readonly diagnosticMode?: LinkerDiagnosticMode;
}

export interface AArch64LinkInputModule {
  readonly moduleKey: string;
  readonly objectModule: AArch64ObjectModule;
  readonly syntheticProviderKey?: string;
  readonly syntheticObjectKey?: string;
}

export interface AArch64ImageEntryRequest {
  readonly wrelaBootLinkageName: string;
}

export interface AArch64SyntheticObjectProviderInput {
  readonly target: AArch64LinkerTargetSurface;
  readonly entry: AArch64ImageEntryRequest;
  readonly objectModules: readonly AArch64LinkInputModule[];
  readonly diagnosticMode?: LinkerDiagnosticMode;
}

export interface AArch64SyntheticObjectModule {
  readonly objectKey: string;
  readonly moduleKey: string;
  readonly objectModule: AArch64ObjectModule;
}

export type AArch64SyntheticObjectProviderResult =
  | {
      readonly kind: "ok";
      readonly modules: readonly AArch64SyntheticObjectModule[];
    }
  | {
      readonly kind: "error";
      readonly diagnostics: readonly LinkerDiagnostic[];
    };

export interface AArch64SyntheticObjectProvider {
  readonly providerKey: string;
  readonly provideObjects: (
    input: AArch64SyntheticObjectProviderInput,
  ) => AArch64SyntheticObjectProviderResult;
}

export interface AArch64LinkerVeneerProviderInput {
  readonly providerKey: string;
  readonly request: AArch64ObjectLinkerVeneerRequest;
  readonly target: AArch64LinkerTargetSurface;
  readonly sourceModuleKey: string;
  readonly sourceRelocationKey: string;
  readonly sourcePatchRva: number;
  readonly targetSymbolKey: string;
  readonly targetLinkageName?: string;
  readonly targetRva: number;
  readonly addend: bigint;
  readonly diagnosticMode?: LinkerDiagnosticMode;
}

export type AArch64LinkerVeneerProviderResult = AArch64SyntheticObjectProviderResult;

export interface AArch64LinkerVeneerProvider {
  readonly providerKey: string;
  readonly provideVeneer: (
    input: AArch64LinkerVeneerProviderInput,
  ) => AArch64LinkerVeneerProviderResult;
}

export interface MaterializeAArch64SyntheticObjectsForLinkInput {
  readonly objectModules: readonly AArch64LinkInputModule[];
  readonly target: AArch64LinkerTargetSurface;
  readonly entry: AArch64ImageEntryRequest;
  readonly syntheticObjects?: readonly AArch64SyntheticObjectProvider[];
  readonly diagnosticMode?: LinkerDiagnosticMode;
}

export interface MaterializedAArch64LinkInputModules {
  readonly modules: readonly AArch64LinkInputModule[];
}

export type LinkAArch64ImageResult =
  | {
      readonly kind: "ok";
      readonly layout: AArch64LinkedImageLayout;
      readonly diagnostics: readonly LinkerDiagnostic[];
      readonly verification: LinkerVerificationSummary;
    }
  | {
      readonly kind: "error";
      readonly diagnostics: readonly LinkerDiagnostic[];
      readonly verification: LinkerVerificationSummary;
    };

const PREFLIGHT_VERIFICATION: LinkerVerificationSummary = Object.freeze({
  runs: Object.freeze([
    Object.freeze({
      verifierKey: "aarch64-linker-api-preflight",
      runKey: "materialize-synthetic-objects",
      status: "passed" as const,
    }),
  ]),
});

const LINK_ORCHESTRATION_STAGE_KEYS = Object.freeze([
  "authenticate-link-target",
  "materialize-synthetic-objects",
  "verify-input-objects",
  "normalize-link-graph",
  "resolve-symbols",
  "layout-sections",
  "materialize-symbol-rvas",
  "plan-relocations",
  "apply-relocations",
  "resolve-entry",
  "materialize-unwind-metadata",
  "verify-linked-image",
] as const);

type LinkOrchestrationStageKey = (typeof LINK_ORCHESTRATION_STAGE_KEYS)[number];
type LinkOrchestrationStageStatus = "passed" | "failed";

export function materializeAArch64SyntheticObjectsForLink(
  input: MaterializeAArch64SyntheticObjectsForLinkInput,
): LinkerResult<MaterializedAArch64LinkInputModules> {
  if (!Array.isArray(input.objectModules)) {
    return linkerError({
      diagnostics: [inputDiagnostic("linker-input:malformed-object-modules")],
      verification: PREFLIGHT_VERIFICATION,
    });
  }

  if (input.objectModules.length === 0) {
    return linkerError({
      diagnostics: [inputDiagnostic("linker-input:empty-object-modules")],
      verification: PREFLIGHT_VERIFICATION,
    });
  }

  if (input.syntheticObjects !== undefined && !Array.isArray(input.syntheticObjects)) {
    return linkerError({
      diagnostics: [inputDiagnostic("linker-input:malformed-synthetic-providers")],
      verification: PREFLIGHT_VERIFICATION,
    });
  }

  const baseModules = input.objectModules.map((module) => freezeInputModule(module));
  const syntheticModules: AArch64LinkInputModule[] = [];
  const providerDiagnostics: LinkerDiagnostic[] = [];
  const preflightDiagnostics: LinkerDiagnostic[] = [];
  const syntheticObjects = input.syntheticObjects ?? [];

  for (let providerIndex = 0; providerIndex < syntheticObjects.length; providerIndex += 1) {
    const provider = syntheticObjects[providerIndex];
    if (!isSyntheticProviderSurface(provider)) {
      preflightDiagnostics.push(
        inputDiagnostic(`linker-input:malformed-synthetic-provider:${providerIndex}`),
      );
      continue;
    }

    const providerResult = provider.provideObjects({
      target: input.target,
      entry: Object.freeze({ ...input.entry }),
      objectModules: Object.freeze([...baseModules]),
      diagnosticMode: input.diagnosticMode,
    });

    if (providerResult.kind === "error") {
      providerDiagnostics.push(...providerResult.diagnostics);
      continue;
    }

    const providerModules = syntheticProviderModulesFromResult({
      providerKey: provider.providerKey,
      modules: providerResult.modules,
    });
    if (providerModules.kind === "error") {
      preflightDiagnostics.push(...providerModules.diagnostics);
      continue;
    }

    for (const module of providerModules.modules) {
      syntheticModules.push(
        freezeInputModule({
          moduleKey: module.moduleKey,
          objectModule: module.objectModule,
          syntheticProviderKey: provider.providerKey,
          syntheticObjectKey: module.objectKey,
        }),
      );
    }
  }

  if (providerDiagnostics.length > 0) {
    return linkerError({
      diagnostics: providerDiagnostics,
      verification: PREFLIGHT_VERIFICATION,
    });
  }

  const diagnostics = Object.freeze([
    ...preflightDiagnostics,
    ...validateMaterializedModules(baseModules, syntheticModules),
  ]);
  if (diagnostics.length > 0) {
    return linkerError({
      diagnostics,
      verification: PREFLIGHT_VERIFICATION,
    });
  }

  return linkerOk({
    value: Object.freeze({
      modules: sortInputModules([...baseModules, ...syntheticModules]),
    }),
    verification: PREFLIGHT_VERIFICATION,
  });
}

export function linkAArch64Image(input: LinkAArch64ImageInput): LinkAArch64ImageResult {
  const authenticatedTarget = authenticateAArch64LinkerTargetSurface(
    linkerTargetSurfaceInputFrom(input.target),
  );
  if (authenticatedTarget.kind === "error") {
    return orchestrationError({
      diagnostics: authenticatedTarget.diagnostics,
      failedStage: "authenticate-link-target",
    });
  }
  const target = authenticatedTarget.value;

  const materialized = materializeAArch64SyntheticObjectsForLink({
    objectModules: input.objectModules,
    target,
    entry: input.entry,
    syntheticObjects: input.syntheticObjects,
    diagnosticMode: input.diagnosticMode,
  });
  if (materialized.kind === "error") {
    return orchestrationError({
      diagnostics: materialized.diagnostics,
      failedStage: "materialize-synthetic-objects",
    });
  }

  const verifiedObjects = verifyAArch64LinkInputObjects({
    target,
    objectModules: materialized.value.modules,
  });
  if (verifiedObjects.kind === "error") {
    return orchestrationError({
      diagnostics: verifiedObjects.diagnostics,
      failedStage: "verify-input-objects",
    });
  }

  const normalized = normalizeAArch64LinkInputs({
    target,
    objectModules: verifiedObjects.value.modules,
  });
  if (normalized.kind === "error") {
    return orchestrationError({
      diagnostics: normalized.diagnostics,
      failedStage: "normalize-link-graph",
    });
  }
  const graph = normalized.value;

  const resolvedSymbols = resolveLinkSymbols(graph);
  if (resolvedSymbols.kind === "error") {
    return orchestrationError({
      diagnostics: resolvedSymbols.diagnostics,
      failedStage: "resolve-symbols",
    });
  }

  const fixedPoint = runLinkLayoutFixedPoint(
    {
      target,
      graph,
      resolvedSymbols: resolvedSymbols.value,
      veneerProvider: input.veneerProvider,
      diagnosticMode: input.diagnosticMode,
    },
    {
      layoutSections: layoutImageSections,
      materializeSymbols: materializeResolvedImageSymbols,
      planPairs: planPairedRelocations,
      applyRelocations: applyResolvedRelocations,
    },
  );
  if (fixedPoint.kind === "error") {
    return orchestrationError({
      diagnostics: fixedPoint.diagnostics,
      failedStage: fixedPoint.failedStage,
    });
  }

  const entry = resolveLinkedImageEntry({
    target,
    entry: input.entry,
    graph: fixedPoint.value.graph,
    symbols: fixedPoint.value.symbols,
    sections: fixedPoint.value.sections,
    appliedRelocations: fixedPoint.value.appliedRelocations,
  });
  if (entry.kind === "error") {
    return orchestrationError({
      diagnostics: entry.diagnostics,
      failedStage: "resolve-entry",
    });
  }

  const unwind = materializeLinkedUnwindRecords({
    target,
    graph: fixedPoint.value.graph,
    sections: fixedPoint.value.sections,
    symbols: fixedPoint.value.symbols,
  });
  if (unwind.kind === "error") {
    return orchestrationError({
      diagnostics: unwind.diagnostics,
      failedStage: "materialize-unwind-metadata",
    });
  }

  const passedVerification = orchestrationVerification(
    LINK_ORCHESTRATION_STAGE_KEYS.map((key) => ({ key, status: "passed" })),
  );
  const constructedLayout = createAArch64LinkedImageLayout({
    targetKey: target.targetKey,
    targetFingerprint: target.backendSurfaceFingerprint,
    targetPolicyFingerprint: target.targetPolicyFingerprint,
    inputModules: inputModulesForLinkedLayout(fixedPoint.value.graph),
    sections: fixedPoint.value.sections,
    symbols: fixedPoint.value.symbols,
    appliedRelocations: fixedPoint.value.appliedRelocations,
    baseRelocations: fixedPoint.value.baseRelocations,
    entry: entry.value.entry,
    unwindRecords: unwind.value.unwindRecords,
    dataDirectorySources: unwind.value.dataDirectorySources,
    provenance: fixedPoint.value.layout.provenance,
    factSpending: fixedPoint.value.graph.factSpending,
    verification: passedVerification,
  });
  const layout: AArch64LinkedImageLayout = Object.freeze({
    ...constructedLayout,
    verification: passedVerification,
  });

  const verified = verifyLinkedImageLayout({ layout, target });
  if (verified.kind === "error") {
    return orchestrationError({
      diagnostics: verified.diagnostics,
      failedStage: "verify-linked-image",
    });
  }

  return Object.freeze({
    kind: "ok" as const,
    layout,
    diagnostics: sortLinkerDiagnostics(
      [
        ...materialized.diagnostics,
        ...normalized.diagnostics,
        ...resolvedSymbols.diagnostics,
        ...fixedPoint.diagnostics,
        ...entry.diagnostics,
        ...unwind.diagnostics,
        ...verified.diagnostics,
      ].filter((diagnostic) => diagnostic.severity !== "error"),
    ),
    verification: passedVerification,
  });
}

function linkerTargetSurfaceInputFrom(
  target: AArch64LinkerTargetSurface,
): AArch64LinkerTargetSurfaceInput {
  return Object.freeze({
    targetKey: target.targetKey,
    backendSurfaceFingerprint: target.backendSurfaceFingerprint,
    relocationCatalogFingerprint: target.relocationCatalogFingerprint,
    constants: target.constants,
    sectionMappings: target.sectionMappings,
    relocationFamilies: target.relocationFamilies,
    entryPolicy: target.entryPolicy,
    baseRelocationPolicy: target.baseRelocationPolicy,
    ...(target.contributionAlignment === undefined
      ? {}
      : { contributionAlignment: target.contributionAlignment }),
  });
}

function inputModulesForLinkedLayout(
  graph: NormalizedLinkGraph,
): readonly LinkedImageInputModule[] {
  return Object.freeze(
    graph.modules.map((module) =>
      Object.freeze({
        moduleKey: module.moduleKey,
        moduleFingerprint: module.moduleFingerprint,
        ...(module.syntheticProviderKey === undefined
          ? {}
          : { syntheticProviderKey: module.syntheticProviderKey }),
      }),
    ),
  );
}

function orchestrationError(input: {
  readonly diagnostics: readonly LinkerDiagnostic[];
  readonly failedStage: LinkOrchestrationStageKey;
}): LinkAArch64ImageResult {
  return linkerError({
    diagnostics: input.diagnostics,
    verification: orchestrationVerification([
      ...passedStagesBefore(input.failedStage).map((key) => ({ key, status: "passed" as const })),
      { key: input.failedStage, status: "failed" as const },
    ]),
  });
}

function passedStagesBefore(
  failedStage: LinkOrchestrationStageKey,
): readonly LinkOrchestrationStageKey[] {
  return Object.freeze(
    LINK_ORCHESTRATION_STAGE_KEYS.slice(0, LINK_ORCHESTRATION_STAGE_KEYS.indexOf(failedStage)),
  );
}

function orchestrationVerification(
  stages: readonly {
    readonly key: LinkOrchestrationStageKey;
    readonly status: LinkOrchestrationStageStatus;
  }[],
): LinkerVerificationSummary {
  return Object.freeze({
    runs: Object.freeze(
      stages.map((stage) =>
        Object.freeze({
          verifierKey: stage.key,
          runKey: stage.key,
          status: stage.status,
        }),
      ),
    ),
  });
}

function validateMaterializedModules(
  baseModules: readonly AArch64LinkInputModule[],
  syntheticModules: readonly AArch64LinkInputModule[],
): readonly LinkerDiagnostic[] {
  const diagnostics: LinkerDiagnostic[] = [];
  const moduleKeys = new Set<string>();

  for (const module of [...baseModules, ...syntheticModules]) {
    if (moduleKeys.has(module.moduleKey)) {
      diagnostics.push(inputDiagnostic(`linker-input:duplicate-module-key:${module.moduleKey}`));
    }
    moduleKeys.add(module.moduleKey);
  }

  for (const module of syntheticModules) {
    if (module.syntheticObjectKey === "") {
      diagnostics.push(
        inputDiagnostic(`linker-input:empty-provider-modules:${module.syntheticProviderKey}`),
      );
      continue;
    }

    const expectedModuleKey = syntheticModuleKey(
      module.syntheticProviderKey ?? "",
      module.syntheticObjectKey ?? "",
    );
    if (module.moduleKey !== expectedModuleKey) {
      diagnostics.push(
        inputDiagnostic(
          `linker-input:invalid-synthetic-module-key:${module.moduleKey}:expected-prefix:${syntheticModulePrefix(
            module.syntheticProviderKey ?? "",
          )}`,
        ),
      );
    }
  }

  return Object.freeze(diagnostics);
}

function isSyntheticProviderSurface(provider: unknown): provider is AArch64SyntheticObjectProvider {
  return provider === undefined || provider === null || typeof provider !== "object"
    ? false
    : typeof (provider as Record<string, unknown>).providerKey === "string" &&
        (provider as Record<string, unknown>).providerKey !== "" &&
        typeof (provider as Record<string, unknown>).provideObjects === "function";
}

export function syntheticProviderModulesFromResult(input: {
  readonly providerKey: string;
  readonly modules: unknown;
}):
  | { readonly kind: "ok"; readonly modules: readonly SyntheticObjectModuleSurface[] }
  | { readonly kind: "error"; readonly diagnostics: readonly LinkerDiagnostic[] } {
  return validateSyntheticObjectModulesSurface({
    modules: input.modules,
    malformedModules: () =>
      inputDiagnostic(`linker-input:malformed-provider-modules:${input.providerKey}`),
    emptyModules: () => inputDiagnostic(`linker-input:empty-provider-modules:${input.providerKey}`),
    malformedModule: (index) =>
      inputDiagnostic(`linker-input:malformed-provider-module:${input.providerKey}:${index}`),
  });
}

function syntheticModulePrefix(providerKey: string): string {
  return `module:synthetic:${providerKey}:`;
}

function syntheticModuleKey(providerKey: string, objectKey: string): string {
  return `${syntheticModulePrefix(providerKey)}${objectKey}`;
}

function sortInputModules(
  modules: readonly AArch64LinkInputModule[],
): readonly AArch64LinkInputModule[] {
  return Object.freeze(
    [...modules].sort((left, right) => compareCodeUnitStrings(left.moduleKey, right.moduleKey)),
  );
}

function freezeInputModule(module: AArch64LinkInputModule): AArch64LinkInputModule {
  return Object.freeze({ ...module });
}

function inputDiagnostic(stableDetail: string): LinkerDiagnostic {
  return linkerDiagnostic({
    code: "LINKER_INPUT_INVALID",
    ownerKey: "aarch64-linker-api",
    stableDetail,
  });
}
