import {
  CollectingDiagnosticSink,
  ImportDiscovery,
  KeywordTable,
  Lexer,
  ModulePath,
  SourceText,
  parseModuleGraph as parseFrontendModuleGraph,
  type LexedModule,
  type ParsedModuleGraph,
} from "../../frontend";
import {
  lowerTypedHir as lowerSourceTypedHir,
  type LowerTypedHirInput,
  type LowerTypedHirResult,
} from "../../hir";
import type {
  ComputeRepresentationLayoutFactsInput,
  ComputeRepresentationLayoutFactsResult,
} from "../../layout";
import { computeRepresentationLayoutFacts as computeSourceRepresentationLayoutFacts } from "../../layout";
import {
  monomorphizeWholeImage as monomorphizeSourceWholeImage,
  type MonomorphizeWholeImageInput,
  type MonomorphizeWholeImageResult,
} from "../../mono";
import {
  constructOptIr as constructSourceOptIr,
  optimizeOptIr as optimizeSourceOptIr,
  productionOptIrOptimizationPolicy,
  type BuildOptimizedOptIrInput,
  type ConstructOptIrResult,
  type OptimizeOptIrResult,
} from "../../opt-ir";
import type { OptIrFactSet } from "../../opt-ir/facts/fact-index";
import type { OptIrOperation } from "../../opt-ir/operations";
import type { OptIrProgram } from "../../opt-ir/program";
import {
  checkProofAndResources as checkProofAndResourcesSource,
  type CheckProofAndResourcesInput,
  type CheckProofAndResourcesResult,
} from "../../proof-check";
import { layoutAuthorityFingerprintForProofCheckInput } from "../../proof-check/validation/input-validator";
import {
  buildProofMir as buildSourceProofMir,
  type BuildProofMirInput,
  type BuildProofMirResult,
} from "../../proof-mir/proof-mir-builder";
import { compareCodeUnitStrings } from "../../shared/deterministic-sort";
import { buildItemIndex } from "../../semantic/item-index";
import { CoreTypeCatalog, resolveNames } from "../../semantic/names";
import { checkSemanticSurface } from "../../semantic/surface";
import { type PlatformPrimitiveId } from "../../semantic/ids";
import { uefiAArch64TargetDiagnostic, type UefiAArch64TargetDiagnostic } from "./diagnostics";
import type {
  CompilerPackageInput,
  UefiAArch64ValidationFixturePacketSource,
} from "./package-input";
import {
  uefiAArch64CompilerIntrinsicNameCatalog,
  uefiAArch64PlatformPrimitiveNameCatalog,
} from "./platform-catalog";
import {
  productionUefiAArch64LayoutTargetSurface,
  productionUefiAArch64OptIrTargetSurface,
  productionUefiAArch64ProofCheckInputAuthority,
  productionUefiAArch64ProofMirBuildTargetContext,
} from "./target-surfaces";
import type {
  UefiAArch64StaticChar16String,
  UefiAArch64StaticChar16StringPointer,
} from "./firmware-strings";
import {
  compilerIntrinsicCallsFromTypedHir,
  extractUefiAArch64StaticChar16MetadataFromCompilerIntrinsics,
  optimizedOptIrArtifact,
  remapStaticChar16MetadataToOptIrValues,
} from "./package-pipeline-static-char16";
import {
  layoutFactsToProofMirInput,
  monomorphizedImageToLayoutFactsInput,
  packageHirToMonomorphizationInput,
  packageInputToModuleGraphParseInput,
  packageParsedGraphToHirInput,
  proofCheckToOptimizedOptIrInput,
  proofMirToCheckInput,
} from "./package-pipeline-stage-inputs";
import { packageSemanticTargetSurface } from "./package-pipeline-semantic-target";
import {
  passedVerification,
  uefiAArch64Error,
  uefiAArch64Ok,
  verificationSummaryFromRuns,
  type UefiAArch64TargetResult,
} from "./result";
import type { UefiAArch64TargetDriverSurface } from "./target-driver-surface";

const PACKAGE_PIPELINE_VERIFIER_KEY = "uefi-aarch64-package-pipeline";
const PACKAGE_PIPELINE_RUN_KEY = "to-opt-ir";

