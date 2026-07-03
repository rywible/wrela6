import type {
  HIR_EXPRESSION_KINDS,
  HIR_STATEMENT_KINDS,
  HirExpressionKindName,
  HirStatementKindName,
} from "../hir";
import type {
  AttemptId,
  BrandId,
  CallSiteRequirementId,
  FactOriginId,
  HirExpressionId,
  HirImageOriginId,
  HirLocalId,
  HirOriginId,
  HirPlatformContractEdgeId,
  HirRequirementId,
  HirStatementId,
  HirTerminalCallId,
  ObligationId,
  PrivateStateTransitionId,
  ResourcePlaceId,
  SessionId,
  ValidationId,
} from "../hir/ids";
import type { HirOriginTable } from "../hir/origin";
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
  TypeId,
  UniqueEdgeRootKey,
} from "../semantic/ids";
import type { WireEndian, WireScalarEncoding } from "../shared/wire-layout";
import type { SourceItemKind } from "../semantic/item-index/item-records";
import type { SyntaxReferenceKey } from "../semantic/names/reference";
import type { CheckedFunctionModifiers } from "../semantic/surface/checked-program";
import type {
  CheckedPlatformEnsuredFact,
  CheckedPlatformEnsuredFactSurface,
} from "../semantic/surface/proof-contracts";
import type { ConcreteResourceKind } from "../semantic/surface/resource-kind";
import type { CheckedType } from "../semantic/surface/type-model";
import type { SourceSpan } from "../shared/source-span";
import type { HirCompilerIntrinsicCallMetadata } from "../hir/hir";
import type { InstantiatedHirId, MonoInstanceId } from "./ids";

declare const MONO_CHECKED_TYPE_BRAND: unique symbol;

export type MonoCheckedType = CheckedType & { readonly [MONO_CHECKED_TYPE_BRAND]: true };

export type MonoLocalId = InstantiatedHirId<HirLocalId>;
export type MonoExpressionId = InstantiatedHirId<HirExpressionId>;
export type MonoStatementId = InstantiatedHirId<HirStatementId>;
export type MonoProofExpressionId = number & { readonly __brand: "MonoProofExpressionId" };

export interface MonoDeterministicTable<Key, Value> {
  get(key: Key): Value | undefined;
  entries(): readonly Value[];
}

export type MonoProofOwner =
  | { readonly kind: "function"; readonly instanceId: MonoInstanceId }
  | { readonly kind: "type"; readonly instanceId: MonoInstanceId }
  | { readonly kind: "image"; readonly instanceId: MonoInstanceId };

export interface MonoInstantiatedProofId<IdValue> {
  readonly owner: MonoProofOwner;
  readonly hirId: IdValue;
  readonly instanceId: MonoInstanceId;
}

export type MonoLocalMode = "receiver" | "parameter" | "ordinary" | "temporary" | "error";

export type MonoLocalIntroducedBy =
  | "receiver"
  | "parameter"
  | "sourceLet"
  | "pattern"
  | "forBinding"
  | "takeAlias"
  | "validationArm"
  | "temporary"
  | "recovery";

export interface MonoLocal {
  readonly localId: MonoLocalId;
  readonly name: string;
  readonly type: MonoCheckedType;
  readonly resourceKind: ConcreteResourceKind;
  readonly mode: MonoLocalMode;
  readonly introducedBy: MonoLocalIntroducedBy;
  readonly sourceOrigin: string;
  readonly parameterId?: ParameterId;
}

export type MonoLocalTable = MonoDeterministicTable<MonoLocalId, MonoLocal>;

export type MonoPlaceRoot =
  | { readonly kind: "receiver"; readonly parameterId: ParameterId }
  | { readonly kind: "parameter"; readonly parameterId: ParameterId }
  | { readonly kind: "local"; readonly localId: MonoLocalId }
  | { readonly kind: "temporary"; readonly ordinal: number }
  | { readonly kind: "imageDevice"; readonly imageId: ImageId; readonly fieldId: FieldId }
  | {
      readonly kind: "validationPayload";
      readonly validationId: MonoInstantiatedProofId<ValidationId>;
    }
  | { readonly kind: "error" };

export type MonoPlaceProjection =
  | { readonly kind: "field"; readonly fieldId: FieldId }
  | { readonly kind: "deref" }
  | { readonly kind: "variant"; readonly name: string };

