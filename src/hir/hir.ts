import type {
  DeviceSurfaceId,
  FieldId,
  FunctionId,
  ImageId,
  ItemId,
  ParameterId,
  PlatformContractId,
  PlatformPrimitiveId,
  TargetId,
  TargetTypeId,
  TypeId,
  UniqueEdgeRootKey,
} from "../semantic/ids";
import type { SourceItemKind } from "../semantic/item-index/item-records";
import type {
  CheckedFunctionSignature,
  CertifiedPlatformBinding,
} from "../semantic/surface/checked-program";
import type {
  CheckedResourceKind,
  ConcreteResourceKind,
  ResourceKindDerivationRule,
  TypeParameterKey,
} from "../semantic/surface/resource-kind";
import type { CheckedType, TypeConstructorId } from "../semantic/surface/type-model";
import type {
  CheckedPlatformEnsuredFact,
  CheckedPlatformEnsuredFactSurface,
} from "../semantic/surface/proof-contracts";
import type {
  AttemptId,
  BrandId,
  CallSiteRequirementId,
  FactOriginId,
  HirExpressionId,
  HirImageOriginId,
  HirLocalId,
  HirOriginId,
  HirOwnedId,
  HirPlatformContractEdgeId,
  HirProofExpressionId,
  HirProofOwner,
  HirRequirementId,
  HirStatementId,
  HirTerminalCallId,
  ObligationId,
  PrivateStateTransitionId,
  ResourcePlaceId,
  SessionId,
  ValidationId,
} from "./ids";
import type { HirOriginTable } from "./origin";
import type { HirTable } from "./hir-table";
import type { HirProofMetadata } from "./proof-metadata";

export type HirDeclarationKind =
  | "type"
  | "function"
  | "validatedBuffer"
  | "image"
  | "field"
  | "recovered";

export interface HirDeclaration {
  readonly itemId: ItemId;
  readonly kind: HirDeclarationKind;
  readonly typeId?: TypeId;
  readonly functionId?: FunctionId;
  readonly imageId?: ImageId;
  readonly fieldId?: FieldId;
  readonly name: string;
  readonly sourceOrigin: HirOriginId;
}

export type HirDeclarationTable = HirTable<ItemId, HirDeclaration>;

export interface HirLocal {
  readonly localId: HirLocalId;
  readonly name: string;
  readonly type: CheckedType;
  readonly resourceKind: CheckedResourceKind;
  readonly mode: "receiver" | "parameter" | "ordinary" | "temporary" | "error";
  readonly introducedBy:
    | "receiver"
    | "parameter"
    | "sourceLet"
    | "pattern"
    | "forBinding"
    | "takeAlias"
    | "validationArm"
    | "temporary"
    | "recovery";
  readonly sourceOrigin: HirOriginId;
  readonly parameterId?: ParameterId;
}

export type HirLocalTable = HirTable<HirLocalId, HirLocal>;

export interface HirBlock {
  readonly statements: readonly HirStatement[];
  readonly sourceOrigin: HirOriginId;
}

export interface HirFunction {
  readonly functionId: FunctionId;
  readonly itemId: ItemId;
  readonly ownerTypeId?: TypeId;
  readonly signature: CheckedFunctionSignature;
  readonly declaredTypeParameters: readonly TypeParameterKey[];
  readonly bodyStatus: "sourceBody" | "certifiedPlatform" | "bodylessRecovery";
  readonly locals: HirLocalTable;
  readonly body?: HirBlock;
  readonly bodyIndex?: HirBodyIndex;
  readonly declaredRequirements: readonly HirRequirement[];
  readonly sourceOrigin: HirOriginId;
}

export type HirFunctionTable = HirTable<FunctionId, HirFunction>;

export interface HirBodyIndex {
  readonly expressions: HirExpressionTable;
  readonly statements: HirStatementTable;
  readonly ensureCandidates: readonly HirEnsureCandidate[];
}