export { extractUefiAArch64StaticChar16MetadataFromCompilerIntrinsics } from "./package-pipeline-static-char16";
export {
  layoutFactsToProofMirInput,
  monomorphizedImageToLayoutFactsInput,
  packageHirToMonomorphizationInput,
  packageInputToModuleGraphParseInput,
  packageParsedGraphToHirInput,
  proofCheckToOptimizedOptIrInput,
  proofMirToCheckInput,
} from "./package-pipeline-stage-inputs";

export type UefiAArch64PackagePipelineStageKey =
  | "frontend"
  | "semantic"
  | "monomorphization"
  | "layout-facts"
  | "proof-mir"
  | "proof-check"
  | "opt-ir";

export interface UefiAArch64StageRecord<StageKey extends string> {
  readonly stageKey: StageKey;
  readonly status: "passed" | "failed";
}

export interface PackageModuleGraphParseInput {
  readonly packageInput: CompilerPackageInput;
}

export interface PackageParsedModuleGraphAdapter {
  readonly kind: "parsed-graph";
  readonly parsedGraph: ParsedModuleGraph;
}

export interface PackageTypedHirInput {
  readonly packageInput: CompilerPackageInput;
  readonly target: UefiAArch64TargetDriverSurface;
  readonly parsedGraph: PackageParsedModuleGraphAdapter;
}

export interface PackageTypedHirAdapter {
  readonly kind: "typed-hir";
  readonly lowerTypedHirInput: LowerTypedHirInput;
  readonly lowerTypedHirResult: LowerTypedHirResult;
}

export interface PackageMonomorphizedImageInput {
  readonly target: UefiAArch64TargetDriverSurface;
  readonly typedHir: PackageTypedHirAdapter;
}

export interface PackageMonomorphizedImageAdapter {
  readonly kind: "mono-image";
  readonly monomorphizeWholeImageInput: MonomorphizeWholeImageInput;
  readonly monomorphizeWholeImageResult: MonomorphizeWholeImageResult & { readonly kind: "ok" };
  readonly reachablePlatformPrimitiveIds: readonly PlatformPrimitiveId[];
  readonly staticChar16Metadata: UefiAArch64StaticChar16IntrinsicMetadata;
}

export interface PackageRepresentationLayoutFactsInput {
  readonly target: UefiAArch64TargetDriverSurface;
  readonly monomorphizedImage: PackageMonomorphizedImageAdapter;
}

export interface PackageRepresentationLayoutFactsAdapter {
  readonly kind: "layout-facts";
  readonly computeRepresentationLayoutFactsInput: ComputeRepresentationLayoutFactsInput;
  readonly computeRepresentationLayoutFactsResult: ComputeRepresentationLayoutFactsResult & {
    readonly kind: "ok";
  };
  readonly staticChar16Metadata: UefiAArch64StaticChar16IntrinsicMetadata;
}

export interface PackageProofMirInput {
  readonly target: UefiAArch64TargetDriverSurface;
  readonly monomorphizedImage: PackageMonomorphizedImageAdapter;
  readonly layoutFacts: PackageRepresentationLayoutFactsAdapter;
}

export interface PackageProofMirAdapter {
  readonly kind: "proof-mir";
  readonly buildProofMirInput: BuildProofMirInput;
  readonly buildProofMirResult: BuildProofMirResult & { readonly kind: "ok" };
  readonly staticChar16Metadata: UefiAArch64StaticChar16IntrinsicMetadata;
}

export interface PackageProofCheckInput {
  readonly target: UefiAArch64TargetDriverSurface;
  readonly proofMir: PackageProofMirAdapter;
  readonly layoutFacts: PackageRepresentationLayoutFactsAdapter;
}

export interface PackageProofCheckAdapter {
  readonly kind: "proof-check";
  readonly checkProofAndResourcesInput: CheckProofAndResourcesInput;
  readonly checkProofAndResourcesResult: CheckProofAndResourcesResult & { readonly kind: "ok" };
  readonly staticChar16Metadata: UefiAArch64StaticChar16IntrinsicMetadata;
}