export type MonoResourcePlaceKind =
  | "receiver"
  | "parameter"
  | "local"
  | "temporary"
  | "imageDevice"
  | "validationPayload"
  | "error";

export interface MonoResourcePlace {
  readonly placeId: MonoInstantiatedProofId<ResourcePlaceId>;
  readonly canonicalKey: string;
  readonly root: MonoPlaceRoot;
  readonly projection: readonly MonoPlaceProjection[];
  readonly type: MonoCheckedType;
  readonly resourceKind: ConcreteResourceKind;
  readonly sourceOrigin: string;
  readonly kind: MonoResourcePlaceKind;
  readonly parameterId?: ParameterId;
  readonly localId?: MonoLocalId;
  readonly fieldId?: FieldId;
}

export type MonoLiteralValue =
  | { readonly kind: "integer"; readonly text: string; readonly value?: bigint }
  | { readonly kind: "string"; readonly value: string }
  | { readonly kind: "bool"; readonly value: boolean };

export interface MonoCallArgument {
  readonly name?: string;
  readonly parameterId?: ParameterId;
  readonly expression: MonoExpression;
  readonly mode?: "observe" | "consume";
  readonly place?: MonoResourcePlace;
}

export type MonoResolvedCallTarget =
  | { readonly kind: "sourceFunction"; readonly targetFunctionInstanceId: MonoInstanceId }
  | {
      readonly kind: "certifiedPlatform";
      readonly targetPlatformEdgeId: MonoInstantiatedProofId<HirPlatformContractEdgeId>;
      readonly primitiveId: PlatformPrimitiveId;
    };

export interface MonoResolvedCallTargetEntry {
  readonly callerInstanceId: MonoInstanceId;
  readonly callExpressionId: MonoExpressionId;
  readonly resolvedTarget: MonoResolvedCallTarget;
}

export interface MonoCallExpression {
  readonly callee: MonoExpression;
  readonly resolvedTarget?: MonoResolvedCallTarget;
  readonly calleeFunctionId?: FunctionId;
  readonly compilerIntrinsic?: HirCompilerIntrinsicCallMetadata;
  readonly ownerTypeId?: TypeId;
  readonly ownerTypeArguments: readonly MonoCheckedType[];
  readonly ownerTypeArgumentSource:
    | "none"
    | "receiverType"
    | "constructorExpectedType"
    | "completedMemberReference"
    | "error";
  readonly arguments: readonly MonoCallArgument[];
  readonly typeArguments: readonly MonoCheckedType[];
  readonly receiver?: MonoExpression;
  readonly sourceOrigin?: string;
  readonly recovered?: boolean;
}

export interface MonoObjectField {
  readonly fieldId?: FieldId;
  readonly name: string;
  readonly value: MonoExpression;
  readonly sourceOrigin: string;
}

export type MonoExpressionKind =
  | { readonly kind: "literal"; readonly literal: MonoLiteralValue }
  | {
      readonly kind: "name";
      readonly name: string;
      readonly localId?: MonoLocalId;
      readonly functionId?: FunctionId;
      readonly parameterId?: ParameterId;
    }
  | {
      readonly kind: "member";
      readonly receiver: MonoExpression;
      readonly fieldId?: FieldId;
      readonly memberPlace?: MonoResourcePlace;
    }
  | {
      readonly kind: "object";
      readonly typeId?: TypeId;
      readonly fields: readonly MonoObjectField[];
    }
  | { readonly kind: "call"; readonly call: MonoCallExpression }
  | { readonly kind: "attempt"; readonly attempt: MonoAttempt }
  | { readonly kind: "validationCreation"; readonly validation: MonoValidation }
  | { readonly kind: "unary"; readonly operator: string; readonly operand: MonoExpression }
  | {
      readonly kind: "binary" | "comparison";
      readonly operator: string;
      readonly left: MonoExpression;
      readonly right: MonoExpression;
    }
  | { readonly kind: "error"; readonly reason: string };

export interface MonoExpression {
  readonly expressionId: MonoExpressionId;
  readonly kind: MonoExpressionKind;
  readonly type: MonoCheckedType;
  readonly resourceKind: ConcreteResourceKind;
  readonly sourceOrigin: string;
  readonly place?: MonoResourcePlace;
}

export interface MonoLetStatement {
  readonly local: MonoLocal;
  readonly value?: MonoExpression;
}