export interface HirEnsureCandidate {
  readonly statementId: HirStatementId;
  readonly expressionId: HirExpressionId;
  readonly sourceStatementKind: "ensure";
  readonly sourceOrigin: HirOriginId;
}

export type HirExpressionTable = HirTable<HirExpressionId, HirExpression>;
export type HirStatementTable = HirTable<HirStatementId, HirStatement>;

export const HIR_EXPRESSION_KINDS = [
  "literal",
  "name",
  "member",
  "object",
  "call",
  "attempt",
  "validationCreation",
  "unary",
  "binary",
  "comparison",
  "error",
] as const;

export type HirExpressionKindName = (typeof HIR_EXPRESSION_KINDS)[number];

export type HirLiteralValue =
  | { readonly kind: "integer"; readonly text: string; readonly value?: bigint }
  | { readonly kind: "string"; readonly value: string }
  | { readonly kind: "bool"; readonly value: boolean };

export interface HirCallArgument {
  readonly name?: string;
  readonly parameterId?: ParameterId;
  readonly expression: HirExpression;
  readonly mode?: "observe" | "consume";
  readonly place?: HirResourcePlace;
}

export interface HirCallExpression {
  readonly callee: HirExpression;
  readonly calleeFunctionId?: FunctionId;
  readonly ownerTypeId?: TypeId;
  readonly ownerTypeArguments: readonly CheckedType[];
  readonly ownerTypeArgumentSource:
    | "none"
    | "receiverType"
    | "constructorExpectedType"
    | "completedMemberReference"
    | "error";
  readonly arguments: readonly HirCallArgument[];
  readonly typeArguments: readonly CheckedType[];
  readonly receiver?: HirExpression;
  readonly sourceOrigin?: HirOriginId;
  readonly recovered?: boolean;
}

export interface HirObjectField {
  readonly fieldId?: FieldId;
  readonly name: string;
  readonly value: HirExpression;
  readonly sourceOrigin: HirOriginId;
}

export type HirExpressionKind =
  | { readonly kind: "literal"; readonly literal: HirLiteralValue }
  | {
      readonly kind: "name";
      readonly name: string;
      readonly localId?: HirLocalId;
      readonly functionId?: FunctionId;
      readonly parameterId?: ParameterId;
    }
  | {
      readonly kind: "member";
      readonly receiver: HirExpression;
      readonly fieldId?: FieldId;
      readonly memberPlace?: HirResourcePlace;
    }
  | {
      readonly kind: "object";
      readonly typeId?: TypeId;
      readonly fields: readonly HirObjectField[];
    }
  | { readonly kind: "call"; readonly call: HirCallExpression }
  | { readonly kind: "attempt"; readonly attempt: HirAttempt }
  | { readonly kind: "validationCreation"; readonly validation: HirValidation }
  | { readonly kind: "unary"; readonly operator: string; readonly operand: HirExpression }
  | {
      readonly kind: "binary" | "comparison";
      readonly operator: string;
      readonly left: HirExpression;
      readonly right: HirExpression;
    }
  | { readonly kind: "error"; readonly reason: string };

export interface HirExpression {
  readonly expressionId: HirExpressionId;
  readonly kind: HirExpressionKind;
  readonly type: CheckedType;
  readonly resourceKind: CheckedResourceKind;
  readonly sourceOrigin: HirOriginId;
  readonly place?: HirResourcePlace;
}

export const HIR_STATEMENT_KINDS = [
  "block",
  "let",
  "assignment",
  "if",
  "while",
  "loop",
  "for",
  "match",
  "validationMatch",
  "take",
  "return",
  "yield",
  "break",
  "continue",
  "expression",
  "error",
] as const;

export type HirStatementKindName = (typeof HIR_STATEMENT_KINDS)[number];

export interface HirLetStatement {
  readonly local: HirLocal;
  readonly value?: HirExpression;
}

