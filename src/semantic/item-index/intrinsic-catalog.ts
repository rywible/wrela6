import type { IntrinsicId } from "../ids";

export interface IntrinsicCatalog {
  readonly modules: readonly IntrinsicModuleSpec[];
}

export interface IntrinsicModuleSpec {
  readonly pathKey: string;
  readonly display: string;
  readonly declarations: readonly IntrinsicDeclarationSpec[];
}

export type IntrinsicDeclarationSpec =
  | IntrinsicFunctionDeclarationSpec
  | IntrinsicTypeDeclarationSpec;

export interface IntrinsicFunctionDeclarationSpec {
  readonly kind: "function";
  readonly intrinsicId: IntrinsicId;
  readonly name: string;
  readonly signature: IntrinsicFunctionSignature;
  readonly targetAvailability: IntrinsicTargetAvailability;
  readonly proofContract: IntrinsicProofContract;
  readonly lowering: IntrinsicLoweringContract;
}

export interface IntrinsicTypeDeclarationSpec {
  readonly kind: "type";
  readonly intrinsicId: IntrinsicId;
  readonly name: string;
  readonly signature: IntrinsicTypeSignature;
  readonly targetAvailability: IntrinsicTargetAvailability;
  readonly proofContract: IntrinsicProofContract;
  readonly lowering: IntrinsicLoweringContract;
}

export type IntrinsicSignature = IntrinsicFunctionSignature | IntrinsicTypeSignature;

export interface IntrinsicFunctionSignature {
  readonly typeParameters: readonly IntrinsicTypeParameterSpec[];
  readonly parameters: readonly IntrinsicParameterSpec[];
  readonly returnType?: IntrinsicTypeReferenceSpec;
}

export interface IntrinsicTypeSignature {
  readonly typeParameters: readonly IntrinsicTypeParameterSpec[];
}

export interface IntrinsicTypeParameterSpec {
  readonly name: string;
  readonly bound?: IntrinsicTypeReferenceSpec;
}

export interface IntrinsicParameterSpec {
  readonly name: string;
  readonly type: IntrinsicTypeReferenceSpec;
  readonly isConsumed: boolean;
}

export interface IntrinsicTypeReferenceSpec {
  readonly name: readonly string[];
  readonly arguments: readonly IntrinsicTypeReferenceSpec[];
}

export interface IntrinsicTargetAvailability {
  readonly targets: readonly string[];
}

export interface IntrinsicProofContract {
  readonly requiredFacts: readonly string[];
  readonly consumedCapabilities: readonly string[];
  readonly producedCapabilities: readonly string[];
}

export interface IntrinsicLoweringContract {
  readonly backend: string;
  readonly operation: string;
  readonly attributes: Readonly<Record<string, string>>;
}