export interface MonoAssignmentStatement {
  readonly target: MonoExpression;
  readonly value: MonoExpression;
  readonly targetPlace?: MonoResourcePlace;
}

export interface MonoIfStatement {
  readonly condition: MonoExpression;
  readonly thenBlock: MonoBlock;
  readonly elseBlock?: MonoBlock;
}

export interface MonoWhileStatement {
  readonly condition: MonoExpression;
  readonly body: MonoBlock;
}

export interface MonoMatchArm {
  readonly patternText: string;
  readonly body: MonoBlock;
  readonly bindingLocals: readonly MonoLocal[];
  readonly sourceOrigin: string;
}

export interface MonoMatchStatement {
  readonly scrutinee: MonoExpression;
  readonly arms: readonly MonoMatchArm[];
}

export interface MonoValidationMatchStatement {
  readonly validationMatchId: MonoInstantiatedProofId<ValidationId>;
  readonly scrutinee: MonoExpression;
  readonly validation?: MonoValidation;
  readonly okArm?: MonoMatchArm;
  readonly errArm?: MonoMatchArm;
  readonly sourceOrigin: string;
  readonly recovered?: boolean;
}

export interface MonoForStatement {
  readonly binding?: MonoLocal;
  readonly iterable: MonoExpression;
  readonly iteration: MonoForIteration;
  readonly body: MonoBlock;
}

export type MonoForIteration =
  | { readonly kind: "ordinary" }
  | {
      readonly kind: "stream";
      readonly sessionId: MonoInstantiatedProofId<SessionId>;
      readonly itemBrandId: MonoInstantiatedProofId<BrandId>;
      readonly closureObligationId: MonoInstantiatedProofId<ObligationId>;
      readonly itemType: MonoCheckedType;
      readonly itemResourceKind: ConcreteResourceKind;
    }
  | { readonly kind: "error" };

export type MonoTakeOperand =
  | {
      readonly kind: "place";
      readonly place: MonoResourcePlace;
      readonly expression: MonoExpression;
    }
  | {
      readonly kind: "takeOnlyCall";
      readonly call: MonoCallExpression;
      readonly callExpressionId: MonoExpressionId;
      readonly resultType: MonoCheckedType;
      readonly resultResourceKind: ConcreteResourceKind;
      readonly resultPlace: MonoResourcePlace;
    }
  | { readonly kind: "error"; readonly expression?: MonoExpression };

export type MonoTakeKind =
  | {
      readonly kind: "stream";
      readonly sessionId: MonoInstantiatedProofId<SessionId>;
      readonly itemBrandId: MonoInstantiatedProofId<BrandId>;
      readonly closureObligationId: MonoInstantiatedProofId<ObligationId>;
      readonly itemType: MonoCheckedType;
      readonly itemResourceKind: ConcreteResourceKind;
    }
  | {
      readonly kind: "buffer";
      readonly bufferPlace: MonoResourcePlace;
      readonly obligationId: MonoInstantiatedProofId<ObligationId>;
    }
  | {
      readonly kind: "validatedBuffer";
      readonly sessionId: MonoInstantiatedProofId<SessionId>;
      readonly memberBrandId: MonoInstantiatedProofId<BrandId>;
      readonly closureObligationId: MonoInstantiatedProofId<ObligationId>;
    }
  | { readonly kind: "error" };

export interface MonoTakeStatement {
  readonly operand: MonoTakeOperand;
  readonly takeKind: MonoTakeKind;
  readonly aliasLocal?: MonoLocal;
  readonly body: MonoBlock;
  readonly sourceOrigin: string;
}

export type MonoStatementKind =
  | { readonly kind: "block"; readonly block: MonoBlock }
  | { readonly kind: "let"; readonly statement: MonoLetStatement }
  | { readonly kind: "assignment"; readonly statement: MonoAssignmentStatement }
  | { readonly kind: "if"; readonly statement: MonoIfStatement }
  | { readonly kind: "while"; readonly statement: MonoWhileStatement }
  | { readonly kind: "loop"; readonly body: MonoBlock }
  | { readonly kind: "for"; readonly statement: MonoForStatement }
  | { readonly kind: "match"; readonly statement: MonoMatchStatement }
  | { readonly kind: "validationMatch"; readonly statement: MonoValidationMatchStatement }
  | { readonly kind: "take"; readonly statement: MonoTakeStatement }
  | { readonly kind: "return"; readonly expression?: MonoExpression }
  | { readonly kind: "yield"; readonly expression?: MonoExpression }
  | { readonly kind: "break" }
  | { readonly kind: "continue" }
  | { readonly kind: "expression"; readonly expression: MonoExpression }
  | { readonly kind: "error"; readonly reason: string };