export interface HirAssignmentStatement {
  readonly target: HirExpression;
  readonly value: HirExpression;
  readonly targetPlace?: HirResourcePlace;
}

export interface HirIfStatement {
  readonly condition: HirExpression;
  readonly thenBlock: HirBlock;
  readonly elseBlock?: HirBlock;
}

export interface HirWhileStatement {
  readonly condition: HirExpression;
  readonly body: HirBlock;
}

export interface HirForStatement {
  readonly binding?: HirLocal;
  readonly iterable: HirExpression;
  readonly iteration: HirForIteration;
  readonly body: HirBlock;
}

export interface HirMatchArm {
  readonly patternText: string;
  readonly body: HirBlock;
  readonly bindingLocals: readonly HirLocal[];
  readonly sourceOrigin: HirOriginId;
}

export interface HirMatchStatement {
  readonly scrutinee: HirExpression;
  readonly arms: readonly HirMatchArm[];
}

export interface HirValidationMatchStatement {
  readonly validationMatchId: HirOwnedId<ValidationId>;
  readonly scrutinee: HirExpression;
  readonly validation?: HirValidation;
  readonly okArm?: HirMatchArm;
  readonly errArm?: HirMatchArm;
  readonly sourceOrigin: HirOriginId;
  readonly recovered?: boolean;
}

export interface HirTakeStatement {
  readonly operand: HirTakeOperand;
  readonly takeKind: HirTakeKind;
  readonly aliasLocal?: HirLocal;
  readonly body: HirBlock;
  readonly sourceOrigin: HirOriginId;
}

export type HirStatementKind =
  | { readonly kind: "block"; readonly block: HirBlock }
  | { readonly kind: "let"; readonly statement: HirLetStatement }
  | { readonly kind: "assignment"; readonly statement: HirAssignmentStatement }
  | { readonly kind: "if"; readonly statement: HirIfStatement }
  | { readonly kind: "while"; readonly statement: HirWhileStatement }
  | { readonly kind: "loop"; readonly body: HirBlock }
  | { readonly kind: "for"; readonly statement: HirForStatement }
  | { readonly kind: "match"; readonly statement: HirMatchStatement }
  | { readonly kind: "validationMatch"; readonly statement: HirValidationMatchStatement }
  | { readonly kind: "take"; readonly statement: HirTakeStatement }
  | { readonly kind: "return"; readonly expression?: HirExpression }
  | { readonly kind: "yield"; readonly expression?: HirExpression }
  | { readonly kind: "break" }
  | { readonly kind: "continue" }
  | { readonly kind: "expression"; readonly expression: HirExpression }
  | { readonly kind: "error"; readonly reason: string };

export interface HirStatement {
  readonly statementId: HirStatementId;
  readonly kind: HirStatementKind;
  readonly sourceOrigin: HirOriginId;
}

export const HIR_TAKE_OPERAND_KINDS = ["place", "takeOnlyCall", "error"] as const;
export const HIR_TAKE_KIND_KINDS = ["stream", "buffer", "validatedBuffer", "error"] as const;
export const HIR_FOR_ITERATION_KINDS = ["ordinary", "stream", "error"] as const;

export type HirTakeOperand =
  | { readonly kind: "place"; readonly place: HirResourcePlace; readonly expression: HirExpression }
  | {
      readonly kind: "takeOnlyCall";
      readonly call: HirCallExpression;
      readonly resultPlace: HirResourcePlace;
    }
  | { readonly kind: "error"; readonly expression?: HirExpression };