export interface PackageOptimizedOptIrInput {
  readonly target: UefiAArch64TargetDriverSurface;
  readonly proofCheck: PackageProofCheckAdapter;
  readonly proofMir: PackageProofMirAdapter;
  readonly layoutFacts: PackageRepresentationLayoutFactsAdapter;
}

export interface UefiAArch64StaticChar16PointerRecord {
  readonly valueKey: string;
  readonly pointer: UefiAArch64StaticChar16StringPointer;
}

export interface UefiAArch64StaticChar16IntrinsicMetadata {
  readonly staticChar16Strings: readonly UefiAArch64StaticChar16String[];
  readonly staticChar16Pointers: readonly UefiAArch64StaticChar16PointerRecord[];
}

export interface UefiAArch64OptimizedOptIrArtifact {
  readonly program: OptIrProgram;
  readonly operations: readonly OptIrOperation[];
  readonly unoptimizedOperations: readonly OptIrOperation[];
  readonly facts: OptIrFactSet;
  readonly staticChar16Strings: readonly UefiAArch64StaticChar16String[];
  readonly staticChar16Pointers: readonly UefiAArch64StaticChar16PointerRecord[];
  readonly validationFixturePacketSources?: readonly UefiAArch64ValidationFixturePacketSource[];
}

export interface PackageOptimizedOptIrAdapter {
  readonly program: OptIrProgram;
  readonly operations: readonly OptIrOperation[];
  readonly unoptimizedOperations: readonly OptIrOperation[];
  readonly facts: OptIrFactSet;
  readonly staticChar16Strings: readonly UefiAArch64StaticChar16String[];
  readonly staticChar16Pointers: readonly UefiAArch64StaticChar16PointerRecord[];
  readonly buildOptimizedOptIrInput: BuildOptimizedOptIrInput;
  readonly constructOptIrResult: ConstructOptIrResult & { readonly kind: "ok" };
  readonly buildOptimizedOptIrResult: OptimizeOptIrResult & { readonly kind: "ok" };
}

export type UefiAArch64PackageStageResult<Value> =
  | {
      readonly kind: "ok";
      readonly value: Value;
      readonly diagnostics: readonly UefiAArch64TargetDiagnostic[];
    }
  | {
      readonly kind: "error";
      readonly diagnostics: readonly UefiAArch64TargetDiagnostic[];
    };

export interface UefiAArch64PackagePipelineDependencies {
  readonly parseModuleGraph: (
    input: PackageModuleGraphParseInput,
  ) => UefiAArch64PackageStageResult<PackageParsedModuleGraphAdapter>;
  readonly lowerTypedHir: (
    input: PackageTypedHirInput,
  ) => UefiAArch64PackageStageResult<PackageTypedHirAdapter>;
  readonly monomorphizeWholeImage: (
    input: PackageMonomorphizedImageInput,
  ) => UefiAArch64PackageStageResult<PackageMonomorphizedImageAdapter>;
  readonly computeRepresentationLayoutFacts: (
    input: PackageRepresentationLayoutFactsInput,
  ) => UefiAArch64PackageStageResult<PackageRepresentationLayoutFactsAdapter>;
  readonly buildProofMir: (
    input: PackageProofMirInput,
  ) => UefiAArch64PackageStageResult<PackageProofMirAdapter>;
  readonly checkProofAndResources: (
    input: PackageProofCheckInput,
  ) => UefiAArch64PackageStageResult<PackageProofCheckAdapter>;
  readonly buildOptimizedOptIr: (
    input: PackageOptimizedOptIrInput,
  ) => UefiAArch64PackageStageResult<PackageOptimizedOptIrAdapter>;
}

export interface RunUefiAArch64PackagePipelineToOptIrInput {
  readonly packageInput: CompilerPackageInput;
  readonly target: UefiAArch64TargetDriverSurface;
}