export interface MonoStatement {
  readonly statementId: MonoStatementId;
  readonly kind: MonoStatementKind;
  readonly sourceOrigin: string;
}

export interface MonoBlock {
  readonly statements: readonly MonoStatement[];
  readonly sourceOrigin: string;
}

export interface MonoBodyIndex {
  readonly expressions: MonoDeterministicTable<MonoExpressionId, MonoExpression>;
  readonly statements: MonoDeterministicTable<MonoStatementId, MonoStatement>;
}

export type MonoRequirementOwner =
  | { readonly kind: "function"; readonly functionInstanceId: MonoInstanceId }
  | { readonly kind: "type"; readonly typeInstanceId: MonoInstanceId };

export type MonoProofExpression =
  | {
      readonly proofExpressionId: MonoProofExpressionId;
      readonly kind: "literal";
      readonly value: string | boolean | bigint;
      readonly sourceOrigin: string;
    }
  | {
      readonly proofExpressionId: MonoProofExpressionId;
      readonly kind: "reference";
      readonly name: string;
      readonly functionId?: FunctionId;
      readonly fieldId?: FieldId;
      readonly sourceOrigin: string;
    }
  | {
      readonly proofExpressionId: MonoProofExpressionId;
      readonly kind: "call";
      readonly calleeFunctionId?: FunctionId;
      readonly arguments: readonly MonoProofExpression[];
      readonly sourceOrigin: string;
    }
  | {
      readonly proofExpressionId: MonoProofExpressionId;
      readonly kind: "binary";
      readonly operator: string;
      readonly left: MonoProofExpression;
      readonly right: MonoProofExpression;
      readonly sourceOrigin: string;
    }
  | {
      readonly proofExpressionId: MonoProofExpressionId;
      readonly kind: "error";
      readonly reason: string;
      readonly sourceOrigin: string;
    };

export type MonoRequirementExpression =
  | { readonly kind: "structured"; readonly expression: MonoProofExpression }
  | { readonly kind: "opaque"; readonly text: string }
  | { readonly kind: "error"; readonly reason: string };

export interface MonoRequirement {
  readonly requirementId: MonoInstantiatedProofId<HirRequirementId>;
  readonly owner: MonoRequirementOwner;
  readonly expression: MonoRequirementExpression;
  readonly sourceOrigin: string;
}

export interface MonoObligation {
  readonly obligationId: MonoInstantiatedProofId<ObligationId>;
  readonly kind:
    | "takeClosure"
    | "streamClosure"
    | "bufferDischarge"
    | "validatedBufferClosure"
    | "terminalClosure"
    | "callRequirement"
    | "error";
  readonly sourceOrigin: string;
  readonly place?: MonoResourcePlace;
}

export interface MonoSession {
  readonly sessionId: MonoInstantiatedProofId<SessionId>;
  readonly kind: "take" | "streamFor" | "validation" | "attempt";
  readonly sourceOrigin: string;
  readonly place?: MonoResourcePlace;
}

export type MonoBrandCanonicalKey =
  | `image:${number}:field:${number}:root:${string}`
  | `platform:${number}:primitive:${string}:contract:${string}:target:${string}`
  | `function:${number}:session:${number}`
  | `function:${number}:validation:${number}`
  | `function:${number}:take:${number}`;

export type MonoBrandOrigin =
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
  | {
      readonly kind: "functionSession";
      readonly functionId: FunctionId;
      readonly ordinal: number;
    }
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

export interface MonoBrand {
  readonly brandId: MonoInstantiatedProofId<BrandId>;
  readonly canonicalKey: MonoBrandCanonicalKey;
  readonly origin: MonoBrandOrigin;
  readonly sourceOrigin?: string;
}

export interface MonoCallSiteRequirement {
  readonly callSiteRequirementId: MonoInstantiatedProofId<CallSiteRequirementId>;
  readonly callExpressionId: MonoExpressionId;
  readonly requirement: MonoRequirement;
  readonly sourceOrigin: string;
}

