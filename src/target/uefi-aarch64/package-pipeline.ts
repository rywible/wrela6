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
import type { LowerTypedHirInput, LowerTypedHirResult } from "../../hir";
import type {
  ComputeRepresentationLayoutFactsInput,
  ComputeRepresentationLayoutFactsResult,
} from "../../layout";
import type { MonomorphizeWholeImageInput, MonomorphizeWholeImageResult } from "../../mono";
import type { BuildOptimizedOptIrInput, OptimizeOptIrResult } from "../../opt-ir";
import type { OptIrFactSet } from "../../opt-ir/facts/fact-index";
import type { OptIrOperation } from "../../opt-ir/operations";
import type { OptIrProgram } from "../../opt-ir/program";
import type { CheckProofAndResourcesInput, CheckProofAndResourcesResult } from "../../proof-check";
import type { BuildProofMirInput, BuildProofMirResult } from "../../proof-mir/proof-mir-builder";
import { compareCodeUnitStrings } from "../../shared/deterministic-sort";
import { uefiAArch64TargetDiagnostic, type UefiAArch64TargetDiagnostic } from "./diagnostics";
import type { CompilerPackageInput } from "./package-input";
import {
  fingerprintUefiAArch64StaticChar16String,
  uefiAArch64StaticChar16StringPointer,
  type UefiAArch64StaticChar16String,
  type UefiAArch64StaticChar16StringPointer,
} from "./firmware-strings";
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
  readonly parsedGraph?: ParsedModuleGraph;
}

export interface PackageTypedHirInput {
  readonly packageInput: CompilerPackageInput;
  readonly target: UefiAArch64TargetDriverSurface;
  readonly parsedGraph: PackageParsedModuleGraphAdapter;
}

export interface PackageTypedHirAdapter {
  readonly kind: "typed-hir";
  readonly lowerTypedHirInput?: LowerTypedHirInput;
  readonly lowerTypedHirResult?: LowerTypedHirResult;
}

export interface PackageMonomorphizedImageInput {
  readonly target: UefiAArch64TargetDriverSurface;
  readonly typedHir: PackageTypedHirAdapter;
}

export interface PackageMonomorphizedImageAdapter {
  readonly kind: "mono-image";
  readonly monomorphizeWholeImageInput?: MonomorphizeWholeImageInput;
  readonly monomorphizeWholeImageResult?: MonomorphizeWholeImageResult & { readonly kind: "ok" };
  readonly reachablePlatformPrimitiveIds?: readonly unknown[];
}

export interface PackageRepresentationLayoutFactsInput {
  readonly target: UefiAArch64TargetDriverSurface;
  readonly monomorphizedImage: PackageMonomorphizedImageAdapter;
}

export interface PackageRepresentationLayoutFactsAdapter {
  readonly kind: "layout-facts";
  readonly computeRepresentationLayoutFactsInput?: ComputeRepresentationLayoutFactsInput;
  readonly computeRepresentationLayoutFactsResult?: ComputeRepresentationLayoutFactsResult & {
    readonly kind: "ok";
  };
}

export interface PackageProofMirInput {
  readonly target: UefiAArch64TargetDriverSurface;
  readonly monomorphizedImage: PackageMonomorphizedImageAdapter;
  readonly layoutFacts: PackageRepresentationLayoutFactsAdapter;
}

export interface PackageProofMirAdapter {
  readonly kind: "proof-mir";
  readonly buildProofMirInput?: BuildProofMirInput;
  readonly buildProofMirResult?: BuildProofMirResult & { readonly kind: "ok" };
}

export interface PackageProofCheckInput {
  readonly target: UefiAArch64TargetDriverSurface;
  readonly proofMir: PackageProofMirAdapter;
  readonly layoutFacts: PackageRepresentationLayoutFactsAdapter;
}

export interface PackageProofCheckAdapter {
  readonly kind: "proof-check";
  readonly checkProofAndResourcesInput?: CheckProofAndResourcesInput;
  readonly checkProofAndResourcesResult?: CheckProofAndResourcesResult & { readonly kind: "ok" };
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

export interface UefiAArch64OptimizedOptIrArtifact {
  readonly program: OptIrProgram;
  readonly operations: readonly OptIrOperation[];
  readonly facts: OptIrFactSet;
  readonly staticChar16Strings: readonly UefiAArch64StaticChar16String[];
  readonly staticChar16Pointers: readonly UefiAArch64StaticChar16PointerRecord[];
}

export interface PackageOptimizedOptIrAdapter {
  readonly program: OptIrProgram;
  readonly operations: readonly OptIrOperation[];
  readonly facts: OptIrFactSet;
  readonly staticChar16Strings?: readonly UefiAArch64StaticChar16String[];
  readonly staticChar16Pointers?: readonly UefiAArch64StaticChar16PointerRecord[];
  readonly buildOptimizedOptIrInput?: BuildOptimizedOptIrInput;
  readonly buildOptimizedOptIrResult?: OptimizeOptIrResult & { readonly kind: "ok" };
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
  const optIrArtifact = optimizedOptIrArtifact(optIr.value);
  if (optIrArtifact.kind === "error") {
    return packagePipelineError(stages.failed("opt-ir"), optIrArtifact.diagnostics);
  }
  stages.passed("opt-ir");

