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
} from "./platform-surface";
export { platformPrimitiveCatalog, semanticTargetSurface } from "./platform-surface";
export type { ImageRootSelection } from "./image-root-selection";
export type { CheckedImageDevice } from "./image-device-checker";
export type { CheckedProofSurface } from "./proof-surface";