export interface MonoValidation {
  readonly validationId: MonoInstantiatedProofId<ValidationId>;
  readonly validationExpressionId: MonoExpressionId;
  readonly sourcePlace: MonoResourcePlace;
  readonly pendingResultPlace: MonoResourcePlace;
  readonly resultLocalId?: MonoLocalId;
  readonly validatedBufferTypeId: TypeId;
  readonly okPayloadType: MonoCheckedType;
  readonly errPayloadType: MonoCheckedType;
  readonly sourceOrigin: string;
}

export interface MonoAttempt {
  readonly attemptId: MonoInstantiatedProofId<AttemptId>;
  readonly attemptExpressionId: MonoExpressionId;
  readonly fallibleExpression: MonoExpression;
  readonly alternativeExpression?: MonoExpression;
  readonly declaredInputPlaces: readonly MonoResourcePlace[];
  readonly sourceOrigin: string;
}

export interface MonoTerminalCall {
  readonly terminalCallId: MonoInstantiatedProofId<HirTerminalCallId>;
  readonly callExpressionId: MonoExpressionId;
  readonly calleeFunctionId: FunctionId;
  readonly closureObligationId: MonoInstantiatedProofId<ObligationId>;
  readonly sourceOrigin: string;
}

export interface MonoPrivateStateTransition {
  readonly transitionId: MonoInstantiatedProofId<PrivateStateTransitionId>;
  readonly functionId: FunctionId;
  readonly kind: "advance" | "close" | "unknown";
  readonly place?: MonoResourcePlace;
  readonly transitionOrdinalForPlace: number;
  readonly sourceOrigin: string;
}

export type MonoCertifiedPlatformEnsuredFact = CheckedPlatformEnsuredFact;

export type MonoPlatformContractEdgeKey = string & {
  readonly __brand: "MonoPlatformContractEdgeKey";
};

export function monoPlatformContractEdgeKey(value: string): MonoPlatformContractEdgeKey {
  return value as MonoPlatformContractEdgeKey;
}

export interface MonoPlatformContractEdge {
  readonly edgeId: MonoInstantiatedProofId<HirPlatformContractEdgeId>;
  readonly sourceFunctionId: FunctionId;
  readonly primitiveId: PlatformPrimitiveId;
  readonly contractId: PlatformContractId;
  readonly targetId: TargetId;
  readonly certificate?: import("../semantic/surface/checked-program").CertifiedPlatformBinding["certificate"];
  readonly sourceRequirementIds?: readonly MonoInstantiatedProofId<HirRequirementId>[];
  readonly callExpressionId: MonoExpressionId;
  readonly callOrigin?: string;
  readonly instantiatedOwnerTypeArguments: readonly MonoCheckedType[];
  readonly instantiatedFunctionTypeArguments: readonly MonoCheckedType[];
  readonly monomorphicEdgeKey: MonoPlatformContractEdgeKey;
  readonly abi: {
    readonly targetId: TargetId;
    readonly primitiveId: PlatformPrimitiveId;
    readonly contractId: PlatformContractId;
  };
  readonly ensuredFacts: readonly CheckedPlatformEnsuredFactSurface[];
  readonly sourceOrigin: string;
}

export type MonoFactContent =
  | {
      readonly kind: "predicateCall";
      readonly predicateFunctionId: FunctionId;
      readonly arguments?: readonly MonoExpression[];
      readonly statePlace?: MonoResourcePlace;
    }
  | { readonly kind: "ensure"; readonly expressionId: MonoExpressionId }
  | {
      readonly kind: "platformEnsure";
      readonly edgeId: MonoInstantiatedProofId<HirPlatformContractEdgeId>;
      readonly fact: MonoCertifiedPlatformEnsuredFact;
    }
  | {
      readonly kind: "matchRefinement";
      readonly scrutineeExpressionId: MonoExpressionId;
      readonly variantReferenceKey: string;
      readonly fieldBindingKeys: readonly string[];
    };

export interface MonoFactOrigin {
  readonly factOriginId: MonoInstantiatedProofId<FactOriginId>;
  readonly fact?: MonoFactContent;
  readonly content?: MonoFactContent;
  readonly sourceOrigin: string;
}

export interface MonoImageOrigin {
  readonly imageOriginId: MonoInstantiatedProofId<HirImageOriginId>;
  readonly imageId: ImageId;
  readonly fieldId?: FieldId;
  readonly deviceSurfaceId?: DeviceSurfaceId;
  readonly sourceOrigin: string;
}