  return uefiAArch64Ok({
    value: Object.freeze({
      target: input.target,
      optIr: optIrArtifact.value,
      semanticPlatformCatalogFingerprint: input.target.semanticPlatformCatalogFingerprint,
      proofMirRuntimeCatalogFingerprint: input.target.proofMirRuntimeCatalogFingerprint,
      reachablePlatformPrimitiveIds: Object.freeze([
        ...(monomorphized.value.reachablePlatformPrimitiveIds ?? []),
      ]),
      runtimeCatalogFingerprint: input.target.proofMirRuntimeCatalogFingerprint,
      stages: stages.records(),
    }),
    verification: passedVerification(PACKAGE_PIPELINE_VERIFIER_KEY, PACKAGE_PIPELINE_RUN_KEY),
  });
}

function optimizedOptIrArtifact(
  adapter: PackageOptimizedOptIrAdapter,
): UefiAArch64PackageStageResult<UefiAArch64OptimizedOptIrArtifact> {
  if (!isOptimizedOptIrArtifact(adapter)) {
    return {
      kind: "error",
      diagnostics: [packagePipelineDiagnostic("opt-ir", "opt-ir-artifact:malformed")],
    };
  }
  const staticMetadata = normalizeStaticChar16Metadata(adapter);
  if (staticMetadata.kind === "error") {
    return { kind: "error", diagnostics: staticMetadata.diagnostics };
  }
  return {
    kind: "ok",
    value: Object.freeze({
      program: adapter.program,
      operations: Object.freeze([...adapter.operations]),
      facts: adapter.facts,
      staticChar16Strings: staticMetadata.staticChar16Strings,
      staticChar16Pointers: staticMetadata.staticChar16Pointers,
    }),
    diagnostics: [],
  };
}

function isOptimizedOptIrArtifact(candidate: unknown): candidate is PackageOptimizedOptIrAdapter {
  if (typeof candidate !== "object" || candidate === null) return false;
  const adapter = candidate as Partial<PackageOptimizedOptIrAdapter>;
  return (
    typeof adapter.program === "object" &&
    adapter.program !== null &&
    Array.isArray(adapter.operations) &&
    typeof adapter.facts === "object" &&
    adapter.facts !== null
  );
}

function normalizeStaticChar16Metadata(adapter: PackageOptimizedOptIrAdapter):
  | {
      readonly kind: "ok";
      readonly staticChar16Strings: readonly UefiAArch64StaticChar16String[];
      readonly staticChar16Pointers: readonly UefiAArch64StaticChar16PointerRecord[];
    }
  | { readonly kind: "error"; readonly diagnostics: readonly UefiAArch64TargetDiagnostic[] } {
  if (adapter.staticChar16Strings !== undefined && !Array.isArray(adapter.staticChar16Strings)) {
    return {
      kind: "error",
      diagnostics: [packagePipelineDiagnostic("opt-ir", "opt-ir-artifact:malformed")],
    };
  }
  if (adapter.staticChar16Pointers !== undefined && !Array.isArray(adapter.staticChar16Pointers)) {
    return {
      kind: "error",
      diagnostics: [packagePipelineDiagnostic("opt-ir", "opt-ir-artifact:malformed")],
    };
  }

  const strings = Object.freeze([...(adapter.staticChar16Strings ?? [])]);
  const pointers = Object.freeze([...(adapter.staticChar16Pointers ?? [])]);
  const diagnostics: UefiAArch64TargetDiagnostic[] = [];
  const stringsByFingerprint = new Map<string, UefiAArch64StaticChar16String>();
  const stableKeyFingerprints = new Map<string, string>();

  for (const value of strings) {
    if (!isStaticChar16StringRecord(value)) {
      diagnostics.push(packagePipelineDiagnostic("opt-ir", "opt-ir-artifact:malformed"));
      continue;
    }
    const expectedFingerprint = fingerprintUefiAArch64StaticChar16String({
      stableKey: value.stableKey,
      codeUnits: value.codeUnits,
      nulTerminated: true,
    });
    if (value.fingerprint !== expectedFingerprint) {
      diagnostics.push(
        packagePipelineDiagnostic(
          "opt-ir",
          `opt-ir-artifact:stale-static-char16-string:${value.stableKey}`,
        ),
      );
      continue;
    }
    const previousStableKeyFingerprint = stableKeyFingerprints.get(value.stableKey);
    if (
      previousStableKeyFingerprint !== undefined &&
      previousStableKeyFingerprint !== value.fingerprint
    ) {
      diagnostics.push(
        packagePipelineDiagnostic(
          "opt-ir",
          `opt-ir-artifact:duplicate-static-char16-string:${value.stableKey}`,
        ),
      );
    }
    stableKeyFingerprints.set(value.stableKey, value.fingerprint);
    stringsByFingerprint.set(value.fingerprint, value);
  }

  const valueKeys = new Set<string>();
  const symbolFingerprints = new Map<string, string>();
  for (const record of pointers) {
    if (!isStaticChar16PointerRecord(record)) {
      diagnostics.push(packagePipelineDiagnostic("opt-ir", "opt-ir-artifact:malformed"));
      continue;
    }
    if (valueKeys.has(record.valueKey)) {
      diagnostics.push(
        packagePipelineDiagnostic(
          "opt-ir",
          `opt-ir-artifact:duplicate-static-char16-pointer:${record.valueKey}`,
        ),
      );
      continue;
    }
    valueKeys.add(record.valueKey);
    const string = stringsByFingerprint.get(record.pointer.fingerprint);
    if (string === undefined) {
      diagnostics.push(
        packagePipelineDiagnostic(
          "opt-ir",
          `opt-ir-artifact:malformed-static-char16-pointer:${record.valueKey}`,
        ),
      );
      continue;
    }
    const expectedPointer = uefiAArch64StaticChar16StringPointer(string);
    if (!staticChar16PointersEqual(record.pointer, expectedPointer)) {
      diagnostics.push(
        packagePipelineDiagnostic(
          "opt-ir",
          `opt-ir-artifact:malformed-static-char16-pointer:${record.valueKey}`,
        ),
      );
    }
    const previousSymbolFingerprint = symbolFingerprints.get(record.pointer.symbolName);
    if (
      previousSymbolFingerprint !== undefined &&
      previousSymbolFingerprint !== record.pointer.fingerprint
    ) {
      diagnostics.push(
        packagePipelineDiagnostic(
          "opt-ir",
          `opt-ir-artifact:duplicate-static-char16-symbol:${record.pointer.symbolName}`,
        ),
      );
    }
    symbolFingerprints.set(record.pointer.symbolName, record.pointer.fingerprint);
  }

  return diagnostics.length > 0
    ? { kind: "error", diagnostics }
    : { kind: "ok", staticChar16Strings: strings, staticChar16Pointers: pointers };
}

function isStaticChar16StringRecord(value: unknown): value is UefiAArch64StaticChar16String {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Partial<UefiAArch64StaticChar16String>;
  return (
    typeof record.stableKey === "string" &&
    record.stableKey.length > 0 &&
    Array.isArray(record.codeUnits) &&
    record.codeUnits.every((codeUnit) => Number.isInteger(codeUnit) && codeUnit >= 0) &&
    Array.isArray(record.bytes) &&
    record.bytes.every((byte) => Number.isInteger(byte) && byte >= 0 && byte <= 0xff) &&
    record.nulTerminated === true &&
    typeof record.fingerprint === "string" &&
    record.fingerprint.length > 0
  );
}

function isStaticChar16PointerRecord(
  value: unknown,
): value is UefiAArch64StaticChar16PointerRecord {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Partial<UefiAArch64StaticChar16PointerRecord>;
  return (
    typeof record.valueKey === "string" &&
    record.valueKey.length > 0 &&
    typeof record.pointer === "object" &&
    record.pointer !== null &&
    isStaticChar16Pointer(record.pointer)
  );
}

function isStaticChar16Pointer(value: unknown): value is UefiAArch64StaticChar16StringPointer {
  if (typeof value !== "object" || value === null) return false;
  const pointer = value as Partial<UefiAArch64StaticChar16StringPointer>;
  return (
    pointer.kind === "static-char16-pointer" &&
    typeof pointer.stableKey === "string" &&
    pointer.stableKey.length > 0 &&
    typeof pointer.symbolName === "string" &&
    pointer.symbolName.length > 0 &&
    typeof pointer.fingerprint === "string" &&
    pointer.fingerprint.length > 0 &&
    pointer.lifetime === "image-readonly" &&
    pointer.nulTerminated === true
  );
}

function staticChar16PointersEqual(
  left: UefiAArch64StaticChar16StringPointer,
  right: UefiAArch64StaticChar16StringPointer,
): boolean {
  return (
    left.kind === right.kind &&
    left.stableKey === right.stableKey &&
    left.symbolName === right.symbolName &&
    left.fingerprint === right.fingerprint &&
    left.lifetime === right.lifetime &&
    left.nulTerminated === right.nulTerminated
  );
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
      const path = ModulePath.from(sourceFile.moduleName);
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
      entry: ModulePath.from(input.packageInput.entryModuleName),
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
      .filter((request) => !moduleKeys.has(request.moduleName))
      .map((request) =>
        packagePipelineDiagnostic(
          "frontend",
          `frontend-missing-import:${module.path.key}->${request.moduleName}`,
        ),
      ),
  );
}

