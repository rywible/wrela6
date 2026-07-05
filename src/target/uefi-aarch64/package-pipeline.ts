import {
  CollectingDiagnosticSink,
  DottedModuleResolver,
  type FileReadResult,
  KeywordTable,
  Lexer,
  ModulePath,
  SourceText,
  loadFrontendModuleGraphSync,
  type SyncFileRepository,
} from "../../frontend";
import { lowerTypedHir as lowerSourceTypedHir, type LowerTypedHirInput } from "../../hir";
import type { ComputeRepresentationLayoutFactsInput } from "../../layout";
import { computeRepresentationLayoutFacts as computeSourceRepresentationLayoutFacts } from "../../layout";
import {
  monomorphizeWholeImage as monomorphizeSourceWholeImage,
  type MonomorphizeWholeImageInput,
} from "../../mono";
import {
  constructOptIr as constructSourceOptIr,
  optimizeOptIr as optimizeSourceOptIr,
  productionOptIrOptimizationPolicy,
  type BuildOptimizedOptIrInput,
} from "../../opt-ir";
import { checkProofAndResources as checkProofAndResourcesSource } from "../../proof-check";
import { layoutAuthorityFingerprintForProofCheckInput } from "../../proof-check/validation/input-validator";
import {
  buildProofMir as buildSourceProofMir,
  type BuildProofMirInput,
} from "../../proof-mir/proof-mir-builder";
import type { Diagnostic } from "../../shared/diagnostics";
import { compareCodeUnitStrings } from "../../shared/deterministic-sort";
import { buildItemIndex, type ItemIndex } from "../../semantic/item-index";
import { CoreTypeCatalog, resolveNames } from "../../semantic/names";
import { checkSemanticSurface } from "../../semantic/surface";
import type { CheckedType } from "../../semantic/surface";
import { type TypeId } from "../../semantic/ids";
import { moduleNameToUefiPackageModulePathKey } from "./package-input";
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
import {
  materializeStaticChar16ConstantPoolReferences,
  optimizedOptIrArtifact,
  staticChar16MetadataFromOptIrConstantPool,
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
import { uefiAArch64SourceApiBridge } from "./source-api-bridge";
import type {
  PackageModuleGraphParseInput,
  PackageMonomorphizedImageAdapter,
  PackageMonomorphizedImageInput,
  PackageOptimizedOptIrAdapter,
  PackageOptimizedOptIrInput,
  PackageParsedModuleGraphAdapter,
  PackageProofCheckAdapter,
  PackageProofCheckInput,
  PackageProofMirAdapter,
  PackageProofMirInput,
  PackageRepresentationLayoutFactsAdapter,
  PackageRepresentationLayoutFactsInput,
  PackageTypedHirAdapter,
  PackageTypedHirInput,
  RunUefiAArch64PackagePipelineToOptIrInput,
  UefiAArch64PackageOptIrPipelineOutput,
  UefiAArch64PackagePipelineDependencies,
  UefiAArch64PackagePipelineStageKey,
  UefiAArch64PackageProofCheckPipelineOutput,
  UefiAArch64PackageStageResult,
} from "./package-pipeline-adapters";
import { passedVerification, uefiAArch64Ok, type UefiAArch64TargetResult } from "./result";
import {
  PACKAGE_PIPELINE_VERIFIER_KEY,
  createUefiAArch64StageRecorder,
  failedOptIrStages,
  mapPackageStageDiagnostics,
  packagePipelineDiagnostic,
  packagePipelineError,
  passedOptIrStages,
  sourcePayloadFromDiagnostic,
} from "./package-pipeline-records";

const PACKAGE_PIPELINE_RUN_KEY = "to-opt-ir";
const PACKAGE_PIPELINE_PROOF_CHECK_RUN_KEY = "to-proof-check";

export type {
  PackageModuleGraphParseInput,
  PackageMonomorphizedImageAdapter,
  PackageMonomorphizedImageInput,
  PackageOptimizedOptIrAdapter,
  PackageOptimizedOptIrInput,
  PackageParsedModuleGraphAdapter,
  PackageProofCheckAdapter,
  PackageProofCheckInput,
  PackageProofMirAdapter,
  PackageProofMirInput,
  PackageRepresentationLayoutFactsAdapter,
  PackageRepresentationLayoutFactsInput,
  PackageTypedHirAdapter,
  PackageTypedHirInput,
  RunUefiAArch64PackagePipelineToOptIrInput,
  UefiAArch64OptimizedOptIrArtifact,
  UefiAArch64PackageOptIrPipelineOutput,
  UefiAArch64PackagePipelineDependencies,
  UefiAArch64PackagePipelineStageKey,
  UefiAArch64PackageProofCheckPipelineOutput,
  UefiAArch64PackageStageResult,
  UefiAArch64StaticChar16IntrinsicMetadata,
  UefiAArch64StaticChar16PointerRecord,
  UefiAArch64StageRecord,
} from "./package-pipeline-adapters";
export {
  layoutFactsToProofMirInput,
  monomorphizedImageToLayoutFactsInput,
  packageHirToMonomorphizationInput,
  packageInputToModuleGraphParseInput,
  packageParsedGraphToHirInput,
  proofCheckToOptimizedOptIrInput,
  proofMirToCheckInput,
} from "./package-pipeline-stage-inputs";

export function runUefiAArch64PackagePipelineToProofCheck(
  input: RunUefiAArch64PackagePipelineToOptIrInput,
  dependencies: UefiAArch64PackagePipelineDependencies = productionPackagePipelineDependencies(),
): UefiAArch64TargetResult<UefiAArch64PackageProofCheckPipelineOutput> {
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

  return uefiAArch64Ok({
    value: Object.freeze({
      target: input.target,
      parsedGraph: parsed.value,
      typedHir: typedHir.value,
      monomorphizedImage: monomorphized.value,
      layoutFacts: layoutFacts.value,
      proofMir: proofMir.value,
      proofCheck: proofCheck.value,
      semanticPlatformCatalogFingerprint: input.target.semanticPlatformCatalogFingerprint,
      proofMirRuntimeCatalogFingerprint: input.target.proofMirRuntimeCatalogFingerprint,
      reachablePlatformPrimitiveIds: Object.freeze([
        ...monomorphized.value.reachablePlatformPrimitiveIds,
      ]),
      runtimeCatalogFingerprint: input.target.proofMirRuntimeCatalogFingerprint,
      stages: stages.records(),
    }),
    verification: passedVerification(
      PACKAGE_PIPELINE_VERIFIER_KEY,
      PACKAGE_PIPELINE_PROOF_CHECK_RUN_KEY,
    ),
  });
}

export function runUefiAArch64PackagePipelineToOptIr(
  input: RunUefiAArch64PackagePipelineToOptIrInput,
  dependencies: UefiAArch64PackagePipelineDependencies = productionPackagePipelineDependencies(),
): UefiAArch64TargetResult<UefiAArch64PackageOptIrPipelineOutput> {
  const proofChecked = runUefiAArch64PackagePipelineToProofCheck(input, dependencies);
  if (proofChecked.kind === "error") return proofChecked;

  const optIr = dependencies.buildOptimizedOptIr(
    proofCheckToOptimizedOptIrInput(
      proofChecked.value.proofCheck,
      proofChecked.value.proofMir,
      proofChecked.value.layoutFacts,
      input.target,
    ),
  );
  if (optIr.kind === "error") {
    return packagePipelineError(failedOptIrStages(proofChecked.value.stages), optIr.diagnostics);
  }
  const optIrArtifact = optimizedOptIrArtifact(optIr.value, input.packageInput);
  if (optIrArtifact.kind === "error") {
    return packagePipelineError(
      failedOptIrStages(proofChecked.value.stages),
      optIrArtifact.diagnostics,
    );
  }

  return uefiAArch64Ok({
    value: Object.freeze({
      ...proofChecked.value,
      optimizedOptIr: optIr.value,
      optIr: optIrArtifact.value,
      stages: passedOptIrStages(proofChecked.value.stages),
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
  const parsedGraph = loadFrontendModuleGraphSync({
    entry: ModulePath.from(
      moduleNameToUefiPackageModulePathKey(input.packageInput.entryModuleName),
    ),
    lexer,
    files: new PackageSourceFileRepository(input.packageInput.sourceFiles),
    resolver: new DottedModuleResolver(),
    diagnostics,
  });
  const targetDiagnostics = parsedGraph.diagnostics.map((diagnostic) =>
    packagePipelineDiagnostic(
      "frontend",
      frontendDiagnosticStableDetail(diagnostic),
      sourcePayloadFromDiagnostic(diagnostic),
    ),
  );
  if (targetDiagnostics.length > 0) {
    return { kind: "error", diagnostics: targetDiagnostics };
  }
  return {
    kind: "ok",
    value: Object.freeze({ kind: "parsed-graph" as const, parsedGraph }),
    diagnostics: [],
  };
}

class PackageSourceFileRepository implements SyncFileRepository {
  private readonly sourceByModulePath = new Map<string, SourceText>();

  constructor(sourceFiles: PackageModuleGraphParseInput["packageInput"]["sourceFiles"]) {
    for (const sourceFile of [...sourceFiles].sort((left, right) =>
      compareCodeUnitStrings(left.sourceKey, right.sourceKey),
    )) {
      const pathKey = moduleNameToUefiPackageModulePathKey(sourceFile.moduleName);
      this.sourceByModulePath.set(pathKey, SourceText.from(sourceFile.sourceKey, sourceFile.text));
    }
  }

  read(path: ModulePath): FileReadResult {
    const source = this.sourceByModulePath.get(path.key);
    if (source === undefined) return { kind: "missing", path };
    return { kind: "found", path, source };
  }
}

function frontendDiagnosticStableDetail(diagnostic: Diagnostic): string {
  return [
    "frontend",
    diagnostic.code,
    diagnostic.source.name,
    String(diagnostic.span.start),
    String(diagnostic.span.end),
  ].join(":");
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
    enabledTargetFeatures: input.packageInput.enabledTargetFeatures,
  } satisfies LowerTypedHirInput);
  const lowerTypedHirResult = lowerSourceTypedHir(lowerTypedHirInput);
  if (lowerTypedHirResult.diagnostics.length > 0) {
    return {
      kind: "error",
      diagnostics: mapPackageStageDiagnostics("semantic", lowerTypedHirResult.diagnostics),
    };
  }
  const semanticValidationContracts = surface.program.proofSurface.validationContracts.entries();
  const hirValidations = lowerTypedHirResult.program.proofMetadata.validations.entries();

  return {
    kind: "ok",
    value: Object.freeze({
      kind: "typed-hir" as const,
      lowerTypedHirInput,
      lowerTypedHirResult,
      ...sourceApiResultConstructorTypeId(indexResult.index),
      ...validationResultConstructorTypeIds([
        ...semanticValidationContracts.map((contract) => contract.resultType),
        ...hirValidations.map((validation) => validation.pendingResultPlace.type),
      ]),
      ...statusCarrierPayloadTypeIds([
        ...sourceApiResultPayloadTypes(indexResult.index),
        ...semanticValidationContracts.map((contract) => contract.errPayloadType),
        ...hirValidations.map((validation) => validation.errPayloadType),
      ]),
    }),
    diagnostics: [],
  };
}

function sourceApiResultConstructorTypeId(index: ItemIndex): {
  readonly sourceApiResultConstructorTypeId?: TypeId;
} {
  const bridge = uefiAArch64SourceApiBridge(index);
  if (bridge?.resultType.kind !== "applied" || bridge.resultType.constructor.kind !== "source") {
    return {};
  }
  return { sourceApiResultConstructorTypeId: bridge.resultType.constructor.typeId };
}

function sourceApiResultPayloadTypes(index: ItemIndex): readonly CheckedType[] {
  const bridge = uefiAArch64SourceApiBridge(index);
  return bridge === undefined ? Object.freeze([]) : Object.freeze([bridge.bootErrorType]);
}

function validationResultConstructorTypeIds(
  resultTypes: readonly CheckedType[],
  existingIds: readonly TypeId[] = Object.freeze([]),
): {
  readonly validationResultConstructorTypeIds?: readonly TypeId[];
} {
  const ids = new Set<TypeId>(existingIds);
  for (const resultType of resultTypes) {
    if (resultType.kind === "applied" && resultType.constructor.kind === "source") {
      ids.add(resultType.constructor.typeId);
    }
  }
  const sorted = [...ids].sort((left, right) => (left as number) - (right as number));
  return sorted.length === 0 ? {} : { validationResultConstructorTypeIds: Object.freeze(sorted) };
}

function statusCarrierPayloadTypeIds(
  payloadTypes: readonly CheckedType[],
  existingIds: readonly TypeId[] = Object.freeze([]),
): {
  readonly statusCarrierPayloadTypeIds?: readonly TypeId[];
} {
  const ids = new Set<TypeId>(existingIds);
  for (const payloadType of payloadTypes) {
    if (payloadType.kind === "source") {
      ids.add(payloadType.typeId);
    }
  }
  const sorted = [...ids].sort((left, right) => (left as number) - (right as number));
  return sorted.length === 0 ? {} : { statusCarrierPayloadTypeIds: Object.freeze(sorted) };
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

  const monoValidations = monomorphizeWholeImageResult.program.proofMetadata.validations.entries();

  return {
    kind: "ok",
    value: Object.freeze({
      kind: "mono-image" as const,
      monomorphizeWholeImageInput,
      monomorphizeWholeImageResult,
      reachablePlatformPrimitiveIds: Object.freeze([
        ...monomorphizeWholeImageResult.reachablePlatformPrimitiveIds,
      ]),
      ...(input.typedHir.sourceApiResultConstructorTypeId === undefined
        ? {}
        : { sourceApiResultConstructorTypeId: input.typedHir.sourceApiResultConstructorTypeId }),
      ...validationResultConstructorTypeIds(
        monoValidations.map((validation) => validation.pendingResultPlace.type),
        input.typedHir.validationResultConstructorTypeIds,
      ),
      ...statusCarrierPayloadTypeIds(
        monoValidations.map((validation) => validation.errPayloadType),
        input.typedHir.statusCarrierPayloadTypeIds,
      ),
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
      ...(input.monomorphizedImage.sourceApiResultConstructorTypeId === undefined
        ? {}
        : {
            sourceApiResultConstructorTypeId:
              input.monomorphizedImage.sourceApiResultConstructorTypeId,
          }),
      ...(input.monomorphizedImage.validationResultConstructorTypeIds === undefined
        ? {}
        : {
            validationResultConstructorTypeIds:
              input.monomorphizedImage.validationResultConstructorTypeIds,
          }),
      ...(input.monomorphizedImage.statusCarrierPayloadTypeIds === undefined
        ? {}
        : {
            statusCarrierPayloadTypeIds: input.monomorphizedImage.statusCarrierPayloadTypeIds,
          }),
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
      ...(input.monomorphizedImage.sourceApiResultConstructorTypeId === undefined
        ? {}
        : {
            sourceApiResultConstructorTypeId:
              input.monomorphizedImage.sourceApiResultConstructorTypeId,
          }),
      ...(input.monomorphizedImage.validationResultConstructorTypeIds === undefined
        ? {}
        : {
            validationResultConstructorTypeIds:
              input.monomorphizedImage.validationResultConstructorTypeIds,
          }),
      ...(input.monomorphizedImage.statusCarrierPayloadTypeIds === undefined
        ? {}
        : {
            statusCarrierPayloadTypeIds: input.monomorphizedImage.statusCarrierPayloadTypeIds,
          }),
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
        packagePipelineDiagnostic("proof-check", `${diagnostic.code}:${diagnostic.stableDetail}`),
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
      ...(input.proofMir.sourceApiResultConstructorTypeId === undefined
        ? {}
        : { sourceApiResultConstructorTypeId: input.proofMir.sourceApiResultConstructorTypeId }),
      ...(input.proofMir.validationResultConstructorTypeIds === undefined
        ? {}
        : {
            validationResultConstructorTypeIds: input.proofMir.validationResultConstructorTypeIds,
          }),
      ...(input.proofMir.statusCarrierPayloadTypeIds === undefined
        ? {}
        : { statusCarrierPayloadTypeIds: input.proofMir.statusCarrierPayloadTypeIds }),
    }),
    diagnostics: [],
  };
}

export function buildOptimizedOptIr(
  input: PackageOptimizedOptIrInput,
): UefiAArch64PackageStageResult<PackageOptimizedOptIrAdapter> {
  const checkProofAndResourcesResult = input.proofCheck.checkProofAndResourcesResult;
  const layoutFactsResult = input.layoutFacts.computeRepresentationLayoutFactsResult;
  const targetOptions =
    input.proofCheck.sourceApiResultConstructorTypeId === undefined &&
    input.proofCheck.validationResultConstructorTypeIds === undefined &&
    input.proofCheck.statusCarrierPayloadTypeIds === undefined
      ? {}
      : {
          ...(input.proofCheck.sourceApiResultConstructorTypeId === undefined
            ? {}
            : {
                sourceApiResultConstructorTypeId: input.proofCheck.sourceApiResultConstructorTypeId,
              }),
          ...(input.proofCheck.validationResultConstructorTypeIds === undefined
            ? {}
            : {
                validationResultConstructorTypeIds:
                  input.proofCheck.validationResultConstructorTypeIds,
              }),
          ...(input.proofCheck.statusCarrierPayloadTypeIds === undefined
            ? {}
            : { statusCarrierPayloadTypeIds: input.proofCheck.statusCarrierPayloadTypeIds }),
        };

  const buildOptimizedOptIrInput = Object.freeze({
    handoff: checkProofAndResourcesResult.checkedOptIrHandoff,
    layoutFacts: Object.freeze({
      facts: layoutFactsResult.facts,
      fingerprint: layoutAuthorityFingerprintForProofCheckInput(layoutFactsResult.facts),
    }),
    target: productionUefiAArch64OptIrTargetSurface(input.target, targetOptions),
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
  const optIrWithStaticChar16 = materializeStaticChar16ConstantPoolReferences({
    program: constructOptIrResult.program,
    operations: constructOptIrResult.operations,
  });
  if (optIrWithStaticChar16.kind === "error") {
    return { kind: "error", diagnostics: optIrWithStaticChar16.diagnostics };
  }
  const optimized = optimizeSourceOptIr({
    program: optIrWithStaticChar16.program,
    operations: optIrWithStaticChar16.operations,
    optimizationRegions: constructOptIrResult.optimizationRegions,
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
  const optimizedStaticChar16Metadata = staticChar16MetadataFromOptIrConstantPool({
    program: buildOptimizedOptIrResult.program,
    operations: buildOptimizedOptIrResult.operations,
  });

  return {
    kind: "ok",
    value: Object.freeze({
      program: buildOptimizedOptIrResult.program,
      operations: Object.freeze([...buildOptimizedOptIrResult.operations]),
      optimizationRegions: Object.freeze([...buildOptimizedOptIrResult.optimizationRegions]),
      unoptimizedOperations: Object.freeze([...optIrWithStaticChar16.operations]),
      facts: buildOptimizedOptIrResult.facts,
      staticChar16Strings: Object.freeze([...optimizedStaticChar16Metadata.staticChar16Strings]),
      staticChar16Pointers: Object.freeze([...optimizedStaticChar16Metadata.staticChar16Pointers]),
      buildOptimizedOptIrInput,
      constructOptIrResult,
      buildOptimizedOptIrResult,
    }),
    diagnostics: [],
  };
}