export interface MonoImageDevice {
  readonly fieldId: FieldId;
  readonly deviceSurfaceId: DeviceSurfaceId;
  readonly place: MonoResourcePlace;
  readonly rootPlaces: readonly MonoResourcePlace[];
  readonly brandIds: readonly MonoInstantiatedProofId<BrandId>[];
  readonly sourceOrigin: string;
}

export interface MonoImage {
  readonly instanceId: MonoInstanceId;
  readonly imageId: ImageId;
  readonly itemId: ItemId;
  readonly entryFunctionInstanceId?: MonoInstanceId;
  readonly devices: readonly MonoImageDevice[];
  readonly sourceOrigin: string;
}

export type MonoImageTable = MonoDeterministicTable<MonoInstanceId, MonoImage>;

export interface MonoFieldRecord {
  readonly fieldId: FieldId;
  readonly ownerTypeInstanceId: MonoInstanceId;
  readonly name: string;
  readonly type: MonoCheckedType;
  readonly resourceKind: ConcreteResourceKind;
  readonly sourceOrigin: string;
}

export interface MonoEnumCaseRecord {
  readonly enumTypeInstanceId: MonoInstanceId;
  readonly caseItemId: ItemId;
  readonly name: string;
  readonly ordinal: number;
  readonly sourceOrigin: string;
}

export type MonoLayoutIntegerWidth =
  | { readonly kind: "targetSize" }
  | { readonly kind: "type"; readonly type: MonoCheckedType };

export interface MonoLayoutIntegerRange {
  readonly minimum: bigint;
  readonly maximum: bigint;
  readonly provenance:
    | "checkedType"
    | "wireEncoding"
    | "sourceLength"
    | "derivedCases"
    | "arithmetic";
}

export type MonoLayoutExpression =
  | {
      readonly kind: "integerLiteral";
      readonly value: bigint;
      readonly width: MonoLayoutIntegerWidth;
      readonly sourceOrigin: string;
    }
  | {
      readonly kind: "sourceLength";
      readonly width: { readonly kind: "targetSize" };
      readonly sourceOrigin: string;
    }
  | {
      readonly kind: "fieldValue";
      readonly fieldId: FieldId;
      readonly fieldKind: "parameter" | "layout" | "derived";
      readonly type: MonoCheckedType;
      readonly sourceOrigin: string;
    }
  | {
      readonly kind: "add" | "subtract" | "multiply";
      readonly left: MonoLayoutExpression;
      readonly right: MonoLayoutExpression;
      readonly width: MonoLayoutIntegerWidth;
      readonly sourceOrigin: string;
    };

export interface MonoDerivedFieldCase {
  readonly condition: MonoLayoutExpression | { readonly kind: "otherwise" };
  readonly result: MonoLayoutExpression;
  readonly sourceOrigin: string;
}

export interface MonoValidatedBufferLayoutField {
  readonly field: MonoFieldRecord;
  readonly offset: MonoLayoutExpression;
  readonly length?: MonoLayoutExpression;
  readonly layoutWireEndian?: WireEndian;
  readonly wireEncoding?: WireScalarEncoding;
  readonly sourceOrigin: string;
}

export interface MonoValidatedBufferDerivedField {
  readonly field: MonoFieldRecord;
  readonly source: MonoLayoutExpression;
  readonly cases: readonly MonoDerivedFieldCase[];
  readonly sourceOrigin: string;
}

export interface MonoTypeInstance {
  readonly instanceId: MonoInstanceId;
  readonly sourceTypeId: TypeId;
  readonly sourceItemId: ItemId;
  readonly sourceName?: string;
  readonly sourceModulePathKey?: string;
  readonly sourceKind: SourceItemKind;
  readonly typeArguments: readonly MonoCheckedType[];
  readonly fields: readonly MonoFieldRecord[];
  readonly enumCases: readonly MonoEnumCaseRecord[];
  readonly resourceKind: ConcreteResourceKind;
  readonly sourceOrigin: string;
}

export type MonoTypeTable = MonoDeterministicTable<MonoInstanceId, MonoTypeInstance>;