export function lowerTypedHir(
  _input: PackageTypedHirInput,
): UefiAArch64PackageStageResult<PackageTypedHirAdapter> {
  return unsupportedProductionStage("semantic", "semantic-to-typed-hir-adapter-not-wired");
}

export function monomorphizeWholeImage(
  _input: PackageMonomorphizedImageInput,
): UefiAArch64PackageStageResult<PackageMonomorphizedImageAdapter> {
  return unsupportedProductionStage("monomorphization", "typed-hir-to-mono-adapter-not-wired");
}

export function computeRepresentationLayoutFacts(
  _input: PackageRepresentationLayoutFactsInput,
): UefiAArch64PackageStageResult<PackageRepresentationLayoutFactsAdapter> {
  return unsupportedProductionStage("layout-facts", "mono-to-layout-adapter-not-wired");
}

export function buildProofMir(
  _input: PackageProofMirInput,
): UefiAArch64PackageStageResult<PackageProofMirAdapter> {
  return unsupportedProductionStage("proof-mir", "layout-to-proof-mir-adapter-not-wired");
}

export function checkProofAndResources(
  _input: PackageProofCheckInput,
): UefiAArch64PackageStageResult<PackageProofCheckAdapter> {
  return unsupportedProductionStage("proof-check", "proof-check-adapter-not-wired");
}