export interface UefiAArch64PackageOptIrPipelineOutput {
  readonly target: UefiAArch64TargetDriverSurface;
  readonly parsedGraph: PackageParsedModuleGraphAdapter;
  readonly typedHir: PackageTypedHirAdapter;
  readonly monomorphizedImage: PackageMonomorphizedImageAdapter;
  readonly layoutFacts: PackageRepresentationLayoutFactsAdapter;
  readonly proofMir: PackageProofMirAdapter;
  readonly proofCheck: PackageProofCheckAdapter;
  readonly optimizedOptIr: PackageOptimizedOptIrAdapter;
  readonly optIr: UefiAArch64OptimizedOptIrArtifact;
  readonly semanticPlatformCatalogFingerprint: string;
  readonly proofMirRuntimeCatalogFingerprint: string;
  readonly reachablePlatformPrimitiveIds: readonly unknown[];
  readonly runtimeCatalogFingerprint: string;
  readonly stages: readonly UefiAArch64StageRecord<UefiAArch64PackagePipelineStageKey>[];
}

export function runUefiAArch64PackagePipelineToOptIr(
  input: RunUefiAArch64PackagePipelineToOptIrInput,
  dependencies: UefiAArch64PackagePipelineDependencies = productionPackagePipelineDependencies(),
): UefiAArch64TargetResult<UefiAArch64PackageOptIrPipelineOutput> {
  const stages = createUefiAArch64StageRecorder<UefiAArch64PackagePipelineStageKey>();

  const parsed = dependencies.parseModuleGraph(packageInputToModuleGraphParseInput(input));
  if (parsed.kind === "error") {
    return packagePipelineError(stages.failed("frontend"), parsed.diagnostics);
  }
  stages.passed("frontend");

  const typedHir = dependencies.lowerTypedHir(
    packageParsedGraphToHirInput(parsed.value, input.packageInput, input.target),
  );
  if (typedHir.kind === "error") {
    return packagePipelineError(stages.failed("semantic"), typedHir.diagnostics);
  }
  stages.passed("semantic");

  const monomorphized = dependencies.monomorphizeWholeImage(
    packageHirToMonomorphizationInput(typedHir.value, input.target),
  );
  if (monomorphized.kind === "error") {
    return packagePipelineError(stages.failed("monomorphization"), monomorphized.diagnostics);
  }
  stages.passed("monomorphization");

  const layoutFacts = dependencies.computeRepresentationLayoutFacts(
    monomorphizedImageToLayoutFactsInput(monomorphized.value, input.target),
  );
  if (layoutFacts.kind === "error") {
    return packagePipelineError(stages.failed("layout-facts"), layoutFacts.diagnostics);
  }
  stages.passed("layout-facts");

  const proofMir = dependencies.buildProofMir(
    layoutFactsToProofMirInput(layoutFacts.value, monomorphized.value, input.target),
  );
  if (proofMir.kind === "error") {
    return packagePipelineError(stages.failed("proof-mir"), proofMir.diagnostics);
  }
  stages.passed("proof-mir");

  const proofCheck = dependencies.checkProofAndResources(
    proofMirToCheckInput(proofMir.value, layoutFacts.value, input.target),
  );
  if (proofCheck.kind === "error") {
    return packagePipelineError(stages.failed("proof-check"), proofCheck.diagnostics);
  }
  stages.passed("proof-check");

  const optIr = dependencies.buildOptimizedOptIr(
    proofCheckToOptimizedOptIrInput(
      proofCheck.value,
      proofMir.value,
      layoutFacts.value,
      input.target,
    ),
  );
  if (optIr.kind === "error") {
    return packagePipelineError(stages.failed("opt-ir"), optIr.diagnostics);
  }
  const optIrArtifact = optimizedOptIrArtifact(optIr.value, input.packageInput);
  if (optIrArtifact.kind === "error") {
    return packagePipelineError(stages.failed("opt-ir"), optIrArtifact.diagnostics);
  }
  stages.passed("opt-ir");

  return uefiAArch64Ok({
    value: Object.freeze({
      target: input.target,
      parsedGraph: parsed.value,
      typedHir: typedHir.value,
      monomorphizedImage: monomorphized.value,
      layoutFacts: layoutFacts.value,
      proofMir: proofMir.value,
      proofCheck: proofCheck.value,
      optimizedOptIr: optIr.value,
      optIr: optIrArtifact.value,
      semanticPlatformCatalogFingerprint: input.target.semanticPlatformCatalogFingerprint,
      proofMirRuntimeCatalogFingerprint: input.target.proofMirRuntimeCatalogFingerprint,
      reachablePlatformPrimitiveIds: Object.freeze([
        ...monomorphized.value.reachablePlatformPrimitiveIds,
      ]),
      runtimeCatalogFingerprint: input.target.proofMirRuntimeCatalogFingerprint,
      stages: stages.records(),
    }),
    verification: passedVerification(PACKAGE_PIPELINE_VERIFIER_KEY, PACKAGE_PIPELINE_RUN_KEY),
  });
}

