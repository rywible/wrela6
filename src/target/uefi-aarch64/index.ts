export type {
  UefiAArch64ArtifactSink,
  UefiAArch64ImageArtifact,
  UefiAArch64SmokePolicy,
  UefiAArch64SmokeReport,
  UefiAArch64TargetMetadata,
} from "./artifact";
export { runUefiAArch64BinarySpine } from "./binary-spine";
export type {
  RunUefiAArch64BinarySpineInput,
  UefiAArch64BinarySpineOutput,
  UefiAArch64BinarySpineStageKey,
} from "./binary-spine";
export {
  compileUefiAArch64ImageAsync,
  compileUefiAArch64Image,
  compileUefiAArch64ImageWithTraceAsync,
  compileUefiAArch64ImageWithTrace,
  createUefiAArch64TargetMetadata,
  fingerprintUefiAArch64ImageBytes,
} from "./compile-uefi-aarch64-image";
export type {
  CompileUefiAArch64ImageAsyncInput,
  CompileUefiAArch64ImageInput,
  CompileUefiAArch64ImageResult,
  CompileUefiAArch64ImageTrace,
  CompileUefiAArch64ImageWithTraceResult,
} from "./compile-uefi-aarch64-image";
export { sortUefiAArch64TargetDiagnostics, uefiAArch64TargetDiagnostic } from "./diagnostics";
export type {
  UefiAArch64TargetDiagnostic,
  UefiAArch64TargetDiagnosticCode,
  UefiAArch64TargetDiagnosticInput,
  UefiAArch64TargetDiagnosticSource,
} from "./diagnostics";
export {
  aarch64UefiImageProfileFromEntryProfile,
  canonicalUefiAArch64EntryProfile,
  fingerprintUefiAArch64EntryProfile,
  validateUefiAArch64BootFunctionContract,
  validateUefiAArch64EntryProfile,
} from "./entry-contract";
export type {
  UefiAArch64BootFunctionContract,
  UefiAArch64BootFunctionContractInput,
  UefiAArch64BootResultShape,
  UefiAArch64EntryProfile,
  UefiAArch64SourceVisibleParameter,
} from "./entry-contract";
export { createUefiAArch64EntryThunkObjectFactory, planUefiAArch64EntryThunk } from "./entry-thunk";
export type {
  CreateUefiAArch64EntryThunkObjectFactoryInput,
  PlanUefiAArch64EntryThunkInput,
  UefiAArch64EntryThunkFrameSlot,
  UefiAArch64EntryThunkInstructionPlan,
  UefiAArch64EntryThunkPlan,
  UefiAArch64EntryThunkRelocationPlan,
  UefiAArch64EntryThunkUnwindPlan,
} from "./entry-thunk";
export { canonicalUefiAArch64ExitBootServicesPolicy } from "./exit-boot-services";
export type {
  UefiAArch64ExitBootServicesPolicy,
  UefiAArch64ExitBootServicesSuccess,
} from "./exit-boot-services";
export {
  canonicalUefiAArch64FirmwareAbiSurface,
  fingerprintUefiAArch64FirmwareAbi,
  validateUefiAArch64FirmwareAbiSurface,
} from "./firmware-abi";
export type { UefiAArch64FirmwareAbiSurface } from "./firmware-abi";
export {
  uefiAArch64FirmwarePlatformCallContext,
  uefiLoweringRuleToAArch64FirmwarePlatformCallLowering,
} from "./firmware-lowering";
export {
  fingerprintUefiAArch64StaticChar16String,
  materializeUefiAArch64StaticChar16String,
  uefiAArch64StaticChar16StringPointer,
} from "./firmware-strings";
export type {
  UefiAArch64StaticChar16String,
  UefiAArch64StaticChar16StringInput,
  UefiAArch64StaticChar16StringPointer,
} from "./firmware-strings";
export {
  canonicalUefiAArch64FirmwareTableSurface,
  fingerprintUefiAArch64FirmwareTables,
  lookupUefiFirmwareTableField,
  validateUefiAArch64FirmwareTableSurface,
} from "./firmware-tables";
export type {
  UefiAArch64FirmwareTableSurface,
  UefiBootServicesField,
  UefiFirmwareTableFieldRecord,
  UefiFirmwareTablePath,
  UefiRuntimeServicesField,
  UefiSimpleTextOutputField,
  UefiSystemTableField,
} from "./firmware-tables";
export {
  compilerPackageInput,
  defaultUefiAArch64SourceRoots,
  packageInputFromFixtureProject,
} from "./package-input";
export type {
  CompilerPackageInput,
  CompilerPackageInputOptions,
  CompilerSourceFileInput,
  CompilerSourceRoot,
  FixtureProjectFilesystem,
  FixtureProjectPackageInputOptions,
  FixtureProjectPathOperations,
  UefiAArch64ValidationFixturePacketSource,
  UefiAArch64ValidationFixturePacketSourceInput,
} from "./package-input";
export {
  buildOptimizedOptIr,
  buildProofMir,
  checkProofAndResources,
  computeRepresentationLayoutFacts,
  layoutFactsToProofMirInput,
  lowerTypedHir,
  monomorphizeWholeImage,
  monomorphizedImageToLayoutFactsInput,
  packageHirToMonomorphizationInput,
  packageInputToModuleGraphParseInput,
  packageParsedGraphToHirInput,
  parseModuleGraph,
  productionPackagePipelineDependencies,
  proofCheckToOptimizedOptIrInput,
  proofMirToCheckInput,
  runUefiAArch64PackagePipelineToProofCheck,
  runUefiAArch64PackagePipelineToOptIr,
} from "./package-pipeline";
export {
  productionUefiAArch64OptIrTargetSurface,
  productionUefiAArch64ProofCheckInputAuthority,
} from "./target-surfaces";
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
  UefiAArch64StageRecord,
  UefiAArch64StaticChar16PointerRecord,
} from "./package-pipeline";
export {
  authenticateUefiAArch64PlatformLowerings,
  canonicalUefiAArch64PlatformLowerings,
  canonicalUefiAArch64SemanticTargetSurface,
  fingerprintUefiPlatformPrimitiveSpec,
  fingerprintUefiSemanticPlatformCatalog,
  FULL_IMAGE_VALIDATION_FEATURE,
  UEFI_AARCH64_UTF16_STATIC_INTRINSIC,
  uefiAArch64CompilerIntrinsicNameCatalog,
  uefiAArch64PlatformPrimitiveNameCatalog,
} from "./platform-catalog";
export type {
  UefiAArch64PlatformPrimitiveLowering,
  UefiFirmwareArgumentRule,
  UefiFirmwareLoweringRule,
  UefiFirmwareResultRule,
  UefiFirmwareStaticChar16PointerRequirement,
} from "./platform-catalog";
export {
  classifyUefiAArch64QemuSmokeRun,
  planUefiAArch64QemuSmokeCommand,
  qemuSmokeArtifactPathFromEnvironment,
  qemuSmokeConfigFromEnvironment,
  runUefiAArch64QemuSmoke,
  runUefiAArch64QemuSmokeImage,
} from "./qemu-smoke";
export type {
  PlanUefiAArch64QemuSmokeCommandInput,
  UefiAArch64DisabledSmokeRequest,
  UefiAArch64QemuHostEffects,
  UefiAArch64QemuRunnerOutput,
  UefiAArch64QemuSmokeCommandPlan,
  UefiAArch64QemuSmokeConfig,
  UefiAArch64QemuSmokeRequest,
  UefiAArch64InlineSmokeRequest,
  UefiAArch64ShellSuccessMarker,
  UefiAArch64SmokeArtifactPathEnvironmentResult,
  UefiAArch64SmokeRequest,
} from "./qemu-smoke";
export {
  failedVerification,
  finishCatalogAuthentication,
  isAsciiSymbolName,
  passedVerification,
  uefiAArch64Error,
  uefiAArch64Ok,
  verificationSummaryFromRuns,
} from "./result";
export type {
  UefiAArch64TargetResult,
  UefiAArch64TargetVerificationSummary,
  UefiAArch64TargetVerifierRun,
} from "./result";
export {
  authenticateUefiAArch64RuntimeMaterializations,
  canonicalUefiAArch64ProofMirRuntimeCatalog,
  canonicalUefiAArch64RuntimeMaterializations,
  fingerprintUefiAArch64ProofMirRuntimeCatalog,
  fingerprintUefiAArch64RuntimeOperation,
  UEFI_AARCH64_ENTRY_INITIALIZE_CONTEXT_LINKAGE_NAME,
  UEFI_AARCH64_EXIT_BOOT_SERVICES_WITH_FRESH_MAP_LINKAGE_NAME,
  UEFI_AARCH64_STATUS_FROM_BOOT_RESULT_LINKAGE_NAME,
} from "./runtime-catalog";
export type { UefiAArch64RuntimeMaterialization } from "./runtime-catalog";
export {
  materializeUefiAArch64EntryInitializeContextHelper,
  materializeUefiAArch64ExitBootServicesWithFreshMapHelper,
  materializeUefiAArch64RuntimeHelperObjects,
  materializeUefiAArch64StatusFromBootResultHelper,
} from "./runtime-helper-objects";
export { materializeUefiAArch64StaticChar16ObjectModule } from "./static-char16-objects";
export type {
  MaterializeUefiAArch64StaticChar16ObjectModuleInput,
  MaterializeUefiAArch64StaticChar16ObjectModuleOutput,
} from "./static-char16-objects";
export {
  canonicalUefiAArch64StatusPolicy,
  efiErrorStatus,
  fingerprintUefiAArch64StatusPolicy,
  validateUefiAArch64StatusPolicy,
} from "./status-conversion";
export type {
  UefiAArch64StatusPolicy,
  UefiAArch64StatusPolicyOverrides,
} from "./status-conversion";
export {
  authenticateUefiAArch64TargetDriverSurface,
  canonicalUefiAArch64TargetDriverSurfaceInput,
  fingerprintTargetDriverSurface,
  validateSmokePolicy,
} from "./target-driver-surface";
export type {
  UefiAArch64TargetComponentFingerprint,
  UefiAArch64TargetComponentFingerprints,
  UefiAArch64TargetDriverSurface,
  UefiAArch64TargetDriverSurfaceInput,
  UefiAArch64TargetKey,
} from "./target-driver-surface";
export {
  authenticateUefiAArch64PeCoffWriterTargetForLinkedPolicy,
  productionUefiAArch64LayoutTargetSurface,
  productionUefiAArch64ProofMirBuildTargetContext,
  productionUefiAArch64ResolvedTargetSurfaces,
  productionUefiAArch64TargetSurfaceFingerprints,
} from "./target-surfaces";
export type {
  UefiAArch64ResolvedTargetSurfaceFingerprints,
  UefiAArch64ResolvedTargetSurfaces,
} from "./target-surfaces";
export {
  fingerprintUefiAArch64WatchdogPolicy,
  planUefiAArch64EntryContextInitialization,
  validateUefiAArch64EntryWatchdogPolicy,
  watchdogPolicyDiagnostic,
  watchdogPolicyKindDiagnostics,
} from "./watchdog-policy";
export type {
  PlanUefiAArch64EntryContextInitializationInput,
  UefiAArch64EntryContextInitializationPlan,
  UefiAArch64EntryContextOperation,
  UefiAArch64EntryWatchdogPolicy,
  ValidateUefiAArch64EntryWatchdogPolicyInput,
} from "./watchdog-policy";