export type HirTakeKind =
  | {
      readonly kind: "stream";
      readonly sessionId: HirOwnedId<SessionId>;
      readonly itemBrandId: HirOwnedId<BrandId>;
      readonly closureObligationId: HirOwnedId<ObligationId>;
      readonly itemType: CheckedType;
      readonly itemResourceKind: CheckedResourceKind;
    }
  | {
      readonly kind: "buffer";
      readonly bufferPlace: HirResourcePlace;
      readonly obligationId: HirOwnedId<ObligationId>;
    }
  | {
      readonly kind: "validatedBuffer";
      readonly sessionId: HirOwnedId<SessionId>;
      readonly memberBrandId: HirOwnedId<BrandId>;
      readonly closureObligationId: HirOwnedId<ObligationId>;
    }
  | { readonly kind: "error" };

export type HirForIteration =
  | { readonly kind: "ordinary" }
  | {
      readonly kind: "stream";
      readonly sessionId: HirOwnedId<SessionId>;
      readonly itemBrandId: HirOwnedId<BrandId>;
      readonly closureObligationId: HirOwnedId<ObligationId>;
      readonly itemType: CheckedType;
      readonly itemResourceKind: CheckedResourceKind;
    }
  | { readonly kind: "error" };

export type HirRequirementOwner =
  | { readonly kind: "function"; readonly functionId: FunctionId }
  | { readonly kind: "type"; readonly typeId: TypeId };

export type HirProofExpression =
  | {
      readonly proofExpressionId: HirProofExpressionId;
      readonly kind: "literal";
      readonly value: string | boolean | bigint;
      readonly sourceOrigin: HirOriginId;
    }
  | {
      readonly proofExpressionId: HirProofExpressionId;
      readonly kind: "reference";
      readonly name: string;
      readonly functionId?: FunctionId;
      readonly fieldId?: FieldId;
      readonly sourceOrigin: HirOriginId;
    }
  | {
      readonly proofExpressionId: HirProofExpressionId;
      readonly kind: "call";
      readonly calleeFunctionId?: FunctionId;
      readonly arguments: readonly HirProofExpression[];
      readonly sourceOrigin: HirOriginId;
    }
  | {
      readonly proofExpressionId: HirProofExpressionId;
      readonly kind: "binary";
      readonly operator: string;
      readonly left: HirProofExpression;
      readonly right: HirProofExpression;
      readonly sourceOrigin: HirOriginId;
    }
  | {
      readonly proofExpressionId: HirProofExpressionId;
      readonly kind: "error";
      readonly reason: string;
      readonly sourceOrigin: HirOriginId;
    };

export type HirRequirementExpression =
  | { readonly kind: "structured"; readonly expression: HirProofExpression }
  | { readonly kind: "opaque"; readonly text: string }
  | { readonly kind: "error"; readonly reason: string };

export interface HirRequirement {
  readonly requirementId: HirOwnedId<HirRequirementId>;
  readonly owner: HirRequirementOwner;
  readonly expression: HirRequirementExpression;
  readonly sourceOrigin: HirOriginId;
}

export type HirPlaceRoot =
  | { readonly kind: "receiver"; readonly parameterId: ParameterId }
  | { readonly kind: "parameter"; readonly parameterId: ParameterId }
  | { readonly kind: "local"; readonly localId: HirLocalId }
  | { readonly kind: "temporary"; readonly ordinal: number }
  | { readonly kind: "imageDevice"; readonly imageId: ImageId; readonly fieldId: FieldId }
  | { readonly kind: "validationPayload"; readonly validationId: HirOwnedId<ValidationId> }
  | { readonly kind: "error" };

export type HirPlaceProjection =
  | { readonly kind: "field"; readonly fieldId: FieldId }
  | { readonly kind: "deref" }
  | { readonly kind: "variant"; readonly name: string };

export interface HirResourcePlace {
  readonly placeId: HirOwnedId<ResourcePlaceId>;
  readonly canonicalKey: string;
  readonly root: HirPlaceRoot;
  readonly projection: readonly HirPlaceProjection[];
  readonly type: CheckedType;
  readonly resourceKind: CheckedResourceKind;
  readonly sourceOrigin: HirOriginId;
  readonly kind:
    | "receiver"
    | "parameter"
    | "local"
    | "temporary"
    | "imageDevice"
    | "validationPayload"
    | "error";
  readonly parameterId?: ParameterId;
  readonly localId?: HirLocalId;
  readonly fieldId?: FieldId;
}