export function productionPackagePipelineDependencies(): UefiAArch64PackagePipelineDependencies {
  return Object.freeze({
    parseModuleGraph,
    lowerTypedHir,
    monomorphizeWholeImage,
    computeRepresentationLayoutFacts,
    buildProofMir,
    checkProofAndResources,
    buildOptimizedOptIr,
  });
}

export function parseModuleGraph(
  input: PackageModuleGraphParseInput,
): UefiAArch64PackageStageResult<PackageParsedModuleGraphAdapter> {
  const diagnostics = new CollectingDiagnosticSink();
  const lexer = new Lexer({
    keywords: KeywordTable.default(),
    diagnostics,
  });
  const imports = new ImportDiscovery({ diagnostics });
  const modules: LexedModule[] = [...input.packageInput.sourceFiles]
    .sort((left, right) => compareCodeUnitStrings(left.sourceKey, right.sourceKey))
    .map((sourceFile) => {
      const source = SourceText.from(sourceFile.sourceKey, sourceFile.text);
      const lexResult = lexer.lex(source);
      const path = ModulePath.from(moduleNameToModulePathKey(sourceFile.moduleName));
      return {
        path,
        source,
        tokens: lexResult.tokens,
        imports: imports.discover({
          importer: path,
          source,
          tokens: lexResult.tokens,
        }),
      };
    });
  const parsedGraph = parseFrontendModuleGraph({
    graph: {
      entry: ModulePath.from(moduleNameToModulePathKey(input.packageInput.entryModuleName)),
      modules,
    },
    lexerDiagnostics: diagnostics.diagnostics,
  });
  const targetDiagnostics = [
    ...(parsedGraph.diagnostics.length === 0
      ? []
      : [
          packagePipelineDiagnostic(
            "frontend",
            `frontend-diagnostics:${parsedGraph.diagnostics.length}`,
          ),
        ]),
    ...missingImportDiagnostics(modules),
  ];
  if (targetDiagnostics.length > 0) {
    return { kind: "error", diagnostics: targetDiagnostics };
  }
  return {
    kind: "ok",
    value: Object.freeze({ kind: "parsed-graph" as const, parsedGraph }),
    diagnostics: [],
  };
}

function missingImportDiagnostics(
  modules: readonly LexedModule[],
): readonly UefiAArch64TargetDiagnostic[] {
  const moduleKeys = new Set(modules.map((module) => module.path.key));
  return modules.flatMap((module) =>
    module.imports
      .filter((request) => !moduleKeys.has(moduleNameToModulePathKey(request.moduleName)))
      .map((request) =>
        packagePipelineDiagnostic(
          "frontend",
          `frontend-missing-import:${module.path.key}->${request.moduleName}`,
        ),
      ),
  );
}

function moduleNameToModulePathKey(moduleName: string): string {
  const normalized = moduleName.replace(/\./g, "/");
  return normalized.endsWith(".wr") ? normalized : `${normalized}.wr`;
}

