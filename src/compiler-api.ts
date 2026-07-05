export { buildOptimizedOptIr, constructOptIr } from "./opt-ir/public-api";
export {
  compileUefiAArch64Image,
  compileUefiAArch64ImageAsync,
  compileUefiAArch64ImageWithTraceAsync,
  createUefiAArch64TargetMetadata,
  fingerprintUefiAArch64ImageBytes,
} from "./target/uefi-aarch64";
export {
  compilerMetadataEntries,
  compilerMetadataValue,
  createCompilerStageMetadata,
  createCompilerStageResult,
  frontendModuleGraphMetadata,
  optIrPassesMetadata,
  releaseEvidenceMetadata,
  scalarReplacementMetadata,
} from "./pipeline";
export { loadFrontendModuleGraph } from "./frontend";
export type { LoadFrontendModuleGraphInput } from "./frontend";

export type {
  BuildOptimizedOptIrInput,
  ConstructOptIrInput,
  ConstructOptIrResult,
  OptimizeOptIrResult,
} from "./opt-ir";
export type {
  CompileUefiAArch64ImageAsyncInput,
  CompileUefiAArch64ImageInput,
  CompileUefiAArch64ImageResult,
  UefiAArch64ArtifactSink,
  UefiAArch64ImageArtifact,
  UefiAArch64InlineSmokeRequest,
  UefiAArch64TargetMetadata,
} from "./target/uefi-aarch64";
export type {
  CompilerStage,
  CompilerStageMetadata,
  CompilerStageMetadataKey,
  CompilerStageMetadataMap,
  CompilerStageResult,
  FrontendModuleGraphMetadata,
  OptIrPassesMetadata,
  ReleaseEvidenceMetadata,
  ScalarReplacementMetadata,
} from "./pipeline";