export function buildOptimizedOptIr(
  _input: PackageOptimizedOptIrInput,
): UefiAArch64PackageStageResult<PackageOptimizedOptIrAdapter> {
  return unsupportedProductionStage("opt-ir", "proof-check-to-opt-ir-adapter-not-wired");
}

export function packageInputToModuleGraphParseInput(
  input: RunUefiAArch64PackagePipelineToOptIrInput,
): PackageModuleGraphParseInput {
  return Object.freeze({ packageInput: input.packageInput });
}

export function packageParsedGraphToHirInput(
  parsedGraph: PackageParsedModuleGraphAdapter,
  packageInput: CompilerPackageInput,
  target: UefiAArch64TargetDriverSurface,
): PackageTypedHirInput {
  return Object.freeze({ packageInput, target, parsedGraph });
}

export function packageHirToMonomorphizationInput(
  typedHir: PackageTypedHirAdapter,
  target: UefiAArch64TargetDriverSurface,
): PackageMonomorphizedImageInput {
  return Object.freeze({ target, typedHir });
}

export function monomorphizedImageToLayoutFactsInput(
  monomorphizedImage: PackageMonomorphizedImageAdapter,
  target: UefiAArch64TargetDriverSurface,
): PackageRepresentationLayoutFactsInput {
  return Object.freeze({ target, monomorphizedImage });
}

export function layoutFactsToProofMirInput(
  layoutFacts: PackageRepresentationLayoutFactsAdapter,
  monomorphizedImage: PackageMonomorphizedImageAdapter,
  target: UefiAArch64TargetDriverSurface,
): PackageProofMirInput {
  return Object.freeze({ target, monomorphizedImage, layoutFacts });
}

export function proofMirToCheckInput(
  proofMir: PackageProofMirAdapter,
  layoutFacts: PackageRepresentationLayoutFactsAdapter,
  target: UefiAArch64TargetDriverSurface,
): PackageProofCheckInput {
  return Object.freeze({ target, proofMir, layoutFacts });
}

export function proofCheckToOptimizedOptIrInput(
  proofCheck: PackageProofCheckAdapter,
  proofMir: PackageProofMirAdapter,
  layoutFacts: PackageRepresentationLayoutFactsAdapter,
  target: UefiAArch64TargetDriverSurface,
): PackageOptimizedOptIrInput {
  return Object.freeze({ target, proofCheck, proofMir, layoutFacts });
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

function unsupportedProductionStage<Value>(
  stageKey: UefiAArch64PackagePipelineStageKey,
  stableDetail: string,
): UefiAArch64PackageStageResult<Value> {
  return {
    kind: "error",
    diagnostics: [packagePipelineDiagnostic(stageKey, stableDetail)],
  };
}

function packagePipelineDiagnostic(
  stageKey: UefiAArch64PackagePipelineStageKey,
  stableDetail: string,
): UefiAArch64TargetDiagnostic {
  return uefiAArch64TargetDiagnostic({
    code: "UEFI_AARCH64_PIPELINE_FAILED",
    ownerKey: `uefi-aarch64-package-pipeline:${stageKey}`,
    stableDetail,
  });
}