export function lowerTypedHir(
  input: PackageTypedHirInput,
): UefiAArch64PackageStageResult<PackageTypedHirAdapter> {
  const graph = input.parsedGraph.parsedGraph;

  const indexResult = buildItemIndex({ graph });
  if (indexResult.diagnostics.length > 0) {
    return {
      kind: "error",
      diagnostics: mapPackageStageDiagnostics("semantic", indexResult.diagnostics),
    };
  }

  const coreTypes = CoreTypeCatalog.default();
  const semanticTarget = packageSemanticTargetSurface(input.target, indexResult.index);
  const names = resolveNames({
    graph,
    index: indexResult.index,
    coreTypes,
    platformPrimitiveNames: uefiAArch64PlatformPrimitiveNameCatalog(),
    compilerIntrinsics: uefiAArch64CompilerIntrinsicNameCatalog(),
    targetTypes: semanticTarget.targetTypeKinds,
  });
  if (names.diagnostics.length > 0) {
    return {
      kind: "error",
      diagnostics: mapPackageStageDiagnostics("semantic", names.diagnostics),
    };
  }

  const surface = checkSemanticSurface({
    graph,
    index: indexResult.index,
    references: names.references,
    platformBindings: names.platformBindings,
    coreTypes,
    targetSurface: semanticTarget,
    enabledFeatures: input.packageInput.enabledTargetFeatures,
  });
  if (surface.diagnostics.length > 0) {
    return {
      kind: "error",
      diagnostics: mapPackageStageDiagnostics("semantic", surface.diagnostics),
    };
  }

  const lowerTypedHirInput = Object.freeze({
    graph,
    index: indexResult.index,
    references: names.references,
    coreTypes,
    program: surface.program,
    ...(surface.image !== undefined ? { image: surface.image } : {}),
  } satisfies LowerTypedHirInput);
  const lowerTypedHirResult = lowerSourceTypedHir(lowerTypedHirInput);
  if (lowerTypedHirResult.diagnostics.length > 0) {
    return {
      kind: "error",
      diagnostics: mapPackageStageDiagnostics("semantic", lowerTypedHirResult.diagnostics),
    };
  }

  return {
    kind: "ok",
    value: Object.freeze({
      kind: "typed-hir" as const,
      lowerTypedHirInput,
      lowerTypedHirResult,
    }),
    diagnostics: [],
  };
}

export function monomorphizeWholeImage(
  input: PackageMonomorphizedImageInput,
): UefiAArch64PackageStageResult<PackageMonomorphizedImageAdapter> {
  const lowerTypedHirResult = input.typedHir.lowerTypedHirResult;

  const imageId = input.typedHir.lowerTypedHirInput.image?.imageId;
  const monomorphizeWholeImageInput = Object.freeze({
    program: lowerTypedHirResult.program,
    ...(imageId !== undefined ? { imageId } : {}),
  } satisfies MonomorphizeWholeImageInput);
  const monomorphizeWholeImageResult = monomorphizeSourceWholeImage(monomorphizeWholeImageInput);
  if (monomorphizeWholeImageResult.kind === "error") {
    return {
      kind: "error",
      diagnostics: mapPackageStageDiagnostics(
        "monomorphization",
        monomorphizeWholeImageResult.diagnostics,
      ),
    };
  }

  const staticChar16Metadata = extractUefiAArch64StaticChar16MetadataFromCompilerIntrinsics(
    compilerIntrinsicCallsFromTypedHir(lowerTypedHirResult),
  );
  if (staticChar16Metadata.kind === "error") {
    return { kind: "error", diagnostics: staticChar16Metadata.diagnostics };
  }

  return {
    kind: "ok",
    value: Object.freeze({
      kind: "mono-image" as const,
      monomorphizeWholeImageInput,
      monomorphizeWholeImageResult,
      reachablePlatformPrimitiveIds: Object.freeze([
        ...monomorphizeWholeImageResult.reachablePlatformPrimitiveIds,
      ]),
      staticChar16Metadata: staticChar16Metadata.value,
    }),
    diagnostics: [],
  };
}

export function computeRepresentationLayoutFacts(
  input: PackageRepresentationLayoutFactsInput,
): UefiAArch64PackageStageResult<PackageRepresentationLayoutFactsAdapter> {
  const monomorphizeWholeImageResult = input.monomorphizedImage.monomorphizeWholeImageResult;

  const computeRepresentationLayoutFactsInput = Object.freeze({
    program: monomorphizeWholeImageResult.program,
    target: productionUefiAArch64LayoutTargetSurface(input.target),
  } satisfies ComputeRepresentationLayoutFactsInput);
  const computeRepresentationLayoutFactsResult = computeSourceRepresentationLayoutFacts(
    computeRepresentationLayoutFactsInput,
  );
  if (computeRepresentationLayoutFactsResult.kind === "error") {
    return {
      kind: "error",
      diagnostics: mapPackageStageDiagnostics(
        "layout-facts",
        computeRepresentationLayoutFactsResult.diagnostics,
      ),
    };
  }

  return {
    kind: "ok",
    value: Object.freeze({
      kind: "layout-facts" as const,
      computeRepresentationLayoutFactsInput,
      computeRepresentationLayoutFactsResult,
      staticChar16Metadata: input.monomorphizedImage.staticChar16Metadata,
    }),
    diagnostics: [],
  };
}