export interface HirObligation {
  readonly obligationId: HirOwnedId<ObligationId>;
  readonly kind:
    | "takeClosure"
    | "streamClosure"
    | "bufferDischarge"
    | "validatedBufferClosure"
    | "terminalClosure"
    | "callRequirement"
    | "error";
  readonly sourceOrigin: HirOriginId;
  readonly place?: HirResourcePlace;
}

export interface HirSession {
  readonly sessionId: HirOwnedId<SessionId>;
  readonly kind: "take" | "streamFor" | "validation" | "attempt";
  readonly sourceOrigin: HirOriginId;
  readonly place?: HirResourcePlace;
}

export type HirBrandCanonicalKey =
  | `image:${number}:field:${number}:root:${string}`
  | `platform:${number}:primitive:${string}:contract:${string}:target:${string}`
  | `function:${number}:session:${number}`
  | `function:${number}:validation:${number}`
  | `function:${number}:take:${number}`;

export type HirBrandOrigin =
  | {
      readonly kind: "imageDevice";
      readonly imageId: ImageId;
      readonly fieldId: FieldId;
      readonly uniqueEdgeRootKey: UniqueEdgeRootKey;
    }
  | {
      readonly kind: "platformToken";
      readonly sourceFunctionId: FunctionId;
      readonly primitiveId: PlatformPrimitiveId;
      readonly contractId: PlatformContractId;
      readonly targetId: TargetId;
    }
  | { readonly kind: "functionSession"; readonly functionId: FunctionId; readonly ordinal: number }
  | {
      readonly kind: "functionValidation";
      readonly functionId: FunctionId;
      readonly ordinal: number;
    }
  | {
      readonly kind: "functionTake";
      readonly functionId: FunctionId;
      readonly statementOrdinal: number;
    };

export interface HirBrand {
  readonly brandId: HirOwnedId<BrandId>;
  readonly canonicalKey: HirBrandCanonicalKey;
  readonly origin: HirBrandOrigin;
  readonly sourceOrigin?: HirOriginId;
}

export interface HirCallSiteRequirement {
  readonly callSiteRequirementId: HirOwnedId<CallSiteRequirementId>;
  readonly callExpressionId: HirExpressionId;
  readonly requirement: HirRequirement;
  readonly sourceOrigin: HirOriginId;
}

export const HIR_VALIDATION_MATCH_KINDS = ["validationMatch", "error"] as const;

export interface HirValidation {
  readonly validationId: HirOwnedId<ValidationId>;
  readonly validationExpressionId: HirExpressionId;
  readonly sourcePlace: HirResourcePlace;
  readonly pendingResultPlace: HirResourcePlace;
  readonly resultLocalId?: HirLocalId;
  readonly validatedBufferTypeId: TypeId;
  readonly okPayloadType: CheckedType;
  readonly errPayloadType: CheckedType;
  readonly sourceOrigin: HirOriginId;
}

export const HIR_ATTEMPT_KINDS = ["attempt", "error"] as const;

export interface HirAttempt {
  readonly attemptId: HirOwnedId<AttemptId>;
  readonly attemptExpressionId: HirExpressionId;
  readonly fallibleExpression: HirExpression;
  readonly alternativeExpression?: HirExpression;
  readonly declaredInputPlaces: readonly HirResourcePlace[];
  readonly sourceOrigin: HirOriginId;
}

export interface HirTerminalCall {
  readonly terminalCallId: HirOwnedId<HirTerminalCallId>;
  readonly callExpressionId: HirExpressionId;
  readonly calleeFunctionId: FunctionId;
  readonly closureObligationId: HirOwnedId<ObligationId>;
  readonly sourceOrigin: HirOriginId;
}

