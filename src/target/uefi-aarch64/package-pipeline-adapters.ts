import type { ParsedModuleGraph } from "../../frontend";
import type { LowerTypedHirInput, LowerTypedHirResult } from "../../hir";
import type {
  ComputeRepresentationLayoutFactsInput,
  ComputeRepresentationLayoutFactsResult,
} from "../../layout";
import type { MonomorphizeWholeImageInput, MonomorphizeWholeImageResult } from "../../mono";
import type {
  BuildOptimizedOptIrInput,
  ConstructOptIrResult,
  OptimizeOptIrResult,
} from "../../opt-ir";
import type { OptIrFactSet } from "../../opt-ir/facts/fact-index";
import type { OptIrOperation } from "../../opt-ir/operations";
import type { OptIrProgram } from "../../opt-ir/program";
import type { CheckProofAndResourcesInput, CheckProofAndResourcesResult } from "../../proof-check";
import type { BuildProofMirInput, BuildProofMirResult } from "../../proof-mir/proof-mir-builder";
import type { PlatformPrimitiveId, TypeId } from "../../semantic/ids";
import type { UefiAArch64TargetDiagnostic } from "./diagnostics";
import type {
  UefiAArch64StaticChar16String,
  UefiAArch64StaticChar16StringPointer,
} from "./firmware-strings";
import type {
  CompilerPackageInput,
  UefiAArch64ValidationFixturePacketSource,
} from "./package-input";
import type { UefiAArch64TargetDriverSurface } from "./target-driver-surface";

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

export interface UefiAArch64StatusCarrierMetadata {
  readonly sourceApiResultConstructorTypeId?: TypeId;
  readonly validationResultConstructorTypeIds?: readonly TypeId[];
  readonly statusCarrierPayloadTypeIds?: readonly TypeId[];
}

export interface PackageTypedHirAdapter extends UefiAArch64StatusCarrierMetadata {
  readonly kind: "typed-hir";
  readonly lowerTypedHirInput: LowerTypedHirInput;
  readonly lowerTypedHirResult: LowerTypedHirResult;
}

export interface PackageMonomorphizedImageInput {
  readonly target: UefiAArch64TargetDriverSurface;
  readonly typedHir: PackageTypedHirAdapter;
}

export interface PackageMonomorphizedImageAdapter extends UefiAArch64StatusCarrierMetadata {
  readonly kind: "mono-image";
  readonly monomorphizeWholeImageInput: MonomorphizeWholeImageInput;
  readonly monomorphizeWholeImageResult: MonomorphizeWholeImageResult & { readonly kind: "ok" };
  readonly reachablePlatformPrimitiveIds: readonly PlatformPrimitiveId[];
}

export interface PackageRepresentationLayoutFactsInput {
  readonly target: UefiAArch64TargetDriverSurface;
  readonly monomorphizedImage: PackageMonomorphizedImageAdapter;
}

export interface PackageRepresentationLayoutFactsAdapter extends UefiAArch64StatusCarrierMetadata {
  readonly kind: "layout-facts";
  readonly computeRepresentationLayoutFactsInput: ComputeRepresentationLayoutFactsInput;
  readonly computeRepresentationLayoutFactsResult: ComputeRepresentationLayoutFactsResult & {
    readonly kind: "ok";
  };
}

export interface PackageProofMirInput {
  readonly target: UefiAArch64TargetDriverSurface;
  readonly monomorphizedImage: PackageMonomorphizedImageAdapter;
  readonly layoutFacts: PackageRepresentationLayoutFactsAdapter;
}

export interface PackageProofMirAdapter extends UefiAArch64StatusCarrierMetadata {
  readonly kind: "proof-mir";
  readonly buildProofMirInput: BuildProofMirInput;
  readonly buildProofMirResult: BuildProofMirResult & { readonly kind: "ok" };
}

export interface PackageProofCheckInput {
  readonly target: UefiAArch64TargetDriverSurface;
  readonly proofMir: PackageProofMirAdapter;
  readonly layoutFacts: PackageRepresentationLayoutFactsAdapter;
}

export interface PackageProofCheckAdapter extends UefiAArch64StatusCarrierMetadata {
  readonly kind: "proof-check";
  readonly checkProofAndResourcesInput: CheckProofAndResourcesInput;
  readonly checkProofAndResourcesResult: CheckProofAndResourcesResult & { readonly kind: "ok" };
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

export interface UefiAArch64PackageProofCheckPipelineOutput {
  readonly target: UefiAArch64TargetDriverSurface;
  readonly parsedGraph: PackageParsedModuleGraphAdapter;
  readonly typedHir: PackageTypedHirAdapter;
  readonly monomorphizedImage: PackageMonomorphizedImageAdapter;
  readonly layoutFacts: PackageRepresentationLayoutFactsAdapter;
  readonly proofMir: PackageProofMirAdapter;
  readonly proofCheck: PackageProofCheckAdapter;
  readonly semanticPlatformCatalogFingerprint: string;
  readonly proofMirRuntimeCatalogFingerprint: string;
  readonly reachablePlatformPrimitiveIds: readonly PlatformPrimitiveId[];
  readonly runtimeCatalogFingerprint: string;
  readonly stages: readonly UefiAArch64StageRecord<UefiAArch64PackagePipelineStageKey>[];
}

export interface UefiAArch64PackageOptIrPipelineOutput extends UefiAArch64PackageProofCheckPipelineOutput {
  readonly optimizedOptIr: PackageOptimizedOptIrAdapter;
  readonly optIr: UefiAArch64OptimizedOptIrArtifact;
}