export function buildProofMir(
  input: PackageProofMirInput,
): UefiAArch64PackageStageResult<PackageProofMirAdapter> {
  const monomorphizeWholeImageResult = input.monomorphizedImage.monomorphizeWholeImageResult;

  const computeRepresentationLayoutFactsResult =
    input.layoutFacts.computeRepresentationLayoutFactsResult;

  const buildProofMirInput = Object.freeze({
    program: monomorphizeWholeImageResult.program,
    layout: computeRepresentationLayoutFactsResult.facts,
    target: productionUefiAArch64ProofMirBuildTargetContext(input.target),
  } satisfies BuildProofMirInput);
  const buildProofMirResult = buildSourceProofMir(buildProofMirInput);
  if (buildProofMirResult.kind === "error") {
    return {
      kind: "error",
      diagnostics: mapPackageStageDiagnostics("proof-mir", buildProofMirResult.diagnostics),
    };
  }

  return {
    kind: "ok",
    value: Object.freeze({
      kind: "proof-mir" as const,
      buildProofMirInput,
      buildProofMirResult,
      staticChar16Metadata: input.monomorphizedImage.staticChar16Metadata,
    }),
    diagnostics: [],
  };
}

export function checkProofAndResources(
  input: PackageProofCheckInput,
): UefiAArch64PackageStageResult<PackageProofCheckAdapter> {
  const proofMirResult = input.proofMir.buildProofMirResult;

  const layoutFactsResult = input.layoutFacts.computeRepresentationLayoutFactsResult;

  const authority = productionUefiAArch64ProofCheckInputAuthority({
    target: input.target,
    proofMir: proofMirResult.mir,
    layout: layoutFactsResult.facts,
  });
  if (authority.kind === "error") {
    return {
      kind: "error",
      diagnostics: authority.diagnostics.map((diagnostic) =>
        packageStageDiagnostic("proof-check", `${diagnostic.code}:${diagnostic.stableDetail}`),
      ),
    };
  }

  const checkProofAndResourcesResult = checkProofAndResourcesSource(authority.value);
  if (checkProofAndResourcesResult.kind === "error") {
    return {
      kind: "error",
      diagnostics: mapPackageStageDiagnostics(
        "proof-check",
        checkProofAndResourcesResult.diagnostics,
      ),
    };
  }

  return {
    kind: "ok",
    value: Object.freeze({
      kind: "proof-check" as const,
      checkProofAndResourcesInput: authority.value,
      checkProofAndResourcesResult,
      staticChar16Metadata: input.proofMir.staticChar16Metadata,
    }),
    diagnostics: [],
  };
}

