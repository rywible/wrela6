export { checkSemanticSurface } from "./semantic-surface-checker";
export type {
  CheckSemanticSurfaceInput,
  CheckSemanticSurfaceResult,
  CheckedImageSeed,
} from "./semantic-surface-checker";
export { sortSemanticSurfaceDiagnostics } from "./diagnostics";
export type { SemanticSurfaceDiagnostic, SemanticSurfaceDiagnosticCode } from "./diagnostics";
export { CheckedProgramBuilder } from "./checked-program";
export type {
  CheckedSemanticProgram,
  CheckedFunctionSignature,
  CheckedFunctionSignatureTable,
  CheckedParameter,
  CheckedReceiver,
  CheckedFunctionModifiers,
  CertifiedPlatformBinding,
  CertifiedPlatformBindingTable,
  CheckedTypeRecord,
  CheckedTypeTable,
} from "./checked-program";
export type {
  ValidatedBufferFieldModel,
  ValidatedBufferFieldDescriptor,
  ValidatedBufferFieldModelTable,
} from "./validated-buffer-field-model";
export { buildValidatedBufferFieldModels } from "./validated-buffer-field-model";
export type { CheckedType, AppliedCheckedType, TypeConstructorId } from "./type-model";
export type { CheckedResourceKind, ConcreteResourceKind, TypeParameterKey } from "./resource-kind";
export type {
  SemanticTargetSurface,
  PlatformPrimitiveCatalog,
  PlatformPrimitiveSpec,
  ImageProfileSpec,
  DeviceSurfaceSpec,
  TargetAvailability,
  TargetFunctionSignature,
  TargetParameterSpec,
  TargetProofContractSurface,
  TargetTypeKindSpec,
} from "./platform-surface";
export { platformPrimitiveCatalog, semanticTargetSurface } from "./platform-surface";
export type { ImageRootSelection } from "./image-root-selection";
export type { CheckedImageDevice } from "./image-device-checker";
export type { CheckedProofSurface } from "./proof-surface";
export * from "./proof-contracts";
export type {
  CheckedMonoClosureFacts,
  CheckedTargetTypeKind,
  CheckedTargetTypeKindTable,
  CheckedConstructorKindRule,
  CheckedConstructorKindRuleTable,
  CheckedInstanceEligibilityRule,
  CheckedInstanceEligibilityRuleTable,
  CheckedInstanceEligibilityOwner,
  CheckedExternalEntryRoot,
  CheckedExternalEntryRootTable,
  CheckedExternalEntryRootReason,
} from "./mono-closure";
export { checkedMonoClosureFactsEmpty } from "./mono-closure";