export interface MonoValidatedBuffer {
  readonly instanceId: MonoInstanceId;
  readonly typeId: TypeId;
  readonly itemId: ItemId;
  readonly parameterFields: readonly MonoFieldRecord[];
  readonly layoutDerivedFieldOrder: readonly FieldId[];
  readonly layoutFields: readonly MonoValidatedBufferLayoutField[];
  readonly derivedFields: readonly MonoValidatedBufferDerivedField[];
  readonly requirements: readonly MonoRequirement[];
  readonly sourceOrigin: string;
}

export type MonoValidatedBufferTable = MonoDeterministicTable<MonoInstanceId, MonoValidatedBuffer>;

export type MonoFunctionBodyStatus = "sourceBody" | "certifiedPlatform" | "bodylessRecovery";

export interface MonoParameter {
  readonly parameterId: ParameterId;
  readonly name: string;
  readonly type: MonoCheckedType;
  readonly mode: "observe" | "consume";
  readonly resourceKind: ConcreteResourceKind;
  readonly referenceKey?: SyntaxReferenceKey;
  readonly sourceSpan: SourceSpan;
}

export interface MonoReceiver {
  readonly parameterId: ParameterId;
  readonly ownerItemId: ItemId;
  readonly type: MonoCheckedType;
  readonly resourceKind: ConcreteResourceKind;
  readonly mode: "observe" | "consume";
  readonly referenceKey?: SyntaxReferenceKey;
}

export interface MonoFunctionSignature {
  readonly functionId: FunctionId;
  readonly itemId: ItemId;
  readonly ownerItemId?: ItemId;
  readonly receiver?: MonoReceiver;
  readonly parameters: readonly MonoParameter[];
  readonly returnType: MonoCheckedType;
  readonly returnKind: ConcreteResourceKind;
  readonly modifiers: CheckedFunctionModifiers;
  readonly sourceSpan: SourceSpan;
}

export interface MonoFunctionInstance {
  readonly instanceId: MonoInstanceId;
  readonly sourceFunctionId: FunctionId;
  readonly sourceItemId: ItemId;
  readonly ownerTypeInstanceId?: MonoInstanceId;
  readonly ownerTypeArguments: readonly MonoCheckedType[];
  readonly functionTypeArguments: readonly MonoCheckedType[];
  readonly signature: MonoFunctionSignature;
  readonly bodyStatus: MonoFunctionBodyStatus;
  readonly locals: MonoLocalTable;
  readonly body?: MonoBlock;
  readonly bodyIndex?: MonoBodyIndex;
  readonly declaredRequirements: readonly MonoRequirement[];
  readonly sourceOrigin: string;
  readonly hirSourceOrigin: HirOriginId;
}

export type MonoFunctionTable = MonoDeterministicTable<MonoInstanceId, MonoFunctionInstance>;

export type MonoExternalRootReason =
  | "imageEntry"
  | "deviceHandler"
  | "hardwareCallback"
  | "targetRequired";

export interface MonoExternalRoot {
  readonly functionInstanceId: MonoInstanceId;
  readonly reason: MonoExternalRootReason;
  readonly origin: HirOriginId;
}

export type MonoReachableFunctionReason = MonoExternalRootReason | "sourceCall";

export interface MonoReachableFunction {
  readonly functionInstanceId: MonoInstanceId;
  readonly reason: MonoReachableFunctionReason;
  readonly origin: HirOriginId;
}

export type MonoReachableFunctionTable = MonoDeterministicTable<
  MonoInstanceId,
  MonoReachableFunction
> & {
  has(key: MonoInstanceId): boolean;
};

export type MonoInstantiationEdgeSource =
  | { readonly kind: "image"; readonly imageId: ImageId }
  | {
      readonly kind: "function";
      readonly instanceId: MonoInstanceId;
      readonly callExpressionId?: MonoExpressionId;
    }
  | {
      readonly kind: "type";
      readonly instanceId: MonoInstanceId;
      readonly fieldId?: FieldId;
    };

export type MonoInstantiationEdgeTargetKind = "function" | "type" | "proofMetadata";

export interface MonoInstantiationEdge {
  readonly source: MonoInstantiationEdgeSource;
  readonly targetInstanceId: MonoInstanceId;
  readonly targetKind: MonoInstantiationEdgeTargetKind;
  readonly sourceOrigin: string;
}

export interface MonoInstantiationGraph {
  readonly edges: readonly MonoInstantiationEdge[];
}