export interface HirPrivateStateTransition {
  readonly transitionId: HirOwnedId<PrivateStateTransitionId>;
  readonly functionId: FunctionId;
  readonly kind: "advance" | "close" | "unknown";
  readonly place?: HirResourcePlace;
  readonly transitionOrdinalForPlace: number;
  readonly sourceOrigin: HirOriginId;
}

export type HirCertifiedPlatformEnsuredFact = CheckedPlatformEnsuredFact;

export interface HirPlatformContractEdge {
  readonly edgeId: HirOwnedId<HirPlatformContractEdgeId>;
  readonly sourceFunctionId: FunctionId;
  readonly primitiveId: PlatformPrimitiveId;
  readonly contractId: PlatformContractId;
  readonly targetId: TargetId;
  readonly certificate?: CertifiedPlatformBinding["certificate"];
  readonly sourceRequirementIds?: readonly HirOwnedId<HirRequirementId>[];
  readonly callExpressionId?: HirExpressionId;
  readonly callOrigin?: HirOriginId;
  readonly ensuredFacts: readonly CheckedPlatformEnsuredFactSurface[];
  readonly sourceOrigin: HirOriginId;
}

export const HIR_FACT_CONTENT_KINDS = [
  "predicateCall",
  "ensure",
  "platformEnsure",
  "matchRefinement",
] as const;

export type HirFactContent =
  | {
      readonly kind: "predicateCall";
      readonly predicateFunctionId: FunctionId;
      readonly arguments?: readonly HirExpression[];
      readonly statePlace?: HirResourcePlace;
    }
  | { readonly kind: "ensure"; readonly expressionId: HirExpressionId }
  | {
      readonly kind: "platformEnsure";
      readonly edgeId: HirOwnedId<HirPlatformContractEdgeId>;
      readonly fact: HirCertifiedPlatformEnsuredFact;
    }
  | {
      readonly kind: "matchRefinement";
      readonly scrutineeExpressionId: HirExpressionId;
      readonly variantReferenceKey: string;
      readonly fieldBindingKeys: readonly string[];
    };

export interface HirFactOrigin {
  readonly factOriginId: HirOwnedId<FactOriginId>;
  readonly fact?: HirFactContent;
  readonly content?: HirFactContent;
  readonly sourceOrigin: HirOriginId;
}

export interface HirImageOrigin {
  readonly imageOriginId: HirOwnedId<HirImageOriginId>;
  readonly imageId: ImageId;
  readonly fieldId?: FieldId;
  readonly deviceSurfaceId?: DeviceSurfaceId;
  readonly sourceOrigin: HirOriginId;
}

export interface HirImageDevice {
  readonly fieldId: FieldId;
  readonly deviceSurfaceId: DeviceSurfaceId;
  readonly place: HirResourcePlace;
  readonly rootPlaces: readonly HirResourcePlace[];
  readonly brandIds: readonly HirOwnedId<BrandId>[];
  readonly sourceOrigin: HirOriginId;
}

export interface HirImage {
  readonly imageId: ImageId;
  readonly itemId: ItemId;
  readonly entryFunctionId?: FunctionId;
  readonly devices: readonly HirImageDevice[];
  readonly sourceOrigin: HirOriginId;
}

export type HirImageTable = HirTable<ImageId, HirImage>;

export interface HirValidatedBuffer {
  readonly typeId: TypeId;
  readonly itemId: ItemId;
  readonly parameterFields: readonly FieldId[];
  readonly layoutFields: readonly FieldId[];
  readonly derivedFields: readonly FieldId[];
  readonly requirements: readonly HirRequirement[];
  readonly sourceOrigin: HirOriginId;
}

export type HirValidatedBufferTable = HirTable<TypeId, HirValidatedBuffer>;