export function buildOptimizedOptIr(
  input: PackageOptimizedOptIrInput,
): UefiAArch64PackageStageResult<PackageOptimizedOptIrAdapter> {
  const checkProofAndResourcesResult = input.proofCheck.checkProofAndResourcesResult;
  const layoutFactsResult = input.layoutFacts.computeRepresentationLayoutFactsResult;

  const buildOptimizedOptIrInput = Object.freeze({
    handoff: checkProofAndResourcesResult.checkedOptIrHandoff,
    layoutFacts: Object.freeze({
      facts: layoutFactsResult.facts,
      fingerprint: layoutAuthorityFingerprintForProofCheckInput(layoutFactsResult.facts),
    }),
    target: productionUefiAArch64OptIrTargetSurface(input.target),
    options: Object.freeze({ deterministicIds: true }),
    policy: productionOptIrOptimizationPolicy(),
  } satisfies BuildOptimizedOptIrInput);
  const constructOptIrResult = constructSourceOptIr(buildOptimizedOptIrInput);
  if (constructOptIrResult.kind === "error") {
    return {
      kind: "error",
      diagnostics: mapPackageStageDiagnostics("opt-ir", constructOptIrResult.diagnostics),
    };
  }
  const optimized = optimizeSourceOptIr({
    program: constructOptIrResult.program,
    facts: constructOptIrResult.facts,
    target: buildOptimizedOptIrInput.target,
    policy: buildOptimizedOptIrInput.policy,
  });
  const buildOptimizedOptIrResult =
    optimized.kind === "error"
      ? optimized
      : Object.freeze({
          ...optimized,
          diagnostics: Object.freeze([
            ...constructOptIrResult.diagnostics,
            ...optimized.diagnostics,
          ]),
        });
  if (buildOptimizedOptIrResult.kind === "error") {
    return {
      kind: "error",
      diagnostics: mapPackageStageDiagnostics("opt-ir", [
        ...constructOptIrResult.diagnostics,
        ...buildOptimizedOptIrResult.diagnostics,
      ]),
    };
  }
  const staticChar16Metadata = remapStaticChar16MetadataToOptIrValues({
    metadata: input.proofCheck.staticChar16Metadata,
    program: buildOptimizedOptIrResult.program,
    operations: buildOptimizedOptIrResult.operations,
  });

  return {
    kind: "ok",
    value: Object.freeze({
      program: buildOptimizedOptIrResult.program,
      operations: Object.freeze([...buildOptimizedOptIrResult.operations]),
      unoptimizedOperations: Object.freeze([...(constructOptIrResult.program.operations ?? [])]),
      facts: buildOptimizedOptIrResult.facts,
      staticChar16Strings: Object.freeze([...staticChar16Metadata.staticChar16Strings]),
      staticChar16Pointers: Object.freeze([...staticChar16Metadata.staticChar16Pointers]),
      buildOptimizedOptIrInput,
      constructOptIrResult,
      buildOptimizedOptIrResult,
    }),
    diagnostics: [],
  };
}

function createUefiAArch64StageRecorder<StageKey extends string>() {
  const records: UefiAArch64StageRecord<StageKey>[] = [];
  return {
    passed(stageKey: StageKey): readonly UefiAArch64StageRecord<StageKey>[] {
      records.push(Object.freeze({ stageKey, status: "passed" as const }));
      return this.records();
    },
    failed(stageKey: StageKey): readonly UefiAArch64StageRecord<StageKey>[] {
      records.push(Object.freeze({ stageKey, status: "failed" as const }));
      return this.records();
    },
    records(): readonly UefiAArch64StageRecord<StageKey>[] {
      return Object.freeze([...records]);
    },
  };
}

function packagePipelineError<Value>(
  stages: readonly UefiAArch64StageRecord<UefiAArch64PackagePipelineStageKey>[],
  diagnostics: readonly UefiAArch64TargetDiagnostic[],
): UefiAArch64TargetResult<Value> {
  return uefiAArch64Error({
    diagnostics,
    verification: verificationSummaryFromRuns(
      stages.map((stage) => ({
        verifierKey: PACKAGE_PIPELINE_VERIFIER_KEY,
        runKey: stage.stageKey,
        status: stage.status,
      })),
    ),
  });
}

function packageStageDiagnostic(
  stageKey: UefiAArch64PackagePipelineStageKey,
  stableDetail: string,
): UefiAArch64TargetDiagnostic {
  return uefiAArch64TargetDiagnostic({
    code: "UEFI_AARCH64_PIPELINE_FAILED",
    ownerKey: `uefi-aarch64-package-pipeline:${stageKey}`,
    stableDetail,
  });
}

function packagePipelineDiagnostic(
  stageKey: UefiAArch64PackagePipelineStageKey,
  stableDetail: string,
): UefiAArch64TargetDiagnostic {
  return packageStageDiagnostic(stageKey, stableDetail);
}

function mapPackageStageDiagnostics(
  stageKey: UefiAArch64PackagePipelineStageKey,
  diagnostics: readonly {
    readonly code?: string;
    readonly stableDetail?: string;
    readonly message?: string;
  }[],
): readonly UefiAArch64TargetDiagnostic[] {
  return diagnostics.map((diagnostic, index) => {
    const originalDetail =
      diagnostic.stableDetail ?? diagnostic.message ?? diagnostic.code ?? `diagnostic:${index}`;
    const originalCode = diagnostic.code ?? "unknown";
    return packageStageDiagnostic(stageKey, `${originalCode}:${originalDetail}`);
  });
}