export type MonoProofMetadataTableCoverageKey =
  | "obligations"
  | "sessions"
  | "brands"
  | "resourcePlaces"
  | "callSiteRequirements"
  | "validations"
  | "attempts"
  | "terminalCalls"
  | "privateStateTransitions"
  | "factOrigins"
  | "platformContractEdges"
  | "imageOrigins";

export interface MonoProofMetadata {
  readonly obligations: MonoDeterministicTable<
    MonoInstantiatedProofId<ObligationId>,
    MonoObligation
  >;
  readonly sessions: MonoDeterministicTable<MonoInstantiatedProofId<SessionId>, MonoSession>;
  readonly brands: MonoDeterministicTable<MonoInstantiatedProofId<BrandId>, MonoBrand>;
  readonly resourcePlaces: MonoDeterministicTable<
    MonoInstantiatedProofId<ResourcePlaceId>,
    MonoResourcePlace
  >;
  readonly callSiteRequirements: MonoDeterministicTable<
    MonoInstantiatedProofId<CallSiteRequirementId>,
    MonoCallSiteRequirement
  >;
  readonly validations: MonoDeterministicTable<
    MonoInstantiatedProofId<ValidationId>,
    MonoValidation
  >;
  readonly attempts: MonoDeterministicTable<MonoInstantiatedProofId<AttemptId>, MonoAttempt>;
  readonly terminalCalls: MonoDeterministicTable<
    MonoInstantiatedProofId<HirTerminalCallId>,
    MonoTerminalCall
  >;
  readonly privateStateTransitions: MonoDeterministicTable<
    MonoInstantiatedProofId<PrivateStateTransitionId>,
    MonoPrivateStateTransition
  >;
  readonly factOrigins: MonoDeterministicTable<
    MonoInstantiatedProofId<FactOriginId>,
    MonoFactOrigin
  >;
  readonly platformContractEdges: MonoDeterministicTable<
    MonoInstantiatedProofId<HirPlatformContractEdgeId>,
    MonoPlatformContractEdge
  >;
  readonly imageOrigins: MonoDeterministicTable<
    MonoInstantiatedProofId<HirImageOriginId>,
    MonoImageOrigin
  >;
}

export type MonoResolvedCallTargetTable = MonoDeterministicTable<string, MonoResolvedCallTarget>;

export interface MonomorphizedHirProgram {
  readonly image: MonoImage;
  readonly externalRoots: readonly MonoExternalRoot[];
  readonly reachableFunctions: MonoReachableFunctionTable;
  readonly functions: MonoFunctionTable;
  readonly types: MonoTypeTable;
  readonly validatedBuffers: MonoValidatedBufferTable;
  readonly proofMetadata: MonoProofMetadata;
  readonly instantiationGraph: MonoInstantiationGraph;
  readonly origins: HirOriginTable;
  readonly resolvedCallTargets: MonoResolvedCallTargetTable;
  readonly reachablePlatformPrimitiveIds: readonly PlatformPrimitiveId[];
}

export const MONO_STATEMENT_KIND_COVERAGE: Readonly<
  Record<(typeof HIR_STATEMENT_KINDS)[number], true>
> = Object.freeze({
  block: true,
  let: true,
  assignment: true,
  if: true,
  while: true,
  loop: true,
  for: true,
  match: true,
  validationMatch: true,
  take: true,
  return: true,
  yield: true,
  break: true,
  continue: true,
  expression: true,
  error: true,
});

export const MONO_EXPRESSION_KIND_COVERAGE: Readonly<
  Record<(typeof HIR_EXPRESSION_KINDS)[number], true>
> = Object.freeze({
  literal: true,
  name: true,
  member: true,
  object: true,
  call: true,
  attempt: true,
  validationCreation: true,
  unary: true,
  binary: true,
  comparison: true,
  error: true,
});

export const MONO_PROOF_METADATA_TABLE_COVERAGE: Readonly<
  Record<MonoProofMetadataTableCoverageKey, true>
> = Object.freeze({
  obligations: true,
  sessions: true,
  brands: true,
  resourcePlaces: true,
  callSiteRequirements: true,
  validations: true,
  attempts: true,
  terminalCalls: true,
  privateStateTransitions: true,
  factOrigins: true,
  platformContractEdges: true,
  imageOrigins: true,
});

export type MonoStatementKindName = HirStatementKindName;
export type MonoExpressionKindName = HirExpressionKindName;