export interface HirTypeRecord {
  readonly typeId: TypeId;
  readonly itemId: ItemId;
  readonly sourceKind: SourceItemKind;
  readonly declaredTypeParameters: readonly TypeParameterKey[];
  readonly fieldIds: readonly FieldId[];
  readonly resourceKind: CheckedResourceKind;
  readonly sourceOrigin: HirOriginId;
}

export type HirTypeTable = HirTable<TypeId, HirTypeRecord>;

export interface HirFieldRecord {
  readonly fieldId: FieldId;
  readonly ownerTypeId: TypeId;
  readonly name: string;
  readonly type: CheckedType;
  readonly resourceKind: CheckedResourceKind;
  readonly sourceOrigin: HirOriginId;
}

export type HirFieldTable = HirTable<FieldId, HirFieldRecord>;

export interface HirPlatformContractEdgeLookupKey {
  readonly owner: HirProofOwner;
  readonly callExpressionId: HirExpressionId;
  readonly calleeFunctionId: FunctionId;
}

export interface HirSourceTypeKindRecord {
  readonly typeId: TypeId;
  readonly kind: CheckedResourceKind;
  readonly sourceOrigin: HirOriginId;
}

export type HirSourceTypeKindTable = HirTable<TypeId, HirSourceTypeKindRecord>;

export interface HirTargetTypeKindRecord {
  readonly targetTypeId: TargetTypeId;
  readonly kind: ConcreteResourceKind;
  readonly sourceOrigin: HirOriginId;
}

export type HirTargetTypeKindTable = HirTable<TargetTypeId, HirTargetTypeKindRecord>;

export interface HirConstructorKindRuleRecord {
  readonly constructor: TypeConstructorId;
  readonly rule: ResourceKindDerivationRule;
  readonly resultKind?: CheckedResourceKind;
  readonly sourceOrigin: HirOriginId;
}

export type HirConstructorKindRuleTable = HirTable<TypeConstructorId, HirConstructorKindRuleRecord>;

export interface HirInstanceEligibilityRuleRecord {
  readonly owner:
    | { readonly kind: "function"; readonly functionId: FunctionId }
    | { readonly kind: "type"; readonly typeId: TypeId };
  readonly parameter: TypeParameterKey;
  readonly allowedConcreteKinds: readonly ConcreteResourceKind[];
  readonly sourceOrigin: HirOriginId;
}

export type HirInstanceEligibilityRuleTable = HirTable<string, HirInstanceEligibilityRuleRecord>;

export interface HirExternalEntryRootRecord {
  readonly functionId: FunctionId;
  readonly ownerTypeArguments: readonly CheckedType[];
  readonly functionTypeArguments: readonly CheckedType[];
  readonly reason: "imageEntry" | "deviceHandler" | "hardwareCallback" | "targetRequired";
  readonly sourceOrigin: HirOriginId;
}

export type HirCertifiedPlatformBindingTable = HirTable<FunctionId, CertifiedPlatformBinding>;

export interface HirMonoClosureSurface {
  readonly sourceTypeKinds: HirSourceTypeKindTable;
  readonly targetTypeKinds: HirTargetTypeKindTable;
  readonly constructorKindRules: HirConstructorKindRuleTable;
  readonly instanceEligibilityRules: HirInstanceEligibilityRuleTable;
  readonly certifiedPlatformBindings: HirCertifiedPlatformBindingTable;
  readonly externalEntryRoots: readonly HirExternalEntryRootRecord[];
}

export interface TypedHirProgram {
  readonly declarations: HirDeclarationTable;
  readonly types: HirTypeTable;
  readonly fields: HirFieldTable;
  readonly functions: HirFunctionTable;
  readonly validatedBuffers: HirValidatedBufferTable;
  readonly images: HirImageTable;
  readonly proofMetadata: HirProofMetadata;
  readonly monoClosure: HirMonoClosureSurface;
  readonly origins: HirOriginTable;
}
